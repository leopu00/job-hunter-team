"""install.ps1 puts the `shim` folder right BEFORE the bin folder in the user PATH, and touches nothing else.

PowerShell takes the first folder of the PATH that has a `jht`; in the bin folder `jht.ps1` comes before `jht.cmd` and the
default execution policy refuses it, so a folder with only the command shim has to come first (see
test_windows_jht_command_under_default_policy.py for the lookup itself). The ordering is a function of three strings
(`Get-OrderedUserPath`), run here in the PowerShell under test; it also reads the installer source for the wiring.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from windows_native_fakes import powershell_argv

ROOT = Path(__file__).resolve().parent.parent
INSTALL = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")
BIN = r"C:\Users\p\.local\bin"
SHIM = BIN + r"\shim"


def _function() -> str:
    start = INSTALL.index("function Get-OrderedUserPath {")
    return INSTALL[start:INSTALL.index("\nfunction Add-ToUserPath {", start)]


def _order(user_path: str) -> str:
    script = _function() + f"\n[Console]::Out.Write((Get-OrderedUserPath -UserPath '{user_path}' -ShimBin '{SHIM}' -BinDir '{BIN}'))\n"
    done = subprocess.run([*powershell_argv(), "-Command", script], capture_output=True, text=True, timeout=60, check=False)
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_the_installer_registers_the_shim_folder_through_that_function():
    assert "$ShimBin    = Join-Path $BinDir 'shim'" in INSTALL
    assert "Get-OrderedUserPath -UserPath $userPath -ShimBin $ShimBin -BinDir $BinDir" in INSTALL
    assert re.search(r"Publish-JhtFile -Destination \(Join-Path \$ShimBin 'jht\.cmd'\)", INSTALL)


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ("", f"{SHIM};{BIN}"),
        (BIN, f"{SHIM};{BIN}"),
        (rf"C:\a;{BIN};C:\b", rf"C:\a;{SHIM};{BIN};C:\b"),
        (rf"C:\a;{SHIM};{BIN};C:\b", rf"C:\a;{SHIM};{BIN};C:\b"),
        (rf"C:\a;{BIN};{SHIM};C:\b", rf"C:\a;{SHIM};{BIN};C:\b"),
        (rf"C:\a;{BIN.upper()}\;C:\b", rf"C:\a;{SHIM};{BIN.upper()}\;C:\b"),
        (r"C:\a;;C:\b", rf"C:\a;C:\b;{SHIM};{BIN}"),
        (r"C:\a;C:\b", rf"C:\a;C:\b;{SHIM};{BIN}"),
    ],
    ids=["empty", "bin-only", "bin-in-the-middle", "already-right", "shim-after-bin", "case-and-slash", "empty-entries-dropped", "no-bin"],
)
def test_the_shim_folder_comes_right_before_the_bin_folder(before, after):
    assert _order(before) == after
