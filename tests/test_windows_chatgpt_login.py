"""Host browser allowlist and relay lifecycle in both native PowerShell engines."""
import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
FAKE = r'''#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_STATE/calls"
case "$1" in
 inspect) printf 'sha256:synthetic-core-image\n' ;;
 run) [ "$FAKE_BUSY" != 1 ] || exit 125; printf 'synthetic-relay-id\n' ;;
esac
'''
HARNESS = r'''
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Test-SubscriptionLoginUrl','Start-SubscriptionLoginBridge','Stop-SubscriptionLoginBridge')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
if (-not (Test-SubscriptionLoginUrl 'https://auth.openai.com/oauth/authorize?state=example')) { throw 'valid URL refused' }
foreach ($url in @('http://auth.openai.com/','https://auth.openai.com.evil.invalid/','https://auth.openai.com@evil.invalid/','file:///tmp/page','https://auth.openai.com:444/','https://auth.openai.com\@evil.invalid/',"https://auth.openai.com/`npage")) {
  if (Test-SubscriptionLoginUrl $url) { throw 'untrusted URL accepted' }
}
# Capture the job boundary; this case never opens the account browser of the test machine.
function Start-Job { param($ArgumentList,$ScriptBlock) [pscustomobject]@{Id=123} }
function Stop-Job { param($Job) }
function Remove-Job { param($Job) }
$Container = 'attested-team'
try {
  Start-SubscriptionLoginBridge
  $mode = ($script:ChatGptEnv -join ' ')
  if ($env:FAKE_BUSY -eq '1' -and $mode -notmatch 'METHOD=device_code') { throw 'no device fallback' }
  if ($env:FAKE_BUSY -ne '1' -and $mode -notmatch 'METHOD=browser') { throw 'no browser flow' }
  throw 'synthetic login error'
} catch {
  if ($_.Exception.Message -ne 'synthetic login error') { throw }
} finally { Stop-SubscriptionLoginBridge }
if ($script:ChatGptRelay -or $script:ChatGptWatcher) { throw 'relay or observer retained' }
'''


@pytest.mark.parametrize("shell", ["powershell", "pwsh"] if WINDOWS else ["pwsh"])
@pytest.mark.parametrize("busy", [False, True])
def test_chatgpt_host_allowlist_and_core_relay_cleanup(tmp_path, busy, shell, monkeypatch):
    monkeypatch.setenv("JHT_TEST_SHELL", shell)
    state = tmp_path / "state"
    state.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE)
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    env = {**(windows_env(tmp_path) if WINDOWS else os.environ),
           "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"], "FAKE_STATE": str(state),
           "FAKE_BUSY": "1" if busy else "0", "JHT_ENGINE_FILE": str(engine),
           "JHT_UNDER_TEST": str(ROOT / "scripts/jht-wrapper.ps1")}
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=60)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    calls = (state / "calls").read_text().splitlines()
    launch = next(line for line in calls if line.startswith("run "))
    assert "--pull=never" in launch
    assert "--publish 127.0.0.1:1455:1455" in launch
    assert "--entrypoint node sha256:synthetic-core-image" in launch
    assert "--volume" not in launch and "--mount" not in launch
    assert any(line.startswith("stop --time 10 jht-chatgpt-") for line in calls)
    assert any(" --cancel " in line for line in calls)
