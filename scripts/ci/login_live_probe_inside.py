#!/usr/bin/env python3
"""The sign-in of LinkedIn, run for real INSIDE the container of `jht-login`, against a page of our own (no account, no network).

Started by scripts/ci/login_live_probe.py in the container that docker-compose.yml describes for `jht-login` (same user, read-only root,
capabilities, seccomp, no network, tmpfs): nothing here is a mock of the browser. What is real: Xvfb, openbox, Debian's Chromium with the
flags of shared/login/login_session.py (the image's own copy of it), the managed policy of the image, the profile folder, the watcher
that reads the cookie and closes the browser. What is ours: the page. A TLS server on 127.0.0.1 inside this container answers as
www.linkedin.com (the browser is told to map that one name to it and to trust that one key), shows a login form, and on a POST sets
a cookie called li_at with a made-up value. The proxy and the relay are the only parts not on the path: they carry bytes and see no page.

What it checks (one line each, `PASS|FAIL|INFO [tag] text`; the tags are stable, the tests read them):
  policy      the image has the managed policy file with the five values;
  nosandbox   the main browser process has no --no-sandbox;
  sandbox     chrome://sandbox, read from the running browser, says it is adequately sandboxed (not only «the flag is absent»);
  typed       the page received the user name and the password that were typed with key events, so «nothing saved» is not «nothing typed»;
  hint        the watcher saw the cookie (hint `logged_in`) and the run ended by itself with 0;
  logindata   Default/Login Data has no row in logins, insecure_credentials, stats (or the file is not there);
  webdata     Default/Web Data has no row in the personal tables (autofill, profiles, cards, ibans, payments);
  marker      the password is in NO byte of the profile folder, the user name is not in Login Data or Web Data (where else it is, `username`);
  cookies     the profile has the cookie names the sign-in is expected to leave (names only, never values);
  owner       nothing in the profile folder is owned by root;
  control     the scanner finds a row and a marker that were planted in a copy (so a clean result is not a blind scanner).
With --no-chroot (the container run WITHOUT SYS_CHROOT) the single check is `chroot`: the browser must not start: the hint `sandbox_failed`
(or `browser_failed`; or say that this engine does not need the capability).

    login_live_probe_inside.py [--no-chroot] [--profile DIR]
    login_live_probe_inside.py --scan DIR [--secret-stdin]
                                              a profile of a REAL sign-in, read on the machine it is on (python3 only): row counts of the
                                              saved-login and personal-data tables, the restore state, the cookie NAMES; with --secret-stdin
                                              one line from stdin (the password, typed by the person) is searched for in every byte of the
                                              folder. Nothing is printed but counts and names, nothing is sent, the copies it reads are removed
    login_live_probe_inside.py --syscalls      only what the kernel and the engine's filters say about the user namespace and the chroot the
                                              sandbox of Chromium needs (the cause, when the sandbox does not start); always exits 0
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import http.server
import json
import os
import secrets
import socket
import sqlite3
import ssl
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

LOGIN_DIR = "/app/shared/login"
POLICY_FILE = "/etc/chromium/policies/managed/jht-login.json"
POLICY_EXPECTED = {
    "PasswordManagerEnabled": False,
    "AutofillAddressEnabled": False,
    "AutofillCreditCardEnabled": False,
    "SyncDisabled": True,
    "BrowserSignin": 0,
}
FAKE_PORT = 8443
CDP_PORT = 9333
WORK = Path("/tmp/probe")
PERSONAL_TABLES = ("autofill", "autofill_profile", "autofill_profiles", "credit_cards", "masked_credit_cards", "unmasked_credit_cards",
                   "local_ibans", "masked_ibans", "payment", "server_address")  # a table that STARTS with one of these is personal
LOGIN_TABLES = ("logins", "insecure_credentials", "stats", "sync_entities_metadata")
FORM = """<!doctype html><meta charset="utf-8"><title>Sign in</title>
<form method="post" action="/login" id="f">
  <input id="username" name="session_key" type="text" autocomplete="username">
  <input id="password" name="session_password" type="password" autocomplete="current-password">
  <button id="go" type="submit">Sign in</button>
