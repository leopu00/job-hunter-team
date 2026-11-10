"""The files install.ps1 publishes in the bin folder, and the two uninstalls that must take every one of them (and nothing else).

After an uninstall `podman-machine-bridge.ps1` was left in ~/.local/bin. The list of the files the installer puts there is
written by hand in three places that cannot read one another at run time (install.ps1 and enable-podman-windows-runtime.ps1 are fetched
alone; the wrapper and the app's uninstaller run when the installer is gone), so this test is the one list: it reads the files the
installer and the enabler publish in the bin folder from their text, and fails if one of them is not in the uninstall of the wrapper
(`jht uninstall`) and in the uninstall of the app. What is not published by the installer is never in either list (another program's file,
`kimi.exe`, `uv.exe`, stays), apart from the old `docker.exe` shim of earlier installs.

Run with: pytest tests/test_windows_uninstall_files.py -v
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
INSTALL = (SCRIPTS / "install.ps1").read_text(encoding="utf-8")
ENABLE = (SCRIPTS / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
WRAPPER = (SCRIPTS / "jht-wrapper.ps1").read_text(encoding="utf-8")
APP_UNINSTALL = (SCRIPTS / "jht-uninstall-windows.ps1").read_text(encoding="utf-8")

# Files of earlier installs that the uninstalls still take (the old Docker shim lived in the bin folder).
OLD_INSTALLS = {"docker.exe"}


def published_in_bin() -> set[str]:
    """Every file name the installer or the enabler names under $BinDir, and the shim folder's command."""
    names: set[str] = set()
    for text in (INSTALL, ENABLE):
        names |= set(re.findall(r"Join-Path \$BinDir '([^'\\]+\.[A-Za-z0-9]+)'", text))
    # `$ShimBin = Join-Path $BinDir 'shim'` and its jht.cmd, published by install.ps1
    assert re.search(r"\$ShimBin\s*=\s*Join-Path \$BinDir 'shim'", INSTALL)
    assert "Join-Path $ShimBin 'jht.cmd'" in INSTALL
    names.add("shim\\jht.cmd")
    return names


def wrapper_known() -> set[str]:
    block = WRAPPER[WRAPPER.index("$knownCommands = @("):]
    block = block[:block.index("\n  )\n")]
    names = set(re.findall(r"Join-Path \$binPath '([^']+)'", block))
    return {name for name in names if name != "shim"}


def app_known() -> set[str]:
    own = APP_UNINSTALL[APP_UNINSTALL.index("function Get-JhtOwnCommands"):]
    own = own[:own.index("\n}\n")]
    names = set(re.findall(r"@\('([^']+)', '[^']+'\)", own))
    names |= set(re.findall(r"\[IO\.Path\]::Combine\(\$Bin, '([^']+)'\)", own))
    shim = re.search(r"\[IO\.Path\]::Combine\(\$Bin, 'shim', '([^']+)'\)", own)
    if shim:
        names.add("shim\\" + shim.group(1))
    return names


def test_the_installer_publishes_the_files_this_test_expects_so_it_is_not_reading_nothing():
    assert {"jht.ps1", "windows-private-acl.ps1", "jht.cmd", "podman-machine-bridge.ps1", "shim\\jht.cmd"} <= published_in_bin()


def test_the_uninstall_of_the_wrapper_takes_every_file_the_installer_publishes_in_bin():
    missing = published_in_bin() - wrapper_known()
    assert not missing, f"jht uninstall does not know what install.ps1 publishes: {sorted(missing)}"


def test_the_uninstall_of_the_app_takes_every_file_the_installer_publishes_in_bin():
    missing = published_in_bin() - app_known()
    assert not missing, f"the uninstall of the app does not know what install.ps1 publishes: {sorted(missing)}"


def test_neither_uninstall_names_a_file_the_installer_does_not_publish_apart_from_the_old_shim():
    published = published_in_bin()
    for name, known in (("wrapper", wrapper_known()), ("app", app_known())):
        extra = known - published - OLD_INSTALLS
        assert not extra, f"the {name} uninstall would remove a file that is not the installer's: {sorted(extra)}"
    assert not ({"kimi.exe", "uv.exe"} & (wrapper_known() | app_known())), "another program's files are never in the lists"


def test_the_two_uninstalls_agree_on_the_files():
    assert wrapper_known() == app_known(), sorted(wrapper_known() ^ app_known())
