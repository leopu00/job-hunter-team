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


def stand_in_tmux(folder: Path, activity: int, text: str) -> dict[str, str]:
    """A tmux that lists one pane with the given last activity and shows the given text."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "pane.txt").write_text(text, encoding="utf-8")
    tmux = folder / "tmux"
    tmux.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if sys.argv[1] == 'list-panes':\n"
        f"    print('%1 {activity}')\n"
        "elif sys.argv[1] == 'capture-pane':\n"
        f"    sys.stdout.write(open({str(folder / 'pane.txt')!r}, encoding='utf-8').read())\n",
        encoding="utf-8",
    )
    tmux.chmod(0o755)
    return {"PATH": f"{folder}{os.pathsep}{os.environ['PATH']}"}


def run(home: Path, request: str = '{"op":"state"}', extra: dict[str, str] | None = None) -> tuple[dict, str]:
    env = {**os.environ, "JHT_HOME": str(home), **(extra or {})}
    # no tmux at all unless the test gives one
    if not extra:
        env["PATH"] = str(home / "no-bin")
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


def test_a_broken_tmux_is_no_evidence(tmp_path):
    config(tmp_path)
    fresh_codex(tmp_path)
    folder = tmp_path / "bin"
    folder.mkdir()
    tmux = folder / "tmux"
    tmux.write_text(f"#!{sys.executable}\nraise SystemExit(3)\n", encoding="utf-8")
    tmux.chmod(0o755)
    assert state(tmp_path, extra={"PATH": f"{folder}{os.pathsep}{os.environ['PATH']}"}) == "ready"


def test_any_other_request_is_refused_with_a_closed_code(tmp_path):
    config(tmp_path)
    fresh_codex(tmp_path)
    for request in ('{"op":"clear"}', '{"op":"state","extra":1}', "[]", "not json", ""):
        reply, _ = run(tmp_path, request=request)
        assert reply == {"ok": False, "error": "provider_login_unreadable"}