</form>"""
FEED = "<!doctype html><meta charset=\"utf-8\"><title>Feed</title><p>signed in</p>"


def say(kind: str, tag: str, text: str) -> None:
    print(f"{kind} [{tag}] {text}", flush=True)


class Verdict:
    def __init__(self) -> None:
        self.failed = 0

    def ok(self, tag: str, text: str) -> None:
        say("PASS", tag, text)

    def bad(self, tag: str, text: str) -> None:
        self.failed += 1
        say("FAIL", tag, text)

    def info(self, tag: str, text: str) -> None:
        say("INFO", tag, text)

    def check(self, condition: bool, tag: str, good: str, bad: str) -> bool:
        (self.ok if condition else self.bad)(tag, good if condition else bad)
        return condition


# ── the profile: what is in it ─────────────────────────────────────────────────────────────────────────────────────────────────────


def table_counts(path: Path) -> dict[str, int] | None:
    """Row count of every table of a SQLite file, read from a copy (Chromium owns the file). None: the file is not there."""
    if not path.is_file():
        return None
    copy = WORK / ("copy-" + path.name.replace(" ", "_"))
    copy.write_bytes(path.read_bytes())
    for side in ("-wal", "-journal"):
        other = Path(str(path) + side)
        if other.is_file():
            Path(str(copy) + side).write_bytes(other.read_bytes())
    connection = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
    try:
        names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        return {name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in names}
    finally:
        connection.close()


def personal_rows(counts: dict[str, int]) -> dict[str, int]:
    return {name: n for name, n in counts.items() if n and name.startswith(PERSONAL_TABLES)}


def login_rows(counts: dict[str, int]) -> dict[str, int]:
    return {name: n for name, n in counts.items() if n and name in LOGIN_TABLES}


def files_with(root: Path, needles: dict[str, bytes]) -> dict[str, list[str]]:
    """For each label, the files below root that hold its bytes (the whole file, WAL and journal included)."""
    found: dict[str, list[str]] = {label: [] for label in needles}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        for label, needle in needles.items():
            if needle in data:
                found[label].append(str(path.relative_to(root)))
    return found


def cookie_names(path: Path) -> list[str] | None:
    for relative in ("Default/Network/Cookies", "Default/Cookies"):
        source = path / relative
        if source.is_file():
            copy = WORK / "copy-cookies"
            copy.write_bytes(source.read_bytes())
            connection = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
            try:
                return sorted(row[0] for row in connection.execute("SELECT name FROM cookies"))
            finally:
                connection.close()
    return None


def scan_profile(profile: Path, user_name: str | None, password: str | None, verdict: Verdict) -> None:
    login = table_counts(profile / "Default" / "Login Data")
    if login is None:
        verdict.ok("logindata", "Default/Login Data is not there")
    else:
        rows = login_rows(login)
        verdict.check(not rows, "logindata", f"Default/Login Data: no row ({len(login)} tables, all of the saved logins empty)",
                      f"Default/Login Data has rows: {rows}")
    web = table_counts(profile / "Default" / "Web Data")
    if web is None:
        verdict.ok("webdata", "Default/Web Data is not there")
    else:
        rows = personal_rows(web)
        verdict.check(not rows, "webdata", f"Default/Web Data: no row in the personal tables ({len(web)} tables; rows only in: "
                      f"{sorted(n for n, c in web.items() if c)})", f"Default/Web Data has personal rows: {rows}")
    if password is None and user_name is None:
        return
    needles = {"password": (password or "\0no-password\0").encode(), "user name": (user_name or "\0no-user\0").encode(),
               "user name (utf-16)": (user_name or "\0no-user\0").encode("utf-16-le")}
    found = files_with(profile, needles)
    if password is not None:
        verdict.check(not found["password"], "marker", "the password is in no file of the profile",
                      f"the password is in: {found['password']}")
    if user_name is not None:
        where = found["user name"] + found["user name (utf-16)"]
        verdict.check(not where, "marker", "the user name is in no file of the profile", f"the user name is in: {where}")


def control_scanner(verdict: Verdict) -> None:
    """The scanner on a folder where a row and the markers are planted: it must see them, or a clean result means nothing."""
    planted = WORK / "planted"
    (planted / "Default").mkdir(parents=True, exist_ok=True)
    marker = "planted-" + secrets.token_hex(6)
    for name, table in (("Login Data", "logins"), ("Web Data", "autofill")):
        connection = sqlite3.connect(planted / "Default" / name)
        connection.execute(f"CREATE TABLE {table} (value TEXT)")
        connection.execute(f"INSERT INTO {table} VALUES (?)", (marker,))
        connection.commit()
        connection.close()
    found = files_with(planted, {"m": marker.encode()})["m"]
    seen = bool(login_rows(table_counts(planted / "Default" / "Login Data") or {})) and \
        bool(personal_rows(table_counts(planted / "Default" / "Web Data") or {})) and len(found) == 2
    verdict.check(seen, "control", "the scanner sees a planted login row, a planted autofill row and a planted marker",
                  "the scanner did NOT see what was planted: its result cannot be trusted")


# ── the page of our own ────────────────────────────────────────────────────────────────────────────────────────────────────────────


class FakeLinkedIn(http.server.BaseHTTPRequestHandler):
    posts: list[dict[str, str]] = []

    def log_message(self, *args) -> None:  # silent
        pass

    def _send(self, code: int, body: str = "", headers: dict[str, str] | None = None) -> None:
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path.startswith("/login"):
            self._send(200, FORM)
        elif self.path.startswith("/feed"):
            self._send(200, FEED)
        else:
            self._send(404, "")

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8", "replace"))
        FakeLinkedIn.posts.append({key: values[0] for key, values in form.items()})
        # the name of the cookie of the real sign-in, a value that is made up
        cookie = f"li_at=fake-{secrets.token_hex(8)}; Domain=.linkedin.com; Path=/; Secure; HttpOnly; Max-Age=3600; SameSite=None"
        self._send(302, "", {"Location": "https://www.linkedin.com/feed", "Set-Cookie": cookie})


def make_certificate() -> tuple[str, str, str]:
    """A key and a certificate for www.linkedin.com that live in this container only, and the hash of the key for the browser."""
    key, cert = str(WORK / "key.pem"), str(WORK / "cert.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
                    "-subj", "/CN=www.linkedin.com", "-addext", "subjectAltName=DNS:www.linkedin.com"],
                   check=True, capture_output=True, timeout=60)
    pub = subprocess.run(["openssl", "x509", "-in", cert, "-pubkey", "-noout"], check=True, capture_output=True, timeout=30).stdout
    der = subprocess.run(["openssl", "pkey", "-pubin", "-outform", "der"], input=pub, check=True, capture_output=True, timeout=30).stdout
    digest = subprocess.run(["openssl", "dgst", "-sha256", "-binary"], input=der, check=True, capture_output=True, timeout=30).stdout
    return key, cert, base64.b64encode(digest).decode()


def start_fake_page(key: str, cert: str) -> http.server.HTTPServer:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", FAKE_PORT), FakeLinkedIn)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ── the browser, through its debugging port (in this container, on the loopback) ───────────────────────────────────────────────────────


class Cdp:
    def __init__(self, port: int) -> None:
        pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5))
        url = next(p["webSocketDebuggerUrl"] for p in pages if p.get("type") == "page")
        host, path = url[5:].split("/", 1)
        name, number = host.split(":")
        self.sock = socket.create_connection((name, int(number)), 5)
        self.sock.settimeout(20)
        nonce = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Key: {nonce}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise EOFError
            self.buf += chunk
        self.buf = self.buf.split(b"\r\n\r\n", 1)[1]
        self.next_id = 0

    def _need(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _recv(self) -> str:
        head = self._need(2)
        length = head[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._need(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._need(8))[0]
        return self._need(length).decode("utf-8", "replace")

    def call(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        data = json.dumps({"id": self.next_id, "method": method, "params": params or {}}).encode()
        mask = os.urandom(4)
        head = bytes([0x81])
        if len(data) < 126:
            head += bytes([0x80 | len(data)])
        elif len(data) < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", len(data))
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", len(data))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        while True:
            message = json.loads(self._recv())
            if message.get("id") == self.next_id:
                return message

    def evaluate(self, expression: str):
        answer = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        return answer.get("result", {}).get("result", {}).get("value")

    def key(self, text: str) -> None:
        if text == "\n":
            event = {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "text": "\r", "unmodifiedText": "\r"}
        else:
            event = {"key": text, "text": text, "unmodifiedText": text}
        self.call("Input.dispatchKeyEvent", {"type": "keyDown", **event})
        self.call("Input.dispatchKeyEvent", {"type": "keyUp", **{k: v for k, v in event.items() if k in ("key", "code", "windowsVirtualKeyCode")}})


def wait_for(condition, seconds: float, step: float = 0.5):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = condition()
        except Exception:
            value = None
        if value:
            return value
        time.sleep(step)
    return None


def main_browser_command() -> list[str] | None:
    for pid in sorted(int(p) for p in os.listdir("/proc") if p.isdigit()):
        try:
            argv = [a.decode("utf-8", "replace") for a in Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if a]
        except OSError:
            continue
        if argv and argv[0].endswith("chromium") and not any(a.startswith("--type=") for a in argv):
            return argv
    return None


def drive(user_name: str, password: str, verdict: Verdict, errors: list[str]) -> None:
    """The person's side: wait for the page, look at the sandbox, type, press Enter. Runs in a thread while the real run goes on."""
    try:
        page = wait_for(lambda: Cdp(CDP_PORT), 60, 1)
        if page is None:
            errors.append("the browser did not open its debugging port in 60 s")
            return
        wait_for(lambda: page.evaluate("document.getElementById('username') !== null"), 60)
        argv = main_browser_command()
        verdict.check(argv is not None and not any("no-sandbox" in a for a in argv), "nosandbox",
                      "the main browser process has no --no-sandbox", f"the main browser process runs with {argv}")
        page.call("Page.enable")
        page.call("Page.navigate", {"url": "chrome://sandbox"})
        # the page of Chromium is drawn by script: wait for its verdict line, not for its title
        text = wait_for(lambda: (lambda t: t if "you are" in t.lower() else None)(page.evaluate("document.body.innerText") or ""), 30, 1) or ""
        good = "adequately sandboxed" in text.lower() and "not adequately" not in text.lower()
        verdict.check(good, "sandbox", "chrome://sandbox says the browser is adequately sandboxed",
                      "chrome://sandbox does not say adequately sandboxed: " + " ".join(text.split())[:300])
        page.call("Page.navigate", {"url": "https://www.linkedin.com/login"})
        if not wait_for(lambda: page.evaluate("document.getElementById('username') !== null"), 30):
            errors.append("the page of our own did not load in the browser")
            return
        for field, value in (("username", user_name), ("password", password)):
            page.evaluate(f"document.getElementById('{field}').focus()")
            for char in value:
                page.key(char)
        typed = page.evaluate("document.getElementById('username').value.length + ',' + document.getElementById('password').value.length")
        verdict.info("typed", f"field lengths in the page: {typed}")
        page.key("\n")
    except Exception as exc:  # the verdict says it; the run ends by its own limit
        errors.append(f"the driver stopped: {type(exc).__name__}")


