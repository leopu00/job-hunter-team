"""Interactive flow safety on a real, isolated Chromium page.

No external ATS, user data or identity grant. Official admission is covered
separately; these fixtures use synthetic local consent/flags and deny network.
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import subprocess
import threading
import time
import queue
import ctypes
import ctypes.util
import socket
import struct
import tempfile
import shutil

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import apply_flow
import apply_gate
import closer_interactive as mission
import closer_interactive_screen
from apply_assisted import AssistedSession
from test_apply_flow import _answers_db, ashby_form, build_flow, cv_path
from test_apply_gate import CONSENT_ON


@pytest.fixture
def interactive_flow(tmp_path, monkeypatch, cv_path):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    config_path = tmp_path / "jht.config.json"
    config_path.write_text(json.dumps(CONSENT_ON))
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "candidate_profile.yml").write_text(
        "name: Test Candidate\ntarget_role: Engineer\nlocation: Remote\n"
    )
    db = _answers_db(tmp_path)
    monkeypatch.setenv("JHT_DB", str(db))
    with contextlib.closing(sqlite3.connect(db)) as conn:
        conn.execute(
            "UPDATE positions SET apply_requested=1,apply_requested_at=?,"
            "apply_requested_by='user_local' WHERE id=41",
            (datetime.now(timezone.utc).isoformat(),),
        )
        conn.commit()
    recorded = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)
    flow.db_path = db
    flow.checkpoint_path = tmp_path / ".cache" / "apply-flow" / "41.json"
    flow.gate_checker = apply_flow._default_gate_checker
    flow.cap_reserver = apply_flow._default_cap_reserver
    return flow, recorded


def checkpoint(flow):
    return json.loads(flow.checkpoint_path.read_text())


def reauthorise(flow):
    with contextlib.closing(sqlite3.connect(flow.db_path)) as conn:
        conn.execute(
            "UPDATE positions SET apply_requested_at=? WHERE id=41",
            ((datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),),
        )
        conn.commit()


def set_consent(flow, **changes):
    path = flow._jht_home() / "jht.config.json"
    config = json.loads(path.read_text())
    config["applications"]["auto_apply"].update(changes)
    path.write_text(json.dumps(config))


def install_page(session, *, captcha=False, receipt=True):
    page = session.page
    network_attempts = []

    def deny_network(route):
        network_attempts.append(route.request.resource_type)
        route.abort()

    page.context.route("**/*", deny_network)
    html = ashby_form(captcha=captcha)
    if not receipt:
        html = html.replace(
            "document.body.innerHTML = '<main class=\"ashby-application-form-success-container\">Thank you for applying.</main>';",
            "/* synthetic submit with no acknowledgement */",
        )
    page.set_content(html)
    return page, network_attempts


@contextlib.contextmanager
def operator_thread(action, *, join_timeout=10):
    """Keep every Page call on its owner thread; relay test failures back."""
    errors = []

    def drive():
        try:
            action()
        except BaseException as exc:
            errors.append(exc)

    worker = threading.Thread(target=drive, name="synthetic-official-controller", daemon=True)
    worker.start()
    try:
        yield
    finally:
        worker.join(timeout=join_timeout)
        assert not worker.is_alive(), "fixture controller did not terminate"
        if errors:
            raise errors[0]


def wait_for(read, predicate, timeout=5):
    """Observe a condition; the deadline fails instead of assuming a delay."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = read()
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        else:
            if predicate(last):
                return last
        time.sleep(0.01)
    raise AssertionError(f"fixture condition not reached; last={last!r}")


def official_cli(operation, binding=None, *, review=None):
    """Use the actual local CLI, never the worker socket or a fake grant."""
    args = [sys.executable, str(ROOT / "shared" / "skills" / "closer_interactive.py"), operation]
    if operation == "admit":
        args.append("41")
    elif binding is not None:
        args += [str(binding["position_id"]), "--mission", binding["mission_id"],
                 "--owner", binding["owner_id"]]
        if review is not None:
            args += ["--review", review]
    result = subprocess.run(args, capture_output=True, text=True, timeout=5)
    return result.returncode, json.loads(result.stdout)


@pytest.fixture
def flow_screen(monkeypatch):
    """Display seam ONLY: these Chromium/CLI tests do not certify RFB."""
    screens = []

    class Screen:
        def __init__(self, flow, deadline, clock):
            self.flow = flow
            self.display = ":fixture"
            self.actions = queue.Queue()
            self.page = None
            self.enabled = False
            self.revoked = False
            self.closed = False
            screens.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            self.closed = True

        def enable(self):
            assert checkpoint(self.flow)["submit_started"] is True
            assert mission.read()["phase"] == "handoff_pending"
            self.enabled = True

        def revoke(self):
            self.revoked = True

        def check(self):
            pass

        def tick(self):
            try:
                action = self.actions.get_nowait()
            except queue.Empty:
                return
            action(self.page)

    monkeypatch.setattr(closer_interactive_screen, "OwnedScreen", Screen)
    return screens


