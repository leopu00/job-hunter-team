//! How the web view is asked to draw on Linux.
//!
//! On the AppImage, on an Intel Haswell GPU with WebKitGTK 4.1 under Wayland, the window drew grey and green
//! horizontal bands over half of the screen from the Office page on (collaudo Linux 44cf, B5): the bands stayed through a
//! restore and went only when the app was started again. They go away with `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which
//! makes WebKitGTK draw through its shared-memory path instead of through DMA-BUF buffers.
//!
//! Why always on Linux, and not only "where it is needed": what goes wrong is a drawing defect, not a crash, and it depends
//! on the GPU generation, its driver, the compositor and the WebKitGTK build together; a test for "this machine is one of
//! those" would be a list that is wrong for the next machine, and the failing machine is the one that shows the stripes in
//! front of a person. The app is a window of text, cards and a small map: the shared-memory path costs it nothing a person
//! can see. The person (or support) can still turn it back on, or off, by setting the variable themselves: a value that is
//! already there is never replaced.
//!
//! It is set before the web view exists (the web process inherits the environment of the app), at the first line of `run`.

use std::ffi::OsString;

/// The name of the variable WebKitGTK reads.
pub(crate) const DISABLE_DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// The environment entries to add on Linux, given a way to read the current one: the DMA-BUF renderer is turned off unless
/// the person already said something about it (any value, `0` included).
pub(crate) fn entries_to_set(current: impl Fn(&str) -> Option<OsString>) -> Vec<(&'static str, &'static str)> {
    let mut entries = Vec::new();
    if current(DISABLE_DMABUF).is_none() {
        entries.push((DISABLE_DMABUF, "1"));
    }
    entries
}

/// Sets them in this process. Linux only: elsewhere the web view is not WebKitGTK and there is nothing to set.
#[cfg(target_os = "linux")]
pub(crate) fn apply() {
    for (name, value) in entries_to_set(|name| std::env::var_os(name)) {
        std::env::set_var(name, value);
    }
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn apply() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dmabuf_renderer_is_turned_off_when_nobody_said_anything() {
        assert_eq!(entries_to_set(|_| None), [(DISABLE_DMABUF, "1")]);
    }

    #[test]
    fn a_value_the_person_already_set_is_never_replaced() {
        for value in ["0", "1", "", "anything"] {
            assert!(entries_to_set(|name| (name == DISABLE_DMABUF).then(|| OsString::from(value))).is_empty(), "{value:?}");
        }
        // another variable is not this one
        assert_eq!(entries_to_set(|name| (name == "WEBKIT_FORCE_COMPOSITING_MODE").then(|| OsString::from("1"))), [(DISABLE_DMABUF, "1")]);
    }

    #[test]
    fn it_is_the_first_thing_run_does_and_the_module_is_declared() {
        let lib = include_str!("lib.rs").replace("\r\n", "\n");
        assert!(lib.contains("mod linux_render;"));
        let run = lib.split("pub fn run() {\n").nth(1).unwrap();
        assert!(run.starts_with("    linux_render::apply();\n"), "before the web view, before anything else");
    }

    #[test]
    fn the_name_is_the_one_webkitgtk_reads() {
        assert_eq!(DISABLE_DMABUF, "WEBKIT_DISABLE_DMABUF_RENDERER");
    }
}
