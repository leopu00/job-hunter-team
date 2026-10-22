// A release build on Windows is a window program, not a console one: without this
// a black console window opens behind the app on every start. Programs the app
// starts are hidden on their own (runtime_host::hide_console).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jht_desktop_lib::run();
}
