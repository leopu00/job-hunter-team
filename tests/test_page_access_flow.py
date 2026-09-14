"""The flow and a vacancy page that does not open: gone, walled, or down for now.

Origin: 1798 (HTTP 403 behind a "Checking your browser..." page) and 1893
(HTTP 410 with a closed notice) stopped on 14/09 as page_unavailable, one
reason and one notification for three situations. Synthetic answers only.
"""

from __future__ import annotations

import contextlib
import functools
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import apply_flow as apply_flow_module  # noqa: E402
import page_failure  # noqa: E402
from apply_flow import FlowCheckpoint  # noqa: E402
from test_apply_flow import ASHBY_URL, ashby_form, build_flow, cv_path, page  # noqa: E402,F401
from test_linkedin_apply_flow import (  # noqa: E402
    JOB,
    LEVER_APPLY,
    Site,
    build_flow as build_linkedin_flow,
    home,  # noqa: F401
)

CHALLENGE = """<!DOCTYPE html><title>Checking your browser...</title><noscript><p>Javascript required</p></noscript>"""
GONE = "<html><body><h1>This job is no longer available</h1></body></html>"


@pytest.fixture
def summary(monkeypatch) -> list:
    """Site stops the flow queues for the round's summary (closer_notices)."""
    import closer_notices

    deferred: list = []
    monkeypatch.setattr(closer_notices, "defer", lambda pid, reason, url: deferred.append((pid, reason)))
    return deferred


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch, summary):
    # The production waits (12 s for a bot check, 30 s for a navigation) would
    # only slow the synthetic pages down.
    monkeypatch.setattr(
        page_failure, "settle", functools.partial(page_failure.settle, wait_ms=300, poll_ms=100)
    )
    monkeypatch.setattr(page_failure, "visit", functools.partial(page_failure.visit, timeout_ms=1_500))
    import safe_fetch

    monkeypatch.setattr(safe_fetch, "resolve_public_address", lambda *_a, **_k: None)


def serve(page, status: int, body: str) -> None:
    page.route(
        "https://jobs.ashbyhq.com/**",
        lambda route: route.fulfill(status=status, content_type="text/html", body=body),
    )


def read(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "checkpoint.json").read_text(encoding="utf-8"))


def managed(flow, monkeypatch, pages_by_headless: dict) -> list[bool]:
    """Production-like browser: one page per launch, chosen by headless mode."""
    launches: list[bool] = []

    def manager():
        launches.append(flow.headless)
        return contextlib.nullcontext(pages_by_headless[flow.headless])

    monkeypatch.setattr(flow, "_managed_page", manager)
    return launches


def query_url() -> str:
    return ASHBY_URL + "?utm_source=board&token=synthetic"


# --- gone ---------------------------------------------------------------------


def test_a_410_that_says_the_vacancy_is_closed_is_vacancy_closed(page, tmp_path: Path, cv_path: Path):
    serve(page, 410, GONE)
    notifications: list = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)

    result = flow.run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "vacancy_closed")
    saved = read(tmp_path)
    assert (saved["http_status"], saved["final_url"]) == (410, ASHBY_URL)
    assert "HTTP 410" in saved["blocked_detail"]
    assert "no longer available" not in json.dumps(saved)


def test_a_404_with_no_evidence_is_page_not_found(page, tmp_path: Path, cv_path: Path):
    serve(page, 404, "<html><body>Not found</body></html>")
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "page_not_found")
    assert read(tmp_path)["http_status"] == 404


def test_the_checkpoint_never_keeps_the_query_of_the_final_url(page, tmp_path: Path, cv_path: Path, monkeypatch):
    serve(page, 404, "<html><body>Not found</body></html>")
    flow = build_flow(tmp_path, cv_path)
    monkeypatch.setattr(flow, "_navigate", lambda active: active.goto(query_url()))

    flow.run(page=page, navigate=True)

    assert read(tmp_path)["final_url"] == ASHBY_URL


def test_a_replaced_navigate_does_not_skip_the_classification(page, tmp_path: Path, cv_path: Path, monkeypatch):
    # Tests of other recipes replace _navigate with a bare goto: the page is
    # still read, and a synthetic 200 stays a page that opened.
    serve(page, 403, CHALLENGE)
    flow = build_flow(tmp_path, cv_path)
    monkeypatch.setattr(flow, "_navigate", lambda active: active.goto(ASHBY_URL))

    result = flow.run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "bot_protection")


# --- anti-bot wall --------------------------------------------------------------


def test_a_wall_gets_one_headed_try_then_a_human_stop_with_screenshot(
    tmp_path: Path, cv_path: Path, monkeypatch, summary: list
):
    playwright = pytest.importorskip("playwright.sync_api")
    notifications: list = []
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        hidden, visible = browser.new_page(), browser.new_page()
        serve(hidden, 403, CHALLENGE)
        serve(visible, 403, CHALLENGE)
        flow = build_flow(tmp_path, cv_path, notifications=notifications)
        flow.headed_available = lambda: True
        launches = managed(flow, monkeypatch, {True: hidden, False: visible})

        result = flow.run(page=None)
        browser.close()

    assert (result.status, result.reason) == ("blocked_human", "bot_protection")
    assert launches == [True, False]
    assert flow.headless is True  # the caller's mode is given back
    saved = read(tmp_path)
    assert saved["http_status"] == 403
    assert saved["stop_screenshot"] and Path(saved["stop_screenshot"]).is_file()
    # A stop of the site: one line in the round's summary, no message of its own.
    assert (notifications, summary) == ([], [(41, "bot_protection")])


