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
    flow = ApplicationFlow(
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
    flow.GENERIC_RENDER_WAIT_MS = 3_000  # a page with nothing to apply with waits this long in tests
    return flow


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
    # Sibling subdomains of one company are one site, as for the recipe.
    apply_flow.ApplicationFlow._assert_recipe_page(Page(), "generic", "fill", application_url="https://careers.example.com/7")
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

    assert (result.status, result.reason) == ("blocked_human", "generic_form_missing")
    assert deferred == [(81, "generic_form_missing", "https://careers.example.invalid/x")]
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

    assert result.reason == "generic_form_missing"
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


def test_after_the_click_a_thank_you_next_to_a_submit_phrase_is_not_a_receipt(browser, cv_path, tmp_path):
    ambiguous = CLASSIC.replace(
        "document.body.innerHTML = '<main><h1>Thank you for your application!</h1></main>';",
        "document.body.innerHTML = '<main><h1>Thank you for your application!</h1><p>Apply now to another role</p></main>';",
    )
    assert ambiguous != CLASSIC
    page = _site_page(browser, {"/jobs/7": ambiguous})
    page.goto(f"{BASE}/jobs/7")
    recorded: list = []

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7", recorded=recorded).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "submit_outcome_unknown")
    assert page.evaluate("window.submitCount") == 1 and recorded == []


def test_a_company_form_rendered_after_load_is_still_applied_to(browser, cv_path, tmp_path):
    # 2071 (14/09): a look right after load saw no form, and the company-form
    # recipe was never tried. The page builds its form 1.5 s later.
    body = CLASSIC.split("<body>", 1)[1].split("</body>", 1)[0]
    late = (
        "<html><body><main id='root'>Loading…</main><script>"
        f"setTimeout(() => {{ document.body.innerHTML = {json.dumps(body).replace('</', '<\\/')};"
        " document.querySelectorAll('script').forEach(old => { const s = document.createElement('script');"
        " s.textContent = old.textContent; old.replaceWith(s); }); }, 1500);"
        "</script></body></html>"
    )
    page = _site_page(browser, {"/jobs/7": late})
    page.goto(f"{BASE}/jobs/7")
    recorded: list = []

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7", recorded=recorded).run(page=page, navigate=False)

    assert result.status == "applied", result
    assert json.loads((tmp_path / ".cache" / "apply-flow" / "81.json").read_text())["platform"] == "generic"


def test_a_vendor_name_in_the_markup_of_a_company_host_is_not_a_known_ats(browser, cv_path, tmp_path):
    marked = CLASSIC.replace("<main>", '<main><script src="/resources/sap-ui-core.js"></script>', 1)
    page = _site_page(browser, {"/jobs/7": marked})
    page.goto(f"{BASE}/jobs/7")

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7").run(page=page, navigate=False)

    assert result.status == "applied", result


def test_a_company_page_with_nothing_to_apply_with_stops_with_the_recipes_own_reason(browser, cv_path, tmp_path):
    page = browser.new_page()
    page.set_content("<html><body><h1>About us</h1><p>We build things.</p></body></html>")

    result = build_flow(tmp_path, cv_path, "https://careers.example.invalid/x").run(page=page, navigate=False)

    # 2071, 1798 (14/09): the slug was in the detail, the reason said ats_unsupported.
    assert (result.status, result.reason) == ("blocked_human", "generic_form_missing")
    saved = json.loads((tmp_path / ".cache" / "apply-flow" / "81.json").read_text())
    assert saved["blocked_reason"] == "generic_form_missing"


def test_a_missing_company_form_recipe_is_logged_never_silent(browser, cv_path, tmp_path, monkeypatch, caplog):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    monkeypatch.setitem(sys.modules, "apply_generic", None)
    monkeypatch.setitem(sys.modules, "shared.skills.apply_generic", None)

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ats_unsupported")
    assert "company-form recipe unavailable:" in caplog.text and "apply_generic" in caplog.text
    assert page.evaluate("window.submitCount") == 0
