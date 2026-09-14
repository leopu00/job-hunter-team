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
        (503, CLOUDFLARE, pf.BOT_PROTECTION),  # a challenge behind a 5xx is a wall, not a blip
        (200, CLOUDFLARE, pf.BOT_PROTECTION),
        (200, DATADOME, pf.BOT_PROTECTION),
        (200, PERIMETERX, pf.BOT_PROTECTION),
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
