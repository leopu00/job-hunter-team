"""Independent #280 negative/lifecycle proofs on real controller and flow code.

Browser/ATS/gate verdicts below are unit dependencies, never a human grant or
proof of product authorisation. Everything is TEMP; no site, real identity,
provider, profile, VPS or application is contacted. Chromium coverage is separate.
JHT_ASSISTED_TEST_SKILLS selects an explicitly captured product snapshot.
"""
from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = Path(os.environ.get("JHT_ASSISTED_TEST_SKILLS", ROOT / "shared/skills")).resolve()
sys.path.insert(0, str(SKILLS))
import apply_assisted as assisted
import apply_flow
import apply_session_lock
import linkedin_apply

assert Path(assisted.__file__).resolve().parent == SKILLS
assert Path(apply_flow.__file__).resolve().parent == SKILLS


@dataclass
class UnitVerdict:
    allowed: bool = True
    reason: str = "fixture_only"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self):
        return "unit gate " + self.reason


class InstrumentedPage:
    """Inert resource handles and explicit synthetic manual input effects."""
    def __init__(self, context):
        self.context = context
        self.url = "about:blank"
        self.closed = False
        self.confirmed = False
        self.manual_count = 0
        self.input_events = []
        self.submit_on = "click"
        self.frames = [self]
        self.mouse = SimpleNamespace(click=lambda *a, **k: self.input("click"))
        self.keyboard = SimpleNamespace(
            press=lambda key, **k: self.input("press", key),
            type=lambda text, **k: self.input("type", text),
            insert_text=lambda text, **k: self.input("type", text),
        )

    def input(self, action, text=""):
        assert not self.closed and self.context.alive and self.context.browser.runtime.alive
        self.input_events.append((action, text))
        if action == self.submit_on:
            self.manual_count += 1

    def is_closed(self):
        return self.closed

    def close(self):
        self.closed = True

    def wait_for_timeout(self, _ms):
        pass

    def wait_for_function(self, *_a, **_kw):
        return SimpleNamespace(json_value=lambda: {"count": 0})

    def screenshot(self, *, path, **_kw):
        assert not self.closed
        Path(path).write_bytes(b"synthetic screenshot, no personal data")


class InstrumentedContext:
    def __init__(self, browser):
        self.browser = browser
        self.alive = True
        self.pages = [InstrumentedPage(self)]

    def new_page(self):
        page = InstrumentedPage(self)
        self.pages.append(page)
        return page

    def close(self):
        self.browser.runtime.events.append("context.close")
        self.alive = False
        for page in self.pages:
            page.close()


class InstrumentedBrowser:
    def __init__(self, runtime):
        self.runtime = runtime
        self.connected = True
        self.contexts = []

    def new_context(self, **_kwargs):
        context = InstrumentedContext(self)
        self.contexts.append(context)
        return context

    def is_connected(self):
        return self.connected

    def close(self):
        self.runtime.events.append("browser.close")
        self.connected = False
        for context in self.contexts:
            context.close()


class InstrumentedRuntime:
    def __init__(self):
        self.alive = False
        self.events = []
        self.browsers = []
        self.chromium = self

    def __enter__(self):
        self.alive = True
        self.events.append("runtime.enter")
        return self

    def __exit__(self, *_args):
        self.alive = False
        self.events.append("runtime.exit")

    def launch(self, **_kwargs):
        browser = InstrumentedBrowser(self)
        self.browsers.append(browser)
        return browser

    def launch_persistent_context(self, *_args, **kwargs):
        return self.launch().new_context(**kwargs)


