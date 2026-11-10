"""provider_login_state.py: the script the desktop app sends into the team's container to learn whether the provider's
sign-in still works. It reads the credentials there and answers ONE word; it never prints a token, a date or a line of an
agent's terminal.

All data is synthetic: fake tokens, fake dates, fake terminal lines.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "desktop" / "src-tauri" / "src" / "provider_login_state.py"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the container is Linux; the test uses a stand-in tmux")

CODEX_REFUSAL = "■ Your access token could not be refreshed. Please log out and sign in again."


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def config(home: Path, provider: str = "openai", method: str | None = "subscription") -> None:
    entry = {} if method is None else {"auth_method": method}
    write_json(home / "jht.config.json", {"active_provider": provider, "providers": {provider: entry}})


def fresh_codex(home: Path, days_old: float = 1.0) -> Path:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - days_old * 86400))
    path = home / ".codex" / "auth.json"
    write_json(path, {"tokens": {"access_token": "fake-access-token-aaa", "refresh_token": "fake-refresh-token-bbb"}, "last_refresh": stamp})
    return path


def stand_in_tmux(folder: Path, activity: int | None = None, text: str = "", list_rc: int = 0, list_err: str = "") -> dict[str, str]:
    """A tmux that lists one pane with the given last activity (none when `activity` is None) and shows the given text.
    `list_rc`/`list_err` make the listing fail the way tmux does."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "pane.txt").write_text(text, encoding="utf-8")
    listing = "" if activity is None else f"%1 {activity}"
    tmux = folder / "tmux"
    tmux.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if sys.argv[1] == 'list-panes':\n"
        f"    sys.stderr.write({list_err!r})\n"
        f"    print({listing!r}) if {list_rc} == 0 else None\n"
        f"    raise SystemExit({list_rc})\n"
        "elif sys.argv[1] == 'capture-pane':\n"
        f"    sys.stdout.write(open({str(folder / 'pane.txt')!r}, encoding='utf-8').read())\n",
        encoding="utf-8",
    )
    tmux.chmod(0o755)
    return {"PATH": f"{folder}{os.pathsep}{os.environ['PATH']}"}


def run(home: Path, request: str = '{"op":"state"}', extra: dict[str, str] | None = None) -> tuple[dict, str]:
    # by default the container has its tmux and no agent running (tmux says there is no server)
    extra = extra or stand_in_tmux(home / "idle-bin", list_rc=1, list_err="no server running on /tmp/tmux-1000/default\n")
    env = {**os.environ, "JHT_HOME": str(home), **extra}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT)], input=request + "\n", capture_output=True, text=True, env=env, timeout=30)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout), done.stdout


def state(home: Path, **kwargs) -> str:
    reply, _ = run(home, **kwargs)
    assert reply["ok"] is True
    assert set(reply) == {"ok", "state", "provider"}
    return reply["state"]


def test_a_team_without_a_subscription_login_has_nothing_to_check(tmp_path):
    assert state(tmp_path) == "not_applicable"
    config(tmp_path, "openai", "api_key")
    fresh_codex(tmp_path)
    assert state(tmp_path) == "not_applicable"
    config(tmp_path, "some-other-provider")
    assert state(tmp_path) == "not_applicable"
    assert run(tmp_path)[0]["provider"] == "none"


def test_no_file_is_missing_and_a_file_that_is_no_login_is_unreadable(tmp_path):
    config(tmp_path)
    assert state(tmp_path) == "missing"
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex" / "auth.json").write_text("not json at all", encoding="utf-8")
    assert state(tmp_path) == "unreadable"
    write_json(tmp_path / ".codex" / "auth.json", {})
    assert state(tmp_path) == "unreadable"
    write_json(tmp_path / ".codex" / "auth.json", ["a", "list"])
    assert state(tmp_path) == "unreadable"
    # a JSON object that is not a sign-in of this provider is no sign-in either
    write_json(tmp_path / ".codex" / "auth.json", {"unrelated": True})
    assert state(tmp_path) == "unreadable"
    write_json(tmp_path / ".codex" / "auth.json", {"tokens": {}, "last_refresh": "2026-11-01T00:00:00Z"})
    assert state(tmp_path) == "unreadable"


def test_a_recent_login_is_ready_and_an_old_one_is_only_probably_expired(tmp_path):
    config(tmp_path)
    fresh_codex(tmp_path, days_old=2)
    assert state(tmp_path) == "ready"
    fresh_codex(tmp_path, days_old=29)
    assert state(tmp_path) == "ready"
    fresh_codex(tmp_path, days_old=31)
    assert state(tmp_path) == "probably_expired"


