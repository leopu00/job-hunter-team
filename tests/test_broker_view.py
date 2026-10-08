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
    websockify = re.search(r'\[sys\.executable, "-m", "broker\.view_ws".*?\]', source, re.S).group(0)
    assert "--verbose" not in websockify and "--record" not in websockify and "--log-file" not in websockify
    x11vnc = re.search(r'\["x11vnc".*?\]', source, re.S).group(0)
    assert "-localhost" in x11vnc and "-viewonly" not in x11vnc
    assert "screenshot" not in source.lower().replace("no screenshots", "")


# ── websockify's log (review note: the token never in a log) ─────────────

TOKEN = "Zk3q-SyntheticOneTimeToken_0123456789abcdefgh"


def test_redact_drops_the_query_and_a_quoted_token():
    from broker.view_ws import redact

    assert TOKEN not in redact(f"127.0.0.1: Path: '/websockify?token={TOKEN}'")
    assert redact(f"127.0.0.1: Path: '/websockify?token={TOKEN}'") == "127.0.0.1: Path: '/websockify?[redacted]'"
    assert redact(f"Token '{TOKEN}' not found") == "Token '[redacted]' not found"
    assert redact("Plain non-SSL (ws://) WebSocket connection") == "Plain non-SSL (ws://) WebSocket connection"


def test_every_log_record_is_written_without_the_token():
    """websockify's own messages, through a real logging handler: the
    formats of 0.10-0.12 (`log_message`, a refused lookup, a GET line)."""
    script = (
        "import logging, sys\n"
        f"sys.path.insert(0, {str(ROOT / 'shared')!r})\n"
        "from broker import view_ws\n"
        "view_ws.install()\n"
        "logging.basicConfig(level=logging.DEBUG, stream=sys.stderr, format='%(message)s')\n"
        "log = logging.getLogger('websockify.websocketproxy')\n"
        f"log.info('%s - - [%s] %s', '127.0.0.1', 'now', \"127.0.0.1: Path: '/websockify?token={TOKEN}'\")\n"
        f"log.info(\"%s: Token '%s' not found\", '127.0.0.1', {TOKEN!r})\n"
        f"log.info('\"GET /websockify?token=%s HTTP/1.1\" 101 -', {TOKEN!r})\n"
        f"log.info('/websockify?token=' + {TOKEN!r})\n"
    )
    out = subprocess.run([sys.executable, "-I", "-c", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert out.stderr.count("[redacted]") == 4
    assert TOKEN not in out.stdout + out.stderr


def test_the_real_websockify_logs_a_connection_without_its_token(tmp_path):
    """End to end where websockify is installed (the image runs the same
    check in scripts/ci/broker_smoke.py)."""
    pytest.importorskip("websockify")
    import socket

    run = tmp_path / "run"
    run.mkdir(mode=0o700)
    issue(run, TOKEN)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = tmp_path / "ws.log"
    with open(log, "wb") as sink:
        proc = subprocess.Popen(
            [sys.executable, "-m", "broker.view_ws", "--token-plugin", "broker.view_token.OneShot",
             # --run-once: the connection is served in this process on every
             # platform, through the same handler and log as the forked child.
             "--run-once", "--token-source", str(run), f"127.0.0.1:{port}"],
            stdout=sink, stderr=sink, env={**os.environ, "PYTHONPATH": str(ROOT / "shared")})
        try:
            for _ in range(100):
                try:
                    conn = socket.create_connection(("127.0.0.1", port), timeout=1)
                    break
                except OSError:
                    time.sleep(0.1)
            with conn:
                conn.sendall((f"GET /websockify?token={TOKEN} HTTP/1.1\r\nHost: 127.0.0.1\r\n"
                              "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                              f"Sec-WebSocket-Key: {'A' * 22}==\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
                conn.settimeout(3)
                try:
                    conn.recv(4096)
                except OSError:
                    pass
            time.sleep(0.5)
        finally:
            proc.terminate()
            proc.wait(timeout=10)
    written = log.read_text(errors="replace")
    assert "Path" in written  # the connection was logged...
    assert TOKEN not in written  # ...without its token


def test_a_stop_with_no_live_session_touches_nothing(env, monkeypatch):
    """The desktop always calls `--stop` when its window closes, also after a
    session ended by itself: that stop must be harmless."""
    killed = []
    monkeypatch.setattr(view.os, "killpg", lambda pid, sig: killed.append(pid))
    assert view.stop() == {"ok": True, "view": "idle"}
    # A session record whose supervisor is gone counts as no session.
    (env / "run" / "session.json").write_text(json.dumps({"supervisor_pid": 2 ** 22 + 7}))
    assert view.stop() == {"ok": True, "view": "idle"}
    assert killed == []
