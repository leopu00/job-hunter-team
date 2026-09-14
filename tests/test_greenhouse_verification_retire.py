"""A submit whose Greenhouse code screen was lost before any code (1967, patch 26).

Greenhouse registers nothing without the code. A checkpoint that recorded the
code screen when it saw it (code_required, with when and how), typed no code
and has no receipt allows ONE new complete submit, only after the user
authorised the position again and only in a new page. Everything else keeps
its stop. Synthetic pages and a fake mailbox only.
"""

from __future__ import annotations

import contextlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from test_greenhouse_apply_flow import GREENHOUSE_URLS, GateVerdict
from test_greenhouse_verification_code import (  # noqa: F401 - fixtures
    CODE,
    code_page,
    cv_path,
    db,
    flow_for,
    fresh_mail,
    mailbox,
    page,
    saved_text,
)

from apply_flow import FlowCheckpoint


def _later() -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()


def _earlier() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()


def _stop_on_the_code_screen(page, tmp_path, cv_path, db) -> dict:
    """A real run: one Submit, the code screen, no email in time."""
    page.set_content(code_page())
    result = flow_for(tmp_path, cv_path, db, reader=mailbox([]), timeout=0.5).run(page=page, navigate=False)
    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_failed")
    assert page.evaluate("window.submitCount") == 1
    return json.loads(saved_text(tmp_path))


def _rerun(tmp_path, cv_path, db, monkeypatch, *, at: str, reader=None, recorded=None, timeout=5.0, browser_page=None):
    """A later run in a new browser (page=None) whose navigation opens the synthetic form again."""
    flow = flow_for(tmp_path, cv_path, db, reader=reader, recorded=recorded, timeout=timeout)
    flow.gate_checker = lambda **_kwargs: GateVerdict(context={"mode": "authorised", "at": at})
    opened: list = []
    if browser_page is not None:
        browser_page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body=code_page()))
        monkeypatch.setattr(flow, "_managed_page", lambda: contextlib.nullcontext(browser_page))

    def navigate(self, target):
        opened.append(target)
        target.goto(self.url)

    monkeypatch.setattr(type(flow), "_navigate", navigate)
    return flow, opened


def test_the_code_screen_is_recorded_when_it_is_seen(page, tmp_path, cv_path, db):
    saved = _stop_on_the_code_screen(page, tmp_path, cv_path, db)

    assert saved["verification"] == "code_required"
    assert saved["verification_seen_at"] and saved["verification_evidence"] == "greenhouse security code screen after submit"
    assert saved["submit_started"] is True and not saved["receipt"]


def test_a_newer_authorisation_allows_one_new_complete_submit(page, tmp_path, cv_path, db, monkeypatch):
    before = _stop_on_the_code_screen(page, tmp_path, cv_path, db)
    recorded: list = []
    flow, opened = _rerun(tmp_path, cv_path, db, monkeypatch, browser_page=(new_page := page.context.browser.new_page()), at=_later(), reader=mailbox(fresh_mail()), recorded=recorded)

    result = flow.run()

    assert result.status == "applied", result
    assert opened == [new_page]
    assert new_page.evaluate("window.submitCount") == 2  # one Submit, then the code confirmed once
    assert len(recorded) == 1
    saved = json.loads(saved_text(tmp_path))
    assert saved["retired_submits"] == [
        {
            "submit_started_at": before["submit_started_at"],
            "verification_seen_at": before["verification_seen_at"],
            "verification_evidence": before["verification_evidence"],
            "retired_at": saved["retired_submits"][0]["retired_at"],
        }
    ]
    assert CODE not in saved_text(tmp_path)