def await_review():
    return wait_for(mission.read, lambda s: s and s["phase"] == "review_wait")


def admitted_session(flow, **kwargs):
    rc, result = official_cli("admit")
    assert rc == 0, result
    return AssistedSession(flow, interactive=True, **kwargs)


def test_review_retains_real_page_cookie_then_confirms_once(interactive_flow, flow_screen):
    flow, recorded = interactive_flow
    with admitted_session(flow, ttl=15) as session:
        page, network = install_page(session)
        context = page.context
        context.add_cookies([{"name": "fixture", "value": "retained", "domain": "example.invalid", "path": "/"}])
        original = flow.before_submit
        observed = []

        def inspect_review(cp, actual):
            observed.append((actual is page, actual.context is context,
                             actual.evaluate("window.submitCount"), cp.submit_started))
            return original(cp, actual)

        flow.before_submit = inspect_review
        binding = []

        def operator():
            state = await_review()
            binding.append(state)
            rc, bad = official_cli("confirm", state, review="0" * 32)
            assert rc != 0 and bad["error"] == "interactive_review_mismatch"
            assert mission.read()["phase"] == "review_wait"
            rc, good = official_cli("confirm", state, review=state["review_id"])
            assert rc == 0, good

        # Worker/socket inputs cannot act as the official host confirmation.
        assert session.command({"op": "resume"})["error"] == "interactive_official_cli_required"
        with operator_thread(operator):
            result = session.run(navigate=False)
        assert result["result"]["status"] == "applied", result
        assert observed == [(True, True, 0, False)]
        assert page.evaluate("window.submitCount") == 1
        assert session.page is page and page.context is context and not page.is_closed()
        assert context.cookies()[0]["value"] == "retained"
        assert len(recorded) == 1 and recorded[0]["receipt"].is_valid()
        assert checkpoint(flow)["submit_started"] is True
        assert official_cli("confirm", binding[0], review=binding[0]["review_id"])[0] != 0
        assert page.evaluate("window.submitCount") == 1 and not network
    assert page.is_closed() and flow_screen[0].closed


@pytest.mark.parametrize("change", ["consent", "flag", "dry_run", "cap"])
def test_gate_changes_during_review_never_submit(interactive_flow, flow_screen, change):
    flow, recorded = interactive_flow
    with admitted_session(flow, ttl=15) as session:
        page, network = install_page(session)

        def operator():
            state = await_review()
            if change == "flag":
                with contextlib.closing(sqlite3.connect(flow.db_path)) as conn:
                    conn.execute("UPDATE positions SET apply_requested=0 WHERE id=41")
                    conn.commit()
            elif change == "cap":
                set_consent(flow, max_per_day=1)
                slot = apply_gate.reserve_daily_slot(42, "browser", db_path=str(flow.db_path))
                assert slot.allowed, slot
            else:
                set_consent(flow, **({"enabled": False} if change == "consent" else {"mode": "dry_run"}))
            # The owner may already have rejected the changed gate; a queued
            # confirmation is never evidence that it has been executed.
            official_cli("confirm", state, review=state["review_id"])

        with operator_thread(operator):
            result = session.run(navigate=False)
        assert result["result"]["status"] == "denied", result
        assert page.evaluate("window.submitCount") == 0
        assert not checkpoint(flow)["submit_started"] and not recorded and not network


@pytest.mark.parametrize("receipt", [True, False])
def test_handoff_last_slot_observes_without_second_submit(interactive_flow, flow_screen, receipt):
    flow, recorded = interactive_flow
    set_consent(flow, max_per_day=1)
    with admitted_session(flow, ttl=15) as session:
        page, network = install_page(session, receipt=receipt)
        screen = flow_screen[0]
        screen.page = page
        submitted = threading.Event()

        def manual_submit(actual):
            assert screen.enabled and checkpoint(flow)["submit_started"]
            actual.evaluate("document.querySelector('form').requestSubmit()")
            submitted.set()

        def operator():
            state = await_review()
            rc, reply = official_cli("handoff", state, review=state["review_id"])
            assert rc == 0, reply
            state = wait_for(mission.read, lambda s: s["phase"] == "handoff" and s["input_ready"])
            assert checkpoint(flow)["submit_started"]
            screen.actions.put(manual_submit)
            assert submitted.wait(5), f"handoff did not remain usable: {mission.read()}"
            rc, reply = official_cli("observe", state)
            assert rc == 0, reply

        with operator_thread(operator):
            result = session.run(navigate=False)
        assert page.evaluate("window.submitCount") == 1
        assert screen.revoked and not network
        assert result["result"]["status"] == ("applied" if receipt else "blocked_human"), result
        assert result["result"]["receipt"] is receipt
        if not receipt:
            assert result["result"]["reason"] == "submit_outcome_unknown"
        with contextlib.closing(sqlite3.connect(flow.db_path)) as conn:
            assert conn.execute("SELECT COUNT(*) FROM apply_cap_reservations").fetchone()[0] == 1
        assert len(recorded) == int(receipt)


