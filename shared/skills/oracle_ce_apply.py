#!/usr/bin/env python3
"""Oracle Recruiting Cloud (Candidate Experience): the identity step, then the application form.

Why. 1944 (14/09): the DNV vacancy's Apply leads to
…oraclecloud.com/hcmUI/CandidateExperience/…/job/7406/apply/email, and the
CLOSER had no recipe for it. Read only, from outside the box, the first step
is:

    "Let's get started" · What's your email? · a hidden "honey-pot" field ·
    "I agree with the terms and conditions" · Next

and the site's own cookie banner (ACCEPT / DECLINE). Oracle identifies a
candidate by email plus a one-time PIN sent to that email; the application
form itself follows. Only that first step was seen: everything after it is
read from the page as it comes, and anything this recipe cannot name stops
with a reason instead of a guess.

What it will not do:
- fill the honey-pot: an anti-bot trap that must stay empty, checked before
  every step forward;
- tick anything but the step's own required terms box;
- type the candidate's email in a dry run: that sends them a PIN for an
  application nobody asked for;
- solve a captcha, or guess a step it does not recognise.

The application form, once open, is read and filled by the company-form
machinery (apply_generic): labels, saved answers, the CLOSER's questions.
"""

from __future__ import annotations

import contextlib
import re
from typing import Any

try:
    import cookie_consent
except ImportError:  # pragma: no cover - package import
    from shared.skills import cookie_consent  # type: ignore[no-redef]

try:
    from apply_flow import BlockedHuman, FlowDeferred, _safe_label
except ImportError:  # pragma: no cover - package import
    from shared.skills.apply_flow import BlockedHuman, FlowDeferred, _safe_label  # type: ignore[no-redef]

try:
    from apply_generic import GenericRecipe
except ImportError:  # pragma: no cover - package import
    from shared.skills.apply_generic import GenericRecipe  # type: ignore[no-redef]

try:
    from profile_facts import profile_value
except ImportError:  # pragma: no cover - package import
    from shared.skills.profile_facts import profile_value  # type: ignore[no-redef]

PLATFORM = "oracle_ce"

# The identity step of the candidate site.
EMAIL_FIELD = "input#primary-email, input[name='primary-email'], form input[type=email]"
HONEYPOT = "input[name*='honey' i], input[id*='honey' i], input[class*='honey' i]"
TERMS_BOX = (
    "input[type=checkbox]#legal-disclaimer-checkbox, input[type=checkbox][id*='disclaimer' i],"
    " input[type=checkbox][id*='terms' i], input[type=checkbox][name*='terms' i]"
)
CODE_FIELD = (
    "input[autocomplete='one-time-code'], input[id*='pin' i], input[id*='verification' i],"
    " input[id*='code' i], input[name*='code' i]"
)
_FORWARD = re.compile(
    r"^\s*(?:next|continue|submit|avanti|continua|weiter|suivant|continuer|siguiente|continuar|tovább|folytatás)\s*$",
    re.I,
)
_CODE_SCREEN = re.compile(
    r"one[- ]time (?:pin|code)|verification code|enter the (?:code|pin)|we (?:sent|emailed) (?:you )?a (?:code|pin)"
    r"|codice (?:di verifica|monouso)|c[oó]digo de verificaci[oó]n|code de v[ée]rification|verifizierungscode"
    r"|c[oó]digo de verifica[cç][aã]o|ellenőrző kód",
    re.I,
)
_IDENTITY_SCREEN = re.compile(
    r"let'?s get started|what'?s your email|authentication screen|sign in to (?:apply|continue)",
    re.I,
)

MAX_STEPS = 6
STEP_WAIT_MS = 15_000


