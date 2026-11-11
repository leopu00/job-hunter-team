"""The `jht` command shim hands the exit code of jht to its caller intact, also when `jht uninstall` deletes the shim while it runs.

The shim was `pwsh -File jht.ps1 %*` and, on the NEXT line, `exit /b %errorlevel%`: cmd reads a batch file line by line, so the line
after the call was read from a file `jht uninstall` had just deleted ("The system cannot find the path specified." and rc 1 after a
good uninstall). `& goto :eof` or `& exit /b` on the same line fail the same way: cmd reopens the file after the command. Now each
call is one line that starts with `(goto) 2>nul &`, which leaves the batch context before jht runs. This runs the shim written by install.ps1 for real.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name != "nt", reason="runs cmd.exe and the Windows PowerShells")

STUB = r"""
if ($args -contains 'delete') {
  Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'jht.cmd') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'shim\jht.cmd') -Force -ErrorAction SilentlyContinue
}
[Console]::Out.WriteLine('ARGS=' + ($args -join '|'))
exit ([int]$env:JHT_STUB_EXIT)
"""


def _shim_text() -> str:
    start = INSTALL.index('$shimContent = @"\n') + len('$shimContent = @"\n')
    return INSTALL[start : INSTALL.index('\n"@', start)]


def _powershell_dir() -> str:
    return str(Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0")


def _path_for(branch: str) -> str:
    system = str(Path(os.environ["SystemRoot"]) / "System32")
    if branch == "powershell":
        return os.pathsep.join([system, _powershell_dir()])
    pwsh = shutil.which("pwsh")
    assert pwsh, "pwsh is required for the pwsh branch of the shim"
    return os.pathsep.join([str(Path(pwsh).parent), system, _powershell_dir()])


@pytest.mark.parametrize("branch", ["powershell", "pwsh"])
@pytest.mark.parametrize("folder", ["bin", "shim"])
@pytest.mark.parametrize("code", [0, 7])
def test_the_exit_code_of_jht_reaches_the_caller_when_jht_deletes_the_shim(tmp_path, branch, folder, code):
    bin_dir = tmp_path / "bin"
    (bin_dir / "shim").mkdir(parents=True)
    (bin_dir / "jht.ps1").write_text(STUB, encoding="utf-8")
    text = _shim_text()
    (bin_dir / "jht.cmd").write_bytes((text.replace("\n", "\r\n") + "\r\n").encode("ascii"))
    (bin_dir / "shim" / "jht.cmd").write_bytes((text.replace("%~dp0jht.ps1", "%~dp0..\\jht.ps1").replace("\n", "\r\n") + "\r\n").encode("ascii"))
    shim = bin_dir / "jht.cmd" if folder == "bin" else bin_dir / "shim" / "jht.cmd"
    env = {"SystemRoot": os.environ["SystemRoot"], "PATH": _path_for(branch), "JHT_STUB_EXIT": str(code), "USERPROFILE": str(tmp_path)}
    done = subprocess.run(["cmd.exe", "/d", "/c", str(shim), "uninstall", "--confirm", "delete"], env=env, text=True,
                          capture_output=True, timeout=120, check=False)
    assert done.returncode == code, (done.stdout, done.stderr)
    assert "ARGS=uninstall|--confirm|delete" in done.stdout
    assert done.stderr.strip() == "", done.stderr
    assert not shim.exists(), "the shim deleted itself while it ran, the case that broke"
