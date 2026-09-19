"""The CLOSER on a Workday posting: wait for the single-page app, name the stop, never click.

Position 1817 (14/09) stopped as ats_unsupported with a blank screenshot.
Synthetic pages shaped like a real Workday posting (its data-automation-id
attributes), served by Playwright routes; nothing reaches Workday.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import workday_apply  # noqa: E402
from apply_flow import ApplicationFlow  # noqa: E402

URL = "https://example.wd3.myworkdayjobs.com/Careers/job/Amsterdam/Synthetic-Engineer_R000001"


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


def posting(body: str, *, delay_ms: int = 1500) -> str:
    """An empty shell that draws the posting later, as Workday does."""
    return (
        "<html><body><div id='root'></div><script>"
        "window.applyClicks = 0;"
        f"setTimeout(() => {{ document.getElementById('root').innerHTML = {body!r};"
        "document.querySelectorAll('[data-automation-id=adventureButton]').forEach(a => "
        "a.addEventListener('click', e => { e.preventDefault(); window.applyClicks += 1; })); }, "
        f"{delay_ms});"
        "</script></body></html>"
    )


OPEN = (
    "<div data-automation-id='jobPostingPage'><h2 data-automation-id='jobPostingHeader'>Synthetic Engineer</h2>"
    f"<a data-automation-id='adventureButton' href='{URL}/apply'>Apply</a>"
    "<div data-automation-id='jobPostingDescription'>What you will do.</div></div>"
)
CLOSED = (
    "<div data-automation-id='jobPostingPage'><h2 data-automation-id='jobPostingHeader'>Synthetic Engineer</h2>"
    "<p>This job posting is no longer available.</p></div>"
)


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        current = browser.new_context().new_page()
        yield current
        browser.close()


def run(page, tmp_path: Path, html: str, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    page.route(URL, lambda route: route.fulfill(status=200, content_type="text/html", body=html))
    monkeypatch.setattr(ApplicationFlow, "_navigate", lambda self, p: p.goto(self.url, wait_until="domcontentloaded"))
    cv = tmp_path / "cv.pdf"
    cv.write_bytes(b"%PDF-1.4\n")
    flow = ApplicationFlow(
        position_id=17,
        url=URL,
        profile={"name": "Test Candidate"},
        cv_path=cv,
        checkpoint_path=tmp_path / "17.json",
        receipt_dir=tmp_path / "receipts",
        db_path=tmp_path / "jobs.db",
        gate_checker=lambda **_k: GateVerdict(),
        notifier=lambda **_k: "1",
        essentials_checker=lambda **_k: [],
        cv_checker=lambda _p: {"ok": True, "reasons": []},
        applied_recorder=lambda **_k: None,
    )
    return flow, flow.run(page=page, navigate=True)


def test_an_open_posting_that_renders_late_stops_as_account_creation_without_a_click(page, tmp_path: Path, monkeypatch):
    flow, result = run(page, tmp_path, posting(OPEN), monkeypatch)

    assert (result.status, result.reason) == ("blocked_human", "account_creation")
    assert page.evaluate("window.applyClicks") == 0
    assert page.locator("[data-automation-id='jobPostingHeader']").is_visible()  # the stop saw the drawn page
    assert Path(__import__("json").loads((tmp_path / "17.json").read_text())["stop_screenshot"]).is_file()


def test_the_account_step_itself_is_account_creation(page, tmp_path: Path, monkeypatch):
    sign_in = (
        "<div data-automation-id='applyFlowPage'><div data-automation-id='signInContent'>"
        "<input data-automation-id='email'><input data-automation-id='password' type='password'>"
        "<button data-automation-id='createAccountSubmitButton'>Create Account</button></div></div>"
    )
    _flow, result = run(page, tmp_path, posting(sign_in), monkeypatch)

    assert result.reason == "account_creation"


def test_a_closed_posting_is_a_closed_vacancy(page, tmp_path: Path, monkeypatch):
    _flow, result = run(page, tmp_path, posting(CLOSED), monkeypatch)

    assert result.reason == "vacancy_closed"


def test_a_posting_that_never_renders_is_unavailable_not_unsupported(page, tmp_path: Path, monkeypatch):
    monkeypatch.setattr(workday_apply, "RENDER_WAIT_MS", 800)
    monkeypatch.setattr(workday_apply.stop_for, "__defaults__", (800,), raising=False)

    _flow, result = run(page, tmp_path, "<html><body><div id='root'></div></body></html>", monkeypatch)

    assert result.reason == "page_unavailable"
