"""The Windows setup recreates a broker or a Telegram service whose user namespace leaves out its own user.

On a Podman 6 machine jht-telegram was created with the ID map 1001:0:1 alone, while jht and the
broker had the whole one (0:1:1001, 1001:0:1, 1002:1002:998999): Podman refused it at every start,
«container uses ID mappings ... but doesn't map UID 1003» (T85). Compose does not recreate a service
whose configuration did not change, and the setup recreated only jht, so it stayed so at every setup.

The setup now reads User and IDMappings of jht-broker and jht-telegram; one whose map leaves out its
uid or its gid, and that is of the jht compose project, is removed (volumes stay: `podman rm` without -v) and `jht up` creates it again, also
when jht is already running.

The code is the enabler's own, read through the PowerShell AST and run under 'Stop' against a fake
podman that answers as Podman does (a container that is not there: stderr and 125). On Windows the
fake is a native program (tests/windows_native_fakes.py) and the shell is the one JHT_TEST_SHELL
names, Windows PowerShell 5.1 by default: every case checks the engine that ran it.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"

FULL = {"UidMap": ["0:1:1001", "1001:0:1", "1002:1002:998999"], "GidMap": ["0:1:1001", "1001:0:1", "1002:1002:998999"]}
SHORT = {"UidMap": ["1001:0:1"], "GidMap": ["1001:0:1"]}

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$wanted = @('Test-IdInMap', 'Test-ContainerMapsItsUser', 'Invoke-Checked')
$found = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $n.Name }, $true))
if ($found.Count -ne $wanted.Count) { throw 'functions not found' }
foreach ($fn in $found) { Invoke-Expression $fn.Extent.Text }
if ($env:JHT_DETAILS_CASES) {
  foreach ($case in ($env:JHT_DETAILS_CASES -split "`n")) { [Console]::Out.WriteLine("MAPS=$(Test-ContainerMapsItsUser -Details $case)") }
  return
}
$statements = @($ast.EndBlock.Statements)
$first = -1; $last = -1
for ($i = 0; $i -lt $statements.Count; $i++) {
  $text = $statements[$i].Extent.Text
  if ($first -lt 0 -and $text -match '^\$sidecarRemoved = ') { $first = $i }
  if ($first -ge 0 -and $text -match '^if \(\$metadataRepaired ') { $last = $i; break }
}
if ($first -lt 0 -or $last -lt $first) { throw 'sidecar block missing' }
$Podman = $env:FAKE_PODMAN
$MachineName = 'jht-podman'
$BinDir = $env:FAKE_BIN
$metadataRepaired = $false
. ([scriptblock]::Create((@($statements[$first..$last]) | ForEach-Object { $_.Extent.Text }) -join "`n"))
[Console]::Out.WriteLine("REMOVED=$sidecarRemoved")
"""

FAKE_PODMAN = r"""#!/bin/sh
# podman --connection jht-podman <command> ...
echo "$*" >> "$FAKE_STATE/calls.log"
shift 2
case "$1" in
  inspect)
    name=$4
    if [ ! -f "$FAKE_STATE/$name.details" ]; then echo "Error: no such object: \"$name\"" >&2; exit 125; fi
    case "$6" in
      *State.Running*) if [ -f "$FAKE_STATE/$name.running" ]; then echo true; else echo false; fi ;;
      *CgroupManager*) if [ -f "$FAKE_STATE/$name.cgroups" ]; then cat "$FAKE_STATE/$name.cgroups"; else echo cgroupfs; fi ;;
      *Config.Labels*) if [ -f "$FAKE_STATE/$name.labels" ]; then cat "$FAKE_STATE/$name.labels"; else echo '{"com.docker.compose.project":"jht","com.docker.compose.service":"'"$name"'"}'; fi ;;
      *) cat "$FAKE_STATE/$name.details" ;;
    esac ;;
  ps) for n in jht jht-broker jht-telegram; do [ -f "$FAKE_STATE/$n.running" ] && echo "$n"; done; exit 0 ;;
  rm) [ -n "$FAKE_RM_FAILS" ] && { echo "Error: rm refused" >&2; exit 2; }; rm -f "$FAKE_STATE/$2.details" ;;
  stop) rm -f "$FAKE_STATE/$4.running" ;;
esac
exit 0
"""


