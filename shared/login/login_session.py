"""The browser of the LinkedIn login: runs in `jht-login`, the container that has NO network.

What it starts, all in this container and nowhere else:
  - Xvfb on a display of its own (:97, no TCP): the socket of the display is in this container's /tmp, shared with nobody, because a
    display has no isolation and the person types a password on it;
  - openbox, and Debian's Chromium on the LinkedIn profile, with the sandbox of Chromium on (a browser that does not start says why in
    the hint file, from a closed list, and the view turns it into the reason the app shows);
  - x11vnc on that display, interactive, listening on a unix socket in the folder it shares with the view and on the loopback of this
    container, which has nothing else;
  - a relay: 127.0.0.1:3128 of this container to the socket of the proxy that has the network. Chromium is told to use it for everything
    and to resolve no name itself.
A watcher reads the cookies of the profile every few seconds (the NAME of the session cookie only, never a value): when LinkedIn has set
it, the hint `logged_in` goes to the shared folder, the browser is closed after a moment so the profile is written, and the container
ends. The hint is a suggestion: the view and the closer decide what it is worth.

    python3 login_session.py <vnc socket> <proxy socket> <hint file> <profile folder>
    python3 login_session.py check <profile folder>      prints logged_in or login_required
"""

from __future__ import annotations

import asyncio
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DISPLAY = ":97"
GEOMETRY = "1280x900x24"
RELAY_HOST, RELAY_PORT = "127.0.0.1", 3128
START_URL = "https://www.linkedin.com/login"
COOKIE_NAME = "li_at"
COOKIE_HOST_SUFFIX = "linkedin.com"
LIFE_SECONDS = 18 * 60
POLL_SECONDS = 3
AFTER_LOGIN_SECONDS = 6
SOCKET_WAIT_SECONDS = 15
EARLY_EXIT_SECONDS = 10
CHUNK = 65536
IDLE_SECONDS = 300
COOKIE_FILES = ("Default/Network/Cookies", "Default/Cookies")
CHROME_UNIX_EPOCH_US = 11644473600 * 1_000_000  # Chromium counts microseconds from 1601


def chromium_command(profile: str) -> list[str]:
    return [
        "chromium",
        f"--user-data-dir={profile}",
        f"--proxy-server=http://{RELAY_HOST}:{RELAY_PORT}",
        # no name is resolved here: the proxy does it, for the names of its list only
        f"--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE {RELAY_HOST}",
        "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync",
        "--disable-component-update", "--disable-breakpad", "--password-store=basic", "--disable-dev-shm-usage", "--disable-gpu",
        "--window-position=0,0", "--window-size=1280,900", START_URL,
    ]


def x11vnc_command(vnc_socket: str) -> list[str]:
    return ["x11vnc", "-display", DISPLAY, "-unixsock", vnc_socket, "-localhost", "-rfbport", "5900", "-nopw", "-forever", "-noxdamage", "-quiet"]


def write_hint(path: str, word: str) -> None:
    """Whole or not there: the view never reads a half word."""
    temp = f"{path}.part"
    with open(temp, "w", encoding="ascii") as handle:
        handle.write(word + "\n")
    os.replace(temp, path)


def logged_in(profile: str, now_us: int | None = None) -> bool:
    """Is the session cookie of LinkedIn in the profile (the name, and that it has not run out)? Reads a copy: Chromium owns the file."""
    now_us = int(time.time() * 1_000_000) + CHROME_UNIX_EPOCH_US if now_us is None else now_us
    for relative in COOKIE_FILES:
        source = Path(profile) / relative
        try:
            if not source.is_file() or source.is_symlink():
                continue
            with tempfile.TemporaryDirectory(prefix="ck", dir="/tmp") as folder:
                copy = Path(folder) / "Cookies"
                shutil.copyfile(source, copy)
                for extra in ("-wal", "-journal"):
                    side = Path(str(source) + extra)
                    if side.is_file() and not side.is_symlink():
                        shutil.copyfile(side, Path(str(copy) + extra))
                connection = sqlite3.connect(f"file:{copy}?mode=ro", uri=True, timeout=2)
                try:
                    rows = connection.execute(
                        "SELECT expires_utc, host_key FROM cookies WHERE name = ?", (COOKIE_NAME,)
                    ).fetchall()
                finally:
                    connection.close()
        except (OSError, sqlite3.Error):
            continue
        for expires, host in rows:
            host = str(host).lstrip(".")
            if (host == COOKIE_HOST_SUFFIX or host.endswith("." + COOKIE_HOST_SUFFIX)) and (not expires or int(expires) > now_us):
                return True
    return False