def test_the_age_is_the_logins_own_date_and_the_file_time_only_when_it_has_none(tmp_path):
    config(tmp_path)
    path = fresh_codex(tmp_path, days_old=60)
    # the file was touched a minute ago but the login inside it is two months old
    os.utime(path, (time.time(), time.time()))
    assert state(tmp_path) == "probably_expired"
    write_json(path, {"tokens": {"access_token": "fake-access-token-aaa"}})
    old = time.time() - 40 * 86400
    os.utime(path, (old, old))
    assert state(tmp_path) == "probably_expired"
    os.utime(path, (time.time(), time.time()))
    assert state(tmp_path) == "ready"


def test_an_agent_refused_after_the_login_is_expired_and_the_answer_is_one_word(tmp_path):
    config(tmp_path)
    path = fresh_codex(tmp_path, days_old=1)
    login_at = int(path.stat().st_mtime)
    extra = stand_in_tmux(tmp_path / "bin", login_at + 600, f"> hello\n{CODEX_REFUSAL}\n")
    reply, raw = run(tmp_path, extra=extra)
    assert reply == {"ok": True, "state": "expired", "provider": "codex"}
    # nothing of the credentials or of the terminal leaves the container
    for secret in ("fake-access-token-aaa", "fake-refresh-token-bbb", "could not be refreshed", "hello"):
        assert secret not in raw


def test_a_refusal_from_before_the_login_does_not_count(tmp_path):
    config(tmp_path)
    path = fresh_codex(tmp_path, days_old=1)
    login_at = int(path.stat().st_mtime)
    # the pane was last active before the login: its error is the old one
    extra = stand_in_tmux(tmp_path / "bin", login_at - 600, CODEX_REFUSAL + "\n")
    assert state(tmp_path, extra=extra) == "ready"
    # and the same pane, active after the login but without the sentence, is fine too
    extra = stand_in_tmux(tmp_path / "bin2", login_at + 600, "working on posizione-1\n")
    assert state(tmp_path, extra=extra) == "ready"


def test_a_sentence_of_another_provider_or_a_job_page_is_not_a_refusal(tmp_path):
    config(tmp_path)
    path = fresh_codex(tmp_path, days_old=1)
    login_at = int(path.stat().st_mtime)
    extra = stand_in_tmux(tmp_path / "bin", login_at + 600, "fetch https://example.invalid/jobs -> 401 Unauthorized\nPlease run /login\n")
    assert state(tmp_path, extra=extra) == "ready"


def test_the_provider_is_named_by_its_product_whatever_the_team_calls_it(tmp_path):
    for configured, named in (("openai", "codex"), ("codex", "codex"), ("claude", "claude"), ("anthropic", "claude"), ("kimi", "kimi"), ("moonshot", "kimi")):
        config(tmp_path, configured)
        assert run(tmp_path)[0]["provider"] == named


def test_claude_is_checked_by_its_own_sentence_and_its_own_file(tmp_path):
    config(tmp_path, "claude")
    assert state(tmp_path) == "missing"
    path = tmp_path / ".claude" / ".credentials.json"
    write_json(path, {"claudeAiOauth": {"accessToken": "fake-access-token-aaa", "expiresAt": 1}})
    # an old file is not an expiry for Claude (it renews itself): ready, until an agent is refused
    old = time.time() - 90 * 86400
    os.utime(path, (old, old))
    assert state(tmp_path) == "ready"
    extra = stand_in_tmux(tmp_path / "bin", int(time.time()), "OAuth token has expired. Please run /login\n")
    assert state(tmp_path, extra=extra) == "expired"
    extra = stand_in_tmux(tmp_path / "bin2", int(time.time()), CODEX_REFUSAL + "\n")
    assert state(tmp_path, extra=extra) == "ready"


def test_a_tmux_that_fails_is_a_failed_check_and_no_server_is_no_agent(tmp_path):
    config(tmp_path)
    fresh_codex(tmp_path)
    broken = stand_in_tmux(tmp_path / "bin", list_rc=3, list_err="something went wrong\n")
    reply, _ = run(tmp_path, extra=broken)
    assert reply == {"ok": False, "error": "provider_login_unreadable"}
    missing = {"PATH": str(tmp_path / "nothing-here")}
    reply, _ = run(tmp_path, extra=missing)
    assert reply == {"ok": False, "error": "provider_login_unreadable"}
    idle = stand_in_tmux(tmp_path / "idle", list_rc=1, list_err="no server running on /tmp/tmux-1000/default\n")
    assert state(tmp_path, extra=idle) == "ready"