@pytest.mark.parametrize("operation", ["finish", "abandon", "expiry"])
def test_review_cleanup_without_submission(interactive_flow, flow_screen, operation):
    flow, recorded = interactive_flow
    clock = [0.0]
    with admitted_session(flow, ttl=10, clock=lambda: clock[0]) as session:
        page, network = install_page(session)

        def operator():
            state = await_review()
            if operation == "expiry":
                clock[0] = 11
            else:
                assert official_cli(operation, state)[0] == 0

        with operator_thread(operator):
            result = session.run(navigate=False)
        assert result["result"]["status"] != "applied", result
        assert not recorded and not network
        assert not checkpoint(flow)["submit_started"]
    assert page.is_closed() and flow_screen[0].closed
    from apply_session_lock import position_lock
    with position_lock(flow._jht_home(), flow.position_id, owner=object()):
        pass


def test_review_tolerates_contended_official_state_lock(interactive_flow, flow_screen, monkeypatch):
    """A legitimate concurrent official writer must not abort the owner."""
    from apply_session_lock import SessionBusy
    flow, _ = interactive_flow
    attempted, busy, held = threading.Event(), threading.Event(), threading.Event()
    original = mission.take_command

    def observe_attempt(actual):
        if held.is_set():
            attempted.set()
        try:
            return original(actual)
        except SessionBusy:
            busy.set()
            raise

    monkeypatch.setattr(mission, "take_command", observe_attempt)
    with admitted_session(flow, ttl=15) as session:
        page, _ = install_page(session)

        def operator():
            state = await_review()
            with mission.state_lock():
                held.set()
                assert attempted.wait(3)
                # Release after the old failure, or a bounded contention
                # interval for the corrected waiting implementation.
                busy.wait(0.25)
            official_cli("confirm", state, review=state["review_id"])

        with operator_thread(operator):
            result = session.run(navigate=False)
        assert not busy.is_set(), "SessionBusy escaped from actual take_command/state_lock"
        assert result["result"]["status"] == "applied", result
        assert page.evaluate("window.submitCount") == 1