async def relay(listen_host: str, listen_port: int, proxy_socket: str) -> asyncio.AbstractServer:
    """Every connection the browser makes to the loopback goes, as bytes, to the socket of the proxy. Nothing is read or changed here."""
    async def pump(source: asyncio.StreamReader, target: asyncio.StreamWriter) -> None:
        try:
            while True:
                data = await asyncio.wait_for(source.read(CHUNK), IDLE_SECONDS)
                if not data:
                    break
                target.write(data)
                await target.drain()
        except Exception:
            pass
        finally:
            try:
                target.close()
            except Exception:
                pass

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            up_reader, up_writer = await asyncio.wait_for(asyncio.open_unix_connection(proxy_socket), 10)
        except Exception:
            writer.close()
            return
        await asyncio.gather(pump(reader, up_writer), pump(up_reader, writer), return_exceptions=True)

    return await asyncio.start_server(handle, listen_host, listen_port)


def stop(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def wait_for_socket(path: str, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if os.path.exists(path):
            return True
        time.sleep(0.1)
    return False


async def run(vnc_socket: str, proxy_socket: str, hint_file: str, profile: str) -> int:
    processes: list[subprocess.Popen] = []
    server = None
    chromium = None
    try:
        env = {**os.environ, "DISPLAY": DISPLAY, "HOME": "/tmp"}
        x_socket = f"/tmp/.X11-unix/X{DISPLAY[1:]}"
        processes.append(subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", GEOMETRY, "-nolisten", "tcp"], env=env,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        if not wait_for_socket(x_socket, SOCKET_WAIT_SECONDS):
            return 6
        processes.append(subprocess.Popen(["openbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        server = await relay(RELAY_HOST, RELAY_PORT, proxy_socket)
        chromium_log = tempfile.NamedTemporaryFile(prefix="chromium", dir="/tmp", delete=False)
        chromium = subprocess.Popen(chromium_command(profile), env=env, stdout=subprocess.DEVNULL, stderr=chromium_log)
        started = time.monotonic()
        processes.append(chromium)
        processes.append(subprocess.Popen(x11vnc_command(vnc_socket), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        if not wait_for_socket(vnc_socket, SOCKET_WAIT_SECONDS):
            write_hint(hint_file, "browser_failed")
            return 7
        done_at = None
        while time.monotonic() - started < LIFE_SECONDS:
            await asyncio.sleep(POLL_SECONDS)
            if chromium.poll() is not None:
                if time.monotonic() - started < EARLY_EXIT_SECONDS and chromium.returncode != 0:
                    chromium_log.flush()
                    try:
                        said = Path(chromium_log.name).read_text(encoding="utf-8", errors="replace").lower()
                    except OSError:
                        said = ""
                    write_hint(hint_file, "sandbox_failed" if "sandbox" in said else "browser_failed")
                    return 8
                return 0
            if done_at is None and logged_in(profile):
                write_hint(hint_file, "logged_in")
                done_at = time.monotonic()
            if done_at is not None and time.monotonic() - done_at >= AFTER_LOGIN_SECONDS:
                return 0  # the browser is closed below, the profile is written then
        return 0
    finally:
        stop(chromium)  # first: the profile is written when the browser ends
        for process in reversed(processes):
            stop(process)
        if server is not None:
            server.close()


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "check":
        # What `jht linkedin status` asks (in a one-shot, with the profile mounted): one word, from a closed list.
        print("logged_in" if logged_in(argv[1]) else "login_required")
        return 0
    if len(argv) != 4:
        print("usage: login_session.py <vnc socket> <proxy socket> <hint file> <profile folder> | check <profile folder>", file=sys.stderr)
        return 2
    loop = asyncio.new_event_loop()
    main_task = loop.create_task(run(*argv))
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, main_task.cancel)
    try:
        return loop.run_until_complete(main_task)
    except asyncio.CancelledError:
        return 0
    finally:
        loop.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
