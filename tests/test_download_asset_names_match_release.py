"""`jht download` asks for the file names the release workflow really publishes.

The names are written in four places that nothing tied together: the workflow that copies each installer into
`release-assets/` and tells `release_artifacts.py verify` which ones to expect, the bash wrapper, the PowerShell
wrapper and the Node CLI. A name that drifts in one of them is a download that looks for a file the release does
not have (the checksum line is missing, or the asset is a 404). This reads the names from the workflow, not from a
list kept here, and fails when any of the other three asks for a different set.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
WRAPPER_SH = (ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8")
WRAPPER_PS1 = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
CLI_DOWNLOAD = (ROOT / "cli/src/commands/download.js").read_text(encoding="utf-8")

NAME = r"job-hunter-team-[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)+"  # a file name with an extension (not the CLI user agent)
# 0.4.0 ships no Windows installer (tests/test_update_release_assets.py); the Windows name below is the one of the
# 0.3.x releases, which the wrapper still serves for those versions and refuses from 0.4.
WINDOWS_OF_THE_OLD_RELEASES = "job-hunter-team-windows-x64-setup.exe"


def _between(text: str, start: str, end: str) -> str:
    head = text.split(start, 1)
    assert len(head) == 2, f"{start!r} not found"
    return head[1].split(end, 1)[0]


def _names(text: str) -> set[str]:
    return set(re.findall(NAME, text)) - {WINDOWS_OF_THE_OLD_RELEASES}


def _release_job() -> str:
    """The `release:` job of the workflow, the one that attaches the assets (build-desktop stays in the file, turned off)."""
    return RELEASE.split("\n  release:\n", 1)[1]


def _published() -> set[str]:
    """What the release job copies, verifies and attaches as an installer: in 0.4.0, nothing."""
    job = _release_job()
    copied = set(re.findall(rf"cp \"?\$\w+\"? release-assets/({NAME})", job))
    expected = set(re.findall(rf"--expected-asset ({NAME})", job))
    assert copied == expected, f"copied {sorted(copied)} but verified {sorted(expected)}"
    return copied


def test_the_release_of_0_4_0_attaches_no_installer() -> None:
    # 0.4.0 installs from the command line (install.sh, install.ps1): no desktop app is built, verified or attached
    assert _published() == set()
    assert ".dmg" not in _release_job()
    assert "if: ${{ vars.JHT_RELEASE_DESKTOP_APP == 'true' }}" in RELEASE.split("\n  build-desktop:\n", 1)[1].split("\n  publish-runtime:\n", 1)[0]


# `jht download` still asks for the desktop app of the macOS release (a known defect of 0.4.0, to go in 0.4.1: it answers
# 404). Until then the three places that ask for it ask for the same name.
APP = {"job-hunter-team-macos-universal.dmg"}


def test_the_bash_wrapper_asks_for_the_name_of_the_app() -> None:
    body = _between(WRAPPER_SH, "handle_host_download() {", "# ── Upgrade runtime")
    assert _names(body) == APP


def test_the_powershell_wrapper_asks_for_the_name_of_the_app() -> None:
    body = _between(WRAPPER_PS1, "function Invoke-HostDownload {", "# ── Upgrade runtime")
    assert _names(body) == APP


def test_the_node_cli_asks_for_the_name_of_the_app() -> None:
    assert _names(CLI_DOWNLOAD) == APP


def test_the_windows_name_is_only_for_the_old_releases() -> None:
    # the name is in the wrappers and the CLI for 0.3.x; the release of 0.4.0 neither builds nor expects it
    assert WINDOWS_OF_THE_OLD_RELEASES not in RELEASE
    for text in (WRAPPER_SH, WRAPPER_PS1, CLI_DOWNLOAD):
        assert WINDOWS_OF_THE_OLD_RELEASES in text


def test_no_linux_installer_is_built_expected_attached_or_asked_for() -> None:
    for text in (RELEASE, CLI_DOWNLOAD, _between(WRAPPER_SH, "handle_host_download() {", "# ── Upgrade runtime"),
                 _between(WRAPPER_PS1, "function Invoke-HostDownload {", "# ── Upgrade runtime")):
        assert "AppImage" not in text and "linux-x64" not in text and ".deb'" not in text
    assert "appimage" not in RELEASE.lower() and "dpkg-deb" not in RELEASE
