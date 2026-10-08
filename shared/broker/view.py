"""The broker's interactive login view (P1 portal secrets, phase 2, brought forward).

The user logs in to LinkedIn in a browser that runs in the broker, on the
broker's own X display, and sees it in the desktop app through noVNC. The
agents never see that display, that browser or its profile.

    jht-broker-admin view start linkedin-login   -> one JSON line with the token
    jht-broker-admin view stop
    jht-broker-admin view status

The contract with the desktop:
- websockify is published only on 127.0.0.1:6081 of the host. On a VPS the
  desktop reaches it through its SSH tunnel.
- The token is 32 random bytes in base64url. It is valid for ONE WebSocket
  connection within TOKEN_TTL seconds, then it burns (view_token.py).
- A session lasts at most SESSION_MAX seconds from the connection. It also
  ends on a successful login (the li_at cookie appears) or on `view stop`.
  At the end x11vnc goes first, so websockify closes the WebSocket normally.
- Errors are one JSON line {"ok": false, "reason": ...} with a non-zero exit:
  view_busy, view_unavailable, login_timeout, token_expired, plus
  chromium_sandbox_unavailable (design R3).
- No screenshots, no recording, no request log: websockify runs without
  --verbose or --record, its output goes to /dev/null, its log records are
  rewritten without the query string (view_ws.py), and the token is never
  written anywhere (only its sha256, in the run dir).

R3: the login browser runs with Chromium's own sandbox. When the container
cannot give it one (namespaces denied), the view fails closed with
chromium_sandbox_unavailable, unless the host has recorded the operator's
written acceptance (`view accept-no-sandbox`). In both cases the browser may
only load linkedin.com and licdn.com: every other request is aborted.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from . import store
from .view_token import token_digest

VIEW_PORT = int(os.environ.get("JHT_BROKER_VIEW_PORT", "6081"))
VNC_PORT = 5901
DISPLAY = os.environ.get("JHT_BROKER_VIEW_DISPLAY", ":101")
GEOMETRY = "1280x900x24"
TOKEN_TTL = 120
SESSION_MAX = 15 * 60
PURPOSES = ("linkedin-login",)
LOGIN_URL = "https://www.linkedin.com/login"
ALLOWED_HOST_SUFFIXES = ("linkedin.com", "licdn.com")


class ViewError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def run_dir() -> Path:
    return Path(os.environ.get("JHT_BROKER_VIEW_RUN", "/tmp/jht-broker-view"))


def profile_dir() -> Path:
    return store.secrets_dir() / "linkedin-profile"


def _now() -> float:
    return time.time()


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write(path: Path, data: dict) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    os.replace(tmp, path)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def session() -> dict:
    """The live session record, or {} when none is running."""
    record = _read(run_dir() / "session.json")
    pid = record.get("supervisor_pid")
    return record if isinstance(pid, int) and _alive(pid) else {}


def no_sandbox_accepted() -> bool:
    return bool(store.read_state("view", {}).get("chromium_no_sandbox_accepted"))


def linkedin_logged_in(profile: Path | None = None) -> bool:
    """A li_at cookie for linkedin.com in the profile, not expired. Reads the
    cookie NAME and expiry only; the value is encrypted and never touched."""
    db = (profile or profile_dir()) / "Default" / "Cookies"
    if not db.is_file():
        return False
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
        try:
            row = conn.execute(
                "SELECT expires_utc FROM cookies WHERE name = 'li_at' AND host_key LIKE '%linkedin.com' "
                "ORDER BY expires_utc DESC LIMIT 1"
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return False
    if row is None:
        return False
    # Chromium time: microseconds since 1601-01-01; 0 = session cookie.
    expires = int(row[0] or 0)
    return expires == 0 or (expires / 1_000_000 - 11_644_473_600) > _now()


def status() -> dict:
    live = session()
    if not live:
        view = "idle"
    elif (run_dir() / "burned").exists():
        view = "connected"
    else:
        view = "waiting"
    last = store.read_state("view", {}).get("last_session", {})
    out = {"ok": True, "view": view, "linkedin": "logged_in" if linkedin_logged_in() else "login_required"}
    if not live and last.get("ended"):
        out["last_session"] = {k: last[k] for k in ("ended", "reason") if k in last}
    return out


def start(purpose: str) -> dict:
    if purpose not in PURPOSES:
        raise ViewError("view_purpose_unknown")
    if session():
        raise ViewError("view_busy")
    directory = run_dir()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    for name in ("burned", "session.json", "token.json", "result.json"):
        try:
            os.unlink(directory / name)
        except FileNotFoundError:
            pass
    token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
    issued = _now()
    _write(directory / "token.json", {"sha256": token_digest(token), "expires_at": issued + TOKEN_TTL})
    session_id = secrets.token_hex(6)
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    proc = subprocess.Popen(
        [sys.executable, "-m", "broker.view", "supervise", purpose, session_id],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, env=env, cwd="/",
    )
    deadline = _now() + 30
    while _now() < deadline:
        result = _read(directory / "result.json")
        if result.get("failed"):
            raise ViewError(str(result["failed"]))
        if result.get("ready"):
            return {"ok": True, "port": VIEW_PORT, "path": "/websockify", "token": token,
                    "expires_at": _iso(issued + TOKEN_TTL), "session": session_id}
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    stop()
    raise ViewError("view_unavailable")


def stop() -> dict:
    live = session()
    if live:
        try:
            os.killpg(int(live["supervisor_pid"]), signal.SIGTERM)
        except (ProcessLookupError, PermissionError, ValueError):
            pass
        deadline = _now() + 10
        while _now() < deadline and session():
            time.sleep(0.2)
    return {"ok": True, "view": "idle"}


# ── supervisor (runs detached, in its own process group) ─────────────────


def _wait_port(port: int, timeout: float) -> bool:
    deadline = _now() + timeout
    while _now() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def _allowed(url: str) -> bool:
    from urllib.parse import urlsplit

    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme in ("data", "blob", "about"):
        return True
    return parts.scheme == "https" and any(host == s or host.endswith("." + s) for s in ALLOWED_HOST_SUFFIXES)


def _launch_browser(playwright, sandbox: bool):
    profile = profile_dir()
    profile.mkdir(mode=0o700, exist_ok=True)
    return playwright.chromium.launch_persistent_context(
        str(profile),
        headless=False,
        chromium_sandbox=sandbox,
        args=["--disable-dev-shm-usage", "--no-first-run", "--disable-features=Translate"],
        viewport=None,
        # HOME on the tmpfs: the root is read-only, and the profile lives in
        # the secrets volume, not in a home.
        env={**os.environ, "DISPLAY": DISPLAY, "HOME": "/tmp"},
    )


def supervise(purpose: str, session_id: str) -> int:
    directory = run_dir()
    procs: list[subprocess.Popen] = []
    ended = {"reason": "stopped"}

    def finish(*_args) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, finish)
    _write(directory / "session.json", {"supervisor_pid": os.getpid(), "session": session_id,
                                        "purpose": purpose, "started": _now()})
    context = None
    playwright = None
    try:
        devnull = subprocess.DEVNULL
        procs.append(subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", GEOMETRY, "-nolisten", "tcp"],
                                      stdout=devnull, stderr=devnull))
        sock = Path("/tmp/.X11-unix") / f"X{DISPLAY.lstrip(':')}"
        for _ in range(50):
            if sock.exists():
                break
            time.sleep(0.1)
        else:
            _write(directory / "result.json", {"failed": "view_unavailable"})
            return 1

        from playwright.sync_api import sync_playwright

        playwright = sync_playwright().start()
        sandbox = not no_sandbox_accepted()
        try:
            context = _launch_browser(playwright, sandbox)
        except Exception:  # noqa: BLE001 - the reason is the code below, never the text
            _write(directory / "result.json",
                   {"failed": "chromium_sandbox_unavailable" if sandbox else "view_unavailable"})
            return 1
        context.route("**/*", lambda route: route.continue_() if _allowed(route.request.url) else route.abort())
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45000)
        except Exception:  # noqa: BLE001 - the page shows the error; the user can reload
            pass

        # Interactive: no -viewonly. Loopback of the broker only; the agents
        # are on another network and cannot reach it.
        procs.append(subprocess.Popen(
            ["x11vnc", "-display", DISPLAY, "-localhost", "-rfbport", str(VNC_PORT), "-forever", "-shared",
             "-nopw", "-quiet", "-noxdamage"], stdout=devnull, stderr=devnull, env={**os.environ, "HOME": "/tmp"}))
        if not _wait_port(VNC_PORT, 15):
            _write(directory / "result.json", {"failed": "view_unavailable"})
            return 1
        # No --verbose, no --record, output to /dev/null, and the launcher
        # rewrites every log record without the query or a quoted token: the
        # token never reaches a log (view_token.py never returns None either).
        procs.append(subprocess.Popen(
            [sys.executable, "-m", "broker.view_ws", "--token-plugin", "broker.view_token.OneShot",
             "--token-source", str(directory), f"0.0.0.0:{VIEW_PORT}"],
            stdout=devnull, stderr=devnull, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}))
        if not _wait_port(VIEW_PORT, 15):
            _write(directory / "result.json", {"failed": "view_unavailable"})
            return 1
        _write(directory / "result.json", {"ready": True})

        started = _now()
        connected_at = None
        while True:
            time.sleep(2)
            if connected_at is None and (directory / "burned").exists():
                connected_at = _now()
            if connected_at is None and _now() - started > TOKEN_TTL:
                ended["reason"] = "token_expired"
                break
            if connected_at is not None and _now() - connected_at > SESSION_MAX:
                ended["reason"] = "login_timeout"
                break
            if any(c.get("name") == "li_at" for c in context.cookies("https://www.linkedin.com")):
                ended["reason"] = "logged_in"
                break
    except SystemExit:
        pass
    finally:
        # x11vnc first: websockify sees its target close and ends the
        # WebSocket with a normal close, then the rest goes.
        for proc in sorted(procs, key=lambda p: 0 if p.args[0] == "x11vnc" else 1):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
            if proc.args[0] == "x11vnc":
                time.sleep(1)
        if context is not None:
            try:
                context.close()
            except Exception:  # noqa: BLE001
                pass
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:  # noqa: BLE001
                pass
        try:
            with store.locked("view"):
                state = store.read_state("view", {})
                state["last_session"] = {"session": session_id, "ended": _iso(_now()), "reason": ended["reason"]}
                store.write_state("view", state)
        except store.StoreError:
            pass
        for name in ("session.json", "token.json", "burned"):
            try:
                os.unlink(directory / name)
            except FileNotFoundError:
                pass
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[0] == "supervise":
        return supervise(argv[1], argv[2])
    print(json.dumps({"ok": False, "reason": "usage"}))
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
