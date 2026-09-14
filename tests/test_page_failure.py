"""page_failure: gone, anti-bot wall, or temporary — three remedies for one page_unavailable.

Origin: 1798 and 1893 (14/09) stopped with page_unavailable on real careers
sites, and nobody could tell a dead page from a wall from a blip.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import page_failure as pf  # noqa: E402

CLOUDFLARE = """<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><div id="challenge-running">Checking your browser before accessing careers.example.com</div>
<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>"""
DATADOME = '<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>'
PERIMETERX = '<html><body><div id="px-captcha"></div><p>Press &amp; Hold to confirm you are a human</p></body></html>'
# Shape of the 1798 answer (14/09): WordPress.com proof-of-work page.
WPCOM_CHECK = """<!DOCTYPE html><title>Checking your browser...</title><noscript><p>Javascript required</p></noscript>
<script>(()=>{const e=2;})()</script>"""
CAREERS_WITH_RECAPTCHA = """<html><head><title>Apply — Example</title></head><body>
<form><input name="email"><div class="g-recaptcha" data-sitekey="x"></div><button>Apply</button></form>
<script src="https://www.google.com/recaptcha/api.js"></script></body></html>"""


@pytest.mark.parametrize(
    ("status", "html", "kind"),
    [
        (200, CAREERS_WITH_RECAPTCHA, pf.OK),
        (404, "<html><body>Not found</body></html>", pf.NOT_FOUND),
        (410, "", pf.NOT_FOUND),
        (400, "", pf.NOT_FOUND),
        (403, "<html><body>Forbidden</body></html>", pf.BOT_PROTECTION),
        (401, "", pf.BOT_PROTECTION),
        (429, "", pf.BOT_PROTECTION),
        (999, "", pf.BOT_PROTECTION),  # LinkedIn refusing an automated client: never retried as a blip
        (503, CLOUDFLARE, pf.BOT_PROTECTION),  # a challenge behind a 5xx is a wall, not a blip
        (200, CLOUDFLARE, pf.BOT_PROTECTION),
        (200, DATADOME, pf.BOT_PROTECTION),
        (200, PERIMETERX, pf.BOT_PROTECTION),
        (403, WPCOM_CHECK, pf.BOT_PROTECTION),
        (200, WPCOM_CHECK, pf.BOT_PROTECTION),
        (500, "", pf.TEMPORARY),
        (502, "<html><body>Bad gateway</body></html>", pf.TEMPORARY),
        (503, "<html><body>Service unavailable</body></html>", pf.TEMPORARY),
        (408, "", pf.TEMPORARY),
    ],
)
def test_classify(status, html, kind):
    assert pf.classify(status, html).kind == kind


def test_timeout_and_network_errors_are_temporary():
    assert pf.classify(None, timed_out=True) == pf.Verdict(pf.TEMPORARY, "timeout")
    assert pf.classify(None, network_error=True).kind == pf.TEMPORARY
    assert pf.classify(None).kind == pf.TEMPORARY


def test_evidence_names_status_and_wall():
    verdict = pf.classify(200, CLOUDFLARE)
    assert verdict.evidence.startswith("http_200 ")
    assert "just a moment" in verdict.evidence.casefold()


def test_a_recaptcha_widget_inside_a_form_is_not_a_wall():
    assert pf.challenge_evidence(CAREERS_WITH_RECAPTCHA) == ""


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://careers.example.com/jobs/1?utm_source=x&token=secret#apply", "https://careers.example.com/jobs/1"),
        ("https://user:" + "pw" + chr(64) + "careers.example.com:8443/a", "https://careers.example.com:8443/a"),
        ("not a url", ""),
        ("", ""),
    ],
)
def test_safe_url_drops_query_fragment_and_credentials(url, expected):
    assert pf.safe_url(url) == expected


def _at(hours: float) -> datetime:
    return datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc) + timedelta(hours=hours)


def test_three_temporary_failures_in_a_day_are_exhausted():
    history, exhausted, retry_after = pf.note_transient([], _at(0))
    assert not exhausted and len(history) == 1
    assert retry_after == "2026-09-14T13:00:00Z"
    history, exhausted, _ = pf.note_transient(history, _at(2))
    assert not exhausted
    history, exhausted, _ = pf.note_transient(history, _at(5))
    assert exhausted and len(history) == 3


def test_failures_older_than_the_window_do_not_count():
    history = ["2026-09-13T08:00:00Z", "2026-09-13T09:00:00Z"]
    kept, exhausted, _ = pf.note_transient(history, _at(0))
    assert not exhausted and kept == ["2026-09-14T12:00:00Z"]


def test_unreadable_history_is_dropped_not_counted():
    kept, exhausted, _ = pf.note_transient(["garbage", "", "2026-09-14T11:00:00Z"], _at(0))
    assert kept == ["2026-09-14T11:00:00Z", "2026-09-14T12:00:00Z"] and not exhausted


# === Browser side and decision (1798: 403 proof-of-work · 1893: 410 closed) ===

URL = "https://careers.example.com/jobs/1234-engineer"
NOW_D2 = datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc)

CHALLENGE = """<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>"""
# A proof-of-work page that clears itself: sets a cookie and reloads.
SELF_CLEARING = """<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><script src="/cdn-cgi/challenge-platform/x"></script>
<script>setTimeout(() => { document.cookie = "passed=1; path=/"; location.reload(); }, 300);</script></body></html>"""
VACANCY = "<html><head><title>Engineer</title></head><body><form><input name=email><button>Apply</button></form></body></html>"


def access(kind: str, status: int | None = 200, evidence: str = "") -> pf.Access:
    return pf.Access(pf.Verdict(kind, evidence or f"http_{status}"), status, URL)


# --- decide: pure ---------------------------------------------------------


def test_an_open_page_proceeds_and_forgets_earlier_blips():
    decision, history, retry_after = pf.decide(
        access(pf.OK), headless=True, headed_available=True, headed_retry_used=False,
        transient_history=[(NOW_D2 - timedelta(hours=1)).isoformat()], now=NOW_D2,
    )
    assert decision.action == pf.PROCEED
    assert (history, retry_after) == ([], "")


def test_a_gone_page_without_evidence_is_page_not_found():
    decision, _, _ = pf.decide(
        access(pf.NOT_FOUND, 404), headless=True, headed_available=True, headed_retry_used=False
    )
    assert (decision.action, decision.reason) == (pf.BLOCK, "page_not_found")
    assert "404" in decision.detail


def test_a_gone_page_that_says_it_is_closed_is_vacancy_closed():
    decision, _, _ = pf.decide(
        access(pf.NOT_FOUND, 410), headless=True, headed_available=True, headed_retry_used=False,
        closed_evidence="notice language: en",
    )
    assert (decision.action, decision.reason) == (pf.BLOCK, "vacancy_closed")
    assert "410" in decision.detail


def test_a_closed_notice_closes_the_vacancy_only_on_a_gone_page():
    decision, _, _ = pf.decide(
        access(pf.NOT_FOUND, 400), headless=True, headed_available=True, headed_retry_used=False,
        closed_evidence="notice language: en",
    )
    assert (decision.action, decision.reason) == (pf.BLOCK, "page_not_found")


def test_a_wall_in_a_headless_browser_gets_one_headed_try():
    decision, _, _ = pf.decide(
        access(pf.BOT_PROTECTION, 403), headless=True, headed_available=True, headed_retry_used=False
    )
    assert decision.action == pf.RETRY_HEADED


@pytest.mark.parametrize(
    ("headless", "available", "used"),
    [(True, True, True), (True, False, False), (False, True, False)],
    ids=["headed-try-already-used", "no-live-screen", "already-headed"],
)
def test_a_wall_is_a_human_stop_when_no_headed_try_is_left(headless, available, used):
    decision, _, _ = pf.decide(
        access(pf.BOT_PROTECTION, 403), headless=headless, headed_available=available, headed_retry_used=used
    )
    assert (decision.action, decision.reason) == (pf.BLOCK, "bot_protection")


def test_a_temporary_failure_waits_without_a_stop():
    decision, history, retry_after = pf.decide(
        access(pf.TEMPORARY, 503), headless=True, headed_available=True, headed_retry_used=False, now=NOW_D2
    )
    assert decision.action == pf.RETRY_LATER
    assert decision.reason == ""
    assert len(history) == 1
    assert pf._instant(retry_after) == NOW_D2 + pf.RETRY_DELAY


def test_the_third_temporary_failure_in_a_day_stops():
    earlier = [(NOW_D2 - timedelta(hours=5)).isoformat(), (NOW_D2 - timedelta(hours=2)).isoformat()]
    decision, history, _ = pf.decide(
        access(pf.TEMPORARY, None, "timeout"), headless=True, headed_available=True,
        headed_retry_used=False, transient_history=earlier, now=NOW_D2,
    )
    assert (decision.action, decision.reason) == (pf.BLOCK, "page_temporarily_unavailable")
    assert len(history) == 3


def test_old_temporary_failures_do_not_count():
    old = [(NOW_D2 - timedelta(hours=30)).isoformat(), (NOW_D2 - timedelta(hours=25)).isoformat()]
    decision, history, _ = pf.decide(
        access(pf.TEMPORARY, 502), headless=True, headed_available=True, headed_retry_used=False,
        transient_history=old, now=NOW_D2,
    )
    assert decision.action == pf.RETRY_LATER
    assert len(history) == 1


# --- retry_pending: the queue's side --------------------------------------


@pytest.mark.parametrize(
    ("checkpoint", "pending"),
    [
        ({"state": "retry_later", "retry_after": (NOW_D2 + timedelta(minutes=5)).isoformat()}, True),
        ({"state": "retry_later", "retry_after": (NOW_D2 - timedelta(minutes=5)).isoformat()}, False),
        ({"state": "retry_later", "retry_after": "not a date"}, False),
        ({"state": "retry_later"}, False),
        ({"state": "blocked_human", "retry_after": (NOW_D2 + timedelta(hours=1)).isoformat()}, False),
        ("not a mapping", False),
    ],
    ids=["future", "past", "unreadable", "missing", "other-state", "garbage"],
)
def test_retry_pending_holds_only_a_readable_future_retry(checkpoint, pending):
    assert pf.retry_pending(checkpoint, NOW_D2) is pending


def test_headed_screen_available_follows_the_live_screen_rule():
    assert pf.headed_screen_available(lambda override: False) is True
    assert pf.headed_screen_available(lambda override: True) is False

    def broken(override):
        raise OSError("no socket dir")

    assert pf.headed_screen_available(broken) is False


# --- the browser: synthetic answers through page.route ---------------------


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        current = browser.new_page()
        yield current
        browser.close()


def _answer(page, status: int, body: str) -> None:
    page.route(
        "https://careers.example.com/**",
        lambda route: route.fulfill(status=status, content_type="text/html", body=body),
    )


@pytest.mark.parametrize(
    ("status", "body", "kind"),
    [
        (200, VACANCY, pf.OK),
        (404, "<html><body>Not found</body></html>", pf.NOT_FOUND),
        (410, "<html><body>This job is no longer available</body></html>", pf.NOT_FOUND),
        (403, "<html><body>Forbidden</body></html>", pf.BOT_PROTECTION),
        (429, "<html><body>Too many requests</body></html>", pf.BOT_PROTECTION),
        (200, CHALLENGE, pf.BOT_PROTECTION),
        (503, "<html><body>Service unavailable</body></html>", pf.TEMPORARY),
    ],
)
def test_visit_classifies_the_synthetic_answer(page, status, body, kind):
    _answer(page, status, body)
    result = pf.visit(page, URL + "?utm_source=board&token=secret")
    assert result.kind == kind
    assert result.status == status
    assert result.final_url == URL  # no query in the checkpoint


def test_visit_turns_a_timeout_into_a_temporary_failure(page):
    page.route("https://careers.example.com/**", lambda route: None)  # never answers
    result = pf.visit(page, URL, timeout_ms=800)
    assert (result.kind, result.status, result.verdict.evidence) == (pf.TEMPORARY, None, "timeout")


def test_visit_turns_a_network_error_into_a_temporary_failure(page):
    page.route("https://careers.example.com/**", lambda route: route.abort("connectionrefused"))
    result = pf.visit(page, URL)
    assert (result.kind, result.verdict.evidence) == (pf.TEMPORARY, "network_error")


def test_observe_reads_the_status_of_a_page_someone_else_opened(page):
    # The flow's tests replace _navigate with a bare page.goto: the
    # classification must not depend on holding the response.
    _answer(page, 410, "<html><body>Gone</body></html>")
    page.goto(URL)
    result = pf.observe(page)
    assert (result.kind, result.status) == (pf.NOT_FOUND, 410)


class ScriptedPage:
    """A page whose every look is scripted: no browser, no real waiting.

    Each entry is (status, html) for one observe(); status "raise" makes the
    status read fail, as an evaluate does while the page is reloading.
    """

    def __init__(self, looks):
        self.looks = list(looks)
        self.current = self.looks.pop(0)
        self.url = URL
        self.waits = 0

    def wait_for_timeout(self, _ms):
        self.waits += 1
        if self.looks:
            self.current = self.looks.pop(0)

    def evaluate(self, _script):
        status, _html = self.current
        if status == "raise":
            raise RuntimeError("Execution context was destroyed")
        return status

    def content(self):
        return self.current[1]


def test_settle_waits_for_a_proof_of_work_check_to_clear_by_itself():
    page = ScriptedPage([(403, SELF_CLEARING), (403, SELF_CLEARING), (200, VACANCY)])
    first = pf.observe(page)
    assert (first.kind, first.status) == (pf.BOT_PROTECTION, 403)

    settled = pf.settle(page, first, wait_ms=5_000, poll_ms=250)

    assert (settled.kind, settled.status) == (pf.OK, 200)
    assert page.waits == 2


@pytest.mark.parametrize("mid_reload", ["raise", None], ids=["status-read-fails", "status-not-yet-there"])
def test_settle_never_stops_on_a_reloading_page_without_its_status(mid_reload):
    # CI run 34881349729: ('ok', None) — the new document's content was read
    # before its status.  The next look has the status.
    page = ScriptedPage([(403, SELF_CLEARING), (mid_reload, VACANCY), (200, VACANCY)])
    first = pf.observe(page)

    settled = pf.settle(page, first, wait_ms=5_000, poll_ms=250)

    assert (settled.kind, settled.status) == (pf.OK, 200)


def test_settle_gives_up_when_the_time_is_up():
    page = ScriptedPage([(403, SELF_CLEARING)] * 10)
    settled = pf.settle(page, pf.observe(page), wait_ms=1_000, poll_ms=250)
    assert settled.kind == pf.BOT_PROTECTION
    assert page.waits == 4


def test_settle_does_not_wait_on_a_bare_403():
    # A Forbidden or a geoblock with no challenge on the page does not clear by waiting.
    class Page:
        url = URL
        waits = 0

        def wait_for_timeout(self, _ms):
            self.waits += 1

    bare = pf.Access(pf.Verdict(pf.BOT_PROTECTION, "http_403"), 403, URL)
    page = Page()
    assert pf.settle(page, bare, wait_ms=5_000, poll_ms=100) is bare
    assert page.waits == 0
