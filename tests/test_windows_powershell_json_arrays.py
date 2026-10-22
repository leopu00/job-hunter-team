"""A JSON array from Podman or Docker is read the same in the shell the app runs.

The app runs the Windows scripts with Windows PowerShell 5.1 (powershell.exe). Its ConvertFrom-Json
gives a JSON array to the pipeline as ONE object: `@($json | ConvertFrom-Json)` is then a single
element, the whole array. The pulled image's digests were never matched (every pull refused), and a
second Podman machine made `[string]$_.Name` the two names joined, so the JHT machine was «absent».
PowerShell 7, where the tests run, enumerates the array, which is why they were green.

Every site that reads an array now parses with -InputObject and enumerates with foreach. Each one
is run here as PowerShell 7 and in the 5.1 shape, reproduced with ConvertFrom-Json -NoEnumerate (the
switch PowerShell 7 added to keep the old behaviour). A last test keeps the old form out of the scripts.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
ENABLER = SCRIPTS / "enable-podman-windows-runtime.ps1"
PROBE = SCRIPTS / "podman-windows-probe.ps1"
WRAPPER = SCRIPTS / "jht-wrapper.ps1"
PWSH = shutil.which("pwsh")

WINDOWS_POWERSHELL_JSON = (
    "function ConvertFrom-Json {\n"
    "  param([Parameter(ValueFromPipeline = $true)]$InputObject)\n"
    "  process { , (Microsoft.PowerShell.Utility\\ConvertFrom-Json -InputObject $InputObject -NoEnumerate) }\n"
    "}\n"
)
SHELLS = ["windows-powershell-5.1", "powershell-7"]

# Two Podman machines of this user: another one first, the JHT one stopped.
MACHINES = json.dumps([{"Name": "other", "Running": True}, {"Name": "jht-podman", "Running": False}], indent=2)

needs_pwsh = pytest.mark.skipif(PWSH is None or os.name == "nt", reason="needs PowerShell off Windows")


def _function(source: str, name: str) -> str:
    return source[source.index(f"function {name} {{") :].split("\n}\n", 1)[0] + "\n}\n"


def _run(tmp_path: Path, shell: str, body: str, fake_output: str) -> subprocess.CompletedProcess:
    script = tmp_path / "run.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        + (WINDOWS_POWERSHELL_JSON if shell == SHELLS[0] else "")
        # the engine prints its JSON over several lines, as podman and docker do
        + "function fake-engine { $global:LASTEXITCODE = 0; @'\n" + fake_output + "\n'@ -split \"`n\" }\n"
        "Set-Alias -Name podman -Value fake-engine; Set-Alias -Name docker -Value fake-engine\n"
        + body,
        encoding="utf-8",
    )
    return subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-File", str(script)], capture_output=True,
                          text=True, timeout=60, env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)})


@needs_pwsh
def test_the_5_1_shape_is_really_one_object(tmp_path):
    done = _run(tmp_path, SHELLS[0], "@((fake-engine) -join \"`n\" | ConvertFrom-Json).Count\n", MACHINES)
    assert done.stdout.split() == ["1"], done.stdout + done.stderr
    done = _run(tmp_path, SHELLS[1], "@((fake-engine) -join \"`n\" | ConvertFrom-Json).Count\n", MACHINES)
    assert done.stdout.split() == ["2"], done.stdout + done.stderr


@needs_pwsh
@pytest.mark.parametrize("shell", SHELLS)
def test_the_setup_finds_its_machine_among_the_users_machines(tmp_path, shell):
    source = ENABLER.read_text(encoding="utf-8")
    block = source[source.index("$machinesJson = ") : source.index("  if (-not $machine) {")]
    done = _run(tmp_path, shell, "$Podman = 'fake-engine'; $MachineName = 'jht-podman'\n" + block
                + "\n\"$($machine.Name) $([bool]$machine.Running)\"\n", MACHINES)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip().splitlines()[-1] == "jht-podman False"


@needs_pwsh
@pytest.mark.parametrize("shell", SHELLS)
def test_the_probe_finds_its_machine_among_the_users_machines(tmp_path, shell):
    function = _function(PROBE.read_text(encoding="utf-8"), "Get-MachineState")
    done = _run(tmp_path, shell, function + "$m = Get-MachineState -Name 'jht-podman'\n\"$($m.Name) $($m.Running)\"\n",
                MACHINES)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip().splitlines()[-1] == "jht-podman False"


@needs_pwsh
@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize(("containers", "count"), [(1, 1), (2, 2)])
def test_the_probe_counts_the_containers_docker_inspect_returns(tmp_path, shell, containers, count):
    source = PROBE.read_text(encoding="utf-8")
    block = source[source.index("  $inspectJson = ") : source.index("  if ($inspectCode -ne 0 -or $containerInspect.Count -ne 1) {")]
    inspect = json.dumps([{"Id": str(n), "Mounts": [{"Destination": "/jht_user"}]} for n in range(containers)], indent=2)
    done = _run(tmp_path, shell, block + "\n\"$($containerInspect.Count) $($containerInspect[0].Mounts[0].Destination)\"\n",
                inspect)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip().splitlines()[-1] == f"{count} /jht_user"


@needs_pwsh
@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize(("name", "state"), [("jht-podman", "present"), ("jht-other", "absent")])
def test_the_wrapper_sees_its_machine_next_to_another_one(tmp_path, shell, name, state):
    function = _function(WRAPPER.read_text(encoding="utf-8"), "Get-JhtPodmanMachineState")
    done = _run(tmp_path, shell, function + f"Get-JhtPodmanMachineState -PodmanPath 'fake-engine' -MachineName '{name}'\n",
                MACHINES)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip().splitlines()[-1] == state


def test_no_script_the_app_runs_reads_an_array_through_the_pipeline_any_more():
    for path in (ENABLER, PROBE, WRAPPER):
        code = "\n".join(line for line in path.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))
        assert not re.search(r"@\(\(?[^()\n]*\|\s*ConvertFrom-Json", code), path.name
