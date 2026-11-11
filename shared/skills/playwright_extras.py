"""The Chromium with a window that the closer opens, when it is not in the image of the team but in a volume.

The headless shell of the scout stays in /opt/playwright, in the image. The full Chromium (the one `apply_flow.py --headful` draws on
the live screen) is a tool that arrives on request: a one-shot container of the extras image copies it into the volume
`jht-playwright`, and the team container mounts that volume read-only on /opt/playwright-extras.

  <volume>/<first 16 hex of the digest of the extras image>/chromium-<rev>/...   the browser
  <volume>/<same folder>/.complete                                              the full digest, written LAST

The team container trusts a folder only when its marker holds a full digest whose first 16 hex are the name of the folder, it is a plain
folder with a plain executable inside, and nothing in the path is a link: never a half copy, never a link. When two such folders are there
(the seconds between a new copy and the removal of the old one) the one whose marker is newer wins. The digest is not read from the
environment of the team container: a variable there would change the configuration hash the wrapper attests the container by. Anything
else gives None and the closer keeps the browser it always had.

    python3 playwright_extras.py populate <digest> <source> <volume>     (inside the extras image, volume writable)
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import sys
from pathlib import Path

DEFAULT_ROOT = "/opt/playwright-extras"
DEFAULT_SOURCE = "/opt/playwright"
MARKER = ".complete"
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
BROWSER_DIR_RE = re.compile(r"^chromium-[0-9]+$")
# Lists of the packages the browser needs, left by the installer with a mode only root reads: not part of what runs.
NOT_COPIED = ("rpm.deps", "deb.deps")
HEX16_RE = re.compile(r"^[0-9a-f]{16}$")


def folder_name(digest: str) -> str:
    return digest.removeprefix("sha256:")[:16]


def _plain_dir(path: Path) -> bool:
    try:
        return stat.S_ISDIR(os.lstat(path).st_mode)
    except OSError:
        return False


def _plain_file(path: Path) -> bool:
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except OSError:
        return False


def _browser_in(folder: Path) -> str | None:
    marker = folder / MARKER
    if not _plain_dir(folder) or not _plain_file(marker):
        return None
    try:
        written = marker.read_text(encoding="ascii").strip()
        names = sorted(name for name in os.listdir(folder) if BROWSER_DIR_RE.fullmatch(name))
    except (OSError, UnicodeDecodeError):
        return None
    if not DIGEST_RE.fullmatch(written) or folder_name(written) != folder.name:
        return None
    for name in reversed(names):
        if not _plain_dir(folder / name):
            continue
        for chrome_dir in sorted(os.listdir(folder / name)):
            binary = folder / name / chrome_dir / "chrome"
            if chrome_dir.startswith("chrome-linux") and _plain_dir(folder / name / chrome_dir) and _plain_file(binary) and os.access(binary, os.X_OK):
                return str(binary)
    return None


def headful_executable(env: dict | None = None) -> str | None:
    """The path of the full Chromium in the volume of the extras image, or None."""
    env = os.environ if env is None else env
    root = Path(env.get("JHT_PLAYWRIGHT_EXTRAS") or DEFAULT_ROOT)
    if not _plain_dir(root):
        return None
    try:
        entries = [root / name for name in os.listdir(root) if HEX16_RE.fullmatch(name)]
        entries.sort(key=lambda folder: os.lstat(folder / MARKER).st_mtime_ns if _plain_file(folder / MARKER) else -1, reverse=True)
    except OSError:
        return None
    for folder in entries:
        found = _browser_in(folder)
        if found:
            return found
    return None


def populate(digest: str, source: Path, volume: Path) -> int:
    """Copy the browser of the image into <volume>/<digest folder>, the marker last; then drop the folders of other digests."""
    if not DIGEST_RE.fullmatch(digest):
        print("playwright-extras: digest not valid", file=sys.stderr)
        return 2
    browsers = sorted(name for name in os.listdir(source) if BROWSER_DIR_RE.fullmatch(name) and _plain_dir(source / name))
    if not browsers:
        print("playwright-extras: no browser in the image", file=sys.stderr)
        return 3
    target = volume / folder_name(digest)
    if _plain_file(target / MARKER) and (target / MARKER).read_text(encoding="ascii").strip() == digest:
        return 0  # already there, whole
    shutil.rmtree(target, ignore_errors=True)  # a folder without marker is a copy that never ended
    target.mkdir(parents=True)
    try:
        for name in browsers:
            shutil.copytree(source / name, target / name, symlinks=True, ignore=shutil.ignore_patterns(*NOT_COPIED))
    except (OSError, shutil.Error) as exc:
        shutil.rmtree(target, ignore_errors=True)
        print(f"playwright-extras: copy failed ({type(exc).__name__}: {str(exc)[:200]})", file=sys.stderr)
        return 1
    temp = target / (MARKER + ".part")
    temp.write_text(digest + "\n", encoding="ascii")
    os.replace(temp, target / MARKER)  # the last thing that appears
    for entry in os.listdir(volume):
        if entry != target.name and _plain_dir(volume / entry):
            shutil.rmtree(volume / entry, ignore_errors=True)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 4 and argv[0] == "populate":
        return populate(argv[1], Path(argv[2]), Path(argv[3]))
    print("usage: playwright_extras.py populate <digest> <source> <volume>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
