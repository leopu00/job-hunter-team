"""The macOS DMG smoke (scripts/ci/smoke_macos_dmg.py) against DMGs built on purpose.

A gate that was never seen red proves nothing, so each way a release can be broken is a DMG here:
the app that exits at once, the app that runs and shows nothing, the companion left out, the
wrong architectures; and one that is right, with a real window. They are real DMGs of real
(tiny) Mach-O apps, signed ad-hoc, mounted and started by the script. Needs macOS with a screen
session and swiftc; anywhere else these are skipped (the gate itself runs on the macOS runner).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ci" / "smoke_macos_dmg.py"

pytestmark = pytest.mark.skipif(
    sys.platform != "darwin" or not shutil.which("swiftc"), reason="needs macOS with swiftc"
)

SLEEP = "import Foundation\nsleep(300)\n"
EXIT = "import Foundation\nexit(7)\n"
WINDOW = """import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 640, height: 480), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
window.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 640, height: 480))
window.setContentSize(NSSize(width: 640, height: 480))
window.title = "Job Hunter Team"
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { NSApp.terminate(nil) }
app.run()
"""
INFO = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>jht-desktop</string>
<key>CFBundleIdentifier</key><string>ai.jobhunterteam.smoketest</string>
<key>CFBundleName</key><string>Job Hunter Team</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
"""


def compile_stub(source: str, name: str, work: Path, arch: str = "arm64") -> Path:
    cache = work / f"{name}-{arch}"
    (work / f"{name}.swift").write_text(source)
    built = subprocess.run(
        ["swiftc", "-O", "-target", f"{arch}-apple-macos13.0", str(work / f"{name}.swift"), "-o", str(cache)],
        capture_output=True, text=True,
    )
    assert built.returncode == 0, built.stderr
    return cache


@pytest.fixture(scope="module")
def stubs(tmp_path_factory):
    work = tmp_path_factory.mktemp("stubs")
    return {
        "sleep": compile_stub(SLEEP, "sleep", work),
        "exit": compile_stub(EXIT, "exit", work),
        "window": compile_stub(WINDOW, "window", work),
        "sleep-x86": compile_stub(SLEEP, "sleep", work, "x86_64"),
    }


def make_dmg(tmp_path: Path, shell: Path, companion: Path | None) -> Path:
    volume = tmp_path / "volume"
    app = volume / "Job Hunter Team.app"
    macos = app / "Contents" / "MacOS"
    macos.mkdir(parents=True)
    (app / "Contents" / "Info.plist").write_text(INFO)
    shutil.copy2(shell, macos / "jht-desktop")
    if companion is not None:
        shutil.copy2(companion, macos / "jht-existing-team")
    signed = subprocess.run(["codesign", "--force", "--deep", "-s", "-", str(app)], capture_output=True, text=True)
    assert signed.returncode == 0, signed.stderr
    dmg = tmp_path / "app.dmg"
    made = subprocess.run(
        ["hdiutil", "create", "-srcfolder", str(volume), "-format", "UDZO", "-volname", "JHT", str(dmg)],
        capture_output=True, text=True,
    )
    assert made.returncode == 0, made.stderr
    return dmg


def smoke(dmg: Path, *extra: str):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(dmg), "--timeout", "12", "--hold", "2", *extra], capture_output=True, text=True
    )


def test_a_good_app_with_a_window_passes(tmp_path, stubs):
    done = smoke(make_dmg(tmp_path, stubs["window"], stubs["sleep"]))
    if done.returncode == 2:
        pytest.skip(done.stderr.strip())
    assert done.returncode == 0, done.stderr
    assert "window: ok" in done.stdout and "container: NOT checked" in done.stdout


def test_an_app_that_exits_at_once_is_red(tmp_path, stubs):
    done = smoke(make_dmg(tmp_path, stubs["exit"], stubs["sleep"]))
    if done.returncode == 2:
        pytest.skip(done.stderr.strip())
    assert done.returncode == 1 and "exited with 7" in done.stderr, done.stderr


def test_an_app_that_runs_and_shows_nothing_is_red(tmp_path, stubs):
    done = smoke(make_dmg(tmp_path, stubs["sleep"], stubs["sleep"]))
    if done.returncode == 2:
        pytest.skip(done.stderr.strip())
    assert done.returncode == 1 and "no window on screen" in done.stderr, done.stderr


def test_a_dmg_without_the_companion_is_red(tmp_path, stubs):
    done = smoke(make_dmg(tmp_path, stubs["window"], None))
    assert done.returncode == 1 and "jht-existing-team is not in the app" in done.stderr, done.stderr


def test_a_universal_build_is_red_when_only_arm64_is_meant(tmp_path, stubs):
    fat = tmp_path / "fat"
    fat_companion = tmp_path / "fat-companion"
    subprocess.run(["lipo", "-create", str(stubs["window"]), str(stubs["sleep-x86"]), "-output", str(fat)], check=True)
    subprocess.run(["lipo", "-create", str(stubs["sleep"]), str(stubs["sleep-x86"]), "-output", str(fat_companion)], check=True)
    done = smoke(make_dmg(tmp_path, fat, fat_companion))
    assert done.returncode == 1 and "the build is meant for ['arm64']" in done.stderr, done.stderr
    # and the same DMG is as it should be when both are meant
    both = smoke(tmp_path / "app.dmg", "--arch", "arm64,x86_64")
    if both.returncode == 2:
        pytest.skip(both.stderr.strip())
    assert both.returncode == 0, both.stderr


def test_a_missing_dmg_is_red():
    done = subprocess.run([sys.executable, str(SCRIPT), "/nonexistent.dmg"], capture_output=True, text=True)
    assert done.returncode == 1 and "no such DMG" in done.stderr


def test_a_window_is_one_a_person_could_see():
    sys.path.insert(0, str(ROOT / "scripts" / "ci"))
    import smoke_macos_dmg as smoke_script

    listing = [
        {"pid": 5, "layer": 0, "alpha": 1, "width": 1180, "height": 660},
        {"pid": 5, "layer": 25, "alpha": 1, "width": 1180, "height": 24},  # a menu bar item
        {"pid": 5, "layer": 0, "alpha": 0, "width": 800, "height": 600},  # invisible
        {"pid": 5, "layer": 0, "alpha": 1, "width": 20, "height": 20},  # a hairline
        {"pid": 9, "layer": 0, "alpha": 1, "width": 1180, "height": 660},  # another process
    ]
    assert smoke_script.windows_of({5}, listing) == [listing[0]]
    assert smoke_script.windows_of({6}, listing) == []