class InstrumentedRecipe:
    answer_sources = {}
    application_channel = ""
    pre_submit_screenshot_path = ""

    def __init__(self):
        self.block = True
        self.automatic_submits = 0
        self.pages = []

    def fill_core(self, page):
        self.pages.append(page)

    def upload_cv(self, _page):
        pass

    def fill_screening(self, _page):
        if self.block:
            raise apply_flow.BlockedHuman("required_answer_missing", "Synthetic required fact absent", "screening")

    def review(self, _page):
        pass

    def submit(self, page):
        self.automatic_submits += 1
        page.confirmed = True


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    runtime = InstrumentedRuntime()
    import playwright.sync_api
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: runtime)
    # No notification or summary can write outside this TEMP directory.
    monkeypatch.setattr(apply_flow, "_optional_module", lambda name: None if name == "closer_notices" else __import__(name))
    recipe = InstrumentedRecipe()
    verdict = UnitVerdict()
    eligibility = {"reason": ""}
    records, gates, caps = [], [], []
    cv = tmp_path / "fixture.pdf"
    cv.write_bytes(b"%PDF-1.4 fixture only")

    def gate(**kwargs):
        gates.append(kwargs)
        return verdict

    def cap(**kwargs):
        caps.append(kwargs)
        return UnitVerdict()

    flow = apply_flow.ApplicationFlow(
        position_id=280, url="https://jobs.ashbyhq.com/example/fixture/application",
        profile={}, cv_path=cv, checkpoint_path=tmp_path / "checkpoint.json",
        receipt_dir=tmp_path / "receipts", db_path=tmp_path / "jobs.db",
        gate_checker=gate, cap_reserver=cap, cv_checker=lambda _p: {"ok": True, "reasons": []},
        essentials_checker=lambda **_kw: [], notifier=lambda **_kw: "fixture",
        applied_recorder=lambda **kw: records.append(kw), confirmation_timeout_ms=0,
    )
    monkeypatch.setattr(flow, "_open_application", lambda cp, page, **kw: (SimpleNamespace(platform="ashby"), recipe, True))
    monkeypatch.setattr(flow, "_navigate", lambda page: setattr(page, "url", flow.url))
    monkeypatch.setattr(flow, "_check_page_access", lambda *a, **kw: None)
    monkeypatch.setattr(flow, "_assert_not_redirected_away", lambda *a, **kw: None)
    monkeypatch.setattr(flow, "_assert_recipe_page", lambda *a, **kw: None)
    monkeypatch.setattr(flow, "_confirmation", lambda page, *a, **kw: (page.url, "Synthetic confirmation") if page.confirmed else None)
    monkeypatch.setattr(flow, "_wait_for_confirmation", lambda page, *a: (page.url, "Synthetic confirmation") if page.confirmed else None)
    now = [0.0]
    return SimpleNamespace(flow=flow, runtime=runtime, recipe=recipe, verdict=verdict,
                           eligibility=eligibility, records=records, gates=gates, caps=caps,
                           clock=lambda: now[0], now=now,
                           checker=lambda *a, **kw: eligibility["reason"], home=tmp_path)


def session_for(rig, ttl=1800):
    return assisted.AssistedSession(rig.flow, ttl=ttl, eligibility_checker=rig.checker, clock=rig.clock)


def blocked(session, rig):
    session.run(navigate=True)
    assert session.status()["phase"] == "blocked"
    assert session.status()["result"]["status"] == "blocked_human"
    page = rig.recipe.pages[-1]
    assert page.context.alive and rig.runtime.alive and not page.is_closed()
    assert rig.recipe.automatic_submits == 0
    return page


def reason_of(result):
    return result.get("error") or (result.get("result") or {}).get("reason") or result.get("reason")


@pytest.mark.parametrize("op", ["resume", "handoff", "input"])
@pytest.mark.parametrize("reason", ["consent_disabled", "position_not_authorised", "daily_cap_reached"])
def test_gate_revoked_after_block_refuses_every_mutating_command(rig, op, reason):
    with session_for(rig) as session:
        page = blocked(session, rig)
        if op == "input":
            session.command({"op": "handoff"})
        before = len(rig.gates)
        rig.verdict.allowed, rig.verdict.reason = False, reason
        result = session.command({"op": op, "action": "click", "x": 1, "y": 1})
        assert reason_of(result) == reason
        assert len(rig.gates) > before
        assert not page.input_events and rig.recipe.automatic_submits == 0 and not rig.records


@pytest.mark.parametrize("op", ["resume", "handoff", "input"])
@pytest.mark.parametrize("reason", ["checkpoint_blocked_human", "email_channel", "essential_facts_missing", "daily_cap_reached"])
def test_official_hold_checked_again_before_command(rig, op, reason):
    with session_for(rig) as session:
        page = blocked(session, rig)
        if op == "input":
            session.command({"op": "handoff"})
        rig.eligibility["reason"] = reason
        result = session.command({"op": op, "action": "click", "x": 1, "y": 1})
        assert reason_of(result) == reason
        assert not page.input_events and not rig.records and not rig.recipe.automatic_submits


