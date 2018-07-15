[`moz60tool`][moz60tool] is a tool for checking your JS source code to see if
you are using any Mozilla-specific extensions that will be removed in
SpiderMonkey 60. It was written by Philip Chimento (@ptomato) and licensed MIT.

This extension is a small wrapper around `moz60tool`, allowing you to easily
check installed extensions for deprecated code. It should be compatible with
Gnome Shell 3.26+, but probably won't work on older versions.

If you discover an extension containing deprecated code that isn't yours,
consider reporting it to that extension's maintainer.

[moz60tool]: https://gitlab.gnome.org/ptomato/moz60tool/tree/master
