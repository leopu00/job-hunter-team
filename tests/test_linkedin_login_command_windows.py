"""`jht linkedin login|status` on Windows: the functions of scripts/jht-integration.ps1 under the PowerShell it is meant for (5.1 and 7), with the
stand-ins of tests/test_integration_command_windows.py (a docker function, Invoke-Compose that records, the lookup of the running container),
extended with a view that answers `grant` and `status` and a one-shot that answers `check`. Same contract as the bash tests."""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from test_integration_command_windows import CASE, DIGEST, REF, host, log  # noqa: F401

TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE"
GOOD = '{"ok": true, "port": 6081, "path": "/websockify", "token": "%s", "expires_at": "2026-11-11T10:00:00Z", "session": "a1b2c3d4e5f6"}' % TOKEN

# the compose and the docker of the stand-ins, for this command
COMPOSE_FAKE = r"""function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)] $Rest)
  Add-Content -LiteralPath $env:T_LOG -Value ('COMPOSE ' + (@($Rest) -join ' '))
  if ($env:JHT_EXTRAS_IMAGE) { Add-Content -LiteralPath $env:T_LOG -Value ('EXTRAS_IMAGE ' + $env:JHT_EXTRAS_IMAGE) }
  $global:LASTEXITCODE = 0
  if ($env:T_COMPOSE_FAIL -eq '1') { $global:LASTEXITCODE = 1; return }
  $words = @($Rest)
  if ($words -contains 'run') { if ($env:T_CHECK_WORD) { $env:T_CHECK_WORD }; return }
  $running = @(Get-Content -LiteralPath $env:T_RUNNING)
  if ($words -contains 'up') { $running += @($words | Select-Object -Skip ([array]::IndexOf($words, '-d') + 1)) }
  if ($words -contains 'stop') { $running = @($running | Where-Object { $_ -ne $words[$words.Count - 1] }) }
  [IO.File]::WriteAllLines($env:T_RUNNING, [string[]]$running)
}
"""
DOCKER_FAKE = r"""function docker {
  Add-Content -LiteralPath $env:T_LOG -Value ('DOCKER ' + ($args -join ' '))
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'exec') {
    if ($args -contains 'grant') { if ($env:T_GRANT) { $env:T_GRANT }; return }
    if ($args -contains 'status') { if ($env:T_VIEW_STATUS) { $env:T_VIEW_STATUS } else { '{"ok": true, "view": "waiting"}' }; return }
  }
  if ($args[0] -eq 'inspect') { if ($env:T_EXIT_CODE) { $env:T_EXIT_CODE } else { $global:LASTEXITCODE = 1 }; return }
  if ($args[0] -eq 'image') { if ($env:T_NO_IMAGE -eq '1') { $global:LASTEXITCODE = 1 }; return }
}
"""
SCRIPT = re.sub(r"function Invoke-Compose \{.*?\n\}\n", lambda m: COMPOSE_FAKE, CASE, count=1, flags=re.S)
SCRIPT = re.sub(r"function docker \{.*?\n\}\n", lambda m: DOCKER_FAKE, SCRIPT, count=1, flags=re.S)
SCRIPT = SCRIPT.replace("Invoke-IntegrationCommand", "Invoke-LinkedinCommand").replace("$JhtHome = $env:T_JHT_HOME\n", "$JhtHome = $env:T_JHT_HOME\n$LinkedinPollSeconds = 0\n", 1)


@pytest.fixture
def lhost(host):
    host.script.write_text(SCRIPT, encoding="utf-8-sig")
    return host


def lrun(host, args: list[str], **extra: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "T_RUNTIME": str(host.runtime), "T_LOG": str(host.log), "T_VOLUMES": str(host.volumes),
           "T_RUNNING": str(host.running), "T_LIBRARY": str(Path(host.script).parent.parent.parent / "scripts" / "jht-integration.ps1")
           if False else str(__import__("test_integration_command_windows").LIBRARY),
           "T_ARGS": json.dumps(args), "T_JHT_HOME": str(host.tmp / "jht-home"), "T_EXTRAS": DIGEST, **extra}
    return subprocess.run([*host.argv, "-File", str(host.script)], env=env, capture_output=True, text=True, timeout=120)


def last(done) -> dict:
    return json.loads(done.stdout.strip().splitlines()[-1])