def test_settings_that_cannot_be_read_are_a_failed_check_not_nothing_to_check(tmp_path):
    (tmp_path / "jht.config.json").write_text("{ not json", encoding="utf-8")
    reply, _ = run(tmp_path)
    assert reply == {"ok": False, "error": "provider_login_unreadable"}
    write_json(tmp_path / "jht.config.json", ["a", "list"])
    reply, _ = run(tmp_path)
    assert reply == {"ok": False, "error": "provider_login_unreadable"}


def test_an_old_refusal_followed_by_answers_is_not_a_refusal(tmp_path):
    config(tmp_path)
    path = fresh_codex(tmp_path, days_old=1)
    login_at = int(path.stat().st_mtime)
    worked = "\n".join(f"• working on posizione-{n}" for n in range(12))
    # the pane worked after the new sign-in: the old refusal is still in its last 40 lines, but answers came after it
    extra = stand_in_tmux(tmp_path / "bin", login_at + 600, f"{CODEX_REFUSAL}\n{worked}\n> \n")
    assert state(tmp_path, extra=extra) == "ready"
    # the same refusal as the last thing said, under only the prompt and the status bar: it is the current one
    extra = stand_in_tmux(tmp_path / "bin2", login_at + 600, f"{worked}\n{CODEX_REFUSAL}\n\n> \n  ? for shortcuts\n")
    assert state(tmp_path, extra=extra) == "expired"


def test_any_other_request_is_refused_with_a_closed_code(tmp_path):
    config(tmp_path)
    fresh_codex(tmp_path)
    for request in ('{"op":"clear"}', '{"op":"state","extra":1}', "[]", "not json", ""):
        reply, _ = run(tmp_path, request=request)
        assert reply == {"ok": False, "error": "provider_login_unreadable"}


def test_with_pi_in_charge_of_the_openai_account_the_sign_in_is_pis_file_and_codexs_is_not_looked_at(tmp_path):
    write_json(tmp_path / "jht.config.json", {"active_provider": "openai", "harness": "pi", "providers": {"openai": {"auth_method": "subscription"}}})
    fresh_codex(tmp_path)
    assert state(tmp_path) == "missing", "a Codex login does not sign Pi in"
    pi = tmp_path / ".pi" / "agent" / "auth.json"
    pi.parent.mkdir(parents=True)
    pi.write_text("", encoding="utf-8")
    assert state(tmp_path) == "unreadable"
    write_json(pi, {"openai": {"type": "oauth", "access": "fake-pi-token"}})
    assert state(tmp_path) == "ready"
    (tmp_path / ".codex" / "auth.json").unlink()
    assert state(tmp_path) == "ready", "with Pi in charge Codex's file is not needed"
    # the word is `pi` and nothing else: any other value leaves Codex's file as the sign-in
    write_json(tmp_path / "jht.config.json", {"active_provider": "openai", "harness": "other", "providers": {"openai": {}}})
    assert state(tmp_path) == "missing"


def test_a_pi_file_with_only_another_service_is_not_the_sign_in_of_the_openai_account(tmp_path):
    """Pi keeps one entry per service. A Claude subscription used from Pi (billed per token) made the file «there», and the app said signed in."""
    write_json(tmp_path / "jht.config.json", {"active_provider": "openai", "harness": "pi", "providers": {"openai": {"auth_method": "subscription"}}})
    pi = tmp_path / ".pi" / "agent" / "auth.json"
    write_json(pi, {"anthropic": {"type": "oauth", "access": "fake-pi-token"}})
    assert state(tmp_path) == "missing"
    write_json(pi, {"anthropic": {"type": "oauth"}, "openai-codex": {"type": "oauth"}})
    assert state(tmp_path) == "missing", "the legacy id is not what the agents start with"
    write_json(pi, {"anthropic": {"type": "oauth"}, "openai": {"type": "oauth"}})
    assert state(tmp_path) == "ready"
    for text in ("{}", '{"openai": {}}', '{"openai": "x"}'):
        pi.write_text(text, encoding="utf-8")
        assert state(tmp_path) == "missing", text
    for text in ("not json", "[]"):
        pi.write_text(text, encoding="utf-8")
        assert state(tmp_path) == "unreadable", text
    reply, _ = run(tmp_path)
    assert "fake-pi-token" not in json.dumps(reply)


def test_the_two_names_of_the_script_are_the_ones_of_the_shared_list():
    names = next(line for line in SCRIPT.read_text(encoding="utf-8").splitlines() if line.startswith("PI_NAMES="))
    listed = next(line for line in (SCRIPT.parents[3] / "shared" / "runtime" / "pi-login-keys.list").read_text(encoding="utf-8").splitlines() if line.startswith("openai|"))
    assert sorted(eval(names.split("=", 1)[1].split("#")[0])) == sorted(listed.split("|")[1].split(","))