class RFBClient:
    """Minimal real RFB 3.8 client; no viewer flags or input-controller mock."""
    def __init__(self, port, password_file):
        self.socket = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.socket.settimeout(5)
        assert self.read(12).startswith(b"RFB ")
        self.socket.sendall(b"RFB 003.008\n")
        types = self.read(self.read(1)[0])
        assert 2 in types, "private VNC authentication not offered"
        self.socket.sendall(b"\x02")
        challenge = self.read(16)
        password = Path(password_file).read_bytes().strip()[:8].ljust(8, b"\0")
        key = bytes(int(f"{c:08b}"[::-1], 2) for c in password)
        crypto = ctypes.CDLL(ctypes.util.find_library("crypto"))
        schedule = ctypes.create_string_buffer(128)
        crypto.DES_set_key_unchecked(ctypes.create_string_buffer(key, 8), schedule)
        response = b""
        for offset in (0, 8):
            output = ctypes.create_string_buffer(8)
            crypto.DES_ecb_encrypt(ctypes.create_string_buffer(challenge[offset:offset + 8], 8),
                                   output, schedule, 1)
            response += output.raw
        self.socket.sendall(response)
        assert self.read(4) == b"\0" * 4, "synthetic VNC authentication failed"
        self.socket.sendall(b"\x01")
        header = self.read(24)
        self.read(struct.unpack(">I", header[20:24])[0])

    def read(self, count):
        chunks = b""
        while len(chunks) < count:
            part = self.socket.recv(count - len(chunks))
            if not part:
                raise EOFError("owned RFB route closed")
            chunks += part
        return chunks

    def key(self, character):
        code = ord(character)
        self.socket.sendall(struct.pack(">BBHI", 4, 1, 0, code) + struct.pack(">BBHI", 4, 0, 0, code))

    def click(self, x, y):
        self.socket.sendall(struct.pack(">BBHH", 5, 1, x, y) + struct.pack(">BBHH", 5, 0, x, y))

    def closed(self):
        try:
            return self.socket.recv(1) == b""
        except (ConnectionResetError, BrokenPipeError):
            return True
        except socket.timeout:
            return False

    def close(self):
        self.socket.close()


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="actual private Xvfb/x11vnc requires Linux")
@pytest.mark.parametrize("ending", ["observe", "finish", "abandon", "owner_eof", "stale"])
def test_real_rfb_input_gate_and_preexisting_connection_revocation(interactive_flow, ending, monkeypatch):
    """Actual RFB bytes -> X11 -> actual Chromium DOM, on an owned new display."""
    flow, _ = interactive_flow
    flow.headless = False
    heartbeat = {"count": 0, "value": ""}
    connected = threading.Event()
    connections = []
    with admitted_session(flow, ttl=40) as session:
        page, network = install_page(session)
        page.evaluate("""() => {
          const input = document.createElement('input'); input.id = 'rfb-probe';
          input.style = 'position:fixed;left:20px;top:20px;width:240px;height:40px;z-index:9999';
          document.body.append(input);
        }""")

        def pulse(value):
            heartbeat.update(count=heartbeat["count"] + 1, value=value)

        page.expose_function("fixturePulse", pulse)
        page.evaluate("setInterval(()=>window.fixturePulse(document.querySelector('#rfb-probe')?.value ?? ''),50)")
        original = flow.before_submit
        coordinates = []

        def inspect_review(cp, actual):
            assert actual.evaluate("window.submitCount") == 0
            assert actual.locator("#_systemfield_name").input_value() == "Test Candidate"
            actual.locator("#rfb-probe").focus()
            coordinates.append(actual.locator("#rfb-probe").evaluate("el=>({x:Math.round(window.screenX+el.getBoundingClientRect().left+20),y:Math.round(window.screenY+window.outerHeight-window.innerHeight+el.getBoundingClientRect().top+20)})"))
            return original(cp, actual)

        flow.before_submit = inspect_review

        def operator():
            client = RFBClient(session.screen.route["vnc_port"], session.screen.root / "viewer-password")
            connections.append(client)
            connected.set()
            # The same connected client attempts input throughout automation.
            until = time.monotonic() + 15
            while time.monotonic() < until:
                client.key("x")
                state = mission.read()
                if state["phase"] == "review_wait":
                    break
                time.sleep(0.02)
            else:
                raise AssertionError("owner never reached real review")
            start = heartbeat["count"]
            client.click(**coordinates[0])
            client.key("x")
            wait_for(lambda: heartbeat.copy(), lambda h: h["count"] >= start + 3)
            assert heartbeat["value"] == "", "view-only RFB changed real DOM"
            rc, reply = official_cli("handoff", state, review=state["review_id"])
            assert rc == 0, reply
            state = wait_for(mission.read, lambda s: s["phase"] == "handoff" and s["input_ready"], timeout=15)
            assert checkpoint(flow)["submit_started"]
            assert client.closed(), "old read-only connection survived replacement"
            active = RFBClient(session.screen.route["vnc_port"], session.screen.root / "viewer-password")
            connections.append(active)
            active.click(**coordinates[0])
            active.key("z")
            wait_for(lambda: heartbeat.copy(), lambda h: h["value"] == "z")
            if ending == "owner_eof":
                session.screen.process.stdin.close()  # real owned lease EOF
            elif ending == "stale":
                monkeypatch.setattr(session.screen, "tick", lambda: None)  # stop lease updates, real wall clock
            else:
                rc, reply = official_cli(ending, state)
                assert rc == 0, reply
            assert active.closed(), f"{ending} retained connected input route"
            # Sending again may fail immediately or land in a closed socket;
            # neither is allowed to reach the retained Page.
            try:
                active.key("q")
            except OSError:
                pass

        try:
            with operator_thread(operator):
                assert connected.wait(10)
                result = session.run(navigate=False)
            assert not network
            if not page.is_closed():
                assert page.locator("#rfb-probe").input_value() == "z"
                assert page.evaluate("window.submitCount") == 0
            assert checkpoint(flow)["submit_started"]
            assert not result["result"]["receipt"]
        finally:
            for client in connections:
                client.close()


# #281 additions exercise the frozen API; no product injection flags are added.
def _claimed_fixture(flow):
    assert official_cli("admit")[0] == 0
    mission.claim(flow)
    return mission.read()


def test_281_metadata_failure_removes_only_new_event(interactive_flow, monkeypatch):
    """Actual private file writes; screenshot bytes and metadata I/O failure injected."""
    flow, _ = interactive_flow
    state = _claimed_fixture(flow)
    monkeypatch.setattr(apply_flow, "_secrets_hidden", lambda *a, **k: contextlib.nullcontext())

    class Page:
        def is_closed(self):
            return False
        def screenshot(self, **kwargs):
            return b"\x89PNG\r\n\x1a\nsynthetic-private-pixels"

    mission.record_block(flow, Page(), "fixture_block")
    directory = mission._event_dir(state, flow._jht_home())
    before = {p.name: p.read_bytes() for p in directory.iterdir()}
    assert len(before) == 2
    actual_write = mission._private_write
    failed = []

    def fail_metadata(path, data):
        if path.suffix == ".json":
            actual_write(path, b'{"partial":')
            failed.append(path.stem)
            raise OSError("injected_metadata_fsync_failure")
        return actual_write(path, data)

    monkeypatch.setattr(mission, "_private_write", fail_metadata)
    with pytest.raises(OSError, match="injected_metadata_fsync_failure"):
        mission.record_block(flow, Page(), "fixture_second_block")
    assert len(failed) == 1
    assert all((directory / name).read_bytes() == data for name, data in before.items())
    assert all(p.stat().st_mode & 0o077 == 0 for p in directory.iterdir())
    mission._prune_events(directory, int(time.time()) + mission.EVENT_TTL + 1)
    assert not list(directory.glob(failed[0] + ".*")), "failed event survived cleanup and 24h pruning"


