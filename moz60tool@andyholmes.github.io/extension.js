'use strict';

const System = imports.system;

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const MessageList = imports.ui.messageList;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;


const Me = ExtensionUtils.getCurrentExtension();
const MOZ60TOOL_PATH = GLib.build_filenamev([Me.path, 'moz60tool']);
const MOZ60TOOL_URI = 'https://gitlab.gnome.org/ptomato/moz60tool/tree/master';


/**
 * Run moz60tool on every JavaScript file in @path, ensuring it isn't a symlink
 */
function checkDirectory(dir) {
    return new Promise((resolve, reject) => {
        let path = dir.get_path();

        // Ensure path isn't a symlink or moz60tool will fail
        let info = dir.query_info(
            'standard::is-symlink,standard::symlink-target',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        if (info.get_is_symlink()) {
            path = info.get_symlink_target();
        }

        // Start moz60tool
        let proc = new Gio.Subprocess({
            argv: ['find', path, '-name', '*.js', '-exec', MOZ60TOOL_PATH, '{}', '\;'],
            flags: Gio.SubprocessFlags.STDOUT_PIPE
        });
        proc.init(null);

        // Read the output
        proc.communicate_utf8_async(null, null, (proc, res) => {
            let ok, stdout, stderr;

            try {
                [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                proc.wait(null);
                resolve(stdout);
            } catch (e) {
                logError(e);
                reject(e);
            }
        });
    });
}


/**
 * Parse the result of checkDirectory() and return a dictionary of errors.
 */
async function checkExtension(extension) {
    let errors = {};

    try {
        let results = await checkDirectory(extension.dir);
        let currentFile;

        for (let line of results.split('\n')) {
            switch (true) {
                case (line.startsWith('Scanning')):
                    currentFile = line.split(' ')[1];
                    break;

                case (line === '0 errors found.'):
                    break;

                case (line.length === 0):
                    break;

                default:
                    if (!errors.hasOwnProperty(currentFile)) {
                        errors[currentFile] = [];
                    }

                    errors[currentFile].push(line);
            }
        }
    } catch (e) {
        logError(e);
    } finally {
        return errors;
    }
}


/**
 * Panel Button..
 */
class Indicator extends PanelMenu.Button {

    _init() {
        super._init(null, `moz60tool-indicator`, false);

        this._dialogs = {};
        this._items = {};

        // Subprocess launcher for dialogs
        this.launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE
        });

        // Indicator Icon
        let icon = new St.Icon({
            icon_name: 'dialog-question-symbolic',
            style_class: 'system-status-icon'
        });
        this.actor.add_actor(icon);

        // Notify the user if gnome-shell is already running under moz60...
        if (System.version > 15304) {
            icon.icon_name = 'dialog-error-symbolic';

            let notice = new PopupMenu.PopupImageMenuItem(
                'Gnome Shell is currently running SpiderMonkey 60.\n' +
                'See the moz60tool repository for more information.',
                'dialog-error',
                { reactive: false }
            );
            notice.label.clutter_text.use_markup = true;
            notice._icon.icon_size = 32;
            notice._icon.y_align = Clutter.ActorAlign.START;
            this.menu.addMenuItem(notice);

            // moz60tool repository link
            this.menu.addAction(
                'moz60tool Repository',
                this._moz60tool,
                'web-browser-symbolic'
            );

        // ...otherwise populate the menu
        } else {
            // We have to do this "later" since we probably aren't the last
            // extension to be loaded.
            let _tmp = this.menu.connect('open-state-changed', () => {
                this.menu.disconnect(_tmp);
                this._populateMenu()
            });

            // Add a place holder so open-state-changed can still trigger
            this.menu.addAction('place-holder', () => {});
        }

        // Add the panel button
        Main.panel.addToStatusArea('moz60indicator', this);
    }

    _moz60tool() {
        Gio.app_info_launch_default_for_uri(
            MOZ60TOOL_URI,
            global.create_app_launch_context(0, -1)
        );
    }

    _populateMenu() {
        this.menu.removeAll();

        // Extensions
        for (let extension of Object.values(ExtensionUtils.extensions)) {
            this._items[extension.uuid] = this.menu.addAction(
                extension.metadata.name,
                this._checkExtension.bind(this, extension),
                'dialog-question'
            );
        }

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Check all...
        let checkItem = new PopupMenu.PopupMenuItem('Check all...');
        this.menu.box.add(checkItem.actor);
        this.menu.length++;
        checkItem.connect('activate', this._checkAllExtensions.bind(this));

        // About moz60tool
        this.menu.addAction('About moz60tool', this._moz60tool);
    }

    _openDialog(extension, results) {
        // Close any existing dialog for this extension
        if (this._dialogs.hasOwnProperty(extension.uuid)) {
            this._dialogs[extension.uuid].force_exit();
            delete this._dialogs[extension.uuid];
        }

        // Launch and track the dialog process
        let proc = this.launcher.spawnv([
            'gjs',
            Me.path + '/dialog.js',
            extension.metadata.name,
            extension.uuid,
            extension.metadata.url
        ]);
        this._dialogs[extension.uuid] = proc;

        // Cleanup on exit
        proc.wait_async(null, (proc, res) => {
            try {
                proc.wait_finish(res);
            } catch (e) {
                logError(e);
            } finally {
                delete this._dialogs[extension.uuid];
            }
        });

        // Send data
        proc.get_stdin_pipe().write_all_async(
            `${JSON.stringify(results)}\n`,
            GLib.PRIORITY_DEFAULT,
            null,
            (stream, res) => {
                try {
                    stream.write_all_finish(res);
                } catch (e) {
                }
            }
        );
    }

    async _checkExtension(extension) {
        log(`moz60tool: Checking ${extension.uuid}...`);

        this._items[extension.uuid]._icon.icon_name = 'view-refresh-symbolic';

        let results = await checkExtension(extension);

        if (Object.entries(results).length > 0) {
            this._items[extension.uuid]._icon.icon_name = 'dialog-error';
            this._openDialog(extension, results);
        } else {
            this._items[extension.uuid]._icon.icon_name = 'emblem-ok-symbolic';
        }
    }

    async _checkAllExtensions() {
        log(`moz60tool: Checking all extensions`);

        for (let extension of Object.values(ExtensionUtils.extensions)) {
            this._checkExtension(extension);
        }
    }

    destroy() {
        for (let proc of Object.values(this._dialogs)) {
            proc.force_exit();
        }

        this._items = {};

        super.destroy();
    }
}


var moz60toolIndicator = null;


function init() {
    log('Initializing moz60tool');
}


function enable() {
    log('Enabling moz60tool');
    moz60toolIndicator = new Indicator();
}


function disable() {
    log('Disabling moz60tool');
    moz60toolIndicator.destroy();
}