def _link_or_skip(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("this machine does not let the test make a symbolic link")


def test_login_makes_the_profile_pulls_starts_only_the_login_profile_and_prints_the_grant_as_it_got_it(lhost):
    done = lrun(lhost, ["login"], T_GRANT=GOOD)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip().splitlines()[-1] == GOOD
    assert (lhost.tmp / "jht-home" / "secrets" / "linkedin-profile").is_dir()
    lines = log(lhost).splitlines()
    up = "COMPOSE --profile login up -d jht-login-proxy jht-login-view jht-login"
    assert lines.index(f"DOCKER pull {REF}") < lines.index(up) and f"EXTRAS_IMAGE {REF}" in lines
    assert not [line for line in lines if " up -d" in line and "--profile login" not in line]


def test_a_release_without_an_extras_image_touches_nothing(lhost):
    done = lrun(lhost, ["login"], T_EXTRAS="")
    assert done.returncode == 1 and last(done) == {"ok": False, "reason": "view_unavailable"}
    assert " up -d" not in log(lhost) and not (lhost.tmp / "jht-home").exists()


def test_a_session_already_there_is_view_busy(lhost):
    lhost.running.write_text("jht-login-view\n", encoding="utf-8")
    done = lrun(lhost, ["login"], T_GRANT=GOOD)
    assert done.returncode == 1 and last(done) == {"ok": False, "reason": "view_busy"}
    assert " up -d" not in log(lhost) and " rm -f" not in log(lhost)


@pytest.mark.parametrize("make_bad", ["secrets_link", "profile_link", "profile_file"])
def test_a_link_or_a_file_down_to_the_profile_is_refused_and_never_followed(lhost, make_bad):
    target = lhost.tmp / "somewhere-else"
    target.mkdir()
    home = lhost.tmp / "jht-home"
    home.mkdir()
    if make_bad == "secrets_link":
        _link_or_skip(home / "secrets", target)
    elif make_bad == "profile_link":
        (home / "secrets").mkdir()
        _link_or_skip(home / "secrets" / "linkedin-profile", target)
    else:
        (home / "secrets").mkdir()
        (home / "secrets" / "linkedin-profile").write_text("x", encoding="utf-8")
    done = lrun(lhost, ["login"], T_GRANT=GOOD)
    assert done.returncode == 1 and last(done) == {"ok": False, "reason": "view_unavailable"}, done.stdout + done.stderr
    assert " up -d" not in log(lhost) and list(target.iterdir()) == []


@pytest.mark.parametrize("line", [
    "", "not json", '{"ok": true}', GOOD.replace(TOKEN, TOKEN[:-1]), GOOD.replace("6081", "6082"), GOOD + ', "extra": 1',
    '{"ok": false, "reason": "something_new"}', '{"ok": false, "reason": "view_busy; rm"}',
])
def test_a_line_that_is_not_exactly_the_contract_never_reaches_the_app_as_a_grant(lhost, line):
    done = lrun(lhost, ["login"], T_GRANT=line)
    assert done.returncode == 1 and TOKEN not in done.stdout
    assert last(done) == {"ok": False, "reason": "view_unavailable"}


@pytest.mark.parametrize("reason", ["view_busy", "login_timeout", "token_expired", "chromium_sandbox_unavailable"])
def test_a_reason_of_the_contract_is_passed_on_and_the_containers_are_taken_down(lhost, reason):
    done = lrun(lhost, ["login"], T_GRANT=json.dumps({"ok": False, "reason": reason}))
    assert done.returncode == 1 and last(done) == {"ok": False, "reason": reason}
    assert lhost.running.read_text(encoding="utf-8").strip() == ""


def test_stop_takes_all_three_down_and_says_ok(lhost):
    lhost.running.write_text("jht-login\njht-login-proxy\njht-login-view\n", encoding="utf-8")
    done = lrun(lhost, ["login", "--stop"])
    assert done.returncode == 0 and last(done) == {"ok": True}
    lines = log(lhost).splitlines()
    for service in ("jht-login", "jht-login-proxy", "jht-login-view"):
        assert f"COMPOSE --profile login stop {service}" in lines and f"COMPOSE --profile login rm -f {service}" in lines


def test_status_idle_waiting_connected_and_how_the_last_session_ended(lhost):
    assert last(lrun(lhost, ["status", "--json"])) == {"ok": True, "view": "idle", "linkedin": "login_required"}
    lhost.running.write_text("jht-login-view\n", encoding="utf-8")
    assert last(lrun(lhost, ["status", "--json"], T_VIEW_STATUS='{"ok": true, "view": "waiting"}'))["view"] == "waiting"
    assert last(lrun(lhost, ["status", "--json"], T_VIEW_STATUS='{"ok": true, "view": "connected"}'))["view"] == "connected"
    lhost.running.write_text("", encoding="utf-8")
    for code, reason in (("10", "logged_in"), ("11", "login_timeout"), ("12", "token_expired"), ("13", "stopped")):
        assert last(lrun(lhost, ["status", "--json"], T_EXIT_CODE=code))["last_session"] == {"reason": reason}
    assert "last_session" not in last(lrun(lhost, ["status", "--json"], T_EXIT_CODE="14"))


def cookies(host, content: bytes = b"cookies") -> Path:
    path = host.tmp / "jht-home" / "secrets" / "linkedin-profile" / "Default" / "Network" / "Cookies"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def runs(host) -> int:
    return log(host).count(" run --rm")


def test_status_asks_the_profile_in_a_one_shot_only_when_there_is_a_cookie_file_and_the_image(lhost):
    profile = lhost.tmp / "jht-home" / "secrets" / "linkedin-profile"
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="logged_in"))["linkedin"] == "login_required"
    assert runs(lhost) == 0
    profile.mkdir(parents=True)
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="logged_in"))["linkedin"] == "login_required" and runs(lhost) == 0  # no cookie file
    cookies(lhost)
    lrun(lhost, ["status", "--json"], T_NO_IMAGE="1", T_CHECK_WORD="logged_in")
    assert runs(lhost) == 0
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="logged_in"))["linkedin"] == "logged_in"
    assert "--no-deps -T --entrypoint python3 jht-login /app/shared/login/login_session.py check /linkedin-profile" in log(lhost)