def _hold_email(flow):
    path = apply_gate.email_state_path(flow.position_id, flow._jht_home())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"state": "blocked_human",
                               "updated_at": datetime.now(timezone.utc).isoformat()}))


@pytest.fixture
def short_display_home(interactive_flow, monkeypatch):
    # AF_UNIX paths have a kernel length limit; keep the real fixture home short.
    # Baseline helpers may keep their DB/CV paths under pytest's longer TEMP.
    flow, recorded = interactive_flow
    original = flow._jht_home()
    with tempfile.TemporaryDirectory(prefix="j28-", dir="/tmp") as directory:
        home = Path(directory)
        shutil.copy2(original / "jht.config.json", home / "jht.config.json")
        shutil.copytree(original / "profile", home / "profile")
        monkeypatch.setenv("JHT_HOME", str(home))
        flow.jht_home = home
        yield flow, recorded


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="actual owned Linux DISPLAY/RFB required")
@pytest.mark.parametrize("fault", ["hold", "frame_eof", "frame_stale"])
def test_281_real_server_revokes_preopened_input_route(short_display_home, monkeypatch, tmp_path, fault):
    """Real Xvfb/x11vnc/Chromium; only frame latency is injected for the lease cases.

    A separate connected RFB client has already changed the DOM before revocation.
    No Python Page input is used after handoff. All network stays local/offline.
    """
    flow, recorded = short_display_home
    flow.headless = False
    marker, release = tmp_path / "frame-entered", tmp_path / "frame-release"
    # The actual supervisor runs unchanged; a test-only bootstrap delays its
    # real RFB client's frame operation. It neither replaces the server nor
    # edits the product module or the lease clock.
    bootstrap = tmp_path / "supervisor_fixture.py"
    bootstrap.write_text(
        "import sys,time,json\nfrom pathlib import Path\n"
        + "sys.path.insert(0," + repr(str(ROOT / "shared" / "skills")) + ")\n"
        + "import closer_desktop_rfb as rfb, closer_interactive_screen as screen\n"
        + "original=rfb.DisplayClient.frame\n"
        + "def stalled(self):\n"
        + " Path(" + repr(str(marker)) + ").touch()\n"
        + " until=time.monotonic()+8\n"
        + " while not Path(" + repr(str(release)) + ").exists() and time.monotonic()<until: time.sleep(.01)\n"
        + " return original(self)\n"
        + ("rfb.DisplayClient.frame=stalled\n" if fault != "hold" else "")
        + "owned=[]; popen=screen.subprocess.Popen; expire=screen._InputLease._expire\n"
        + "def trace_spawn(argv,*args,**kwargs):\n"
        + " p=popen(argv,*args,**kwargs)\n"
        + " if argv[0]=='/usr/bin/x11vnc' and '-storepasswd' not in argv: owned.append((p,'-viewonly' in argv))\n"
        + " return p\n"
        + "def trace_expire(self,*args):\n"
        + " print(json.dumps({'diagnostic':'lease_expire','monotonic':time.monotonic(),'expired_before':self.expired}),file=sys.stderr,flush=True)\n"
        + " return expire(self,*args)\n"
        + "screen.subprocess.Popen=trace_spawn; screen._InputLease._expire=trace_expire\n"
        + "try: screen._supervise()\n"
        + "finally: print(json.dumps({'diagnostic':'owned_vnc_exit','monotonic':time.monotonic(),'children':[{'pid':p.pid,'view_only':v,'returncode':p.returncode} for p,v in owned]}),file=sys.stderr,flush=True)\n")
    actual_popen = subprocess.Popen
    def spawn(argv, *args, **kwargs):
        if isinstance(argv, list) and len(argv) == 3 and argv[-1] == "_supervise":
            argv = [argv[0], str(bootstrap)]
            kwargs["stderr"] = None  # pytest captures exact fixture startup diagnostics
        return actual_popen(argv, *args, **kwargs)
    monkeypatch.setattr(subprocess, "Popen", spawn)
    heartbeat = {"count": 0, "value": "", "submits": 0}
    clients, frame_threads, frame_results = [], [], []
    observed = {"route_closed":False}
    owned = None
    with admitted_session(flow, ttl=35) as session:
        owned = session.screen.process
        screen_root = session.screen.root
        page, network = install_page(session, captcha=True)
        page.evaluate("""() => {
            const el=document.createElement('input'); el.id='rfb-probe';
            el.style='position:fixed;left:20px;top:20px;width:240px;height:40px;z-index:9999';
            document.body.append(el); el.focus();
        }""")
        page.bring_to_front()
        coordinates = page.locator("#rfb-probe").evaluate("el=>({x:Math.round(window.screenX+el.getBoundingClientRect().left+20),y:Math.round(window.screenY+window.outerHeight-window.innerHeight+el.getBoundingClientRect().top+20)})")
        def pulse(value, submits):
            heartbeat.update(count=heartbeat["count"] + 1, value=value, submits=submits)
        page.expose_function("fixturePulse", pulse)
        page.evaluate("setInterval(()=>window.fixturePulse(document.querySelector('#rfb-probe').value,window.submitCount),50)")

        def exercise():
            state = wait_for(mission.read, lambda s: s and s["phase"] == "review_wait" and s.get("handoff_allowed"), 15)
            assert state["can_confirm"] is False, "fixture must enter intermediate block, not presubmit"
            assert official_cli("handoff", state, review=state["review_id"])[0] == 0
            state = wait_for(mission.read, lambda s: s["phase"] == "handoff" and s["input_ready"], 15)
            active = RFBClient(session.screen.route["vnc_port"], session.screen.root / "viewer-password")
            clients.append(active)
            active.click(**coordinates)
            active.key("z")
            wait_for(lambda: heartbeat.copy(), lambda h: h["value"] == "z")
            marked = checkpoint(flow)
            assert marked["submit_started"] and not marked.get("receipt")
            try:
                if fault == "hold":
                    _hold_email(flow)
                    wait_for(mission.read, lambda s: (s.get("block") or {}).get("reason") == "email_blocked_human")
                else:
                    request = {"op":"frame", "mission_id":state["mission_id"], "position_id":41,
                               "owner_id":state["owner_id"], "generation":1,
                               "display_id":session.screen.route["display_id"], "frame_sequence":0}
                    frame = threading.Thread(target=lambda: frame_results.append(mission.desktop_request(request)), daemon=True)
                    frame_threads.append(frame); frame.start()
                    wait_for(marker.exists, bool)
                    if fault == "frame_eof":
                        session.screen.process.stdin.close()
                    else:
                        monkeypatch.setattr(session.screen, "tick", lambda: None)
                    time.sleep(2.3)  # real wall time exceeds the advertised lease
                active.socket.settimeout(.2)
                closed = active.closed()
                if not closed:
                    active.key("q")  # real RFB input, never Page/keyboard bypass
                release.touch()
                # Record the server-route verdict independently of API denial.
                assert closed, f"{fault}: preopened enabled RFB route survived revocation deadline"
                observed["route_closed"] = True
                assert heartbeat["submits"] == 0
                if fault == "hold":
                    assert mission.read()["input_ready"] is False
                    apply_gate.email_state_path(flow.position_id, flow._jht_home()).unlink()
                    wait_for(mission.read, lambda value: value.get("handoff_allowed") is True)
                    assert official_cli("observe", mission.read())[0] == 0
                    wait_for(mission.read, lambda value: value["phase"] in {"observing", "unknown", "completed"})
            finally:
                release.touch()
                for worker in frame_threads:
                    worker.join(10)
                    assert not worker.is_alive()
                current = mission.read()
                if current["phase"] in {"review_wait", "handoff_pending", "handoff"} and not current.get("command"):
                    official_cli("finish", current)
        def operator():
            try:
                exercise()
            finally:
                release.touch()
                current = mission.read()
                if current and current["phase"] in {"review_wait", "handoff_pending", "handoff"} and not current.get("command"):
                    official_cli("finish", current)

        try:
            with operator_thread(operator, join_timeout=30):
                try:
                    session.run(navigate=False)
                except ValueError as exc:
                    # Only this fixture deliberately closes the owner's writer.
                    # A subsequent owner write raises locally; it is not a normal
                    # terminal acknowledgement and cannot excuse a live route.
                    if fault != "frame_eof" or not owned.stdin.closed or "closed" not in str(exc):
                        raise
                    print("EXPECTED_INJECTED_OWNER_PIPE_CLOSED", type(exc).__name__)
        finally:
            release.touch()
            for client in clients:
                client.close()
        assert not network and not recorded
        assert checkpoint(flow)["submit_started"]
        # Finish/EOF can close the display asynchronously; the pre-finish
        # heartbeat above asserts zero DOM submits while the Page is retained.


    assert observed["route_closed"] is True
    assert owned is not None and owned.poll() is not None
    assert owned.stdin.closed and owned.stdout.closed
    assert all(not (screen_root / name).exists() for name in ("desktop.sock", "viewer-password", "rfbauth"))