def test_a_wall_that_a_headed_browser_passes_goes_on_with_the_application(
    tmp_path: Path, cv_path: Path, monkeypatch
):
    playwright = pytest.importorskip("playwright.sync_api")
    recorded: list = []
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        hidden, visible = browser.new_page(), browser.new_page()
        serve(hidden, 403, CHALLENGE)
        serve(visible, 200, ashby_form())
        flow = build_flow(tmp_path, cv_path, recorded=recorded)
        flow.headed_available = lambda: True
        launches = managed(flow, monkeypatch, {True: hidden, False: visible})

        result = flow.run(page=None)
        submits = visible.evaluate("window.submitCount")
        browser.close()

    assert result.status == "applied", result
    assert launches == [True, False]
    assert submits == 1 and len(recorded) == 1


def test_a_proof_of_work_check_that_clears_by_itself_needs_no_headed_try(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    # The shape of 1798: a 403 "Checking your browser..." page that reloads itself.
    clearing = CHALLENGE + '<script>setTimeout(() => { document.cookie = "passed=1; path=/"; location.reload(); }, 100);</script>'

    def handler(route):
        if "passed=1" in (route.request.headers.get("cookie") or ""):
            route.fulfill(status=200, content_type="text/html", body=ashby_form())
        else:
            route.fulfill(status=403, content_type="text/html", body=clearing)

    page.route("https://jobs.ashbyhq.com/**", handler)
    monkeypatch.setattr(
        page_failure, "settle", functools.partial(page_failure.settle.func, wait_ms=5_000, poll_ms=200)
    )
    recorded: list = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)
    flow.headed_available = lambda: False
    launches = managed(flow, monkeypatch, {True: page})

    result = flow.run(page=None)

    assert result.status == "applied", result
    assert launches == [True]
    assert read(tmp_path)["http_status"] == 200


def test_without_a_live_screen_a_wall_stops_at_once(page, tmp_path: Path, cv_path: Path, monkeypatch):
    serve(page, 429, "<html><body>Too many requests</body></html>")
    flow = build_flow(tmp_path, cv_path)
    flow.headed_available = lambda: False
    launches = managed(flow, monkeypatch, {True: page})

    result = flow.run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "bot_protection")
    assert launches == [True]


def test_an_injected_page_is_never_reopened_headed(page, tmp_path: Path, cv_path: Path, monkeypatch):
    serve(page, 403, CHALLENGE)
    flow = build_flow(tmp_path, cv_path)
    flow.headed_available = lambda: True
    launches = managed(flow, monkeypatch, {True: page, False: page})

    result = flow.run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "bot_protection")
    assert launches == []


def test_submit_recovery_never_retries_headed(page, tmp_path: Path, cv_path: Path, monkeypatch):
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.save(tmp_path / "checkpoint.json")
    serve(page, 403, CHALLENGE)
    flow = build_flow(tmp_path, cv_path)
    flow.headed_available = lambda: True
    launches = managed(flow, monkeypatch, {True: page})

    result = flow.run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "submit_outcome_unknown")
    assert launches == [True]


def test_a_walled_handoff_destination_is_classified_too(page, home: Path, cv_path: Path, monkeypatch):
    site = Site(offsite=True)
    site.install(page)
    page.route(
        LEVER_APPLY,
        lambda route: route.fulfill(status=403, content_type="text/html", body=CHALLENGE),
    )
    flow = build_linkedin_flow(home, cv_path)
    flow.headed_available = lambda: False

    result = flow.run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "bot_protection")
    saved = json.loads((home / ".cache" / "apply-flow" / "71.json").read_text())
    assert (saved["url"], saved["handoff_url"], saved["http_status"]) == (JOB, LEVER_APPLY, 403)


def test_a_headed_try_after_a_handoff_starts_again_from_the_queue_url(home: Path, cv_path: Path, monkeypatch):
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        hidden, visible = browser.new_page(), browser.new_page()
        for current in (hidden, visible):
            Site(offsite=True).install(current)
            current.route(
                LEVER_APPLY,
                lambda route: route.fulfill(status=403, content_type="text/html", body=CHALLENGE),
            )
        flow = build_linkedin_flow(home, cv_path)
        flow.headed_available = lambda: True
        launches = managed(flow, monkeypatch, {True: hidden, False: visible})

        result = flow.run(page=None)
        browser.close()

    # Not checkpoint_invalid: the rerun loads the checkpoint of the queue's URL.
    assert (result.status, result.reason) == ("blocked_human", "bot_protection")
    assert launches == [True, False]


