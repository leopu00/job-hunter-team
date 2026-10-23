"""The Windows wrapper's onboarding snapshot says the container is running when jht runs, and why when not.

The desktop's onboarding stopped at «Il container del team non risulta pronto» on a Windows computer
whose jht was running: `jht status` (by name) said running, `jht onboarding-snapshot` said
containerRunning=0, and nothing said why (T79). The snapshot finds jht through
Get-RunningComposeServiceId, which gave up, silently, on any container of the compose listing that was
not of the three services or not of the project, and on labels ConvertFrom-Json could not read.

- a profile not ready yet (its last check exits 1) does not make jht look stopped: the final
  `inspect … | Select-Object -First 1` stopped the native command and read the exit code of the
  check before it, so a fresh team was «not running» on every computer whose profile was not ready;
- a helper or a container of another project in the listing is skipped: jht running is running;
- labels with two keys that differ only in case (Windows PowerShell 5.1 refuses them) still give jht;
- when the container is not running the snapshot still says 0, and one line on stderr says why
  («onboarding_snapshot: <code>: <detail>»): the desktop puts it in its runtime log;
- stdout stays exactly the eight lines the desktop's strict parser reads.

The functions are the wrapper's own, read through the AST; docker is a native fake (on Windows, the
shell JHT_TEST_SHELL names: Windows PowerShell 5.1 by default).
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"

JHT = "a" * 64
BROKER = "b" * 64
TELEGRAM = "c" * 64
HELPER = "d" * 64

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$wanted = @('Get-ComposeProjectName', 'Get-ComposeLabel', 'Get-RunningComposeServiceId', 'Write-InactiveOnboardingSnapshot',
  'Write-OnboardingSnapshotReason', 'Write-OnboardingSnapshot')
foreach ($name in $wanted) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if ($fn) { Invoke-Expression $fn.Extent.Text }
}
function Test-RuntimeBundleTrusted { $env:FAKE_TRUSTED -eq '1' }
$ContainerRuntime = 'podman'
$ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
$Container = 'jht'; $BrokerContainer = 'jht-broker'; $TelegramContainer = 'jht-telegram'
$NodeEntry = '/app/cli/bin/jht.js'
Write-OnboardingSnapshot
"""

# compose ps -q: the listing; inspect --type container ID: running|labels; the rest of the snapshot's calls.
FAKE_DOCKER = r"""#!/bin/sh
case "$1" in
  compose) cat "$FAKE_STATE/ps.txt"; exit 0 ;;
  inspect)
    if [ "$2" = --type ]; then
      [ -f "$FAKE_STATE/$4.details" ] || { echo "Error: no such object" >&2; exit 125; }
      cat "$FAKE_STATE/$4.details"; exit 0
    fi
    echo true; exit 0 ;;
  exec)
    case "$*" in *" node -e "*) echo "0 0 0"; exit 0 ;; esac
    exit 1 ;;
esac
exit 0
"""


def _labels(service: str, project: str = "jht", extra: dict[str, str] | None = None) -> str:
    return json.dumps({"com.docker.compose.project": project, "com.docker.compose.service": service, **(extra or {})})


