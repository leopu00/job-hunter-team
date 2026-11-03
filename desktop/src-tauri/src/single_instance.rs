//! One window of the app at a time.
//!
//! Opening the app while it is already open (the first window blank or hidden, a second double click, the launcher
//! pressed twice) used to start a SECOND process that shared the team's container, the runtime log and the provider
//! sign-in with the first, and whose "Try again" ran the installer under the team the first one had just started.
//! `tauri-plugin-single-instance` makes the second process hand over to the first and exit; the first brings its
//! window forward. The hand-over carries the second process's arguments and folder, and nothing here reads them: the
//! only effect of a second opening is to show the window that already exists.

use tauri::{AppHandle, Manager, Runtime};

/// The label of the app's one window (tauri.conf.json).
const MAIN_WINDOW: &str = "main";

/// Brings the existing window to the front: restored if it was minimised, shown if it was hidden, focused.
pub(crate) fn bring_main_window_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_plugin_is_the_first_one_the_builder_registers_and_only_brings_the_window_forward() {
        let lib = include_str!("lib.rs");
        let single = lib
            .find("tauri_plugin_single_instance::init")
            .expect("the single-instance plugin is registered");
        let dialog = lib.find("tauri_plugin_dialog::init").expect("the dialog plugin is registered");
        let builder = lib.find("tauri::Builder::default()").expect("the builder");
        // the plugin decides whether this process goes on at all: it comes before every other plugin and the setup
        assert!(builder < single && single < dialog, "single-instance must be the first plugin");
        let registration = &lib[single..dialog];
        assert!(
            registration.contains("single_instance::bring_main_window_forward"),
            "the callback shows the existing window"
        );
        // the second process's arguments and folder are named with a leading underscore: not used for anything
        assert!(registration.contains("|app, _args, _cwd|"), "the hand-over is not read");
    }

    #[test]
    fn the_main_window_label_is_the_one_in_the_config() {
        let config = include_str!("../tauri.conf.json");
        assert!(config.contains("\"label\": \"main\""), "tauri.conf.json names the window `main`");
        assert_eq!(super::MAIN_WINDOW, "main");
    }
}
