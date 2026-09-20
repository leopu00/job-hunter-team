#!/usr/bin/env python3
"""iCIMS candidate portal: the email step with its GDPR consent, the account, then the application.

Why. 1843 (14/09): the AXA vacancy's APLICAR leads to
careers-<tenant>.icims.com/jobs/<id>/login, and the CLOSER had no recipe for
it. Read only, from outside the box (page fetched 20/09), the first step is a
single form:

    <form id="enterEmailForm">
      <input type="email" id="email" name="css_loginName">
      <select id="gdpr_consent_type">  ← two consents, see below
      <input type="checkbox" id="accept_gdpr">  "I accept the privacy notice"
      <input type="submit" id="enterEmailSubmitButton" value="Siguiente">

plus an hCaptcha the page creates with `data-size: invisible` and executes on
submit. The two consents were, in the vacancy's own words: one that also
allows the company to write about *future opportunities*, and one limited to
*this position only*, with the data deleted afterwards. The operator's
decision (14/09) is the second one, always.

Everything after the email step — a password, a new account, whatever iCIMS
shows this tenant — was never seen without sending the email, so it is read
from the page as it comes: what this recipe cannot name stops with a reason
instead of a guess.

What it will not do:
- pick the consent that also covers future opportunities or a talent
  community, or invent one when neither says "this position only";
- tick anything but the portal's own required privacy box;
- type the candidate's email in a dry run: it starts an account they did not
  ask for;
- try a captcha: a visible hCaptcha challenge stops the run at once, with no
  attempt (operator's decision, 14/09);
- reset a password, or keep the account object anywhere it could be
  serialised — a checkpoint, a receipt, a notice (SICUREZZA, 20/09).
"""

from __future__ import annotations

import contextlib
import os
import re
from pathlib import Path
from typing import Any

try:
    import ats_account
except ImportError:  # pragma: no cover - package import
    from shared.skills import ats_account  # type: ignore[no-redef]

try:
    import cookie_consent
except ImportError:  # pragma: no cover - package import
    from shared.skills import cookie_consent  # type: ignore[no-redef]

try:
    from apply_flow import BlockedHuman, FlowDeferred, _safe_label
except ImportError:  # pragma: no cover - package import
    from shared.skills.apply_flow import (  # type: ignore[no-redef]
        BlockedHuman,
        FlowDeferred,
        _safe_label,
    )

try:
    from apply_generic import GenericRecipe
except ImportError:  # pragma: no cover - package import
    from shared.skills.apply_generic import GenericRecipe  # type: ignore[no-redef]

try:
    from profile_facts import profile_value
except ImportError:  # pragma: no cover - package import
    from shared.skills.profile_facts import profile_value  # type: ignore[no-redef]

PLATFORM = "icims"

CONTENT_FRAME = "iframe#icims_content_iframe, iframe[src*='icims.com']"
EMAIL_FORM = "form#enterEmailForm"
EMAIL_FIELD = "input#email, input[name='css_loginName'], form input[type=email]"
GDPR_SELECT = "select#gdpr_consent_type, select[name='gdpr_consent_type'], select[id*='consent' i]"
PRIVACY_BOX = (
    "input[type=checkbox]#accept_gdpr, input[type=checkbox][name='accept_gdpr'],"
    " input[type=checkbox][id*='gdpr' i], input[type=checkbox][id*='privacy' i]"
)
PASSWORD_FIELD = "input[type=password]"
FORWARD = (
    "#enterEmailSubmitButton, form input[type=submit], form button[type=submit],"
    " form button:not([type=button]), input.iCIMS_PrimaryButton"
)
HONEYPOT = "input[name*='honey' i], input[id*='honey' i], input[class*='honey' i]"

# A consent that also covers anything beyond this vacancy is never the one.
_FUTURE_CONSENT = re.compile(
    r"futur|future|futuras|futuros|próxim|prossim|weiter|zukünftig|jövőbeli|toekomstig"
    r"|opportunit|oportunidad|oportunidade|vacancies|vacantes|stellenangebot"
    r"|talent (?:pool|network|community)|comunidad|communit|newsletter|marketing"
    r"|banco de (?:talentos|curr)|base de datos|adatbázis",
    re.I,
)
# …and the one that is limited to it says so.
_ONLY_THIS = re.compile(
    r"\b(?:only|solo|sólo|solamente|soltanto|unicamente|únicamente|apenas|seulement|uniquement|nur|csak)\b",
    re.I,
)
_THIS_POSITION = re.compile(
    r"this (?:position|job|vacancy|role|application)|esta (?:posición|posicion|vacante|oferta|candidatura)"
    r"|questa (?:posizione|candidatura)|esta (?:posição|vaga|candidatura)|ce poste|cette (?:offre|candidature)"
    r"|diese (?:stelle|position|bewerbung)|erre az állásra|ezen (?:pozíció|állás)",
    re.I,
)
_CREATE_ACCOUNT = re.compile(
    r"create (?:an? )?(?:account|profile|password)|set (?:up )?(?:a )?password|confirm (?:your )?password"
    r"|crear (?:una )?(?:cuenta|contraseña)|confirmar contraseña|crea (?:un )?account|conferma password"
    r"|criar (?:uma )?(?:conta|palavra-passe)|créer (?:un )?(?:compte|mot de passe)|konto erstellen|passwort erstellen"
    r"|fiók létrehozása",
    re.I,
)