@pytest.mark.parametrize("bad", [None, [], {"op":"descriptor", "path":"/tmp/private"},
    {"op":"input", "body":"handoff"}, {"op":"arbitrary"}, {"op":[]},
    {"op":"descriptor", "port":5900}])
def test_281_fixed_resource_schema_rejects_extra_authority(interactive_flow, bad):
    flow, _ = interactive_flow
    assert mission.desktop_request(bad, home=flow._jht_home())["ok"] is False


@pytest.mark.parametrize("tamper", ["owner_id", "mission_id", "position_id", "generation", "event_id"])
def test_281_snapshot_binding_and_private_delete(interactive_flow, monkeypatch, tamper):
    """Private artifact I/O with synthetic PNG bytes; not a screenshot-content proof."""
    flow, _ = interactive_flow
    state = _claimed_fixture(flow)
    monkeypatch.setattr(apply_flow, "_secrets_hidden", lambda *a, **k: contextlib.nullcontext())
    class Page:
        def is_closed(self): return False
        def screenshot(self, **kwargs): return b"\x89PNG\r\n\x1a\nsynthetic-private-pixels"
    mission.record_block(flow, Page(), "fixture_block")
    event = mission.read()["block"]["event_id"]
    request = {"op":"snapshot", "mission_id":state["mission_id"], "position_id":41,
               "owner_id":state["owner_id"], "generation":1, "event_id":event}
    result = mission.desktop_request(request)
    assert result["ok"] and result["event_id"] == event and result["png_base64"]
    assert not any(k in result for k in ("path", "password", "ws_port", "vnc_port"))
    wrong = dict(request)
    wrong[tamper] = {"position_id":42, "generation":True, "event_id":"../outside"}.get(tamper,"0"*32)
    assert mission.desktop_request(wrong)["ok"] is False
    directory = mission._event_dir(state)
    assert all(p.stat().st_mode & 0o077 == 0 for p in directory.iterdir())
    assert mission.desktop_request(dict(request, op="delete_snapshot")) == {"ok":True,"deleted":True}
    assert not list(directory.iterdir())
    assert mission.desktop_request(request)["ok"] is False


