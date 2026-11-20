"""The help of the container reaches the screen from the Windows wrapper (`scripts/jht-wrapper.ps1`): with the container up,
`jht --help`, `jht help` and the help of a command of the container came out empty on Windows, with code 0."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PS1 = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")


POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")


@pytest.mark.skipif(POWERSHELL is None, reason="needs PowerShell")
@pytest.mark.parametrize("sub", ["--help", "-h", "help", "enrichment"])
def test_the_help_of_the_container_reaches_the_screen_from_powershell(tmp_path, sub):
    """Windows, new user, build 15: with the container up `jht --help`, `jht help` and `jht enrichment --help` printed nothing,
    with code 0. The help went through `exit (Invoke-HelpWithoutDocker ...)`, and what a command prints inside a function is
    the value the function returns: the help of the container ended up in the code of the exit, not on the screen."""
    ps = PS1.replace("\r\n", "\n")
    fn = re.search(r"^function Invoke-HelpWithoutDocker \{\n.*?^\}\n", ps, re.S | re.M).group(0)
    if sub == "enrichment":
        start = ps.index("  if (Test-HostCommandUsesLocalHelp $Sub) {\n")
        call = ps[ps.index("\n  }\n", start) + 5:]
        call, rest = "$Sub = 'enrichment'; $Rest = @('--help')\n" + call[:call.index("\n}\n")], ["enrichment", "--help"]
    elif sub == "help":
        arm = ps[ps.index("\n  'help' {\n"):]
        call, rest = arm[arm.index("    Invoke-HelpWithoutDocker"):arm.index("\n  }\n")], ["help"]
    else:
        arm = ps[ps.index("  { $_ -in @('-h', '--help', '') } {\n"):]
        call, rest = arm[arm.index("\n") + 1:arm.index("\n  }\n")], ["--help"]
    script = tmp_path / "help-harness.ps1"
    script.write_text(
        "$Container = 'jht'\n$NodeEntry = '/app/cli/bin/jht.js'\n$env:JHT_HOST_TYPE = 'windows'\n"
        "function Test-DockerReachable { $true }\nfunction Test-ContainerUp { $true }\n"
        "function Write-LocalHelp { Write-Output 'LOCAL HELP' }\n"
        "function docker { Write-Output 'Usage: jht [command]'; Write-Output \"ARGS $($args -join ' ')\"; $global:LASTEXITCODE = 3 }\n"
        + fn + call + "\nWrite-Output 'AFTER THE HELP'\n", encoding="utf-8")
    done = subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-File", str(script)],
                          capture_output=True, text=True, timeout=60)
    out = done.stdout.replace("\r\n", "\n")
    assert "Usage: jht [command]" in out, (out, done.stderr)
    assert f"ARGS exec -e JHT_HOST_TYPE=windows jht node /app/cli/bin/jht.js {' '.join(rest)}" in out
    # the code of the help is the code of the wrapper, and nothing runs after it
    assert done.returncode == 3 and "AFTER THE HELP" not in out and "LOCAL HELP" not in out
