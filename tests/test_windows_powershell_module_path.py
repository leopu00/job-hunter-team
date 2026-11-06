"""The module path of the PowerShell the app was started from never reaches a Windows PowerShell 5.1 child.

An app opened from PowerShell 7 hands PowerShell 7's PSModulePath to every Windows PowerShell 5.1 it starts; 5.1 then cannot
load Microsoft.PowerShell.Security ("could not autoload the matching module") and Get-Acl / Get-FileHash fail: the setup stops on its
first ACL, the stop of the team fails the same way. The app removes the variable from every child it starts
(runtime_host::clean_powershell_env, tested in Rust); install.ps1 and the wrapper also rebuild it themselves. Here: the sources,
and a real Windows PowerShell 5.1 given a module path that names only a folder without modules.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from windows_native_fakes import WINDOWS, windows_env

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
INSTALL = SCRIPTS / "install.ps1"
WRAPPER = SCRIPTS / "jht-wrapper.ps1"
needs_windows = pytest.mark.skipif(not WINDOWS, reason="needs Windows PowerShell 5.1")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


# An app opened from PowerShell 7 hands PowerShell 7's PSModulePath to every Windows PowerShell 5.1 it starts; 5.1 then cannot
# load Microsoft.PowerShell.Security ("CouldNotAutoloadMatchingModule") and Get-Acl / Get-FileHash fail. The app removes the
# variable from its children (runtime_host::clean_powershell_env); install.ps1 and the wrapper also rebuild it themselves.

BEGIN, END = "# PSMODULEPATH-BEGIN", "# PSMODULEPATH-END"


def _module_path_block(path: Path) -> str:
    text = _text(path)
    assert text.count(BEGIN) == 1 and text.count(END) == 1, path.name
    return text[text.index(BEGIN) : text.index(END) + len(END)]


@pytest.mark.parametrize("script", [INSTALL, WRAPPER], ids=lambda p: p.name)
def test_install_and_wrapper_rebuild_the_module_path_before_any_other_command(script):
    text = _text(script)
    block = _module_path_block(script)
    # in Windows PowerShell only; before the first command that needs a module, which is far below
    assert "$PSVersionTable.PSEdition -eq 'Desktop'" in block
    before = text[: text.index(BEGIN)]
    for module_command in ("Get-FileHash", "Get-Acl", "Set-Acl", "Get-AuthenticodeSignature", "Expand-Archive", "Import-Module"):
        assert module_command not in "\n".join(line for line in before.split("\n") if not line.lstrip().startswith("#")), module_command
    # it uses the folders Windows PowerShell itself uses: its own, Program Files', the person's, the machine's and the user's list
    for piece in ("WindowsPowerShell", "'Modules'", "$PSHOME", "'Machine', 'User'"):
        assert piece in block, piece


WINDOWS_POWERSHELL_51 = (
    Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
)


@needs_windows
@pytest.mark.parametrize("script", [INSTALL, WRAPPER], ids=lambda p: p.name)
def test_windows_powershell_51_with_the_module_path_of_another_powershell_loads_its_modules_after_the_block(tmp_path, script):
    """The PSModulePath a PowerShell 7 parent hands down breaks Get-FileHash and Get-Acl in 5.1; the block puts the 5.1 folders
    back. The same case runs in 5.1 whatever shell runs the test."""
    assert WINDOWS_POWERSHELL_51.is_file()
    # what PowerShell 7 hands down: its own module folder first (it holds another Microsoft.PowerShell.Security, for the Core
    # edition, that Windows PowerShell finds first and cannot load), then the folders of Windows PowerShell
    pwsh = shutil.which("pwsh")
    seven = [Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "PowerShell" / "7" / "Modules"]
    if pwsh:
        seven.insert(0, Path(pwsh).parent / "Modules")
    folder = next((candidate for candidate in seven if (candidate / "Microsoft.PowerShell.Security").is_dir()), None)
    if folder is None:
        pytest.skip("PowerShell 7 is not installed: there is no module folder of it to hand down")
    system = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "Modules"
    dirty = os.pathsep.join([str(folder), str(system)])
    probe = tmp_path / "probe.txt"
    probe.write_text("x", encoding="utf-8")

    def run(prefix: str) -> subprocess.CompletedProcess:
        case = tmp_path / "case.ps1"
        case.write_text(
            prefix + "\n$ErrorActionPreference = 'Stop'\n"
            f"try {{ $h = (Get-FileHash -Algorithm SHA256 -LiteralPath '{probe}').Hash; $a = (Get-Acl -LiteralPath '{probe}').Owner; 'LOADED' }} "
            "catch { 'FAILED: ' + $_.FullyQualifiedErrorId }\n",
            encoding="utf-8",
        )
        env = {**windows_env(tmp_path), "PSModulePath": dirty}
        return subprocess.run(
            [str(WINDOWS_POWERSHELL_51), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(case)],
            capture_output=True, text=True, timeout=120, env=env,
        )

    control = run("")
    assert "FAILED" in control.stdout, "without the block the dirty path breaks the modules: " + control.stdout + control.stderr
    fixed = run(_module_path_block(script))
    assert "LOADED" in fixed.stdout, fixed.stdout + fixed.stderr