def test_281_retention_bounds_and_expired_snapshot(interactive_flow, monkeypatch):
    flow, _ = interactive_flow
    state = _claimed_fixture(flow)
    monkeypatch.setattr(apply_flow, "_secrets_hidden", lambda *a, **k: contextlib.nullcontext())
    class Page:
        def is_closed(self): return False
        def screenshot(self, **kwargs): return b"\x89PNG\r\n\x1a\nsynthetic-private-pixels"
    for _ in range(10):
        mission.record_block(flow, Page(), "fixture_block")
    directory = mission._event_dir(state)
    assert len(list(directory.glob("*.json"))) == 8
    assert len(list(directory.glob("*.png"))) == 8
    event = mission.read()["block"]["event_id"]
    request = {"op":"snapshot", "mission_id":state["mission_id"], "position_id":41,
               "owner_id":state["owner_id"], "generation":1, "event_id":event}
    now = time.time()
    monkeypatch.setattr(mission.time, "time", lambda: now + mission.EVENT_TTL + 1)
    assert mission.desktop_request(request)["ok"] is False
    mission._prune_events(directory, int(time.time()))
    assert not list(directory.iterdir())


@pytest.mark.parametrize("mode", ["valid", "wrong_owner", "wrong_display", "error"])
def test_281_actual_unix_client_rejects_mismatched_reply(short_display_home, mode):
    """Actual local socket client, controlled server reply; not a supervisor/kernel grant."""
    flow, _ = short_display_home
    state = _claimed_fixture(flow)
    display = "d" * 32
    mission.update(flow, screen={"display_id":display})
    root = mission._private_dir(mission._path().parent / state["owner_id"])
    path = root / "desktop.sock"
    request = {"op":"frame", "mission_id":state["mission_id"], "position_id":41,
               "owner_id":state["owner_id"], "generation":1, "display_id":display, "frame_sequence":0}
    captured = []
    response = {**request, "ok":True,"frame_sequence":1,"png_base64":"controlled-frame"}
    if mode == "wrong_owner": response["owner_id"] = "0" * 32
    if mode == "wrong_display": response["display_id"] = "0" * 32
    if mode == "error": response = {"ok":False,"error":"controlled_failure"}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        listener.bind(str(path)); path.chmod(0o600); listener.listen(1); listener.settimeout(3)
        def serve():
            with listener.accept()[0] as connection:
                raw = b""
                while not raw.endswith(b"\n"): raw += connection.recv(4096)
                captured.append(json.loads(raw))
                connection.sendall((json.dumps(response)+"\n").encode())
        with operator_thread(serve):
            result = mission.desktop_request(request)
        assert captured == [request]
        assert result["ok"] is (mode == "valid")
        if mode != "valid": assert set(result) == {"ok", "error"}
    path.unlink()



def test_281_real_page_snapshot_masks_secret_and_retains_page(short_display_home, flow_screen, monkeypatch):
    """Real Chromium Page + screenshot, screen lifecycle seam; no real DISPLAY claim."""
    import base64
    flow, _ = short_display_home
    with admitted_session(flow, ttl=15) as session:
        page = session.page
        page.context.route("**/*", lambda route: route.abort())
        page.set_content('<label>synthetic block</label><input id="secret" type="password" value="SYNTHETIC_ONLY">')
        original = page.screenshot
        hidden = []
        def screenshot(**kwargs):
            hidden.append(page.locator("#secret").evaluate("el=>getComputedStyle(el).visibility"))
            return original(**kwargs)
        monkeypatch.setattr(page, "screenshot", screenshot)
        path = Path(mission.record_block(flow, page, "fixture_block"))
        assert hidden == ["hidden"]
        assert page.locator("#secret").evaluate("el=>getComputedStyle(el).visibility") == "visible"
        assert path.stat().st_mode & 0o077 == 0
        state = mission.read()
        request = {"op":"snapshot", "mission_id":state["mission_id"], "position_id":41,
                   "owner_id":state["owner_id"], "generation":1, "event_id":state["block"]["event_id"]}
        result = mission.desktop_request(request)
        assert result["ok"]
        png = base64.b64decode(result["png_base64"], validate=True)
        assert png == path.read_bytes() and png.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack(">II", png[16:24]) == (1280, 900)
        assert session.page is page and not page.is_closed()
        assert mission.desktop_request(dict(request, op="delete_snapshot"))["deleted"]
        assert not path.exists() and mission.desktop_request(request)["ok"] is False