# --- temporary ------------------------------------------------------------------


def test_a_503_waits_without_a_stop_or_a_notice(page, tmp_path: Path, cv_path: Path, monkeypatch, summary: list):
    serve(page, 503, "<html><body>Service unavailable</body></html>")
    notifications: list = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)
    launches = managed(flow, monkeypatch, {True: page})

    first = flow.run(page=None)
    again = flow.run(page=None)

    assert (first.status, first.state, first.reason) == ("retry_later", "retry_later", "page_retry_later")
    assert (again.status, again.reason) == ("retry_later", "page_retry_later")
    assert launches == [True]  # before retry_after no browser opens
    assert (notifications, summary) == ([], [])
    saved = read(tmp_path)
    assert saved["state"] == "retry_later"
    assert saved["blocked_reason"] == "" and saved["stop_screenshot"] == ""
    assert len(saved["transient_failures"]) == 1
    assert page_failure.retry_pending(saved)


def _expire_retry(tmp_path: Path) -> None:
    path = tmp_path / "checkpoint.json"
    saved = json.loads(path.read_text(encoding="utf-8"))
    saved["retry_after"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    path.write_text(json.dumps(saved), encoding="utf-8")


def test_the_third_temporary_failure_in_a_day_is_a_human_stop(
    page, tmp_path: Path, cv_path: Path, monkeypatch, summary: list
):
    page.route("https://jobs.ashbyhq.com/**", lambda route: None)  # never answers: timeout
    notifications: list = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)
    managed(flow, monkeypatch, {True: page})

    results = []
    for _ in range(3):
        results.append(flow.run(page=None))
        if results[-1].status == "retry_later":
            _expire_retry(tmp_path)

    assert [r.status for r in results] == ["retry_later", "retry_later", "blocked_human"]
    assert results[-1].reason == "page_temporarily_unavailable"
    assert (notifications, summary) == ([], [(41, "page_temporarily_unavailable")])
    assert read(tmp_path)["http_status"] is None


def test_a_page_that_opens_after_a_blip_goes_on_and_forgets_it(page, tmp_path: Path, cv_path: Path, monkeypatch):
    answers = iter([(503, "<html><body>down</body></html>")])

    def handler(route):
        status, body = next(answers, (200, ashby_form()))
        route.fulfill(status=status, content_type="text/html", body=body)

    page.route("https://jobs.ashbyhq.com/**", handler)
    recorded: list = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)
    managed(flow, monkeypatch, {True: page})

    assert flow.run(page=None).status == "retry_later"
    _expire_retry(tmp_path)
    result = flow.run(page=None)

    assert result.status == "applied", result
    saved = read(tmp_path)
    assert (saved["transient_failures"], saved["retry_after"], saved["http_status"]) == ([], "", 200)


# --- the checkpoint -------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("http_status", "403"),
        ("http_status", True),
        ("final_url", 7),
        ("transient_failures", "2026-09-14T12:00:00Z"),
        ("transient_failures", [1]),
        ("retry_after", None),
    ],
)
def test_a_malformed_page_access_record_is_an_invalid_checkpoint(tmp_path: Path, cv_path: Path, field, value):
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.save(tmp_path / "checkpoint.json")
    saved = read(tmp_path)
    saved[field] = value
    (tmp_path / "checkpoint.json").write_text(json.dumps(saved), encoding="utf-8")

    result = build_flow(tmp_path, cv_path).run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "checkpoint_invalid")


def test_retry_later_without_a_retry_time_is_an_invalid_checkpoint(tmp_path: Path, cv_path: Path):
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.state = "retry_later"
    checkpoint.save(tmp_path / "checkpoint.json")

    result = build_flow(tmp_path, cv_path).run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "checkpoint_invalid")


def test_an_old_checkpoint_without_the_new_fields_still_loads(tmp_path: Path):
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.save(tmp_path / "checkpoint.json")
    saved = read(tmp_path)
    for name in ("http_status", "final_url", "transient_failures", "retry_after"):
        saved.pop(name)
    (tmp_path / "checkpoint.json").write_text(json.dumps(saved), encoding="utf-8")

    loaded = FlowCheckpoint.load(tmp_path / "checkpoint.json", 41, ASHBY_URL)

    assert (loaded.http_status, loaded.final_url, loaded.transient_failures, loaded.retry_after) == (None, "", [], "")


def test_the_cli_exit_code_of_retry_later_is_its_own(monkeypatch, tmp_path: Path, cv_path: Path):
    profile_path = tmp_path / "profile.yml"
    profile_path.write_text("name: Test Candidate\n", encoding="utf-8")

    class Flow:
        def __init__(self, **_kwargs):
            pass

        def run(self):
            return apply_flow_module.FlowResult("retry_later", "retry_later", "page_retry_later")

    monkeypatch.setattr(apply_flow_module, "ApplicationFlow", Flow)
    code = apply_flow_module.main(
        ["--position-id", "41", "--url", ASHBY_URL, "--profile", str(profile_path), "--cv", str(cv_path)]
    )

    assert code == apply_flow_module.RETRY_LATER_EXIT
