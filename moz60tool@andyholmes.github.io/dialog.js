'use strict';

const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;


Gtk.init(null);


/**
 * Read the error results from stdin
 */
function readResults() {
    return new Promise((resolve, reject) => {
        let stdin = new Gio.DataInputStream({
            base_stream: new Gio.UnixInputStream({
                fd: 0,
                close_fd: false
            }),
            byte_order: Gio.DataStreamByteOrder.HOST_ENDIAN
        });

        stdin.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            try {
                let data = stream.read_line_finish(res)[0];
                let results = JSON.parse(data);
                resolve(results);
            } catch (e) {
                reject(e);
            } finally {
                stream.close(null);
            }
        });
    });
}


/**
 * Format the error results and populate the dialog
 */
async function populateDialog(dialog) {
    try {
        let results = await readResults();

        for (let [path, errors] of Object.entries(results)) {
            let filename = path.split(ARGV[1])[1];

            let expander = new Gtk.Expander({
                label: `<b>${filename}</b>`,
                use_markup: true,
                visible: true
            });
            dialog.box.add(expander);

            let box = new Gtk.Box({
                margin_left: 18,
                orientation: Gtk.Orientation.VERTICAL,
                visible: true
            });
            expander.add(box);

            for (let error of errors) {
                // Error description
                if (error.startsWith('/')) {
                    let [, line, col, msg] = error.replace(path, '').split(':');
                    error = `\n<a href="file://${path}"><b>Line ${line}, Column ${col}:${msg}</b></a>`;

                // Recommendation
                } else if (error.startsWith('  ')) {
                    error = error.replace('CORRECT:', '<b>CORRECT:</b>');
                    error = error.replace('WRONG:', '<b>WRONG:</b>');

                // Count
                } else if (error.endsWith('found.')) {
                    expander.label = `${expander.label} - ${error}`;
                    continue;
                }

                let label = new Gtk.Label({
                    label: `<tt><small>${error}</small></tt>`,
                    halign: Gtk.Align.START,
                    use_markup: true,
                    visible: true
                });
                box.add(label);
            }
        }
    } catch (e) {
        let label = new Gtk.Label({
            label: `Error reading moz60tool out for ${ARGV[1]}`,
            halign: Gtk.Align.CENTER,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            vexpand: true,
            visible: true
        });
        dialog.add(label);
    }
}


// Dialog
let dialog = new Gtk.Window({
    title: ARGV[0],
    height_request: 480,
    width_request: 640
});
dialog.connect('delete-event', () => Gtk.main_quit());

let headerbar = new Gtk.HeaderBar({
    title: ARGV[0],
    subtitle: ARGV[1],
    show_close_button: true
});
dialog.set_titlebar(headerbar);

let webButton = new Gtk.Button({
    image: new Gtk.Image({
        icon_name: 'web-browser-symbolic'
    }),
    always_show_image: true,
    tooltip_text: ARGV[2]
});
webButton.connect('clicked', () => {
    Gtk.show_uri_on_window(dialog, ARGV[2], Gdk.CURRENT_TIME);
    return false;
});
headerbar.pack_end(webButton);

let scrolledWindow = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.NEVER
});
dialog.add(scrolledWindow);

dialog.box = new Gtk.Box({
    margin: 18,
    orientation: Gtk.Orientation.VERTICAL
});
scrolledWindow.add(dialog.box)

dialog.show_all();

// Read data from stdin
populateDialog(dialog);


Gtk.main();