# ── the two runs ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────


def import_login_session():
    sys.path.insert(0, LOGIN_DIR)
    import login_session  # the image's own copy
    return login_session


def patched_command(login_session, spki: str):
    """The command of the image, with the network flags replaced by the ones that send ONE name to our page. Everything else is as is."""
    real = login_session.chromium_command

    def command(profile: str) -> list[str]:
        flags = [a for a in real(profile) if not a.startswith(("--proxy-server=", "--host-resolver-rules="))]
        extra = [f"--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:{FAKE_PORT}, MAP * ~NOTFOUND",
                 f"--ignore-certificate-errors-spki-list={spki}", f"--remote-debugging-port={CDP_PORT}"]
        return flags[:-1] + extra + flags[-1:]  # the last one is the address
    return command


def run_without_chroot(verdict: Verdict, profile: Path) -> None:
    session = import_login_session()
    hint = WORK / "hint"
    code = asyncio.run(session.run(str(WORK / "vnc.sock"), str(WORK / "proxy.sock"), str(hint), str(profile)))
    said = hint.read_text().strip() if hint.exists() else ""
    log = sorted(Path("/tmp").glob("chromium*"))
    last = " | ".join(log[-1].read_text(errors="replace").strip().splitlines()[-3:])[:400] if log else ""
    if code != 0 and said in ("sandbox_failed", "browser_failed"):
        verdict.ok("chroot", f"without SYS_CHROOT the browser does not start (rc {code}, hint {said}): the capability is what lets the sandbox run")
        verdict.info("chroot", f"what the browser said: {last}")
    else:
        verdict.info("chroot", f"without SYS_CHROOT the run ended rc {code}, hint '{said}': on this engine the capability may not be needed")


