"""Optional Telegram lifecycle: real private store/planner, fake engine boundary."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from test_telegram_pairing_wrapper import functions, powershell_functions
from shared.telegram_service import lifecycle, store

ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "shared/telegram_service/lifecycle.py"


@pytest.fixture
def lifecycle_home(tmp_path, monkeypatch):
    for name in ("secrets", "secrets/bots", "state"):
        (tmp_path / name).mkdir(mode=0o700, exist_ok=True)
    monkeypatch.setenv("JHT_TELEGRAM_SECRETS", str(tmp_path / "secrets"))
    monkeypatch.setenv("JHT_TELEGRAM_STATE", str(tmp_path / "state"))
    return tmp_path


def configure(role="assistente"):
    store.write_bot(role, {"bot_token": "123456:" + "x" * 24, "chat_id": "12345"})


def invoke_plan(phase, action, role=""):
    return subprocess.run(
        [sys.executable, "-I", str(PLANNER), phase, action, "--", role],
        capture_output=True, text=True, check=False,
    )


@pytest.mark.parametrize("action", ["resume", "status", "pair", "setup", "remove"])
def test_real_planner_reads_no_bot_state_without_exposing_secrets(lifecycle_home, action):
    role = "assistente" if action in ("pair", "setup", "remove") else ""
    result = invoke_plan("prepare", action, role)
    expected = {"resume": "stop\n", "status": "not-configured\n", "pair": "start\npair\n",
                "setup": "start\npair\n", "remove": "not-configured\n"}
    assert result.returncode == 0 and result.stdout == expected[action], result.stderr
    assert result.stderr == ""


def test_configuration_and_completion_use_the_actual_remaining_roles(lifecycle_home):
    configure()
    configure("mentor")
    assert invoke_plan("prepare", "resume").stdout == "start\n"
    assert invoke_plan("prepare", "status").stdout == "status\n"
    store.delete_bot("assistente")
    assert invoke_plan("complete", "remove", "assistente").stdout == ""
    store.delete_bot("mentor")
    assert invoke_plan("complete", "remove", "mentor").stdout == "stop\n"
    assert invoke_plan("complete", "pair", "assistente").stdout == "stop\n"


@pytest.mark.parametrize("role", ["other", ";echo bad", "assistente\nstop"])
def test_bad_role_is_refused_before_any_transport_operation(lifecycle_home, role):
    result = invoke_plan("prepare", "pair", role)
    assert result.returncode != 0 and result.stdout == ""


def test_unreadable_private_state_is_not_reported_as_unconfigured(lifecycle_home):
    path = lifecycle_home / "secrets/bots/assistente.json"
    path.write_text("broken", encoding="utf-8")
    path.chmod(0o600)
    result = invoke_plan("prepare", "status")
    assert result.returncode == 1 and result.stdout == ""
    assert "store_unreadable" in result.stderr


BASH_TRANSPORT = r'''
compose() {
  case "$1" in
    run)
      while [ "$1" != -I ]; do shift; done
      shift 2
      "$PYTHON" -I "$PLANNER" "$@"
      ;;
    up) printf 'start\n' >> "$EVENTS" ;;
    stop) printf 'stop\n' >> "$EVENTS" ;;
    *) return 98 ;;
  esac
}
err() { printf '%s\n' "$*" >&2; }
telegram_pair() {
  printf 'pair\n' >> "$EVENTS"
  [ "${FAIL_PAIR:-0}" = 0 ] || return 7
  "$PYTHON" "$MUTATE" pair "$1"
}
telegram_admin() {
  printf '%s\n' "$*" >> "$EVENTS"
  "$PYTHON" "$MUTATE" "$2" "${3:-}"
}
'''

PS_TRANSPORT = r'''
$TelegramContainer = 'jht-telegram'
function Invoke-Compose {
  param([switch]$NoInput, [Parameter(ValueFromRemainingArguments)] $Args)
  if ($Args[0] -eq 'run') {
    $i = [Array]::IndexOf($Args, '-I')
    if (-not $NoInput) { throw 'planner stdin must be closed' }
    $null | & $env:PYTHON '-I' $env:PLANNER @($Args[($i+2)..($Args.Count-1)])
    return
  }
  if ($Args[0] -eq 'up') { Add-Content $env:EVENTS 'start' }
  elseif ($Args[0] -eq 'stop') { Add-Content $env:EVENTS 'stop' }
  else { throw 'invalid transport' }
  $global:LASTEXITCODE = 0
}
function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }
function Invoke-TelegramPair {
  param([string]$Role)
  Add-Content $env:EVENTS 'pair'
  if ($env:FAIL_PAIR -eq '1') { return 7 }
  & $env:PYTHON $env:MUTATE 'pair' $Role | Out-Host
  return $LASTEXITCODE
}
function Invoke-TelegramAdmin {
  param([string[]]$AdminArgs)
  Add-Content $env:EVENTS ($AdminArgs -join ' ')
  & $env:PYTHON $env:MUTATE $AdminArgs[1] $AdminArgs[2] | Out-Host
  return $LASTEXITCODE
}
'''


def run_host(tmp_path, language, args, *, fail_pair=False):
    events = tmp_path / "events"
    events.write_text("", encoding="utf-8")
    mutate = tmp_path / "mutate.py"
    mutate.write_text(
        "import sys\nsys.path.insert(0, " + repr(str(ROOT)) + ")\n"
        "from shared.telegram_service import store, admin\n"
        "if sys.argv[1] == 'pair':\n"
        " store.write_bot(sys.argv[2], {'bot_token':'123456:'+'x'*24,'chat_id':'12345'})\n"
        "else: raise SystemExit(admin.main(['bots', *sys.argv[1:]]))\n",
        encoding="utf-8",
    )
    env = {**os.environ, "PYTHON": sys.executable, "PLANNER": str(PLANNER),
           "MUTATE": str(mutate), "EVENTS": str(events), "FAIL_PAIR": str(int(fail_pair))}
    if language == "bash":
        body = functions("telegram_lifecycle_plan", "telegram_lifecycle_steps", "telegram_lifecycle_command")
        script = BASH_TRANSPORT + '\nTELEGRAM_SERVICE=jht-telegram\n' + body + '\ntelegram_lifecycle_command "$@"\n'
        command = ["bash", "-c", script, "test-host", *args]
    else:
        body = powershell_functions("Get-TelegramLifecyclePlan", "Invoke-TelegramLifecycleSteps", "Invoke-TelegramLifecycle")
        script = tmp_path / "transport.ps1"
        script.write_text(PS_TRANSPORT + body + '\nexit (Invoke-TelegramLifecycle $args)\n', encoding="utf-8")
        command = ["pwsh", "-NoProfile", "-File", str(script), *args]
    result = subprocess.run(command, env=env, capture_output=True, text=True, check=False, timeout=30)
    return result, events.read_text(encoding="utf-8-sig").splitlines()


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_default_up_and_status_never_start_the_telegram_service(lifecycle_home, language):
    result, events = run_host(lifecycle_home, language, ["resume"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == ["stop"]
    result, events = run_host(lifecycle_home, language, ["status"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == []
    assert "non attivo: Telegram non configurato" in result.stdout


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_pair_starts_before_pairing_and_last_remove_stops_after_deletion(lifecycle_home, language):
    result, events = run_host(lifecycle_home, language, ["pair", "assistente"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == ["start", "pair"]
    assert store.read_bot("assistente") is not None
    result, events = run_host(lifecycle_home, language, ["resume"])
    assert result.returncode == 0 and events == ["start"]
    result, events = run_host(lifecycle_home, language, ["remove", "assistente"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == ["start", "bots delete assistente", "stop"]
    assert store.read_bot("assistente") is None


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_removing_one_of_two_bots_keeps_the_other_service_running(lifecycle_home, language):
    configure()
    configure("mentor")
    result, events = run_host(lifecycle_home, language, ["remove", "assistente"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == ["start", "bots delete assistente"]
    assert store.read_bot("mentor") is not None


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_pair_failure_retains_its_error_and_shuts_down_an_unconfigured_service(lifecycle_home, language):
    result, events = run_host(lifecycle_home, language, ["pair", "assistente"], fail_pair=True)
    assert result.returncode == 7, result.stdout + result.stderr
    assert events == ["start", "pair", "stop"]
    assert store.read_bot("assistente") is None
