"""The broker's interactive login view: token, session, perimeter (phase 2, early).

Local tests drive the session logic with a fake supervisor; the live part
(Xvfb, Chromium, x11vnc, websockify, the published port and what the agents
can reach) runs in CI on Linux (test_broker_socket_live.py and docker.yml).

Run with: pytest tests/test_broker_view.py -v
"""

import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))

from broker import view  # noqa: E402
from broker.view_token import DEAD_TARGET, VNC_TARGET, OneShot, check_and_burn, token_digest  # noqa: E402


@pytest.fixture
def env(tmp_path, monkeypatch):
    for name in ("secrets", "state", "run"):
        (tmp_path / name).mkdir(mode=0o700)
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(tmp_path / "secrets"))
    monkeypatch.setenv("JHT_BROKER_STATE", str(tmp_path / "state"))
    monkeypatch.setenv("JHT_BROKER_VIEW_RUN", str(tmp_path / "run"))
    return tmp_path


def issue(run: Path, token: str, ttl: float = 120) -> None:
    (run / "token.json").write_text(json.dumps({"sha256": token_digest(token), "expires_at": time.time() + ttl}))


# ── the token ────────────────────────────────────────────────────────────


def test_the_token_opens_one_connection_and_then_burns(env):
    run = env / "run"
    issue(run, "right-token")
    plugin = OneShot(str(run))
    assert plugin.lookup("right-token") == VNC_TARGET
    assert plugin.lookup("right-token") == DEAD_TARGET


def test_a_wrong_or_expired_token_gets_a_dead_target_never_none(env):
    run = env / "run"
    issue(run, "right-token", ttl=-1)
    plugin = OneShot(str(run))
    for token in ("right-token", "wrong", "", None):
        assert plugin.lookup(token) == DEAD_TARGET
    assert not (run / "burned").exists()


def test_without_an_issued_token_nothing_opens(env):
    assert check_and_burn(env / "run", "anything") is False


def test_the_run_dir_keeps_the_digest_never_the_token(env, monkeypatch):
    run = env / "run"

    class FakeProc:
        def poll(self):
            return None

    def fake_popen(cmd, **kwargs):
        (run / "session.json").write_text(json.dumps({"supervisor_pid": os.getpid()}))
        (run / "result.json").write_text(json.dumps({"ready": True}))
        return FakeProc()

    monkeypatch.setattr(view.subprocess, "Popen", fake_popen)
    out = view.start("linkedin-login")
    assert out["ok"] and out["port"] == 6081 and out["path"] == "/websockify"
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", out["token"])
    blob = "".join(p.read_text() for p in run.iterdir() if p.is_file())
    assert out["token"] not in blob and token_digest(out["token"]) in blob
    assert check_and_burn(run, out["token"]) is True


# ── the session ──────────────────────────────────────────────────────────


def test_one_session_at_a_time(env, monkeypatch):
    (env / "run" / "session.json").write_text(json.dumps({"supervisor_pid": os.getpid()}))
    with pytest.raises(view.ViewError) as err:
        view.start("linkedin-login")
    assert err.value.code == "view_busy"


def test_only_the_login_purpose_exists(env):
    with pytest.raises(view.ViewError) as err:
        view.start("anything-else")
    assert err.value.code == "view_purpose_unknown"


def test_a_supervisor_failure_comes_back_as_its_code(env, monkeypatch):
    run = env / "run"

    class FakeProc:
        def poll(self):
            return None

    def fake_popen(cmd, **kwargs):
        (run / "result.json").write_text(json.dumps({"failed": "chromium_sandbox_unavailable"}))
        return FakeProc()

    monkeypatch.setattr(view.subprocess, "Popen", fake_popen)
    with pytest.raises(view.ViewError) as err:
        view.start("linkedin-login")
    assert err.value.code == "chromium_sandbox_unavailable"


def test_status_tells_idle_waiting_connected(env):
    run = env / "run"
    assert view.status()["view"] == "idle"
    (run / "session.json").write_text(json.dumps({"supervisor_pid": os.getpid()}))
    assert view.status()["view"] == "waiting"
    (run / "burned").write_text("")
    assert view.status()["view"] == "connected"


def cookies_db(profile: Path, expires_utc: int) -> None:
    (profile / "Default").mkdir(parents=True)
    conn = sqlite3.connect(profile / "Default" / "Cookies")
    conn.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB, expires_utc INTEGER)")
    conn.execute("INSERT INTO cookies VALUES ('.www.linkedin.com', 'li_at', x'00', ?)", (expires_utc,))
    conn.commit()
    conn.close()


def chromium_time(ts: float) -> int:
    return int((ts + 11_644_473_600) * 1_000_000)


def test_status_reads_only_the_cookie_name_and_expiry(env):
    profile = env / "secrets" / "linkedin-profile"
    assert view.status()["linkedin"] == "login_required"
    cookies_db(profile, chromium_time(time.time() + 3600))
    assert view.status()["linkedin"] == "logged_in"


def test_an_expired_session_cookie_is_a_login_required(env):
    cookies_db(env / "secrets" / "linkedin-profile", chromium_time(time.time() - 60))
    assert view.status()["linkedin"] == "login_required"


# ── the perimeter (R3) ───────────────────────────────────────────────────


@pytest.mark.parametrize("url,allowed", [
    ("https://www.linkedin.com/login", True),
    ("https://static.licdn.com/sc/h/x.js", True),
    ("http://www.linkedin.com/login", False),
    ("https://linkedin.com.evil.invalid/login", False),
    ("https://accounts.google.com/o/oauth2", False),
    ("https://evil.invalid/?u=linkedin.com", False),
    ("data:text/html,x", True),
])
def test_the_login_browser_loads_only_linkedin(url, allowed):
    assert view._allowed(url) is allowed


def admin(argv, stdin=b""):
    from broker import admin as adm

    out = io.StringIO()
    real_out, real_in = sys.stdout, sys.stdin
    sys.stdout, sys.stdin = out, io.TextIOWrapper(io.BytesIO(stdin))
    try:
        code = adm.main(argv)
    finally:
        sys.stdout, sys.stdin = real_out, real_in
    return code, json.loads(out.getvalue())


def test_the_sandbox_is_required_until_the_host_records_an_acceptance(env):
    assert view.no_sandbox_accepted() is False
    assert admin(["view", "accept-no-sandbox", "--by", " "])[1]["reason"] == "acceptance_needs_a_name"
    code, out = admin(["view", "accept-no-sandbox", "--by", "operator"])
    assert out["ok"] and view.no_sandbox_accepted() is True
    admin(["view", "require-sandbox"])
    assert view.no_sandbox_accepted() is False


def test_the_view_is_not_an_operation_of_the_agents_socket():
    from broker.server import handle

    for op in ("view.start", "view.status", "view.stop"):
        assert handle(json.dumps({"op": op, "role": "scout"}).encode()) == {"ok": False, "reason": "unknown_operation"}


def test_the_supervisor_runs_websockify_quiet_and_x11vnc_interactive_on_loopback():
    source = (ROOT / "shared" / "broker" / "view.py").read_text()
    websockify = re.search(r'\[sys\.executable, "-m", "websockify".*?\]', source, re.S).group(0)
    assert "--verbose" not in websockify and "--record" not in websockify and "--log-file" not in websockify
    x11vnc = re.search(r'\["x11vnc".*?\]', source, re.S).group(0)
    assert "-localhost" in x11vnc and "-viewonly" not in x11vnc
    assert "screenshot" not in source.lower().replace("no screenshots", "")
