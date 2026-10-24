"""Invoke-BrokerAdmin hands the broker the words of its caller and opens stdin only when asked.

`$InputText` is the first positional parameter of Invoke-BrokerAdmin, and a typed string defaults
to "". So `Invoke-BrokerAdmin secrets status` bound 'secrets' to it and left the broker one verb
short, and every call, even one with no text, opened stdin with a line. Every caller now names
-AdminArgs (as Invoke-TelegramAdmin's do) and stdin is opened only for an -InputText that was
passed (an empty one, as `apply record` does, included).

The function is read out of the wrapper through the AST and run against a fake `docker` function
(a function wins over the executable): off Windows under pwsh, on Windows under the shell
JHT_TEST_SHELL names (PowerShell 5.1 and 7 in CI).
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

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-BrokerAdmin' }, $true)
if (-not $fn) { throw 'Invoke-BrokerAdmin missing' }
Invoke-Expression $fn.Extent.Text
$BrokerContainer = 'jht-broker'
function Get-RunningComposeServiceId { param($Name) 'abc123' }
function Write-Err { param($Message) [Console]::Error.WriteLine($Message) }
function docker {
  $line = 'ARGS=' + ($args -join '|') + ';PIPED=' + $MyInvocation.ExpectingInput + ';STDIN=' + (@($input) -join '|')
  [IO.File]::AppendAllText($env:FAKE_LOG, $line + "`n")
  $global:LASTEXITCODE = 0
}
$null = Invoke-BrokerAdmin -AdminArgs @('secrets', 'status')
$null = Invoke-BrokerAdmin -AdminArgs @('apply', 'account', 'acct-1')
$null = Invoke-BrokerAdmin -InputText '' -AdminArgs @('apply', 'record', 'id-1')
$null = Invoke-BrokerAdmin -InputText 'secret-text' -AdminArgs @('mailbox', 'setup', '--user', 'a@example.invalid')
"""


def _run(tmp_path: Path) -> list[str]:
    harness = tmp_path / "harness.ps1"
    engine = tmp_path / "engine.txt"
    log = tmp_path / "docker.log"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(WRAPPER), "FAKE_LOG": str(log),
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    return log.read_text(encoding="utf-8").splitlines()


@needs_powershell
def test_the_broker_gets_every_word_and_stdin_opens_only_for_a_text_that_was_passed(tmp_path):
    assert _run(tmp_path) == [
        "ARGS=exec|-i|abc123|jht-broker-admin|secrets|status;PIPED=False;STDIN=",
        "ARGS=exec|-i|abc123|jht-broker-admin|apply|account|acct-1;PIPED=False;STDIN=",
        # an empty text on purpose (`apply record`): stdin is opened
        "ARGS=exec|-i|abc123|jht-broker-admin|apply|record|id-1;PIPED=True;STDIN=",
        "ARGS=exec|-i|abc123|jht-broker-admin|mailbox|setup|--user|a@example.invalid;PIPED=True;STDIN=secret-text",
    ]
