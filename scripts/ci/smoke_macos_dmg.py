#!/usr/bin/env python3
"""Install the macOS DMG as a person does, open the app, and see its window.

The 0.3.9 release went out with a DMG that was built and signed and could not
open. Nothing in the pipeline had ever started the app it shipped. This does:

 1. the DMG is mounted read-only and its .app is copied to a folder of its own
    (the drag to Applications);
 2. both binaries of the desktop crate, the shell and the companion, are there,
    executable, and hold exactly the architectures the build is meant for;
 3. the shell is started the way the Finder starts it (a bare PATH, a HOME of
    its own, so that it finds neither the developer's tools nor their data) and
    must show a window on screen within the time given, and still be alive a
    few seconds later;
 4. it is stopped, and nothing it started is left running.

Window titles need the Screen Recording permission, which a runner cannot
grant; the window list of the process (layer 0, on screen, a real size) does not.

Not checked here: the team's container. GitHub's macOS runners cannot run a
virtual machine, so Podman has no machine to start: that part is tried on a real Mac.

Usage: smoke_macos_dmg.py <dmg> [--arch arm64] [--timeout 60] [--hold 5]
Exit: 0 ok, 1 the app does not open (or the DMG is not what was meant), 2 the check could not run.
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BINARIES = ("jht-desktop", "jht-existing-team")
# the environment the Finder gives an app: no Homebrew, no cargo, no developer's variables
FINDER_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
# a window the person could see: not a status item or a hairline (the app's own is 1180 x 660)
MIN_SIDE = 80

LIST_WINDOWS = """
ObjC.import('CoreGraphics');
var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)));
JSON.stringify((list || []).map(function (w) {
  return {pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, alpha: w.kCGWindowAlpha,
          width: w.kCGWindowBounds ? w.kCGWindowBounds.Width : 0, height: w.kCGWindowBounds ? w.kCGWindowBounds.Height : 0};
}));
"""


class Fail(Exception):
    """The app, or the DMG, is not what it must be."""


class CannotRun(Exception):
    """The check itself could not run (no screen session, no tool)."""


def run(argv, **kwargs):
    return subprocess.run(argv, capture_output=True, text=True, **kwargs)


def windows_of(pids, listing):
    """The windows of these processes that a person would see: on screen, layer 0, visible, of a real size."""
    return [
        w for w in listing
        if w.get("pid") in pids and w.get("layer") == 0 and (w.get("alpha") or 0) > 0
        and (w.get("width") or 0) >= MIN_SIDE and (w.get("height") or 0) >= MIN_SIDE
    ]


def on_screen_windows():
    out = run(["osascript", "-l", "JavaScript", "-e", LIST_WINDOWS])
    if out.returncode:
        raise CannotRun(f"no window list (is there a screen session?): {out.stderr.strip()[:300]}")
    try:
        return json.loads(out.stdout)
    except ValueError:
        raise CannotRun(f"window list not understood: {out.stdout.strip()[:300]}")


def descendants(pid):
    """The process and everything below it."""
    table = run(["ps", "-axo", "pid=,ppid="]).stdout.split()
    parent = dict(zip(map(int, table[0::2]), map(int, table[1::2])))
    found, frontier = {pid}, [pid]
    while frontier:
        children = [p for p, q in parent.items() if q in frontier and p not in found]
        found.update(children)
        frontier = children
    return found


def check_app(app: Path, archs: set) -> None:
    for name in BINARIES:
        binary = app / "Contents" / "MacOS" / name
        if not binary.is_file():
            raise Fail(f"{name} is not in the app")
        if not os.access(binary, os.X_OK):
            raise Fail(f"{name} is not executable")
        found = run(["lipo", "-archs", str(binary)])
        if found.returncode or set(found.stdout.split()) != archs:
            raise Fail(f"{name} holds {sorted(set(found.stdout.split()))}, the build is meant for {sorted(archs)}")
    signed = run(["codesign", "--verify", "--deep", "--strict", str(app)])
    if signed.returncode:
        raise Fail(f"the app does not pass codesign --verify: {signed.stderr.strip()[:300]}")


def install(dmg: Path, into: Path) -> Path:
    with tempfile.TemporaryDirectory() as mount:
        attach = run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, str(dmg)])
        if attach.returncode:
            raise Fail(f"the DMG does not mount: {attach.stderr.strip()[:300]}")
        try:
            apps = sorted(Path(mount).glob("*.app"))
            if len(apps) != 1:
                raise Fail(f"the DMG holds {len(apps)} apps, not one")
            target = into / apps[0].name
            copied = run(["ditto", str(apps[0]), str(target)])
            if copied.returncode:
                raise Fail(f"the app cannot be copied out of the DMG: {copied.stderr.strip()[:300]}")
            return target
        finally:
            run(["hdiutil", "detach", mount, "-force"])


def stop(process, tree):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid in tree:
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=10)
            break
        except subprocess.TimeoutExpired:
            continue


def open_app(app: Path, timeout: float, hold: float, home: Path) -> float:
    binary = app / "Contents" / "MacOS" / "jht-desktop"
    log = home / "stderr.log"
    env = {"PATH": FINDER_PATH, "HOME": str(home), "TMPDIR": str(home) + "/", "LANG": "en_US.UTF-8"}
    with open(log, "wb") as errors:
        process = subprocess.Popen([str(binary)], env=env, stdin=subprocess.DEVNULL, stdout=errors, stderr=errors,
                                   start_new_session=True)
        started = time.monotonic()
        tree = {process.pid}
        try:
            seen = None
            while time.monotonic() - started < timeout:
                if process.poll() is not None:
                    raise Fail(f"the app exited with {process.returncode} before showing a window: "
                               f"{log.read_text(errors='replace')[-400:].strip()}")
                tree |= descendants(process.pid)
                if windows_of(tree, on_screen_windows()):
                    seen = time.monotonic() - started
                    break
                time.sleep(1)
            if seen is None:
                raise Fail(f"no window on screen after {timeout:.0f} s (the app is running: {sorted(tree)})")
            time.sleep(hold)
            if process.poll() is not None:
                raise Fail(f"the app showed a window and exited with {process.returncode} {hold:.0f} s later")
            tree |= descendants(process.pid)
            if not windows_of(tree, on_screen_windows()):
                raise Fail(f"the window was gone {hold:.0f} s later")
            return seen
        finally:
            stop(process, tree)
            time.sleep(1)
            left = [pid for pid in tree if run(["ps", "-p", str(pid)]).returncode == 0]
            if left:
                print(f"::warning::processes left after stopping the app: {left}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dmg", type=Path)
    parser.add_argument("--arch", default="arm64", help="exact architectures of both binaries, comma separated")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--hold", type=float, default=5)
    args = parser.parse_args()
    archs = set(args.arch.split(","))
    if sys.platform != "darwin":
        print("this check runs on macOS", file=sys.stderr)
        return 2
    if not args.dmg.is_file():
        print(f"FAIL no such DMG: {args.dmg}", file=sys.stderr)
        return 1
    work = Path(tempfile.mkdtemp(prefix="jht-dmg-smoke-"))
    try:
        applications = work / "Applications"
        applications.mkdir()
        home = work / "home"
        home.mkdir()
        app = install(args.dmg, applications)
        check_app(app, archs)
        seconds = open_app(app, args.timeout, args.hold, home)
    except Fail as problem:
        print(f"FAIL {problem}", file=sys.stderr)
        return 1
    except CannotRun as problem:
        print(f"CANNOT RUN {problem}", file=sys.stderr)
        return 2
    finally:
        shutil.rmtree(work, ignore_errors=True)
    notice = ("window: ok, after %.0f s and still there %.0f s later; installed from %s, architectures %s.\n"
              "container: NOT checked here (GitHub's macOS runners cannot run a virtual machine): to be tried on a real Mac."
              % (seconds, args.hold, args.dmg.name, ",".join(sorted(archs))))
    print(notice)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as handle:
            handle.write("### macOS DMG: installed and opened\n\n" + notice.replace("\n", "\n\n") + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