def _details(user: str, mappings) -> str:
    return f"{user}|{json.dumps(mappings)}"


def _write(path: Path, text: str) -> None:
    # LF on Windows too: what the fake prints is what Podman would print
    path.write_text(text, encoding="utf-8", newline="\n")


def _run(tmp_path: Path, env: dict[str, str]):
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    base = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
    }
    done = subprocess.run(
        [*powershell_argv(), "-File", str(harness)],
        env={**base, "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(ENABLER), **env},
        capture_output=True, text=True, timeout=120,
    )
    assert_engine(engine, done.stderr)
    return done


def _machine(tmp_path: Path, containers: dict[str, tuple[str, bool]], rm_fails: bool = False,
             labels: dict[str, str] | None = None, cgroups: dict[str, str] | None = None):
    """containers: name -> (details, running); labels: name -> its labels JSON (default: of the jht
    project); cgroups: name -> its cgroup manager (default: cgroupfs). Returns the result, podman's
    calls, and whether jht up ran."""
    state = tmp_path / "state"
    state.mkdir()
    for name, manager in (cgroups or {}).items():
        _write(state / f"{name}.cgroups", manager + "\n")
    for name, raw in (labels or {}).items():
        _write(state / f"{name}.labels", raw + "\n")
    for name, (details, running) in containers.items():
        _write(state / f"{name}.details", details + "\n")
        if running:
            _write(state / f"{name}.running", "")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    podman = install_fake(bin_dir, "podman.exe", FAKE_PODMAN)
    (bin_dir / "jht.ps1").write_text(
        "Add-Content -LiteralPath (Join-Path $env:FAKE_STATE 'up.log') -Value \"jht $args\"\nexit 0\n", encoding="utf-8"
    )
    env = {"FAKE_STATE": str(state), "FAKE_PODMAN": str(podman), "FAKE_BIN": str(bin_dir)}
    if rm_fails:
        env["FAKE_RM_FAILS"] = "1"
    done = _run(tmp_path, env)
    calls = [" ".join(line.split()[2:4]) for line in (state / "calls.log").read_text(encoding="utf-8").splitlines()]
    up = (state / "up.log").read_text(encoding="utf-8").split() if (state / "up.log").exists() else []
    return done, calls, up


def test_a_map_is_judged_on_the_containers_own_uid_and_gid(tmp_path):
    cases = [
        _details("1003:1003", SHORT),                                             # T85: False
        _details("1003:1003", FULL),                                              # True
        _details("1002:1002", FULL),                                              # True
        _details("1001:1001", SHORT),                                             # True: 1001 is mapped
        _details("1003:1003", {"UidMap": FULL["UidMap"], "GidMap": ["1001:0:1"]}),  # gid left out: False
        _details("1003", SHORT),                                                  # uid only: False
        "1003:1003|null",                                                         # no user namespace: True
        _details("jht", SHORT),                                                   # a name, not judged: True
        _details("", SHORT),                                                      # the image's user: True
        "1003:1003|{not json",                                                    # not readable: True
        _details("1003:1003", {"UidMap": ["0-1"], "GidMap": []}),                 # unknown form: True
    ]
    done = _run(tmp_path, {"JHT_DETAILS_CASES": "\n".join(cases)})
    assert done.returncode == 0, done.stderr
    assert done.stdout.split() == [f"MAPS={v}" for v in
                                   ("False", "True", "True", "True", "False", "False", "True", "True", "True", "True", "True")]


def test_a_telegram_service_that_leaves_out_its_user_is_removed_and_jht_up_creates_it_again(tmp_path):
    done, calls, up = _machine(tmp_path, {
        "jht": (_details("", FULL), True),
        "jht-broker": (_details("1002:1002", FULL), True),
        "jht-telegram": (_details("1003:1003", SHORT), False),
    })
    assert done.returncode == 0, done.stdout + done.stderr
    assert "rm jht-telegram" in calls and "rm jht-broker" not in calls
    assert not any(call.startswith("stop") for call in calls), calls
    assert "REMOVED=True" in done.stdout and "Recreating jht-telegram" in done.stdout
    assert up == ["jht", "up"], "jht was running: without the repair the setup would not run jht up"


def test_a_running_service_that_leaves_out_its_user_is_stopped_first(tmp_path):
    done, calls, up = _machine(tmp_path, {"jht-broker": (_details("1002:1002", SHORT), True)})
    assert done.returncode == 0, done.stdout + done.stderr
    assert calls.index("stop --time") < calls.index("rm jht-broker")
    assert up == ["jht", "up"]


def test_services_that_map_their_users_are_left_alone(tmp_path):
    done, calls, up = _machine(tmp_path, {
        "jht": (_details("", FULL), True),
        "jht-broker": (_details("1002:1002", FULL), True),
        "jht-telegram": (_details("1003:1003", FULL), True),
    })
    assert done.returncode == 0, done.stdout + done.stderr
    assert not any(call.startswith(("rm", "stop")) for call in calls), calls
    assert "REMOVED=False" in done.stdout and up == []


def test_a_new_machine_without_the_services_goes_on_and_runs_jht_up(tmp_path):
    # "no such object" on stderr, under 'Stop': skipped, not a stop of the setup
    done, calls, up = _machine(tmp_path, {})
    assert done.returncode == 0, done.stdout + done.stderr
    assert not any(call.startswith(("rm", "stop")) for call in calls), calls
    assert up == ["jht", "up"]


def test_a_removal_that_fails_stops_the_setup(tmp_path):
    done, calls, up = _machine(tmp_path, {"jht-telegram": (_details("1003:1003", SHORT), False)}, rm_fails=True)
    assert done.returncode != 0
    assert "REMOVED=" not in done.stdout and up == []


@pytest.mark.parametrize("raw", ['{"com.docker.compose.project":"other","com.docker.compose.service":"jht-telegram"}', "null", ""])
def test_a_container_with_the_same_name_that_is_not_of_the_jht_project_is_left_alone(tmp_path, raw):
    # a deletion filter by name alone would remove someone else's container
    done, calls, up = _machine(tmp_path, {"jht-telegram": (_details("1003:1003", SHORT), True)}, labels={"jht-telegram": raw})
    assert done.returncode == 0, done.stdout + done.stderr
    assert not any(call.startswith(("rm", "stop")) for call in calls), calls
    assert "not of the jht project" in done.stdout and "REMOVED=False" in done.stdout


def test_a_service_created_under_systemd_is_recreated_under_cgroupfs(tmp_path):
    # T87: under systemd it has a pids limit, and the WSL machine has no pids controller to give it
    done, calls, up = _machine(
        tmp_path,
        {"jht-broker": (_details("1002:1002", FULL), False), "jht-telegram": (_details("1003:1003", FULL), False)},
        cgroups={"jht-broker": "systemd"},
    )
    assert done.returncode == 0, done.stdout + done.stderr
    assert "rm jht-broker" in calls and "rm jht-telegram" not in calls
    assert "Recreating jht-broker: it was created under the systemd cgroup manager, not cgroupfs" in done.stdout
    assert up == ["jht", "up"]


def test_a_service_whose_cgroup_manager_cannot_be_read_is_not_judged_on_it(tmp_path):
    done, calls, up = _machine(tmp_path, {"jht-broker": (_details("1002:1002", FULL), False)}, cgroups={"jht-broker": ""})
    assert done.returncode == 0, done.stdout + done.stderr
    assert not any(call.startswith(("rm", "stop")) for call in calls), calls
    assert "REMOVED=False" in done.stdout
