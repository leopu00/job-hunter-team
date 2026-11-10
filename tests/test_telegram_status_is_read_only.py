"""`jht status` says one line about Telegram and creates nothing: no `compose run`, no volume, no output of compose.

On a computer where Telegram was never configured, every `jht status` used to run the lifecycle plan: two throwaway
containers and the volumes of the service, with the lines of compose printed under the status. The line now comes from
questions to the engine only (the volume list, an exec in the running service), the same ones `jht integration` asks, so
the two commands say the same thing. Same rule in jht-wrapper.sh and jht-wrapper.ps1.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _source(name: str) -> str:
    return (ROOT / "scripts" / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def functions(*names: str) -> str:
    return "\n".join(re.search(rf"^{n}\(\) \{{\n.*?^\}}\n", _source("jht-wrapper.sh"), re.S | re.M).group(0) for n in names)


def powershell_functions(*names: str) -> str:
    return "\n".join(re.search(rf"^function {n} \{{\n.*?^\}}\n", _source("jht-wrapper.ps1"), re.S | re.M).group(0) for n in names)


# The engine: records every call; answers `volume ls` from VOLUMES and `exec ... bots status` from BOTS (a JSON line).
ENGINE = r'''
import os, sys
with open(os.environ['LOG'], 'a') as log:
    log.write('docker ' + ' '.join(sys.argv[1:]) + '\n')
if sys.argv[1:3] == ['volume', 'ls']:
    print(os.environ.get('VOLUMES', ''))
elif sys.argv[1] == 'exec' and sys.argv[-3:] == ['jht-telegram-admin', 'bots', 'status']:
    if os.environ.get('BOTS') is None:
        raise SystemExit(1)
    print(os.environ['BOTS'])
'''

BASH = '''set -u
compose_lacks_service() { return 1; }
compose() { echo "COMPOSE $*" >> "$LOG"; }
read_only_service_id() { [ -n "${RUNNING:-}" ] && { echo id-telegram; return 0; }; return 3; }
telegram_admin() { echo "admin $*" >> "$LOG"; docker exec id-telegram jht-telegram-admin "$@"; }
TELEGRAM_SERVICE=jht-telegram
''' + functions("compose_project_name", "telegram_state_volume_absent", "telegram_bots_configured", "telegram_status_line") + '''
telegram_status_line
'''

POWERSHELL = '''$ErrorActionPreference = 'Stop'
$ContainerRuntime = 'podman'
$ComposeFile = Join-Path $PSScriptRoot 'compose.yml'
Set-Content -LiteralPath $ComposeFile -Value "services:`n  jht-telegram:`n    image: synthetic"
$TelegramContainer = 'jht-telegram'
function Invoke-Compose { Add-Content -LiteralPath $env:LOG -Value "COMPOSE $args"; return @() }
function Get-RunningComposeServiceId { param([string]$Service); if ($env:RUNNING) { return 'id-telegram' }; return $null }
function Invoke-TelegramAdmin {
  param([string]$InputText = $null, [Parameter(ValueFromRemainingArguments)] [string[]]$AdminArgs)
  Add-Content -LiteralPath $env:LOG -Value "admin $AdminArgs"
  & docker exec id-telegram jht-telegram-admin @AdminArgs | Out-Host
  return 0
}
''' + powershell_functions("Get-ComposeProjectName", "Test-TelegramStateVolumeAbsent", "Get-TelegramBotsConfigured", "Write-TelegramStatusLine") + '''
exit (Write-TelegramStatusLine)
'''

CONFIGURED = "jht_jht-telegram-state\njht_jht-deps\n"
OTHERS_ONLY = "jht_jht-deps\njht_jht-secrets\n"
NO_BOT = '{"ok": true, "bots": {"assistente": "absent", "capitano": "absent", "mentor": "absent"}, "cutover": false}'
ONE_BOT = '{"ok": true, "bots": {"assistente": "present", "capitano": "absent", "mentor": "absent"}, "cutover": false}'
NOT_CONFIGURED = "Telegram non attivo: Telegram non configurato."


def run(tmp_path, language, volumes, running=False, bots=None):
    shell = os.environ.get("JHT_TEST_SHELL") or "pwsh"
    if language == "bash" and sys.platform == "win32":
        pytest.skip("the bash wrapper is not run on Windows")
    if language == "pwsh" and not shutil.which(shell):
        pytest.skip(f"{shell} not installed")
    binaries = tmp_path / "bin"
    binaries.mkdir()
    engine = binaries / "docker"
    if sys.platform == "win32":
        (binaries / "engine.py").write_text(ENGINE, encoding="utf-8")
        engine = binaries / "docker.cmd"
        engine.write_text(f'@"{sys.executable}" "{binaries / "engine.py"}" %*\r\n', encoding="utf-8")
    else:
        engine.write_text("#!" + sys.executable + "\n" + ENGINE, encoding="utf-8")
        engine.chmod(0o700)
    log = tmp_path / "calls.log"
    log.touch()
    env = {k: v for k, v in os.environ.items() if k not in ("BOTS", "RUNNING")}
    env.update({"PATH": str(binaries) + os.pathsep + os.environ["PATH"], "LOG": str(log), "VOLUMES": volumes})
    if running:
        env["RUNNING"] = "1"
    if bots is not None:
        env["BOTS"] = bots
    script = tmp_path / ("host.sh" if language == "bash" else "host.ps1")
    script.write_text(BASH if language == "bash" else POWERSHELL, encoding="utf-8")
    command = ["bash", str(script)] if language == "bash" else [shell, "-NoProfile", "-File", str(script)]
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=60)
    return result, log.read_text().splitlines()


def creates_nothing(calls):
    """Only questions: the volume list and the exec of a read; never a compose call, a docker run or a create."""
    return not any(call.startswith("COMPOSE") or call.startswith("docker run") or " create" in call for call in calls)


@pytest.mark.parametrize("language", ["bash", "pwsh"])
@pytest.mark.parametrize("volumes", ["", OTHERS_ONLY])
def test_never_configured_is_one_line_and_not_a_single_container(tmp_path, language, volumes):
    result, calls = run(tmp_path, language, volumes)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == NOT_CONFIGURED
    assert calls == ["docker volume ls -q --filter label=com.docker.compose.project=jht"]


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_a_service_that_is_up_with_no_bot_says_not_configured_the_same_way(tmp_path, language):
    result, calls = run(tmp_path, language, CONFIGURED, running=True, bots=NO_BOT)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == NOT_CONFIGURED
    assert creates_nothing(calls)


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_a_configured_telegram_prints_what_the_service_says(tmp_path, language):
    result, calls = run(tmp_path, language, CONFIGURED, running=True, bots=ONE_BOT)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '"assistente": "present"' in result.stdout
    assert NOT_CONFIGURED not in result.stdout
    assert creates_nothing(calls)


@pytest.mark.parametrize("language", ["bash", "pwsh"])
@pytest.mark.parametrize("case", ["service_off", "no_answer"])
def test_a_state_that_cannot_be_read_says_so_and_creates_nothing(tmp_path, language, case):
    if case == "service_off":
        result, calls = run(tmp_path, language, CONFIGURED, running=False)
    else:
        result, calls = run(tmp_path, language, CONFIGURED, running=True, bots=None)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "stato non verificabile" in result.stdout
    assert NOT_CONFIGURED not in result.stdout
    assert creates_nothing(calls)


def test_the_status_command_of_both_wrappers_calls_the_read_only_line_and_not_the_lifecycle():
    sh = _source("jht-wrapper.sh")
    ps = _source("jht-wrapper.ps1")
    status_sh = re.search(r"status_human_running .*?\n(.*?)\n    else", sh, re.S).group(1)
    assert "telegram_status_line" in status_sh and "telegram_lifecycle" not in status_sh
    status_ps = re.search(r"^  'status' \{\n    Require-Docker.*?\n  \}\n", ps, re.S | re.M).group(0)
    assert "Write-TelegramStatusLine" in status_ps and "Invoke-AvailableTelegramLifecycle" not in status_ps


def test_integration_help_is_its_own_usage_and_both_wrappers_serve_it_before_the_generic_help():
    sh = _source("jht-wrapper.sh")
    ps = _source("jht-wrapper.ps1")
    text = re.search(r"^integration_help\(\) \{\n.*?^\}\n", sh, re.S | re.M).group(0)
    for needed in ("jht integration <comando>", "list [--json]", "status [ID]", "add ID", "remove ID", "--purge"):
        assert needed in text, needed
    assert re.search(r'if \[ "\$SUB" = integration \] && \[ "\$#" -eq 2 \]; then\n\s+integration_help', sh)
    assert re.search(r"-ceq 'integration' -and \$Rest.Count -eq 1\) \{\n\s+Write-IntegrationHelp", ps)
    # the same text in the two wrappers
    ps_text = re.search(r"Write-IntegrationHelp \{.*?@'\n(.*?)\n'@", ps, re.S).group(1)
    sh_text = re.search(r"<<'JHTINTEGRATIONHELP'\n(.*?)\nJHTINTEGRATIONHELP", sh, re.S).group(1)
    assert ps_text == sh_text


def test_integration_help_runs_and_prints_the_usage():
    if sys.platform == "win32":
        pytest.skip("the bash wrapper is not run on Windows")
    script = "set -u\n" + functions("integration_help") + "\nintegration_help\n"
    result = subprocess.run(["bash", "-c", script], text=True, capture_output=True, timeout=30)
    assert result.returncode == 0 and result.stdout.startswith("Uso: jht integration <comando>")