def run_login(verdict: Verdict, profile: Path) -> None:
    session = import_login_session()
    verdict.check(Path(POLICY_FILE).is_file() and json.loads(Path(POLICY_FILE).read_text()) == POLICY_EXPECTED, "policy",
                  f"{POLICY_FILE} holds the five values", f"{POLICY_FILE} is missing or different")
    user_name = "probe-" + secrets.token_hex(5) + "@" + "mail.invalid"
    password = "pw-" + secrets.token_hex(8)
    key, cert, spki = make_certificate()
    start_fake_page(key, cert)
    session.chromium_command = patched_command(session, spki)
    errors: list[str] = []
    thread = threading.Thread(target=drive, args=(user_name, password, verdict, errors), daemon=True)
    thread.start()
    hint = WORK / "hint"
    started = time.monotonic()
    code = asyncio.run(session.run(str(WORK / "vnc.sock"), str(WORK / "proxy.sock"), str(hint), str(profile)))
    thread.join(5)
    said = hint.read_text().strip() if hint.exists() else ""
    for line in errors:
        verdict.bad("drive", line)
    if said in ("sandbox_failed", "browser_failed"):
        log = sorted(Path("/tmp").glob("chromium*"))
        if log:
            verdict.info("browser", "what the browser said: " + " | ".join(log[-1].read_text(errors="replace").strip().splitlines()[-4:])[:600])
    verdict.check(code == 0 and said == "logged_in", "hint", f"the watcher saw the cookie and the run ended by itself (rc 0, {time.monotonic() - started:.0f} s)",
                  f"the run ended rc {code} with hint '{said}'")
    received = FakeLinkedIn.posts[-1] if FakeLinkedIn.posts else {}
    verdict.check(received.get("session_key") == user_name and received.get("session_password") == password, "typed",
                  "the page received the typed user name and password", f"the page received {sorted(received)} and not what was typed")
    scan_profile(profile, user_name, password, verdict)
    names = cookie_names(profile)
    verdict.check(names is not None and "li_at" in names, "cookies", f"the profile keeps the cookie names {names}",
                  f"the profile has no li_at cookie (names: {names})")
    foreign = [str(p.relative_to(profile)) for p in profile.rglob("*") if p.lstat().st_uid == 0]
    verdict.check(not foreign, "owner", "nothing in the profile is owned by root", f"owned by root: {foreign[:5]}")


