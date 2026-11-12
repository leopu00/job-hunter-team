"""Windows: `jht down` stays down, and `jht doctor` never starts the team (the same rule as jht-wrapper.sh, test_down_stays_down.py).

The functions are read from the real jht-wrapper.ps1 (the harness of test_windows_podman_wsl_branches), with stand-ins for what Windows
and the engine say.
"""
from __future__ import annotations

import json
import re

import pytest

from test_windows_podman_wsl_branches import WRAPPER, _run

STOPPED_IT = "Job Hunter Team e' fermato: jht up per riaccenderlo."


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


STAND_INS = r"""
$RuntimeDir = $env:RUNTIME
$Container = 'jht'
function Get-JhtTextLanguage { return 'it' }
function Test-ContainerUp { return ($env:FAKE_UP -eq '1') }
function Test-DockerReachable { return ($env:FAKE_ENGINE -eq '1') }
function Test-RuntimeBundleTrusted { return $true }
function Get-JhtDoctorWslMemoryAdvice { return [string]$env:FAKE_WSL_ADVICE }
function Repair-MountOwnership { Add-Content -LiteralPath $env:FAKE_LOG -Value 'start'; return $false }
"""

IMPORTS = ["Get-JhtTeamStoppedPath", "Test-JhtTeamStoppedByPerson", "Set-JhtTeamStopped", "Clear-JhtTeamStopped",
           "Get-JhtTeamStoppedText", "Invoke-JhtHostDoctor", "Ensure-Up", "Write-Err", "Write-Info"]


def _ps(tmp_path, body: str, **env: str):
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    (tmp_path / "bin").mkdir(exist_ok=True)
    result, calls = _run(tmp_path, WRAPPER, IMPORTS, STAND_INS + body,
                         {"RUNTIME": str(runtime), "FAKE_UP": "0", "FAKE_ENGINE": "1", "FAKE_WSL_ADVICE": "", **env})
    return result, calls, runtime


def test_after_down_a_command_says_the_team_is_stopped_and_starts_nothing(tmp_path):
    result, calls, runtime = _ps(tmp_path, "Set-JhtTeamStopped\nEnsure-Up\n[Console]::Out.WriteLine('went on')")
    assert (runtime / "team-stopped").is_file()
    assert result.returncode == 1
    assert STOPPED_IT in result.stdout + result.stderr
    assert "went on" not in result.stdout and "start" not in calls


def test_up_or_setup_clear_the_mark_and_the_start_goes_on(tmp_path):
    result, calls, runtime = _ps(tmp_path, "Set-JhtTeamStopped\nClear-JhtTeamStopped\nEnsure-Up")
    assert not (runtime / "team-stopped").exists()
    assert "start" in calls  # it went on to start the container (the stand-in stops it there)


def test_a_running_team_is_never_refused_whatever_the_mark(tmp_path):
    result, calls, _ = _ps(tmp_path, "Set-JhtTeamStopped\nEnsure-Up\n[Console]::Out.WriteLine('went on')", FAKE_UP="1")
    assert result.returncode == 0 and "went on" in result.stdout and "start" not in calls


DOCTOR = "exit (Invoke-JhtHostDoctor -Team 'off' -DoctorArgs @($env:DOCTOR_ARGS -split ' ' | Where-Object { $_ }))"


def test_doctor_with_the_team_off_gives_the_host_checks(tmp_path):
    result, calls, _ = _ps(tmp_path, DOCTOR, DOCTOR_ARGS="", FAKE_WSL_ADVICE="3GB")
    out = result.stdout.replace("\r\n", "\n")
    assert "squadra spenta (il suo container non gira)" in out, result.stdout + result.stderr
    assert "+ motore dei container raggiungibile" in out and "+ runtime JHT integro" in out
    assert "memory=3GB" in out and "! squadra spenta: 'jht up' la accende" in out
    assert result.returncode == 0 and "start" not in calls


def test_doctor_json_with_no_engine_is_a_problem(tmp_path):
    result, _, _ = _ps(tmp_path, DOCTOR, DOCTOR_ARGS="--json", FAKE_ENGINE="0")
    assert result.stdout.strip().startswith("{"), result.stdout + result.stderr
    answer = json.loads(result.stdout)
    assert answer["teamRunning"] is False and answer["ok"] is False and answer["summary"]["problems"] == 1
    assert result.returncode == 1


def test_the_wrapper_marks_on_down_clears_on_up_and_setup_and_doctor_never_ensures_up():
    text = WRAPPER.read_text(encoding="utf-8")
    def block(head: str) -> str:
        start = text.index(head)
        return text[start:text.index("\n  }\n", start)]
    assert "Set-JhtTeamStopped; Write-JhtLifecycleDone 'down'" in block("{ $_ -in @('down', 'stop-container') } {")
    assert "Clear-JhtTeamStopped" in block("{ $_ -in @('up', 'start-container') } {")
    setup = block("\n  'setup' {")
    assert setup.index("Clear-JhtTeamStopped") < setup.index("Ensure-Up")
    doctor = block("\n  'doctor' {")
    assert "Ensure-Up" not in doctor and "Invoke-JhtHostDoctor" in doctor
    ensure = text[text.index("function Ensure-Up {"):]
    assert re.search(r"Test-JhtTeamStoppedByPerson\) \{ Write-Err \(Get-JhtTeamStoppedText\); exit 1 \}", ensure[:ensure.index("\n}\n")])
