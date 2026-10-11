"""Actual Chromium ownership and recovery; no external site or application."""
import contextlib
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
import apply_flow as module
from apply_assisted import AssistedSession, AssistedDenied
from test_apply_flow import build_flow, ashby_form, _answers_db, cv_path
from test_apply_gate import CONSENT_ON


def test_expired_driver_handle_does_not_signal_unrelated_process():
    from apply_assisted import _interrupt_driver
    from types import SimpleNamespace
    async def completed_driver():
        child = await asyncio.create_subprocess_exec(sys.executable, "-c", "pass")
        await child.wait()
        return child
    driver = asyncio.run(completed_driver())
    unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(10)"])
    try:
        _interrupt_driver(SimpleNamespace(_playwright_driver=driver))
        assert driver.returncode == 0
        assert unrelated.poll() is None
    finally:
        unrelated.terminate()
        unrelated.wait(timeout=5)


@pytest.fixture
def live_flow(tmp_path, monkeypatch, cv_path):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    (tmp_path / "jht.config.json").write_text(json.dumps(CONSENT_ON))
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "candidate_profile.yml").write_text("name: Test Candidate\ntarget_role: Engineer\nlocation: Remote\n")
    db = _answers_db(tmp_path)
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE positions SET apply_requested=1,apply_requested_at=?,apply_requested_by='user_local' WHERE id=41",
                     (datetime.now(timezone.utc).isoformat(),))
    flow = build_flow(tmp_path, cv_path)
    flow.db_path = db
    flow.checkpoint_path = tmp_path / ".cache" / "apply-flow" / "41.json"
    flow.gate_checker = module._default_gate_checker
    flow.cap_reserver = module._default_cap_reserver
    return flow


def reauthorise(flow):
    with sqlite3.connect(flow.db_path) as conn:
        conn.execute("UPDATE positions SET apply_requested_at=? WHERE id=41",
                     ((datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),))


def other_process_lock(home):
    code = "from pathlib import Path; from apply_session_lock import position_lock,SessionBusy\ntry:\n with position_lock(Path(__import__('sys').argv[1]),41): pass\nexcept SessionBusy: raise SystemExit(9)"
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "shared" / "skills")}
    return subprocess.run([sys.executable, "-c", code, str(home)], env=env, capture_output=True).returncode


def test_real_page_context_cookie_survive_block_and_answer_resume(live_flow):
    import application_answers
    flow = live_flow
    with AssistedSession(flow) as session:
        page = session.page
        context = page.context
        context.add_cookies([{"name": "fixture", "value": "same-session", "domain": "example.invalid", "path": "/"}])
        page.set_content(ashby_form(question="Why do you want to join us?"))
        first = session.run(navigate=False)
        assert first["result"]["reason"] == "required_answer_missing"
        assert not page.is_closed() and page.context is context
        assert other_process_lock(flow._jht_home()) == 9
        with sqlite3.connect(flow.db_path) as conn:
            application_answers.save_answer(conn, key="why do you want to join us",
                label="Why do you want to join us?", answer="Synthetic fixture answer.",
                field_type="textarea", channel="user", scope=application_answers.answer_scope(conn, "textarea", 41))
            conn.commit()
        second = session.command({"op": "resume"})
        assert second["result"]["status"] == "applied"
        assert session.page is page and page.context is context
        assert page.evaluate("window.submitCount") == 1
        assert context.cookies()[0]["value"] == "same-session"
        assert not page.is_closed()
        assert session.command({"op": "finish"})["phase"] == "closed"
        assert page.is_closed()
    assert other_process_lock(flow._jht_home()) == 0


@pytest.mark.parametrize("trigger", ["Enter", "onchange", "requestSubmit"])
def test_human_submit_is_marked_before_input_and_never_clicked_again(live_flow, trigger):
    flow = live_flow
    with AssistedSession(flow) as session:
        page = session.page
        page.set_content(ashby_form(captcha=True))
        assert session.run(navigate=False)["result"]["reason"] == "captcha"
        reauthorise(flow)
        assert session.command({"op": "handoff"})["phase"] == "handoff"
        checkpoint = json.loads(flow.checkpoint_path.read_text())
        assert checkpoint["submit_started"] is True
        # The real portal can submit even without a Submit-button click.
        page.locator("iframe").evaluate("el=>el.remove()")
        page.locator("#_systemfield_name").fill("Test Candidate")
        page.locator("#_systemfield_email").fill("candidate@example.invalid")
        page.locator("input[type=file]").set_input_files(str(flow.cv_path))
        if trigger == "Enter":
            page.locator("#_systemfield_name").focus()
            session.command({"op": "input", "action": "press", "key": "Enter"})
        elif trigger == "onchange":
            page.locator("#_systemfield_name").evaluate("el=>el.addEventListener('input',()=>el.form.requestSubmit())")
            page.locator("#_systemfield_name").focus()
            session.command({"op": "input", "action": "type", "text": "x"})
        else:
            page.evaluate("document.querySelector('form').requestSubmit()")
        assert page.locator(".ashby-application-form-success-container").is_visible()
        result = session.command({"op": "resume"})
        assert result["result"]["status"] == "applied"
        assert page.evaluate("window.submitCount") == 1


