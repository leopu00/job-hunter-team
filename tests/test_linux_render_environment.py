"""The Linux app turns off WebKitGTK's DMA-BUF renderer before the web view exists, unless the person said otherwise.

Origin: collaudo Linux 44cf (B5), AppImage on an Intel Haswell GPU with WebKitGTK 4.1 under Wayland: grey and green
horizontal bands over half of the window from the Office page on, gone only by starting the app again. They go away with
WEBKIT_DISABLE_DMABUF_RENDERER=1. The startup-order guard lives only in linux_render.rs, including the one-shot upload
that exits before window startup. These Python tests cover platform wiring and the troubleshooting documentation.
"""

from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "desktop" / "src-tauri" / "src"


def _text(name: str) -> str:
    return (SRC / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_variable_is_set_to_one_on_linux_only_and_only_when_it_is_not_set():
    source = _text("linux_render.rs")
    assert 'pub(crate) const DISABLE_DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";' in source
    assert 'entries.push((DISABLE_DMABUF, "1"));' in source
    # a value already there, whatever it is, is kept: the check is "is there one", not "is it 1"
    assert "if current(DISABLE_DMABUF).is_none()" in source
    apply = source[source.index("pub(crate) fn apply()") - 40 : source.index("#[cfg(test)]")]
    assert '#[cfg(target_os = "linux")]' in apply and '#[cfg(not(target_os = "linux"))]' in apply
    assert "std::env::set_var(name, value)" in apply


def test_the_reason_for_always_on_linux_is_written_where_the_next_person_reads_it():
    doc = _text("linux_render.rs").split("use std::ffi::OsString;", 1)[0]
    for needle in ("Haswell", "WebKitGTK 4.1", "Wayland", "B5", "never replaced"):
        assert needle in doc, needle
