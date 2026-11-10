"""`desktop-apply record` in the PowerShell wrapper: Invoke-DesktopApply closes every field before it reaches the broker.

The function is read out of the wrapper through the AST and run against a fake `docker` function (a function wins
over the executable): off Windows under pwsh, on Windows under the shell JHT_TEST_SHELL names (PowerShell 5.1 and 7).
It answers one closed line, never starts anything, and the broker is called only with fields that passed.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
needs_powershell = pytest.mark.skipif(not WINDOWS and shutil.which("pwsh") is None, reason="needs PowerShell")
INSTANT = "2026-11-03T09:30:00.123Z"

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-DesktopApply' }, $true)
if (-not $fn) { throw 'Invoke-DesktopApply missing' }
Invoke-Expression $fn.Extent.Text
$script:DesktopApplyExitCode = 2
$BrokerContainer = 'jht-broker'
function Test-RuntimeBundleTrusted { return $true }
function Get-RunningComposeServiceId { param($Name) if ($env:FAKE_BROKER_UP -eq '1') { 'broker-id' } else { $null } }
function Test-DockerReachable { return $true }
# Ensure-Broker is the one step that makes the broker (tests/test_broker_on_request_windows.py): a stub that makes it or fails.
function Ensure-Broker {
  param([switch]$Quiet)
  [IO.File]::AppendAllText($env:FAKE_LOG, "ENSURE`n")
  if ($env:FAKE_ENSURE_MAKES -eq '1') { $env:FAKE_BROKER_UP = '1'; return 0 }
  return 1
}
function docker {
  [IO.File]::AppendAllText($env:FAKE_LOG, 'ARGS=' + ($args -join '|') + "`n")
  if ($env:FAKE_BROKER_ANSWER -ne '') { $env:FAKE_BROKER_ANSWER }
  $global:LASTEXITCODE = [int]$env:FAKE_BROKER_RC
}
$list = [string[]]($env:JHT_APPLY_ARGS -split [string][char]31)
Invoke-DesktopApply $list
"EXIT=" + $script:DesktopApplyExitCode
"""


def _run(tmp_path: Path, args: list[str], up="1", answer='{"ok": true, "status": "recorded"}', rc="0", makes="0"):
    harness = tmp_path / "harness.ps1"
    engine = tmp_path / "engine.txt"
    log = tmp_path / "docker.log"
    log.write_text("")
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(WRAPPER), "FAKE_LOG": str(log),
        "JHT_APPLY_ARGS": "\x1f".join(args), "FAKE_BROKER_UP": up, "FAKE_ENSURE_MAKES": makes, "FAKE_BROKER_ANSWER": answer, "FAKE_BROKER_RC": rc,
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = [line.strip() for line in done.stdout.splitlines() if line.strip()]
    return lines[-2:], log.read_text(encoding="utf-8").splitlines()


OK = ["record", "42", INSTANT, "web:jobs.example.com"]


@needs_powershell
def test_a_good_record_reaches_the_broker_with_its_three_fields_and_answers_ok(tmp_path):
    out, calls = _run(tmp_path, OK)
    assert out == ['{"ok":true}', "EXIT=0"]
    assert calls == [f"ARGS=exec|-i|broker-id|jht-broker-admin|apply|record|42|{INSTANT}|web:jobs.example.com"]


@needs_powershell
@pytest.mark.parametrize("args", [
    ["record", "0", INSTANT, "web:jobs.example.com"],
    ["record", "042", INSTANT, "web:jobs.example.com"],
    ["record", "12345678901", INSTANT, "web:jobs.example.com"],
    ["record", "4a", INSTANT, "web:jobs.example.com"],
    ["Record", "42", INSTANT, "web:jobs.example.com"],
    ["record", "42", "2026-11-03T09:30:00.123z", "web:jobs.example.com"],
    ["record", "42", "2026-11-03T09:30:00Z", "web:jobs.example.com"],
    ["record", "42", INSTANT, "WEB:jobs.example.com"],
    ["record", "42", INSTANT, "web:a b"],
    ["record", "42", INSTANT, "web:jobs.example.com\nx"],
    ["record", "42", INSTANT, "web:jobs.example.com\n"],
    ["record", "42\n", INSTANT, "web:jobs.example.com"],
    ["record", "42", INSTANT + "\n", "web:jobs.example.com"],
    ["record", "42", INSTANT, "portal:"],
    ["record", "42", INSTANT],
    ["record", "42", INSTANT, "web:jobs.example.com", "extra"],
])
def test_every_field_is_closed_before_the_broker_is_asked(tmp_path, args):
    out, calls = _run(tmp_path, args)
    assert out == ['{"ok":false,"error":"apply_record_invalid"}', "EXIT=2"], args
    assert calls == [], args


@needs_powershell
def test_a_broker_that_cannot_be_made_answers_its_code_and_docker_is_never_called(tmp_path):
    out, calls = _run(tmp_path, OK, up="0")
    assert out == ['{"ok":false,"error":"apply_record_no_broker"}', "EXIT=113"]
    assert calls == ["ENSURE"]


@needs_powershell
def test_the_first_click_makes_the_broker_and_records_in_it(tmp_path):
    out, calls = _run(tmp_path, OK, up="0", makes="1")
    assert out == ['{"ok":true}', "EXIT=0"]
    assert calls == ["ENSURE", f"ARGS=exec|-i|broker-id|jht-broker-admin|apply|record|42|{INSTANT}|web:jobs.example.com"]


@needs_powershell
@pytest.mark.parametrize("answer,rc", [
    ('{"ok": false, "status": "refused"}', "0"),
    ('{"ok": true, "status": "recorded"}', "1"),
    ("", "0"),
])
def test_a_broker_that_did_not_record_is_refused_in_a_closed_line(tmp_path, answer, rc):
    out, _ = _run(tmp_path, OK, answer=answer, rc=rc)
    assert out == ['{"ok":false,"error":"apply_record_refused"}', "EXIT=1"]


@needs_powershell
def test_an_already_recorded_authorisation_counts_as_recorded(tmp_path):
    out, _ = _run(tmp_path, OK, answer='{"ok": true, "status": "already_recorded"}')
    assert out == ['{"ok":true}', "EXIT=0"]