def test_a_word_that_is_not_in_the_closed_list_is_not_a_sign_in_and_is_not_kept(lhost):
    cookies(lhost)
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="whatever; rm"))["linkedin"] == "login_required"
    assert not (lhost.runtime / "linkedin-status.cache").exists()
    lrun(lhost, ["status", "--json"], T_CHECK_WORD="whatever; rm")
    assert runs(lhost) == 2


def test_looking_again_and_again_costs_one_container_not_one_per_look(lhost):
    cookies(lhost)
    answers = [last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="logged_in"))["linkedin"] for _ in range(4)]
    assert answers == ["logged_in"] * 4 and runs(lhost) == 1
    parts = (lhost.runtime / "linkedin-status.cache").read_text(encoding="utf-8").strip().split("|")
    assert len(parts) == 3 and parts[0].isdigit() and parts[2] == "logged_in"
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="login_required"))["linkedin"] == "logged_in", "inside the time the kept answer is the answer"


def test_the_one_shot_runs_again_when_the_cookie_files_change_and_when_the_entry_is_old_or_not_clean(lhost):
    path = cookies(lhost)
    lrun(lhost, ["status", "--json"], T_CHECK_WORD="login_required")
    assert runs(lhost) == 1
    path.write_bytes(b"the person signed in: more bytes")
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="logged_in"))["linkedin"] == "logged_in" and runs(lhost) == 2
    cache = lhost.runtime / "linkedin-status.cache"
    epoch, key, word = cache.read_text(encoding="utf-8").strip().split("|")
    for line in (f"{int(epoch) - 400}|{key}|logged_in", f"{epoch}|{key}|logged_in; rm", f"{epoch}|other|logged_in", f"x|{key}|logged_in",
                 f"{int(epoch) + 4000}|{key}|logged_in", f"{epoch}|{key}", f"{epoch}|{key}|logged_in|more"):
        cache.write_text(line + "\n", encoding="utf-8")
        before = runs(lhost)
        assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="login_required"))["linkedin"] == "login_required", line
        assert runs(lhost) == before + 1, line


def test_a_cookie_file_that_is_a_link_is_not_a_cookie_file(lhost, tmp_path):
    folder = lhost.tmp / "jht-home" / "secrets" / "linkedin-profile" / "Default" / "Network"
    folder.mkdir(parents=True)
    target = tmp_path / "somewhere"
    target.write_bytes(b"x")
    try:
        (folder / "Cookies").symlink_to(target)
    except OSError:
        pytest.skip("this machine does not let the test make a symbolic link")
    assert last(lrun(lhost, ["status", "--json"], T_CHECK_WORD="logged_in"))["linkedin"] == "login_required" and runs(lhost) == 0


@pytest.mark.parametrize("args", [[], ["login", "now"], ["status"], ["logout"], ["login", "--stop", "now"]])
def test_anything_else_is_the_usage_with_code_2_and_the_engine_is_not_asked(lhost, args):
    done = lrun(lhost, args)
    assert done.returncode == 2 and "uso: jht linkedin" in done.stderr
    assert log(lhost) == ""


def test_the_wrapper_has_the_same_linkedin_command_as_the_bash_one():
    root = Path(__file__).resolve().parents[1] / "scripts"
    power = (root / "jht-wrapper.ps1").read_text(encoding="utf-8")
    shell = (root / "jht-wrapper.sh").read_text(encoding="utf-8")
    assert "$Sub -ceq 'linkedin' -and $Rest.Count -eq 1" in power and "linkedin_help" in shell and "Write-LinkedinHelp" in power
    assert "'linkedin', 'tools'" in power and "integration|screen|linkedin|tools" in shell
    assert '''{"ok": true, "view": "idle", "linkedin": "login_required"}''' in power and '''{"ok": true, "view": "idle", "linkedin": "login_required"}''' in shell
    assert "Invoke-LinkedinCommand @($Rest)" in power and "linkedin_main" in shell
