"""The flow's hook to the company-form recipe (apply_generic) and to the round summary (closer_notices).

Synthetic pages only, served by Playwright routes; the recipe itself is
tested in tests/test_apply_generic.py.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import apply_flow  # noqa: E402
from apply_flow import ApplicationFlow  # noqa: E402
from test_apply_generic import BASE, CLASSIC, PROFILE, _site_page  # noqa: E402


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


@pytest.fixture
def browser():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        launched = runtime.chromium.launch(headless=True)
        yield launched
        launched.close()


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "synthetic-profile.pdf"
    path.write_bytes(b"%PDF-1.4\n% synthetic test fixture only\n")
    return path


@pytest.fixture(autouse=True)
def home(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return tmp_path


def build_flow(tmp_path: Path, cv_path: Path, url: str, *, recorded=None, notified=None) -> ApplicationFlow:
    recorded = recorded if recorded is not None else []
    notified = notified if notified is not None else []
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=81,
        url=url,
        profile=PROFILE,
        cv_path=cv_path,
        checkpoint_path=tmp_path / ".cache" / "apply-flow" / "81.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(),
        notifier=lambda **kwargs: notified.append(kwargs) or "1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        confirmation_timeout_ms=1500,
    )


def test_a_company_form_no_ats_names_is_applied_to_with_the_generic_recipe(browser, cv_path, tmp_path):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recorded: list = []

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7", recorded=recorded).run(page=page, navigate=False)

    assert result.status == "applied", result
    saved = json.loads((tmp_path / ".cache" / "apply-flow" / "81.json").read_text())
    assert saved["platform"] == "generic"
    assert Path(saved["pre_submit_screenshot"]).is_file()
    assert page.evaluate("window.submitCount") == 1
    assert len(recorded) == 1


def test_a_known_ats_without_a_recipe_never_becomes_a_company_form(browser, cv_path, tmp_path, monkeypatch):
    url = "https://example.wd1.myworkdayjobs.com/en-US/careers/job/7"
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body=CLASSIC))
    page.goto(url)

    result = build_flow(tmp_path, cv_path, url).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ats_unsupported")
    assert page.evaluate("window.submitCount") == 0


def test_without_the_generic_module_an_unknown_page_stays_unsupported(browser, cv_path, tmp_path, monkeypatch):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    real = apply_flow._optional_module
    monkeypatch.setattr(apply_flow, "_optional_module", lambda name: None if name == "apply_generic" else real(name))

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ats_unsupported")
    assert page.evaluate("window.submitCount") == 0


def test_a_company_form_that_leaves_the_company_site_stops_before_the_click(browser, cv_path, tmp_path):
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body=CLASSIC))
    page.goto("https://elsewhere.example.net/jobs/7")

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "application_redirect_untrusted")
    assert page.evaluate("window.submitCount") == 0


def test_company_site_subdomains_are_the_same_site():
    class Page:
        url = "https://jobs.example.com/apply"

    apply_flow.ApplicationFlow._assert_recipe_page(Page(), "generic", "fill", application_url="https://example.com/careers/7")
    with pytest.raises(apply_flow.BlockedHuman):
        apply_flow.ApplicationFlow._assert_recipe_page(Page(), "generic", "fill", application_url="https://example.org/careers/7")
    Page.url = "http://jobs.example.com/apply"
    with pytest.raises(apply_flow.BlockedHuman):
        apply_flow.ApplicationFlow._assert_recipe_page(Page(), "generic", "fill", application_url="https://example.com/careers/7")


def test_no_confirmation_on_a_company_site_is_an_unknown_outcome(browser, cv_path, tmp_path):
    silent = CLASSIC.replace("document.body.innerHTML = '<main><h1>Thank you for your application!</h1></main>';", "void 0;")
    assert silent != CLASSIC
    page = _site_page(browser, {"/jobs/7": silent})
    page.goto(f"{BASE}/jobs/7")
    recorded: list = []

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7", recorded=recorded).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "submit_outcome_unknown")
    assert page.evaluate("window.submitCount") == 1 and recorded == []


def test_a_site_stop_goes_to_the_round_summary_not_to_a_message(browser, cv_path, tmp_path, monkeypatch):
    import closer_notices

    deferred: list = []
    monkeypatch.setattr(closer_notices, "defer", lambda *args: deferred.append(args))
    page = browser.new_page()
    page.set_content("<html><body><h1>Careers</h1><p>Nothing to apply to here.</p></body></html>")
    notified: list = []

    result = build_flow(tmp_path, cv_path, "https://careers.example.invalid/x", notified=notified).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ats_unsupported")
    assert deferred == [(81, "ats_unsupported", "https://careers.example.invalid/x")]
    assert notified == []


def test_a_broken_summary_still_notifies_the_stop(browser, cv_path, tmp_path, monkeypatch):
    import closer_notices

    def broken(*_args):
        raise OSError("synthetic disk full")

    monkeypatch.setattr(closer_notices, "defer", broken)
    page = browser.new_page()
    page.set_content("<html><body><h1>Careers</h1></body></html>")
    notified: list = []

    result = build_flow(tmp_path, cv_path, "https://careers.example.invalid/x", notified=notified).run(page=page, navigate=False)

    assert result.reason == "ats_unsupported"
    assert len(notified) == 1


def test_an_application_stop_is_notified_in_the_users_words(cv_path, tmp_path, monkeypatch):
    import closer_notices

    monkeypatch.setattr(closer_notices, "stop_message", lambda reason, detail, pid, default="": f"LOCALISED {reason}")
    flow = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7")

    message = flow._notification_message(apply_flow.BlockedHuman("form_error", "synthetic", "review"))

    assert message == "LOCALISED form_error"
    monkeypatch.setattr(closer_notices, "stop_message", lambda *a, **k: (_ for _ in ()).throw(ValueError("x")))
    assert flow._notification_message(apply_flow.BlockedHuman("form_error", "synthetic", "review")).startswith(
        "CLOSER stopped before any blind retry."
    )


def test_conflicting_ats_markers_never_become_a_company_form(browser, cv_path, tmp_path):
    markers = '<div id="grnhse_app"></div><div class="ashby-application-form-field-entry"></div>'
    page = _site_page(browser, {"/jobs/7": CLASSIC.replace("<main>", "<main>" + markers, 1)})
    page.goto(f"{BASE}/jobs/7")

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ats_conflict")
    assert page.evaluate("window.submitCount") == 0