@pytest.mark.parametrize("action,extra", [("click", {"x": 1, "y": 1}), ("press", {"key": "Enter"}), ("type", {"text": "synthetic"})])
@pytest.mark.parametrize("confirmed", [True, False])
def test_manual_input_may_submit_and_resume_never_submits_again(rig, action, extra, confirmed):
    with session_for(rig) as session:
        page = blocked(session, rig)
        page.submit_on = action
        session.command({"op": "handoff"})
        checkpoint = apply_flow.FlowCheckpoint.load(rig.flow.checkpoint_path, position_id=280, url=rig.flow.url)
        assert checkpoint.submit_started, "durable uncertainty marker must precede any input"
        assert len(rig.caps) == 1
        session.command({"op": "input", "action": action, **extra})
        assert page.manual_count == 1
        page.confirmed = confirmed
        rig.recipe.block = False
        session.command({"op": "resume"})
        outcome = session.status()["result"]
        assert outcome["status"] == ("applied" if confirmed else "blocked_human")
        if not confirmed:
            assert outcome["reason"] == "submit_outcome_unknown" and not rig.records
        else:
            assert len(rig.records) == 1 and rig.records[0]["receipt"].is_valid()
        assert rig.recipe.automatic_submits == 0 and len(rig.caps) == 1
        assert not page.is_closed() or session.status()["phase"] in {"completed", "closed"}


def test_ordinary_flow_closes_resources_but_assisted_block_keeps_them(rig):
    assert rig.flow.run().status == "blocked_human"
    assert not rig.runtime.alive and rig.runtime.events[-1] == "runtime.exit"
    with session_for(rig) as session:
        page = blocked(session, rig)
        assert page.context.alive and rig.runtime.alive
    assert page.is_closed() and not rig.runtime.alive


@pytest.mark.parametrize("close_kind", ["abandon", "finish", "disconnect", "expiry"])
def test_terminal_paths_close_once_release_position_and_keep_uncertainty(rig, close_kind):
    session = session_for(rig, ttl=10)
    with session:
        page = blocked(session, rig)
        session.command({"op": "handoff"})
        if close_kind in {"abandon", "finish"}:
            session.command({"op": close_kind})
        elif close_kind == "disconnect":
            page.close()
            session.command({"op": "status"})
        else:
            rig.now[0] = 11
            session.command({"op": "status"})
        assert session.status()["phase"] == "closed"
        assert page.is_closed() and not rig.runtime.alive
        exits = rig.runtime.events.count("runtime.exit")
        session.close("again")
        assert rig.runtime.events.count("runtime.exit") == exits == 1
        checkpoint = json.loads(rig.flow.checkpoint_path.read_text())
        assert checkpoint["submit_started"] and not checkpoint["receipt"]
        with apply_session_lock.position_lock(rig.home, 280):
            pass
    assert not rig.records and rig.recipe.automatic_submits == 0


@pytest.mark.parametrize("action,extra", [("click", {"x": 1, "y": 1}), ("press", {"key": "Enter"}), ("type", {"text": "synthetic"})])
def test_real_consent_mode_change_to_dry_run_refuses_input_but_allows_observation(rig, action, extra):
    import apply_gate
    # Exercise the production consent parser and flow gate dispatch. Position
    # eligibility remains an explicit unit dependency: no DB grant is invented.
    config_path = rig.home / "synthetic-consent.json"
    config = {"applications": {"auto_apply": {"enabled": True, "max_per_day": 3, "mode": "authorised"}}}
    config_path.write_text(json.dumps(config))
    rig.flow.gate_checker = lambda **_kw: apply_gate.consent_verdict(path=config_path)
    with session_for(rig) as session:
        page = blocked(session, rig)
        assert session.command({"op": "handoff"})["phase"] == "handoff"
        config["applications"]["auto_apply"]["mode"] = "dry_run"
        config_path.write_text(json.dumps(config))
        verdict = rig.flow._gate()
        assert verdict.allowed and verdict.context["mode"] == "dry_run"
        result = session.command({"op": "input", "action": action, **extra})
        assert reason_of(result) == "assisted_input_requires_authorisation"
        assert not page.input_events and not rig.records and not rig.recipe.automatic_submits
        outcome = session.command({"op": "resume"})
        assert outcome["result"]["reason"] == "submit_outcome_unknown"
        assert not page.input_events and not rig.records and not rig.recipe.automatic_submits