def test_the_new_submit_is_the_only_one_of_its_run(page, tmp_path, cv_path, db, monkeypatch):
    _stop_on_the_code_screen(page, tmp_path, cv_path, db)
    flow, _opened = _rerun(tmp_path, cv_path, db, monkeypatch, browser_page=(new_page := page.context.browser.new_page()), at=_later(), reader=mailbox([]), timeout=0.5)

    result = flow.run()

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_failed")
    assert new_page.evaluate("window.submitCount") == 1
    saved = json.loads(saved_text(tmp_path))
    assert len(saved["retired_submits"]) == 1
    # The new submit's own code screen, seen after the old one was retired.
    assert saved["verification"] == "code_required" and saved["submit_started"] is True
    assert saved["verification_seen_at"] >= saved["retired_submits"][0]["retired_at"]


def test_without_a_newer_authorisation_the_lost_screen_stays_a_stop(page, tmp_path, cv_path, db, monkeypatch):
    _stop_on_the_code_screen(page, tmp_path, cv_path, db)
    flow, opened = _rerun(tmp_path, cv_path, db, monkeypatch, browser_page=(new_page := page.context.browser.new_page()), at=_earlier(), reader=mailbox(fresh_mail()))

    result = flow.run()

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_lost")
    assert opened == [] and new_page.url == "about:blank"
    assert json.loads(saved_text(tmp_path))["retired_submits"] == []


def test_the_same_page_is_never_retired(page, tmp_path, cv_path, db, monkeypatch):
    # navigate=False: the caller hands the page of the submit; its screen being
    # gone is a lost verification, not a reason to fill the form again.
    _stop_on_the_code_screen(page, tmp_path, cv_path, db)
    page.set_content(code_page())
    flow, _opened = _rerun(tmp_path, cv_path, db, monkeypatch, at=_later(), reader=mailbox(fresh_mail()))

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_lost")
    assert page.evaluate("window.submitCount || 0") == 0


def _checkpoint(tmp_path: Path, **fields) -> None:
    checkpoint = FlowCheckpoint.new(52, GREENHOUSE_URLS[0])
    checkpoint.platform = "greenhouse"
    checkpoint.state = "blocked_human"
    checkpoint.resume_state = "submit"
    checkpoint.completed_steps = ["detect", "fill", "upload_cv", "screening", "review"]
    checkpoint.submit_started = True
    checkpoint.submit_started_at = _earlier()
    for name, value in fields.items():
        setattr(checkpoint, name, value)
    checkpoint.save(tmp_path / "checkpoint.json")


@pytest.mark.parametrize(
    ("fields", "reason"),
    (
        # 1967's checkpoint of 19:48: stopped before the record existed.
        ({"verification": "", "blocked_reason": "submit_outcome_unknown"}, "submit_outcome_unknown"),
        ({"verification": "code_required"}, "greenhouse_verification_lost"),
        # A code was typed and confirmed: the site may have taken it.
        ({"verification": "code_entered", "verification_seen_at": "2026-09-14T19:48:20+00:00",
          "verification_evidence": "greenhouse security code screen after submit"}, "submit_outcome_unknown"),
    ),
)
def test_no_new_submit_without_the_record_or_after_a_code(page, tmp_path, cv_path, db, monkeypatch, fields, reason):
    _checkpoint(tmp_path, **fields)
    recorded: list = []
    flow, opened = _rerun(tmp_path, cv_path, db, monkeypatch, browser_page=page, at=_later(), reader=mailbox(fresh_mail()), recorded=recorded)

    result = flow.run()

    assert (result.status, result.reason) == ("blocked_human", reason)
    assert page.evaluate("window.submitCount || 0") == 0
    assert recorded == []
    assert json.loads(saved_text(tmp_path))["submit_started"] is True


def test_a_receipt_is_never_retired(page, tmp_path, cv_path, db, monkeypatch):
    _checkpoint(tmp_path, verification="code_required", verification_seen_at=_earlier(),
                verification_evidence="greenhouse security code screen after submit", receipt={"partial": True})
    flow, _opened = _rerun(tmp_path, cv_path, db, monkeypatch, browser_page=page, at=_later(), reader=mailbox(fresh_mail()))

    flow.run()

    saved = json.loads(saved_text(tmp_path))
    assert saved["submit_started"] is True and saved["retired_submits"] == []