MAX_STEPS = 6
STEP_WAIT_MS = 15_000


class ICIMSRecipe(GenericRecipe):
    PLATFORM = PLATFORM
    SECURITY_CODE_SENDERS = ("icims.com",)
    CODE_SHAPE = "digits6"

    def __init__(self, profile: Any = None, cv_path: Any = None):
        super().__init__(profile, cv_path)
        # This recipe is only ever reached through the vacancy's Apply control.
        self.via_apply = True
        self.dry_run = False
        self.identity_email = ""
        self.consent: dict[str, str] | None = None
        # The tenant, never the credentials: the object with the password must
        # not reach a checkpoint, a receipt or a notice.
        self.account_tenant = ""
        self.account_state = ""
        self._flow = None

    # ── the flow's handles ──

    def attach(self, flow) -> None:
        self._flow = flow
        self.dry_run = getattr(flow, "_mode", "") == "dry_run"

    def _home(self) -> Path:
        home = getattr(self._flow, "_jht_home", None)
        if callable(home):
            with contextlib.suppress(Exception):
                return Path(home())
        return Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")

    # ── reading the page ──

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
    def _all_visible(page, selector: str) -> list[Any]:
        found = page.locator(selector)
        controls = []
        for index in range(found.count()):
            control = found.nth(index)
            with contextlib.suppress(Exception):
                if control.is_visible():
                    controls.append(control)
        return controls

    @staticmethod
    def _text(page) -> str:
        try:
            return " ".join((page.locator("body").inner_text(timeout=5_000) or "").split())
        except Exception:
            return ""

    @classmethod
    def email_screen(cls, page) -> bool:
        if page.locator(EMAIL_FORM).count():
            return True
        return bool(cls._visible(page, EMAIL_FIELD)) and bool(
            cls._visible(page, GDPR_SELECT) or cls._visible(page, PRIVACY_BOX)
        )

    @classmethod
    def account_screen(cls, page) -> bool:
        return bool(cls._visible(page, PASSWORD_FIELD))

    def _enter_content(self, page) -> bool:
        """iCIMS inside the company page lives in its own iframe: go to it directly.

        Same host as the portal itself, so the flow's redirect guard keeps
        holding; working in the top document keeps every later step (the form
        machinery of apply_generic) on one page.
        """
        if self.email_screen(page) or self.account_screen(page) or self.form_present(page):
            return False
        frames = page.locator(CONTENT_FRAME)
        for index in range(frames.count()):
            source = (frames.nth(index).get_attribute("src") or "").strip()
            if not source:
                continue
            target = source if source.startswith("http") else f"https:{source}" if source.startswith("//") else ""
            if "icims.com" not in target:
                continue
            page.goto(self.url_guard(target), wait_until="domcontentloaded", timeout=30_000)
            return True
        return False

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
                    "icims_honeypot_filled",
                    "The anti-bot field of the application page is not empty",
                    "detect",
                )

    def _assert_no_challenge(self, page, step: str) -> None:
        """iCIMS runs an invisible hCaptcha on submit; when it turns into a
        challenge the run stops there, with no attempt (operator, 14/09)."""
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"The site requires human intervention ({challenge})", step)

    # ── the email step, with its consent ──

    @staticmethod
    def _options(select) -> list[tuple[str, str]]:
        raw = select.evaluate("element => Array.from(element.options).map(o => [o.value, o.textContent || ''])")
        return [(str(value or ""), " ".join(str(text or "").split())) for value, text in raw]

    @classmethod
    def position_only_consent(cls, options: list[tuple[str, str]]) -> tuple[str, str]:
        """The consent limited to this vacancy, never one that also covers more.

        Raises when no option says so, or when two do and nothing tells them
        apart: a consent given by guesswork is not a consent.
        """
        usable = [(value, text) for value, text in options if value and text]
        limited = [(value, text) for value, text in usable if not _FUTURE_CONSENT.search(text)]
        if len(limited) > 1:
            explicit = [
                (value, text) for value, text in limited if _ONLY_THIS.search(text) and _THIS_POSITION.search(text)
            ]
            limited = explicit or limited
        if len(limited) != 1:
            raise BlockedHuman(
                "icims_gdpr_option_unknown",
                f"The portal's data-protection consent has {len(limited)} options limited to this position "
                f"out of {len(usable)}: the CLOSER never guesses a consent",
                "detect",
            )
        return limited[0]

    def _consent_step(self, page) -> None:
        select = self._visible(page, GDPR_SELECT)
        terms = ""
        if select is not None:
            value, text = self.position_only_consent(self._options(select))
            select.select_option(value)
            if (select.input_value() or "") != value:
                raise BlockedHuman("answer_not_accepted", "The portal did not keep the chosen consent", "detect")
            terms = text
        box = self._visible(page, PRIVACY_BOX)
        if box is not None:
            box.check()
            terms = f"{terms} · {_safe_label(self._box_label(page, box))}".strip(" ·")
        if terms:
            self.consent = ats_account.consent_record(
                self.account_tenant or ats_account.tenant_id(PLATFORM, page.url), terms
            )

    @staticmethod
    def _box_label(page, box) -> str:
        with contextlib.suppress(Exception):
            identifier = box.get_attribute("id") or ""
            if identifier:
                label = page.locator(f"label[for='{identifier}']").first
                if label.count():
                    return label.inner_text(timeout=2_000) or ""
        return ""

    def _email_step(self, page) -> None:
        if self.dry_run:
            # A dry run only looks: the email starts a candidate account on the
            # portal, for an application nobody asked for.
            raise FlowDeferred(
                "icims_dry_run_identity",
                "A dry run does not identify the candidate on iCIMS: the portal would start an account",
            )
        email = profile_value(self.profile, "email")
        if not email:
            raise BlockedHuman(
                "required_profile_field_missing",
                "iCIMS asks for the candidate's email and the profile states none",
                "detect",
            )
        self._assert_honeypot_empty(page)
        self._assert_no_challenge(page, "detect")
        self.account_tenant = ats_account.tenant_id(PLATFORM, page.url)
        field = self._visible(page, EMAIL_FIELD)
        field.fill(email)
        if (field.input_value() or "").strip().casefold() != email.strip().casefold():
            raise BlockedHuman("answer_not_accepted", "iCIMS did not keep the candidate's email", "detect")
        self.identity_email = email
        self._consent_step(page)
        self._forward(page, "the email step")

    # ── the account step ──

    def _account_step(self, page) -> None:
        text = self._text(page)
        self._assert_honeypot_empty(page)
        self._assert_no_challenge(page, "detect")
        email = self.identity_email or profile_value(self.profile, "email") or ""
        tenant = self.account_tenant or ats_account.tenant_id(PLATFORM, page.url)
        self.account_tenant = tenant
        boxes = self._all_visible(page, PASSWORD_FIELD)
        try:
            saved = ats_account.load(self._home(), tenant)
        except ats_account.AccountStop as unsafe:
            raise BlockedHuman(unsafe.reason, unsafe.detail, "detect") from None
        creating = len(boxes) > 1 or bool(_CREATE_ACCOUNT.search(text))
        try:
            if saved is None:
                if not creating or ats_account.email_in_use(text):
                    # The portal knows this email and we hold no password for it:
                    # the CLOSER never resets one.
                    stop = ats_account.email_in_use_stop(tenant)
                    raise BlockedHuman(stop.reason, stop.detail, "detect")
                try:
                    saved = ats_account.create_pending(self._home(), tenant, email)
                except ats_account.AccountStop as refused:
                    raise BlockedHuman(refused.reason, refused.detail, "detect") from None
            for box in boxes[:2]:
                ats_account.fill_secret(box, saved.password)
            self.account_state = saved.state
        finally:
            saved = None
        self._forward(page, "the account step")

    def account_accepted(self, page) -> None:
        """Past the account step: keep the saved account as the one the portal knows."""
        if not self.account_tenant or self.account_state == ats_account.ACTIVE:
            return
        with contextlib.suppress(Exception):
            credentials = ats_account.load(self._home(), self.account_tenant)
            if credentials is not None:
                ats_account.mark_active(self._home(), credentials)
                self.account_state = ats_account.ACTIVE

    # ── walking the portal ──

    def _forward(self, page, step_name: str) -> None:
        control = self._visible(page, FORWARD)
        if control is None:
            raise BlockedHuman(
                "icims_step_unrecognised", f"{step_name} has no control to go on with", "detect"
            )
        self._assert_honeypot_empty(page)
        control.click(timeout=10_000)

    def open_form(self, page) -> None:
        self.application_url = self.application_url or page.url
        cookie_consent.dismiss(page)
        self._enter_content(page)
        cookie_consent.dismiss(page)
        for _ in range(MAX_STEPS):
            self._assert_no_challenge(page, "detect")
            if self.email_screen(page):
                self._email_step(page)
            elif self.account_screen(page):
                self._account_step(page)
            elif self.form_present(page):
                self.account_accepted(page)
                self._assert_honeypot_empty(page)
                self._form(page, "detect")
                return
            else:
                raise BlockedHuman(
                    "icims_step_unrecognised",
                    f"iCIMS shows a step this recipe does not know ({_safe_label(self._step_name(page))})",
                    "detect",
                )
            page.wait_for_timeout(1_000)
            self._settle(page)
            cookie_consent.dismiss(page)
        raise BlockedHuman(
            "icims_step_unrecognised",
            f"The iCIMS portal did not reach a form in {MAX_STEPS} steps",
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
            if self.form_present(page) or self.email_screen(page) or self.account_screen(page):
                return
            page.wait_for_timeout(250)
            deadline -= 250

    def upload_cv(self, page) -> None:
        self._assert_honeypot_empty(page)
        super().upload_cv(page)

    def review(self, page) -> None:
        self._assert_honeypot_empty(page)
        super().review(page)