def test_position_lock_blocks_another_automatic_owner(rig):
    with session_for(rig) as session:
        blocked(session, rig)
        results = []
        def competing_automatic():
            results.append(rig.flow.run())
        thread = threading.Thread(target=competing_automatic)
        thread.start()
        thread.join(timeout=2)
        assert not thread.is_alive()
        assert results[0].reason == "application_session_busy"
        assert len(rig.runtime.browsers) == 1 and rig.recipe.automatic_submits == 0


def test_same_thread_distinct_automatic_flow_cannot_reenter_owner_lock(rig):
    import inspect
    # A fresh automatic flow, never a copy of any session capability.
    kwargs = {name: getattr(rig.flow, name) for name in inspect.signature(apply_flow.ApplicationFlow).parameters
              if hasattr(rig.flow, name)}
    competing = apply_flow.ApplicationFlow(**kwargs)
    for name in ["_open_application", "_navigate", "_check_page_access", "_assert_not_redirected_away",
                 "_assert_recipe_page", "_confirmation", "_wait_for_confirmation"]:
        setattr(competing, name, getattr(rig.flow, name))
    with session_for(rig) as session:
        blocked(session, rig)
        result = competing.run()
        assert result.reason == "application_session_busy"
        assert len(rig.runtime.browsers) == 1


def test_linkedin_profile_lock_is_held_against_another_owner_and_released(rig, monkeypatch):
    profile = rig.home / "isolated-browser-profile"
    profile.mkdir()
    rig.flow._linkedin_profile = profile
    monkeypatch.setattr(rig.flow, "_linkedin_profile_stop", lambda _cp: None)
    with session_for(rig) as session:
        page = blocked(session, rig)
        with pytest.raises(linkedin_apply.ProfileBusy):
            with linkedin_apply.profile_lock(rig.home):
                pass
        assert page.context.alive and rig.runtime.alive
    with linkedin_apply.profile_lock(rig.home):
        pass
    assert not page.context.alive and not rig.runtime.alive


def test_cap_reservation_denied_before_handoff_never_grants_input(rig):
    with session_for(rig) as session:
        page = blocked(session, rig)
        rig.flow.cap_reserver = lambda **kw: UnitVerdict(False, "daily_cap_reached")
        result = session.command({"op": "handoff"})
        assert reason_of(result) == "daily_cap_reached"
        assert not json.loads(rig.flow.checkpoint_path.read_text())["submit_started"]
        assert reason_of(session.command({"op": "input", "action": "press", "key": "Enter"})) == "assisted_input_requires_handoff"
        assert not page.input_events


def test_shared_uid_private_controller_body_never_grants_identity_or_consent(rig):
    import socket
    import stat
    import tempfile
    with session_for(rig) as session, tempfile.TemporaryDirectory(prefix="jht280-", dir="/tmp") as folder:
        page = blocked(session, rig)
        rig.verdict.allowed, rig.verdict.reason = False, "consent_disabled"
        root = Path(folder)
        root.chmod(0o700)
        endpoint = root / "control.sock"
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(endpoint))
            endpoint.chmod(0o600)
            server.listen(1)
            assert stat.S_IMODE(endpoint.stat().st_mode) == 0o600
            assert endpoint.stat().st_uid == os.getuid()
            responses = []
            def receive():
                with server.accept()[0] as client:
                    payload = json.loads(client.makefile("rb").readline())
                    responses.append(session.command(payload))
                    client.sendall(json.dumps(responses[-1]).encode() + b"\n")
            worker = threading.Thread(target=receive)
            worker.start()
            before = rig.flow.checkpoint_path.read_bytes()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(str(endpoint))
                client.sendall(json.dumps({"op": "handoff", "uid": os.getuid(), "human": True,
                                           "identity": "unit-claim", "consent": True}).encode() + b"\n")
                result = json.loads(client.makefile("rb").readline())
            worker.join(timeout=2)
            assert not worker.is_alive() and reason_of(result) == "consent_disabled"
            assert rig.flow.checkpoint_path.read_bytes() == before
            assert rig.verdict.allowed is False and not page.input_events and not rig.caps
