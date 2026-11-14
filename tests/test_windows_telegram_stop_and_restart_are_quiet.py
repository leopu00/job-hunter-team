"""On Windows `jht up` with a Telegram that has no bot, and `jht restart`, print no line of compose.

With the Telegram service on and no bot paired, the resume step of `jht up` stops jht-telegram (the plan of the runtime: no bot,
no service), and the person read, after «Job Hunter Team avviato.», compose's « Container jht-telegram Stopping» and
« Container jht-telegram Stopped». `jht restart` printed « Container jht Restarting» and « Container jht Started». Both now go
through Invoke-ComposeQuiet: nothing when it went well, every line on stderr and compose's code when it did not; `jht restart`
says «Job Hunter Team riavviato.» in the person's language. A Telegram with a bot is started again by the same resume step
(the plan says start), on `jht up` and after a `jht down`.

Run from the real script with a fake docker, as test_up_down_say_the_phase_not_the_compose_lines.py.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from test_windows_podman_wsl_branches import _fake, _run

ROOT = Path(__file__).resolve().parent.parent
PS1 = ROOT / "scripts" / "jht-wrapper.ps1"
SOURCE = PS1.read_text(encoding="utf-8").replace("\r\n", "\n")

COMPOSE_CASES = r"""  "compose "*" stop jht-telegram") printf ' Container jht-telegram  Stopping\n Container jht-telegram  Stopped\n' >&2; [ "$FAKE_FAIL" = stop ] && { echo 'Error: stop failed' >&2; exit 5; } ;;
  "compose "*" restart jht") printf ' Container jht  Restarting\n Container jht  Started\n' >&2; [ "$FAKE_FAIL" = restart ] && { echo 'Error: restart failed' >&2; exit 6; } ;;"""

PREAMBLE = r"""
function Test-PrivateJhtHomeAcl { $true }
function Assert-TrustedRuntime {}
function Confirm-TelegramLifecycle { param([string]$Operation) 'CONFIRMED ' + $Operation | Out-Host; return 0 }
$ContainerRuntime = 'docker'
$ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
$TelegramContainer = 'jht-telegram'; $Container = 'jht'
$script:JhtComposeVerbose = $false
"""


def _case(tmp_path, body: str, fail: str = ""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", COMPOSE_CASES)
    return _run(tmp_path, PS1, ["Invoke-ComposeQuiet", "Invoke-Compose", "Invoke-TelegramLifecycleSteps"], PREAMBLE + body, {"FAKE_FAIL": fail})


def test_the_stop_of_a_telegram_without_a_bot_prints_no_line_of_compose(tmp_path):
    result, calls = _case(tmp_path, "$code = Invoke-TelegramLifecycleSteps @('stop') ''\n'CODE=' + $code\n")
    out = result.stdout + result.stderr
    assert result.returncode == 0, out
    assert "Container jht-telegram" not in out, out
    assert "CONFIRMED stop" in result.stdout and "CODE=0" in result.stdout, out
    assert any(c.startswith("compose") and c.endswith("stop jht-telegram") for c in calls), calls


def test_a_stop_that_fails_shows_what_compose_said_and_gives_its_code(tmp_path):
    result, _ = _case(tmp_path, "$code = Invoke-TelegramLifecycleSteps @('stop') ''\n'CODE=' + $code\n", fail="stop")
    assert "CODE=5" in result.stdout and "CONFIRMED" not in result.stdout, result.stdout
    for line in ("Container jht-telegram  Stopping", "Error: stop failed"):
        assert line in result.stderr, (line, result.stderr)


def test_restart_goes_through_the_quiet_compose_and_says_its_result():
    branch = re.search(r"\n  'restart' \{\n(.*?)\n  \}\n", SOURCE, re.S).group(1)
    assert "$restartCode = Invoke-ComposeQuiet 'restart' $Container" in branch
    assert "if ($restartCode -ne 0) { exit $restartCode }" in branch
    assert "Write-JhtLifecycleDone 'restart'" in branch
    assert "Invoke-Compose restart" not in branch


@pytest.mark.parametrize("fail,code", [("", 0), ("restart", 6)])
def test_the_restart_of_compose_is_quiet_when_it_works(tmp_path, fail, code):
    result, _ = _case(tmp_path, "$code = Invoke-ComposeQuiet 'restart' $Container\n'CODE=' + $code\n", fail=fail)
    assert f"CODE={code}" in result.stdout, result.stdout + result.stderr
    assert ("Container jht  Restarting" in result.stderr) == bool(fail), result.stderr
    assert "Container jht" not in result.stdout


def test_restart_says_its_result_in_the_language_of_the_person(tmp_path):
    body = "$env:JHT_LANG = 'it'\nWrite-JhtLifecycleDone 'restart'\n$env:JHT_LANG = 'en'\nWrite-JhtLifecycleDone 'restart'\n"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", COMPOSE_CASES)
    result, _ = _run(tmp_path, PS1, ["Get-JhtTextLanguage", "Write-JhtLifecycleDone"], body, {})
    assert result.stdout.splitlines() == ["Job Hunter Team riavviato.", "Job Hunter Team restarted."], result.stdout + result.stderr


def test_a_telegram_with_a_bot_is_started_again_by_up_and_after_a_down():
    # the plan of the runtime: resume = start when a bot is configured, stop when none
    lifecycle = (ROOT / "shared" / "telegram_service" / "lifecycle.py").read_text(encoding="utf-8")
    assert 'return ("start",) if configured else ("stop",)' in lifecycle
    up = SOURCE[SOURCE.index("  { $_ -in @('up', 'start-container') } {"):]
    up = up[:up.index("\n  }\n")]
    assert up.index("Invoke-ComposeQuiet 'up' '-d'") < up.index("Invoke-AvailableTelegramLifecycle 'resume'")