@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="actual owned Linux DISPLAY/RFB required")
def test_281_real_frame_event_binding_and_automation_gate(short_display_home):
    """Actual desktop socket -> raw RFB -> same X11 Chromium Page; no screen seam."""
    import base64
    flow, recorded = short_display_home
    flow.headless = False
    pulse = {"value":"", "count":0}
    with admitted_session(flow, ttl=35) as session:
        page, network = install_page(session, captcha=True)
        page.evaluate("""() => {
          const el=document.createElement('input'); el.id='backend-probe';
          el.style='position:fixed;left:20px;top:20px;width:240px;height:40px;z-index:9999';
          document.body.append(el);
        }""")
        page.bring_to_front()
        xy = page.locator("#backend-probe").evaluate("el=>({x:Math.round(window.screenX+el.getBoundingClientRect().left+20),y:Math.round(window.screenY+window.outerHeight-window.innerHeight+el.getBoundingClientRect().top+20)})")
        def heartbeat(value): pulse.update(value=value, count=pulse["count"]+1)
        page.expose_function("fixturePulse", heartbeat)
        page.evaluate("setInterval(()=>window.fixturePulse(document.querySelector('#backend-probe').value),50)")
        def operator():
            state = wait_for(mission.read, lambda s: s and s["phase"] == "review_wait" and s.get("handoff_allowed"), 15)
            binding = {"mission_id":state["mission_id"], "position_id":41, "owner_id":state["owner_id"], "generation":1}
            def descriptor(): return mission.desktop_request({"op":"descriptor"})
            d = descriptor()
            assert d["stream_available"] and not d["input_ready"]
            display = {**binding, "display_id":d["display_id"]}
            def frame(sequence):
                result = mission.desktop_request({**display, "op":"frame", "frame_sequence":sequence})
                assert result["ok"], result
                data = base64.b64decode(result["png_base64"], validate=True)
                assert data.startswith(b"\x89PNG\r\n\x1a\n") and struct.unpack(">II", data[16:24]) == (1440, 1000)
                return result["frame_sequence"]
            seq = frame(0)
            assert descriptor()["frame_sequence"] == seq
            auto = mission.desktop_request({**display, "op":"input", "frame_sequence":seq,
                                            "kind":"key", "key":"x", "pressed":True})
            assert auto["ok"] is False
            try:
                assert official_cli("handoff", state, review=state["review_id"])[0] == 0
                wait_for(mission.read, lambda s: s["phase"] == "handoff" and s["input_ready"], 15)
                seq = frame(seq)
                assert "input" in descriptor()["allowed_actions"]
                for pressed in (True, False):
                    result = mission.desktop_request({**display, "op":"input", "frame_sequence":seq,
                                                      "kind":"pointer", **xy, "button":1,"pressed":pressed})
                    assert result.get("accepted") is True, result
                for pressed in (True, False):
                    result = mission.desktop_request({**display, "op":"input", "frame_sequence":seq,
                                                      "kind":"key", "key":"z", "pressed":pressed})
                    assert result.get("accepted") is True, result
                wait_for(lambda:pulse.copy(), lambda h:h["value"]=="z")
                newer = frame(seq)
                assert newer > seq
                stale = mission.desktop_request({**display, "op":"input", "frame_sequence":seq,
                                                  "kind":"key", "key":"q", "pressed":True})
                assert stale["ok"] is False
                seq = frame(newer)
                wrong = mission.desktop_request({**display, "display_id":"0"*32,"op":"input", "frame_sequence":seq,
                                                  "kind":"key", "key":"q", "pressed":True})
                assert wrong["ok"] is False
                seq = frame(seq)
                time.sleep(2.3)  # owner continues authorised ticks, only frame is old
                expired = mission.desktop_request({**display, "op":"input", "frame_sequence":seq,
                                                    "kind":"key", "key":"q", "pressed":True})
                assert expired["ok"] is False
                assert pulse["value"] == "z"
                assert official_cli("observe", mission.read())[0] == 0
            finally:
                current = mission.read()
                if current["phase"] in {"review_wait", "handoff_pending"}:
                    official_cli("finish", current)
        with operator_thread(operator, join_timeout=30):
            result = session.run(navigate=False)
        assert session.page is page and not page.is_closed() and not network and not recorded
        assert page.locator("#backend-probe").input_value() == "z"
        assert page.evaluate("window.submitCount") == 0
        assert checkpoint(flow)["submit_started"]
        assert result["result"]["reason"] == "submit_outcome_unknown"