def scan_real_profile(profile: Path, secret: str | None) -> int:
    """A profile made by a REAL sign-in, on the machine of the person: counts and names only, never a value, nothing leaves this process.

    The copies of the databases this makes (Chromium owns the files) go to a folder that is removed at the end.
    """
    global WORK
    import shutil
    import tempfile
    WORK = Path(tempfile.mkdtemp(prefix="jht-scan-"))
    verdict = Verdict()
    try:
        if not profile.is_dir() or profile.is_symlink():
            say("FAIL", "scan", "the profile is not a folder")
            return 2
        scan_profile(profile, None, secret, verdict)
        state = [relative for relative in ("Default/Sessions", "Default/Current Session", "Default/Current Tabs", "Default/Last Session",
                                           "Default/Last Tabs") if (profile / relative).exists()]
        verdict.check(not state, "restore", "no file the browser restores its tabs from", f"the browser's restore state is there: {state}")
        names = cookie_names(profile)
        verdict.info("cookies", f"cookie names in the profile: {names}")
        say("RESULT", "scan", "FAILED" if verdict.failed else "OK")
        return 1 if verdict.failed else 0
    finally:
        shutil.rmtree(WORK, ignore_errors=True)


def sandbox_syscalls() -> None:
    """The two steps the namespace sandbox of Chromium takes, one by one, in a child process each, and what filters this process is under."""
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    clone_newuser = 0x10000000

    def child(step) -> str:
        pid = os.fork()
        if pid == 0:
            os._exit(step())
        status = os.waitpid(pid, 0)[1]
        code = os.WEXITSTATUS(status)
        return "ok" if code == 0 else f"errno {code} ({os.strerror(code)})"

    def unshare_user() -> int:
        return 0 if libc.unshare(clone_newuser) == 0 else ctypes.get_errno()

    def user_then_chroot() -> int:
        if libc.unshare(clone_newuser) != 0:
            return ctypes.get_errno()
        return 0 if libc.chroot(b"/proc/self/fdinfo/") == 0 else ctypes.get_errno()

    say("INFO", "syscalls", f"unshare(CLONE_NEWUSER): {child(unshare_user)}")
    say("INFO", "syscalls", f"unshare(CLONE_NEWUSER) then chroot(): {child(user_then_chroot)}")
    status = {}
    for line in Path("/proc/self/status").read_text().splitlines():
        key, _, value = line.partition(":")
        if key in ("Seccomp", "Seccomp_filters", "NoNewPrivs", "CapEff", "CapBnd"):
            status[key] = value.strip()
    say("INFO", "syscalls", f"process: {status}")
    for path in ("/proc/sys/user/max_user_namespaces", "/proc/sys/kernel/unprivileged_userns_clone",
                 "/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "/proc/self/attr/current", "/proc/sys/kernel/osrelease"):
        try:
            say("INFO", "syscalls", f"{path}: {Path(path).read_text().strip()[:80]}")
        except OSError:
            say("INFO", "syscalls", f"{path}: not readable here")


def main(argv: list[str]) -> int:
    if argv[:1] == ["--scan"] and len(argv) in (2, 3) and (len(argv) == 2 or argv[2] == "--secret-stdin"):
        secret = sys.stdin.readline().rstrip("\n") if len(argv) == 3 else None
        return scan_real_profile(Path(argv[1]).expanduser(), secret or None)
    if argv == ["--syscalls"]:
        sandbox_syscalls()
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-chroot", action="store_true")
    parser.add_argument("--profile", default="/linkedin-profile")
    args = parser.parse_args(argv)
    WORK.mkdir(parents=True, exist_ok=True)
    verdict = Verdict()
    profile = Path(args.profile)
    if args.no_chroot:
        run_without_chroot(verdict, profile)
    else:
        control_scanner(verdict)
        run_login(verdict, profile)
    say("RESULT", "probe", "FAILED" if verdict.failed else "OK")
    return 1 if verdict.failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