def test_human_input_without_receipt_is_unknown_even_if_no_submit_was_seen(live_flow):
    flow = live_flow
    with AssistedSession(flow) as session:
        page = session.page
        page.set_content(ashby_form(captcha=True))
        session.run(navigate=False)
        assert not json.loads(flow.checkpoint_path.read_text())["submit_started"]
        reauthorise(flow)
        session.command({"op": "handoff"})
        session.command({"op": "input", "action": "press", "key": "Tab"})
        result = session.command({"op": "resume"})
        assert result["result"]["reason"] == "submit_outcome_unknown"
        assert page.evaluate("window.submitCount") == 0
        assert json.loads(flow.checkpoint_path.read_text())["submit_started"]


def test_real_browser_expiry_and_disconnect_release_resources(live_flow):
    now = [0.0]
    session = AssistedSession(live_flow, ttl=1, clock=lambda: now[0])
    with session:
        page = session.page
        now[0] = 2
        assert session.command({"op": "status"})["error"] == "assisted_expired"
        assert page.is_closed()
    assert other_process_lock(live_flow._jht_home()) == 0
    with AssistedSession(live_flow) as session:
        session.page.context.browser.close()
        assert session.command({"op": "status"})["error"] == "assisted_disconnected"
    assert other_process_lock(live_flow._jht_home()) == 0


def test_automatic_browser_still_closes_on_block(live_flow, monkeypatch):
    flow = live_flow
    opened = []
    managed = flow._managed_page
    @contextlib.contextmanager
    def remember():
        with managed() as page:
            opened.append(page)
            yield page
    monkeypatch.setattr(flow, "_managed_page", remember)
    monkeypatch.setattr(flow, "_navigate", lambda page: page.set_content(ashby_form(captcha=True)))
    # No external navigation; the normal manager remains the owner.
    monkeypatch.setattr(flow, "_check_page_access", lambda *a, **k: None)
    monkeypatch.setattr(flow, "_assert_not_redirected_away", lambda *a, **k: None)
    assert flow.run().status == "blocked_human"
    assert opened[0].is_closed()


def test_real_persistent_profile_is_owned_until_finish(live_flow, monkeypatch, tmp_path):
    import linkedin_apply
    flow = live_flow
    flow.url = "https://www.linkedin.com/jobs/view/123456789/"
    directory = tmp_path / "synthetic-profile"
    directory.mkdir()
    monkeypatch.setattr(linkedin_apply, "profile_state", lambda home: "ready")
    monkeypatch.setattr(linkedin_apply, "profile_dir", lambda home: directory)
    with AssistedSession(flow) as session:
        assert flow._profile_page_owner == directory
        assert linkedin_apply.profile_busy(tmp_path)
        assert flow._linkedin_profile_stop(session._checkpoint()) is None
        assert not session.page.is_closed()
    assert not linkedin_apply.profile_busy(tmp_path)
    assert flow._profile_page_owner is None


@pytest.mark.parametrize("slow_navigation,operation", [(False, None), (True, None), (False, "finish"), (False, "abandon")])
def test_owner_process_real_timer_closes_chromium_and_socket(live_flow, monkeypatch, slow_navigation, operation):
    import apply_assisted
    from apply_assisted import _write
    flow = live_flow
    # AF_UNIX is limited to 104 bytes on macOS; this fixture uses a short home.
    with tempfile.TemporaryDirectory(prefix="jhta-", dir="/tmp") as directory:
        root = Path(directory)
        home = flow._jht_home()
        config = root / "start-fixture.json"
        _write(config, {"owner_id": "fixture", "position_id": 41,
            "url": flow.url, "profile": str(home / "profile" / "candidate_profile.yml"),
            "cv": str(flow.cv_path), "checkpoint": str(flow.checkpoint_path),
            "db": str(flow.db_path), "receipt_dir": str(flow.receipt_dir),
            "assisted_ttl": 30 if operation else 4, "fixture_slow_navigation": slow_navigation})
        helper = Path(__file__).parent / "fixtures" / "assisted_owner.py"
        process = subprocess.Popen([sys.executable, str(helper), str(config)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)})
        try:
            if operation:
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if (root / "status.json").exists() and json.loads((root / "status.json").read_text()).get("phase") == "blocked":
                        break
                    time.sleep(0.05)
                else:
                    pytest.fail("owner did not reach fixture block")
                monkeypatch.setattr(apply_assisted, "_paths", lambda _pid: root)
                assert apply_assisted.main(["status", "--position-id", "41"]) == 0
                assert apply_assisted.main([operation, "--position-id", "41"]) == 0
            stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
            pytest.fail("owner timeout: " + stderr.decode())
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        assert process.returncode == 0, stderr.decode()
        status = json.loads((root / "status.json").read_text())
        assert status["phase"] == "closed"
        assert status["reason"] == ({"finish": "finished", "abandon": "abandoned"}.get(operation, "expired_or_stopped"))
        assert not (root / "control.sock").exists()
        assert not config.exists()
        pids = json.loads((root / "browser-pids.json").read_text())
        assert pids
        for pid in pids:
            # A reaped process or a zombie has no live browser resources.
            observed = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True)
            assert not observed.stdout.strip() or observed.stdout.strip().startswith("Z")
        assert other_process_lock(home) == 0
