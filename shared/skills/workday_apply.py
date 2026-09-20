#!/usr/bin/env python3
"""workday_apply.py — the CLOSER on Workday career sites (myworkdayjobs.com). [JHT-CLOSER-WORKDAY]

Position 1817 (14/09): a LinkedIn vacancy handed over to a Workday posting and
stopped as ats_unsupported with a blank screenshot.  Workday is a single-page
app: when the flow looked (DOM loaded, half a second later) nothing was drawn.

Read on a real posting, nothing typed and nothing sent: every application
starts with a mandatory "Create Account/Sign In" step (email, password, a box
consenting to the employer's terms), one account per employer.  The CLOSER
does not create accounts or accept terms for the user, so this module does
not apply yet: it waits for the page to render, then tells a closed posting
from an open one, without clicking anything.

- open posting (its Apply control is there)  → the recipe applies
- no Apply control and a closed-vacancy notice → vacancy_closed
- no Apply control, no notice                 → ats_unsupported (named detail)
- a page with content but no posting          → ats_unsupported
- nothing rendered in time                    → page_unavailable

The selectors are Workday's own data-automation-id attributes, stable across
tenants; the classes are generated.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ats_account  # noqa: E402
from apply_flow import BlockedHuman, vacancy_closed_evidence  # noqa: E402

RENDER_WAIT_MS = 15_000
_RENDERED = (
    "[data-automation-id='jobPostingHeader'], [data-automation-id='jobPostingPage'], "
    "[data-automation-id='applyFlowPage'], [data-automation-id='signInContent'], "
    "[data-automation-id='errorMessage']"
)
_APPLY = "[data-automation-id='adventureButton'], [data-automation-id='applyManually']"
_ACCOUNT = "[data-automation-id='signInContent'], [data-automation-id='createAccountSubmitButton']"


def stop_for(page, *, wait_ms: int = RENDER_WAIT_MS) -> BlockedHuman | None:
    """Why the CLOSER stops on this Workday page, or None when it can apply.

    Never clicks, never types: it waits for the single-page app and reads it.
    """
    try:
        page.locator(_RENDERED).first.wait_for(state="visible", timeout=wait_ms)
    except Exception:
        try:
            drawn = bool(page.locator("body").inner_text(timeout=5_000).strip())
        except Exception:
            drawn = False
        if drawn:
            # Content, but no Workday posting: never a company form on a
            # Workday host, and not a page that failed to load either.
            return BlockedHuman("ats_unsupported", "The Workday host shows no Workday posting", "detect")
        return BlockedHuman(
            "page_unavailable",
            f"The Workday page did not render its posting within {wait_ms // 1000} s",
            "detect",
        )
    if page.locator(f"{_ACCOUNT}, {_APPLY}").count():
        # An open posting: the recipe applies (the account step included).
        return None
    try:
        text = page.locator("body").inner_text(timeout=5_000)
    except Exception:
        text = ""
    language = vacancy_closed_evidence(text)
    if language:
        return BlockedHuman(
            "vacancy_closed",
            f"The Workday posting has no Apply control and says it is closed (notice language: {language})",
            "detect",
        )
    return BlockedHuman("ats_unsupported", "The Workday posting shows no Apply control", "detect")




# ── the application itself (operator's decision A, 14/09) ───────────────────
#
# Every Workday application starts with "Create Account/Sign In".  The CLOSER
# creates that account (ats_account: one per tenant, password saved before it
# is typed, never in a log or a screenshot) and accepts ONLY the account
# step's terms box.  The steps after it are walked one at a time; a step this
# recipe does not know stops the run with its name, and nothing is sent.

APPLY_START = "[data-automation-id='adventureButton']"
APPLY_MANUALLY = "[data-automation-id='applyManually']"
APPLY_FLOW = "[data-automation-id='applyFlowPage']"
SIGN_IN_CONTENT = "[data-automation-id='signInContent']"
ACCOUNT_FIELDS = {
    "email": "[data-automation-id='email']",
    "password": "[data-automation-id='password']",
    "verify": "[data-automation-id='verifyPassword']",
    "consent": "[data-automation-id='createAccountCheckbox']",
    "create": "[data-automation-id='createAccountSubmitButton']",
    "sign_in_link": "[data-automation-id='signInLink']",
    "sign_in_submit": "[data-automation-id='signInSubmitButton'], [data-automation-id='click_filter'] button[type=submit]",
    "create_link": "[data-automation-id='createAccountLink']",
}
ERRORS = "[data-automation-id='errorMessage'], [data-automation-id='inlineError'], [role=alert]"
PROGRESS_STEP = "[data-automation-id='progressBarActiveStep']"
ACCOUNT_STEP_NAMES = re.compile(r"create account|sign in|crea account|accedi|konto|anmelden|compte|cuenta|conta", re.I)


def _text(locator, limit: int = 300) -> str:
    try:
        return " ".join((locator.inner_text() or "").split())[:limit]
    except Exception:
        return ""


class WorkdayRecipe:
    """Workday's five-step application; today it opens it and owns the account step."""

    PLATFORM = "workday"
    VENDOR = "Workday"
    FORM = APPLY_FLOW
    FIELD_ENTRY = "[data-automation-id^='formField-']"
    SUBMIT = "[data-automation-id='bottom-navigation-next-button']:has-text('Submit')"
    SUCCESS = "[data-automation-id='applicationSubmitted'], [data-automation-id='confirmationPage']"
    CONFIRMATION_MARKERS = ("your application has been submitted", "application submitted")

    def __init__(self, profile, cv_path):
        self.profile = dict(profile or {})
        self.cv_path = Path(cv_path)
        self.answer_sources: dict[str, str] = {}
        self.answer_origins: dict[str, str] = {}
        self.jht_home = Path.home() / ".jht"
        self.url = ""
        self.credentials = None
        self.consent = None
        self.pre_submit_screenshot_path = ""

    def attach(self, flow) -> None:
        self.jht_home = flow._jht_home()
        self.url = flow.url

    # ── the posting ──────────────────────────────────────────────────────────

    def form_present(self, page) -> bool:
        return page.locator(APPLY_FLOW).count() > 0

    def apply_control_present(self, page) -> bool:
        return page.locator(f"{APPLY_START}, {APPLY_MANUALLY}, {APPLY_FLOW}").count() > 0

    def dom_match(self, page) -> bool:
        return page.locator(f"{APPLY_FLOW}, {SIGN_IN_CONTENT}").count() > 0

    def open_form(self, page) -> None:
        """Apply → Apply Manually → the account step, and no further for now."""
        blocked = stop_for(page)
        if blocked is not None:
            raise blocked
        if not page.locator(APPLY_FLOW).count():
            start = page.locator(APPLY_START)
            if not start.count():
                raise stop_for(page) or BlockedHuman(
                    "workday_apply_control_missing", "The Workday posting shows no Apply control", "detect"
                )
            start.first.click(timeout=15_000)
            manual = page.locator(APPLY_MANUALLY)
            try:
                manual.first.wait_for(state="visible", timeout=10_000)
            except Exception as exc:
                raise BlockedHuman(
                    "workday_apply_start_unrecognised",
                    "Workday's Start Your Application dialog did not offer Apply Manually",
                    "detect",
                ) from exc
            manual.first.click(timeout=15_000)
        try:
            page.locator(f"{APPLY_FLOW}, {SIGN_IN_CONTENT}").first.wait_for(state="visible", timeout=RENDER_WAIT_MS)
        except Exception as exc:
            raise BlockedHuman("workday_apply_flow_missing", "Workday did not open its application flow", "detect") from exc
        self.account_step(page)

    # ── step 1 of 5: the candidate account ───────────────────────────────────

    def tenant(self) -> str:
        return ats_account.tenant_id(self.PLATFORM, self.url or "")

    def account_step(self, page) -> None:
        """Sign in with the saved account, or create one; only the terms box is ticked."""
        if not page.locator(SIGN_IN_CONTENT).count():
            return  # already signed in: the flow is past its first step
        tenant = self.tenant()
        try:
            saved = ats_account.load(self.jht_home, tenant)
            if saved is not None:
                self._sign_in(page, saved)
            else:
                self._create_account(page, tenant)
        except ats_account.AccountStop as stop:
            raise BlockedHuman(stop.reason, stop.detail, "detect") from None
        self._assert_account_accepted(page)

    def _field(self, page, name: str, *, required: bool = True):
        control = page.locator(ACCOUNT_FIELDS[name])
        if control.count() != 1 or not control.first.is_visible():
            if not required:
                return None
            raise BlockedHuman(
                "workday_account_form_unrecognised",
                f"The Workday account step has no single {name} field",
                "detect",
            )
        return control.first

    def _email(self) -> str:
        contacts = self.profile.get("contacts") if isinstance(self.profile.get("contacts"), Mapping) else {}
        email = (contacts or {}).get("email") or self.profile.get("email")
        return str(email or "").strip()

    def _sign_in(self, page, credentials) -> None:
        link = self._field(page, "sign_in_link", required=False)
        if link is not None and page.locator(ACCOUNT_FIELDS["verify"]).count():
            link.click(timeout=10_000)  # the page opened on Create Account
            page.wait_for_timeout(500)
        self._field(page, "email").fill(credentials.email)
        ats_account.fill_secret(self._field(page, "password"), credentials.password)
        submit = self._field(page, "sign_in_submit", required=False) or self._field(page, "create")
        submit.click(timeout=15_000)
        page.wait_for_timeout(1_500)
        self.credentials = credentials

    def _create_account(self, page, tenant: str) -> None:
        email = self._email()
        credentials = ats_account.create_pending(self.jht_home, tenant, email)
        self.credentials = credentials
        self._field(page, "email").fill(credentials.email)
        ats_account.fill_secret(self._field(page, "password"), credentials.password)
        verify = self._field(page, "verify", required=False)
        if verify is not None:
            ats_account.fill_secret(verify, credentials.password)
        consent = self._field(page, "consent")
        terms = _text(page.locator(SIGN_IN_CONTENT).first, 500)
        consent.check(timeout=10_000)
        if not consent.is_checked():
            raise BlockedHuman("workday_terms_not_accepted", "The Workday terms box could not be ticked", "detect")
        self.consent = ats_account.consent_record(tenant, terms, self.url)
        self._field(page, "create").click(timeout=15_000)
        page.wait_for_timeout(1_500)

    def _assert_account_accepted(self, page) -> None:
        """The portal's answer to the account step: a stop, or the flow's next step."""
        errors = _text(page.locator(ERRORS).first) if page.locator(ERRORS).count() else ""
        if errors and ats_account.email_in_use(errors):
            stop = ats_account.email_in_use_stop(self.tenant())
            raise BlockedHuman(stop.reason, stop.detail, "detect")
        if errors:
            raise BlockedHuman("workday_account_refused", f"Workday refused the account step: {errors[:200]}", "detect")
        if page.locator(SIGN_IN_CONTENT).count():
            body = _text(page.locator("body").first, 1_000)
            if re.search(r"verif|conferma|bestätig|vérif|verificación|verificação", body, re.I):
                raise BlockedHuman(
                    "workday_account_verification_required",
                    "Workday asks to verify the account's email before the application continues",
                    "detect",
                )
            raise BlockedHuman(
                "workday_account_not_accepted",
                "Workday stayed on its account step after the account was submitted",
                "detect",
            )
        if self.credentials is not None:
            self.credentials = ats_account.mark_active(self.jht_home, self.credentials)

    # ── the steps after the account: not walked yet ──────────────────────────

    def _step_name(self, page) -> str:
        step = page.locator(PROGRESS_STEP)
        return _text(step.first, 120) if step.count() else ""

    def _unsupported_step(self, step: str) -> BlockedHuman:
        name = self._step_name_or_default(step)
        return BlockedHuman(
            "workday_step_unsupported",
            f"The Workday application went past its account step ({name}); the CLOSER does not fill those steps yet",
            step,
        )

    @staticmethod
    def _step_name_or_default(step: str) -> str:
        return step or "after the account"

    def fill_core(self, page) -> None:
        raise self._unsupported_step(self._step_name(page) or "fill")

    def upload_cv(self, page) -> None:  # pragma: no cover - fill_core stops first
        raise self._unsupported_step("upload_cv")

    def fill_screening(self, page) -> None:  # pragma: no cover - fill_core stops first
        raise self._unsupported_step("screening")

    def review(self, page) -> None:  # pragma: no cover - fill_core stops first
        raise self._unsupported_step("review")

    def submit(self, page) -> None:  # pragma: no cover - fill_core stops first
        raise self._unsupported_step("submit")

    @staticmethod
    def _challenge_reason(page) -> str:
        return ""
