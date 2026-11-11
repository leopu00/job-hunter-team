"""`jht up` and `jht down` say the phase and the result, not the lines of compose; `jht help setup` is `jht setup --help`.

A Mac with Colima (and Docker) printed what `docker compose` writes while it works (Network ... Creating, Volume ... Created,
Container jht Starting...) after `jht up` and `jht down`, about 24 lines, where the Podman runtime said «Job Hunter Team started.».
Now the lines stay out of sight when all went well, come whole when it did not, and come as they are with `--verbose` (or
JHT_VERBOSE=1). On Windows the same with Invoke-ComposeQuiet, run here from the real script with a fake docker. The text
`jht help setup` printed was the generic help; it is the one of `jht setup --help`.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

from test_cli_help_never_starts_docker import assert_no_docker_effect, make_docker_spy, run_wrapper
from test_windows_podman_wsl_branches import _fake, _run

ROOT = Path(__file__).resolve().parent.parent
PS1 = ROOT / "scripts" / "jht-wrapper.ps1"
SH = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL = (PS1.read_text(encoding="utf-8")).replace("\r\n", "\n")


# ── jht help setup ──────────────────────────────────────────────────────────

@pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")
@pytest.mark.parametrize("container_running", [False, True])
def test_help_setup_is_the_help_of_setup_and_starts_nothing(tmp_path, container_running):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=container_running)
    asked = run_wrapper(["help", "setup"], fake_bin, tmp_path)
    same = run_wrapper(["setup", "--help"], fake_bin, tmp_path)
    assert asked.returncode == 0 and same.returncode == 0, asked.stderr
    assert asked.stdout == same.stdout and "--api-key-file <percorso>" in asked.stdout and "--api-key-stdin" in asked.stdout
    assert_no_docker_effect(log)


@pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")
def test_plain_help_is_still_the_long_list_and_the_windows_wrapper_answers_help_setup_too(tmp_path):
    fake_bin, _log = make_docker_spy(tmp_path, reachable=False, container_running=False)
    plain = run_wrapper(["help"], fake_bin, tmp_path)
    assert plain.returncode == 0 and "--api-key-file" not in plain.stdout
    branch = re.search(r"  'help' \{\n(.*?)\n  \}\n", POWERSHELL, re.S).group(1)
    assert "$Rest.Count -eq 1 -and $Rest[0] -ceq 'setup'" in branch and "Write-SetupHelp" in branch


# ── the bash wrapper: the dispatcher says the phase for up and down ─────────

def test_the_four_lifecycle_branches_ask_for_the_verbose_flag_first():
    text = SH.read_text(encoding="utf-8")
    for branch in ("  up)\n", "  start-container)\n", "  down|stop-container)\n", "  recreate)\n"):
        assert branch + '    jht_compose_verbose_requested "${@:2}"\n' in text, branch


# ── the Windows wrapper: Invoke-ComposeQuiet ────────────────────────────────

COMPOSE_CASES = r"""  "compose "*" up -d") printf ' Container jht  Creating\n Container jht  Started\n'; printf ' Network jht_default  Created\n' >&2; [ "$FAKE_FAIL" = up ] && { echo 'Error: compose up failed' >&2; exit 3; } ;;
  "compose "*" down") printf ' Container jht  Stopping\n' >&2; [ "$FAKE_FAIL" = down ] && { echo 'Error: down failed' >&2; exit 4; } ;;"""

BODY = r"""
function Test-PrivateJhtHomeAcl { $true }
function Assert-TrustedRuntime {}
$ContainerRuntime = 'docker'
$ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
$script:JhtComposeVerbose = ($env:VERBOSE -eq '1')
$code = Invoke-ComposeQuiet 'up' '-d'
'CODE=' + $code
"""


def _compose(tmp_path, *, verbose: bool = False, fail: str = "", body: str = BODY):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", COMPOSE_CASES)
    return _run(tmp_path, PS1, ["Invoke-ComposeQuiet", "Invoke-Compose"], body, {"VERBOSE": "1" if verbose else "0", "FAKE_FAIL": fail})


def test_windows_compose_that_went_well_prints_nothing_and_gives_its_code(tmp_path):
    result, calls = _compose(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.split() == ["CODE=0"], result.stdout
    assert "Container jht" not in result.stdout + result.stderr and "Network" not in result.stdout + result.stderr
    assert any(call.startswith("compose") and call.endswith("up -d") for call in calls), calls


def test_windows_compose_that_failed_shows_everything_it_said_and_gives_its_code(tmp_path):
    result, _calls = _compose(tmp_path, fail="up")
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.split() == ["CODE=3"], result.stdout
    for line in ("Container jht  Creating", "Network jht_default  Created", "Error: compose up failed"):
        assert line in result.stdout + result.stderr, (line, result.stdout, result.stderr)


def test_windows_compose_with_verbose_prints_what_compose_says(tmp_path):
    result, _calls = _compose(tmp_path, verbose=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Container jht  Started" in result.stdout and "CODE=0" in result.stdout


def test_windows_up_and_down_say_the_result_in_the_language_of_the_person(tmp_path):
    body = r"""
function Test-PrivateJhtHomeAcl { $true }
function Assert-TrustedRuntime {}
$env:JHT_HOST_ENV_FILE = Join-Path $env:HOME '.jht/host.env'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $env:JHT_HOST_ENV_FILE) | Out-Null
$env:JHT_LANG = 'it'
Write-JhtLifecycleDone 'up'
Set-Content -LiteralPath (Join-Path (Split-Path -Parent $env:JHT_HOST_ENV_FILE) 'i18n-prefs.json') -Value '{"locale": "en"}'
Write-JhtLifecycleDone 'up'
Write-JhtLifecycleDone 'down'
Set-Content -LiteralPath (Join-Path (Split-Path -Parent $env:JHT_HOST_ENV_FILE) 'i18n-prefs.json') -Value '{"locale": "it"}'
$env:JHT_LANG = 'en'
Write-JhtLifecycleDone 'down'
"""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", COMPOSE_CASES)
    result, _calls = _run(tmp_path, PS1, ["Get-JhtTextLanguage", "Write-JhtLifecycleDone"], body, {})
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.splitlines() == [
        "Job Hunter Team avviato.",    # no saved choice: JHT_LANG says it
        "Job Hunter Team started.",    # the person chose en with `jht setup --language en`: it wins over JHT_LANG=it
        "Job Hunter Team stopped.",
        "Job Hunter Team fermato.",    # and the other way round
    ], result.stdout
