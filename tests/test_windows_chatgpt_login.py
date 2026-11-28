"""Host browser allowlist and relay lifecycle in both native PowerShell engines."""
import os
import json
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
 exec) case "$*" in
  *--request*) [ "$FAKE_PROBE" = 1 ] || exit 1; if [ -f "$FAKE_STATE/mode" ]; then printf '%s' "$AUTH_URL"; else printf probe; fi ;;
  *--health*) [ "$FAKE_DEAD" != 1 ] ;;
  *--mode*) printf '%s' "$*" > "$FAKE_STATE/mode" ;;
  *--arm*|*--cancel*) exit 0 ;;
  *) exit 1 ;;
 esac ;;
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
if (-not (Test-SubscriptionLoginUrl $env:AUTH_URL)) { throw 'valid URL refused' }
foreach ($url in @('http://auth.openai.com/','https://auth.openai.com.evil.invalid/','https://auth.openai.com@evil.invalid/','file:///tmp/page','https://auth.openai.com:444/','https://auth.openai.com/codex/device?code=other',($env:AUTH_URL + '&extra=other'),($env:AUTH_URL -replace 'S256','plain'),($env:AUTH_URL -replace 'originator=pi','originator=other'),($env:AUTH_URL -replace 'client_id=app_','client_id=other_'),($env:AUTH_URL -replace 'localhost%3A1455','evil.invalid%3A1455'),($env:AUTH_URL + "`n"))) {
  if (Test-SubscriptionLoginUrl $url) { throw 'untrusted URL accepted' }
}
function Get-RunningComposeServiceId { param($Service) 'aaaaaaaaaaaa' }
# The real background job runs, with a browser opener that only records its URL.
function Start-Job {
  param($ArgumentList, $ScriptBlock)
  if ($env:FAKE_OBSERVER_ERROR -eq '1') { throw 'synthetic observer error' }
  Microsoft.PowerShell.Core\Start-Job -ArgumentList $ArgumentList -ScriptBlock $ScriptBlock -InitializationScript {
    function global:Start-Process { param($FilePath) [IO.File]::AppendAllText($env:OPENED, $FilePath + [Environment]::NewLine) }
  }
}
$Container = 'untrusted-name-must-not-be-used'
try {
  Start-SubscriptionLoginBridge
  if ($env:FAKE_OBSERVER_ERROR -eq '1') {
    if ($script:ChatGptEnv.Count) { throw 'observer failure did not fall back' }
  } elseif ($env:FAKE_PROBE -eq '1') {
    if (-not $script:ChatGptEnv.Count) { throw ('observer startup: ' + ($Error | Select-Object -First 3 | Out-String)) }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path (Join-Path $env:FAKE_STATE 'mode')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path (Join-Path $env:FAKE_STATE 'mode'))) {
      $diagnostic = ($script:ChatGptWatcher | Receive-Job -Keep *>&1 | Out-String)
      throw ('no login negotiation: ' + $diagnostic)
    }
    $mode = [IO.File]::ReadAllText((Join-Path $env:FAKE_STATE 'mode'))
    if (($env:FAKE_BUSY -eq '1' -or $env:FAKE_DEAD -eq '1') -and $mode -notmatch ' device_code$') { throw 'no device fallback' }
    if ($env:FAKE_BUSY -ne '1' -and $env:FAKE_DEAD -ne '1' -and $mode -notmatch ' browser$') { throw 'no browser flow' }
    Start-Sleep -Milliseconds 1800
  } else { Start-Sleep -Milliseconds 1800 }
  throw 'synthetic login error'
} catch {
  if ($_.Exception.Message -ne 'synthetic login error') { throw }
} finally { Stop-SubscriptionLoginBridge }
if ($script:ChatGptRelay -or $script:ChatGptWatcher) { throw 'relay or observer retained' }
'''


@pytest.mark.parametrize("shell", ["powershell", "pwsh"] if WINDOWS else ["pwsh"])
@pytest.mark.parametrize("busy,dead,probe,observer_error", [(False,False,True,False),(True,False,True,False),(False,True,True,False),(False,False,False,False),(False,False,False,True)])
def test_chatgpt_host_allowlist_and_core_relay_cleanup(tmp_path, busy, dead, probe, observer_error, shell, monkeypatch):
    monkeypatch.setenv("JHT_TEST_SHELL", shell)
    auth_url = ('https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann'
                '&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email+offline_access'
                '&code_challenge=' + 'a' * 43 + '&code_challenge_method=S256&state=' + 'b' * 32
                + '&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=pi')
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
           "FAKE_BUSY": str(int(busy)), "FAKE_DEAD": str(int(dead)), "FAKE_PROBE": str(int(probe)),
           "FAKE_OBSERVER_ERROR": str(int(observer_error)), "AUTH_URL": auth_url, "OPENED": str(tmp_path / "opened"), "JHT_ENGINE_FILE": str(engine),
           "JHT_UNDER_TEST": str(ROOT / "scripts/jht-wrapper.ps1")}
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=60)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    calls = (state / "calls").read_text().splitlines()
    launches = [line for line in calls if line.startswith("run ")]
    if not probe:
        assert launches == [], 'a setup without a login publishes no port'
    else:
        assert len(launches) == 1
        launch = launches[0]
        assert "--pull=never" in launch
        assert "--publish 127.0.0.1:1455:1455" in launch
        assert "--entrypoint node sha256:synthetic-core-image" in launch
        assert "--volume" not in launch and "--mount" not in launch
        assert (tmp_path / "opened").read_text().splitlines() == [auth_url]
    assert all('untrusted-name-must-not-be-used' not in line for line in calls)
    assert any(line.startswith("stop --time 10 jht-chatgpt-") for line in calls)
    assert any(" --cancel " in line for line in calls)