class OracleCERecipe(GenericRecipe):
    PLATFORM = PLATFORM
    SECURITY_CODE_SENDERS = ("oraclecloud.com", "oracle.com")
    CODE_SHAPE = "digits6"

    def __init__(self, profile: Any = None, cv_path: Any = None):
        super().__init__(profile, cv_path)
        # This recipe is only ever reached through the vacancy's Apply control.
        self.via_apply = True
        self.dry_run = False
        self.identity_email = ""
        self.consent: dict[str, str] | None = None
        self._flow = None

    # ── the flow's handles (the code channel needs the database and the user) ──

    def attach(self, flow) -> None:
        self._flow = flow
        self.dry_run = getattr(flow, "_mode", "") == "dry_run"

    # ── steps of the candidate site ──

    @staticmethod
    def _visible(page, selector: str):
        found = page.locator(selector)
        for index in range(found.count()):
            control = found.nth(index)
            with contextlib.suppress(Exception):
                if control.is_visible():
                    return control
        return None

    @staticmethod
    def _text(page) -> str:
        try:
            return " ".join((page.locator("body").inner_text(timeout=5_000) or "").split())
        except Exception:
            return ""

    @classmethod
    def identity_screen(cls, page) -> bool:
        return bool(cls._visible(page, EMAIL_FIELD)) and bool(
            _IDENTITY_SCREEN.search(cls._text(page)) or cls._visible(page, TERMS_BOX)
        )

    @classmethod
    def security_code_screen(cls, page) -> bool:
        """The PIN screen, for this recipe and for the flow's post-submit path."""
        return bool(cls._visible(page, CODE_FIELD)) and bool(_CODE_SCREEN.search(cls._text(page)))

    @classmethod
    def enter_security_code(cls, page, code: str) -> None:
        field = cls._visible(page, CODE_FIELD)
        if field is None:
            raise BlockedHuman("oracle_ce_code_field_missing", "The code screen has no field to type the code in", "submit")
        field.fill(code)

    @classmethod
    def clear_security_code(cls, page) -> None:
        field = cls._visible(page, CODE_FIELD)
        if field is not None:
            with contextlib.suppress(Exception):
                field.fill("")

    @classmethod
    def _challenge_reason(cls, page) -> str:
        """Oracle's own one-time code is a step of this recipe, not a human stop.

        Everything else the company-form recipe calls a challenge (a captcha, a
        login, an account) still stops.
        """
        reason = GenericRecipe._challenge_reason(page)
        if reason == "two_factor" and cls.security_code_screen(page):
            return ""
        return reason

    def _assert_honeypot_empty(self, page) -> None:
        """The trap field must be empty: the CLOSER never types in it, and a page
        that arrives with it filled is not a page to send anything from."""
        traps = page.locator(HONEYPOT)
        for index in range(traps.count()):
            value = ""
            with contextlib.suppress(Exception):  # only the reading may fail, never the stop
                value = traps.nth(index).input_value() or ""
            if value.strip():
                raise BlockedHuman(
                    "oracle_ce_honeypot_filled",
                    "The anti-bot field of the application page is not empty",
                    "detect",
                )

    def _forward(self, page) -> Any:
        buttons = page.locator("button, input[type=submit], a[role=button]")
        for index in range(buttons.count()):
            control = buttons.nth(index)
            try:
                if not control.is_visible():
                    continue
                label = " ".join(
                    ((control.inner_text() or "") + " " + (control.get_attribute("aria-label") or "")).split()
                )
            except Exception:
                continue
            if _FORWARD.match(label) or _FORWARD.match(label.split("\n")[0]):
                return control
        return None

    def _identity_step(self, page) -> None:
        if self.dry_run:
            # A dry run only looks: typing the email would send the user a PIN
            # for an application nobody asked for.
            raise FlowDeferred(
                "oracle_ce_dry_run_identity",
                "A dry run does not identify the candidate on Oracle: the site would email a one-time code",
            )
        email = profile_value(self.profile, "email")
        if not email:
            raise BlockedHuman(
                "required_profile_field_missing",
                "Oracle asks for the candidate's email and the profile states none",
                "detect",
            )
        self._assert_honeypot_empty(page)
        field = self._visible(page, EMAIL_FIELD)
        field.fill(email)
        if (field.input_value() or "").strip().casefold() != email.strip().casefold():
            raise BlockedHuman("answer_not_accepted", "Oracle did not keep the candidate's email", "detect")
        self.identity_email = email
        terms = self._visible(page, TERMS_BOX)
        if terms is not None:
            terms.check()
            self.consent = {"terms_text": _safe_label(self._terms_label(page)), "step": "identity"}
        forward = self._forward(page)
        if forward is None:
            raise BlockedHuman("oracle_ce_step_unrecognised", "The identity step has no control to go on with", "detect")
        self._assert_honeypot_empty(page)
        forward.click(timeout=10_000)

    @staticmethod
    def _terms_label(page) -> str:
        with contextlib.suppress(Exception):
            label = page.locator("label[for='legal-disclaimer-checkbox'], label:has(input[type=checkbox])").first
            if label.count():
                return label.inner_text(timeout=2_000) or ""
        return ""

    def _code_step(self, page) -> None:
        flow = self._flow
        if flow is None:
            raise BlockedHuman(
                "oracle_ce_code_unavailable",
                "Oracle asks for a one-time code and this run has no channel to get it",
                "detect",
            )
        try:
            import verification_code
        except ImportError:  # pragma: no cover - package import
            from shared.skills import verification_code  # type: ignore[no-redef]
        try:
            code = flow.site_verification_code(self, shape=self.CODE_SHAPE)
        except verification_code.CodeUnavailable as missing:
            raise BlockedHuman(
                "oracle_ce_code_unavailable",
                f"No usable one-time code ({missing.reason}): {missing.detail}",
                "detect",
            ) from None
        try:
            self.enter_security_code(page, code)
        finally:
            del code
        forward = self._forward(page)
        if forward is None:
            raise BlockedHuman("oracle_ce_step_unrecognised", "The code screen has no control to go on with", "detect")
        forward.click(timeout=10_000)

    def open_form(self, page) -> None:
        self.application_url = self.application_url or page.url
        cookie_consent.dismiss(page)
        for _ in range(MAX_STEPS):
            challenge = self._challenge_reason(page)
            if challenge:
                raise BlockedHuman(challenge, f"The site requires human intervention ({challenge})", "detect")
            if self.form_present(page):
                self._assert_honeypot_empty(page)
                self._form(page, "detect")
                return
            if self.identity_screen(page):
                self._identity_step(page)
            elif self.security_code_screen(page):
                self._code_step(page)
            else:
                raise BlockedHuman(
                    "oracle_ce_step_unrecognised",
                    f"Oracle shows a step this recipe does not know ({_safe_label(self._step_name(page))})",
                    "detect",
                )
            page.wait_for_timeout(1_000)
            self._settle(page)
            cookie_consent.dismiss(page)
        raise BlockedHuman(
            "oracle_ce_step_unrecognised",
            f"Oracle's application did not reach a form in {MAX_STEPS} steps",
            "detect",
        )

    @staticmethod
    def _step_name(page) -> str:
        """What to call the step in a stop: its heading, its title, or its address."""
        with contextlib.suppress(Exception):
            heading = page.locator("h1, h2").first
            if heading.count():
                text = " ".join((heading.inner_text(timeout=2_000) or "").split())
                if text:
                    return text
        with contextlib.suppress(Exception):
            title = page.title()
            if title:
                return title
        return str(getattr(page, "url", ""))

    def _settle(self, page) -> None:
        deadline = STEP_WAIT_MS
        while deadline > 0:
            if self.form_present(page) or self.identity_screen(page) or self.security_code_screen(page):
                return
            page.wait_for_timeout(250)
            deadline -= 250

    def upload_cv(self, page) -> None:
        self._assert_honeypot_empty(page)
        super().upload_cv(page)

    def review(self, page) -> None:
        self._assert_honeypot_empty(page)
        super().review(page)
