"""A computer where Telegram was never configured does nothing about Telegram at install, `jht up` or upgrade.

Only the Telegram service (profile telegram) mounts the jht-telegram-state volume, so «no volume» means «never
configured» and `resume` returns before the lifecycle plan, a `compose run` that would create the volumes and
three run containers. A listing the engine cannot answer says nothing: the lifecycle runs as it always did.
The same rule is in jht-wrapper.sh and jht-wrapper.ps1 (the Node CLI has its own test).
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


# The engine: records every call, answers `volume ls` from VOLUMES, or fails when LIST_FAILS is set.
ENGINE = r'''
import os, sys
with open(os.environ['LOG'], 'a') as log:
    log.write('docker ' + ' '.join(sys.argv[1:]) + '\n')
if sys.argv[1:3] == ['volume', 'ls']:
    if os.environ.get('LIST_FAILS'):
        raise SystemExit(1)
    print(os.environ.get('VOLUMES', ''))
'''

BASH = '''set -u
compose_lacks_service() { return 1; }
telegram_lifecycle_command() { echo "lifecycle $*" >> "$LOG"; }
TELEGRAM_SERVICE=jht-telegram
''' + functions("compose_project_name", "telegram_state_volume_absent", "telegram_lifecycle_if_available") + '''
telegram_lifecycle_if_available "$ACTION"
'''

POWERSHELL = '''$ErrorActionPreference = 'Stop'
$ContainerRuntime = 'podman'
$ComposeFile = Join-Path $PSScriptRoot 'compose.yml'
Set-Content -LiteralPath $ComposeFile -Value "services:`n  jht-telegram:`n    image: synthetic"
function Invoke-TelegramLifecycle { param([string[]]$TelegramArgs); Add-Content -LiteralPath $env:LOG -Value "lifecycle $TelegramArgs"; return 0 }
''' + powershell_functions("Get-ComposeProjectName", "Test-TelegramStateVolumeAbsent", "Invoke-AvailableTelegramLifecycle") + '''
exit (Invoke-AvailableTelegramLifecycle $env:ACTION)
'''

CONFIGURED = "jht_jht-telegram-state\njht_jht-deps\n"
OTHERS_ONLY = "jht_jht-deps\njht_jht-secrets\n"


def run(tmp_path, language, action, volumes, list_fails=False):
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
    env = {**os.environ, "PATH": str(binaries) + os.pathsep + os.environ["PATH"],
           "LOG": str(log), "ACTION": action, "VOLUMES": volumes}
    if list_fails:
        env["LIST_FAILS"] = "1"
    script = tmp_path / ("host.sh" if language == "bash" else "host.ps1")
    script.write_text(BASH if language == "bash" else POWERSHELL, encoding="utf-8")
    command = ["bash", str(script)] if language == "bash" else [shell, "-NoProfile", "-File", str(script)]
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=60)
    return result, log.read_text().splitlines()


@pytest.mark.parametrize("language", ["bash", "pwsh"])
@pytest.mark.parametrize("volumes", ["", OTHERS_ONLY])
def test_resume_without_the_state_volume_runs_nothing_for_telegram(tmp_path, language, volumes):
    result, calls = run(tmp_path, language, "resume", volumes)
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == ["docker volume ls -q --filter label=com.docker.compose.project=jht"]


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_resume_with_the_state_volume_keeps_the_lifecycle(tmp_path, language):
    result, calls = run(tmp_path, language, "resume", CONFIGURED)
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls[-1] == "lifecycle resume"


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_a_listing_that_fails_keeps_the_lifecycle(tmp_path, language):
    result, calls = run(tmp_path, language, "resume", "", list_fails=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls[-1] == "lifecycle resume"


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_status_still_answers_when_telegram_was_never_configured(tmp_path, language):
    """Only `resume` is skipped: `jht telegram status` goes on to say «Telegram non configurato»."""
    result, calls = run(tmp_path, language, "status", "")
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == ["lifecycle status"]