def _snapshot(tmp_path: Path, listing: list[str], details: dict[str, str], trusted: bool = True):
    state = tmp_path / "state"
    state.mkdir()
    (state / "ps.txt").write_text("".join(f"{line}\n" for line in listing), encoding="utf-8", newline="\n")
    for cid, text in details.items():
        (state / f"{cid}.details").write_text(text + "\n", encoding="utf-8", newline="\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE_DOCKER)
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(WRAPPER),
        "FAKE_STATE": str(state), "FAKE_TRUSTED": "1" if trusted else "0",
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = done.stdout.splitlines()
    assert len(lines) == 8 and lines[0].startswith("runtimeInstalled="), lines  # the strict parser's eight lines
    values = dict(line.split("=", 1) for line in lines)
    reasons = [line for line in done.stderr.splitlines() if line.startswith("onboarding_snapshot: ")]
    return values, reasons


TEAM = {
    JHT: "true|" + _labels("jht"),
    BROKER: "true|" + _labels("jht-broker"),
    TELEGRAM: "true|" + _labels("jht-telegram"),
}


def test_a_profile_not_ready_yet_does_not_make_jht_look_stopped(tmp_path):
    # the fake's exec answers 1 to the sessions, ready.flag and profile validate: a team just started
    values, reasons = _snapshot(tmp_path, [BROKER, TELEGRAM, JHT], TEAM)
    assert values["containerRunning"] == "1", reasons
    assert values["profileReady"] == "0" and values["assistantRunning"] == "0" and values["captainRunning"] == "0"
    assert values["providerConfigured"] == "0" and reasons == []


def test_the_three_services_running_give_container_running(tmp_path):
    values, reasons = _snapshot(tmp_path, [BROKER, TELEGRAM, JHT], TEAM)
    assert values["containerRunning"] == "1" and reasons == []


@pytest.mark.parametrize("helper", [
    "true|" + _labels("jht-helper"),                 # a container of the project that is not one of the three services
    "true|" + _labels("", project="host-runtime"),   # a container of another project in the listing
    "true|{}",                                       # a container with no compose labels, an infra one
])
def test_a_container_that_is_not_one_of_the_team_does_not_hide_a_running_jht(tmp_path, helper):
    values, reasons = _snapshot(tmp_path, [HELPER, BROKER, TELEGRAM, JHT], {**TEAM, HELPER: helper})
    assert values["containerRunning"] == "1", reasons
    assert reasons == []


def test_labels_with_keys_that_differ_only_in_case_still_give_jht(tmp_path):
    # Windows PowerShell 5.1's ConvertFrom-Json refuses such labels: the two compose keys are read from the text
    tricky = "true|" + _labels("jht", extra={"maintainer": "a", "Maintainer": "b"})
    values, reasons = _snapshot(tmp_path, [BROKER, TELEGRAM, JHT], {**TEAM, JHT: tricky})
    assert values["containerRunning"] == "1", reasons


def test_no_running_jht_says_zero_and_why(tmp_path):
    values, reasons = _snapshot(tmp_path, [BROKER, TELEGRAM], TEAM)
    assert values["containerRunning"] == "0"
    assert reasons == ["onboarding_snapshot: container_not_found: no running container of jht among 2 listed by compose ps"]


def test_a_stopped_jht_says_zero_and_why(tmp_path):
    values, reasons = _snapshot(tmp_path, [BROKER, TELEGRAM, JHT], {**TEAM, JHT: "false|" + _labels("jht")})
    assert values["containerRunning"] == "0"
    assert len(reasons) == 1 and "container_not_found" in reasons[0] and f"{JHT[:12]} of jht is not running (false)" in reasons[0]


def test_an_empty_listing_says_zero_and_why(tmp_path):
    values, reasons = _snapshot(tmp_path, [], {})
    assert values["containerRunning"] == "0"
    assert len(reasons) == 1 and "compose ps listed no running container of project jht" in reasons[0]


def test_a_listing_that_is_not_ids_says_zero_and_why(tmp_path):
    values, reasons = _snapshot(tmp_path, ["Error: something on stdout", JHT], TEAM)
    assert values["containerRunning"] == "0"
    assert reasons == ["onboarding_snapshot: container_not_found: compose ps printed a line that is not a container id: Error: something on stdout"]


def test_two_running_jht_says_zero_and_why(tmp_path):
    second = "e" * 64
    values, reasons = _snapshot(tmp_path, [JHT, second], {**TEAM, second: "true|" + _labels("jht")})
    assert values["containerRunning"] == "0"
    assert len(reasons) == 1 and "two running containers of jht" in reasons[0]


def test_an_untrusted_runtime_says_zero_and_why(tmp_path):
    values, reasons = _snapshot(tmp_path, [JHT], TEAM, trusted=False)
    assert values["runtimeInstalled"] == "0" and values["containerRunning"] == "0"
    assert len(reasons) == 1 and reasons[0].startswith("onboarding_snapshot: runtime_untrusted:")
