"""Greenhouse upload, review and verification controls — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import re
import time
from dataclasses import field


try:
    from apply_flow_constants import (
        LOG,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _normalise_label, _safe_label, _fill_secret,
    )
    from apply_flow_ashby import (
        AshbyRecipe,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _normalise_label, _safe_label, _fill_secret,
    )
    from shared.skills.apply_flow_ashby import (
        AshbyRecipe,
    )


class GreenhouseReviewMixin:
    # A script error of the uploader itself, not a verdict on the file. 1967
    # (patch 23): "Cannot read properties of undefined (reading 'uploadFile')"
    # under Resume/CV, the widget not yet initialised when the file was set.
    _UPLOADER_SCRIPT_ERROR = re.compile(
        r"cannot read propert|reading '|is not a function|is not defined|undefined|typeerror|referenceerror",
        re.I,
    )
    _RESUME_INPUT = "#resume, input[name='resume'], input[name='job_application[resume]']"
    UPLOAD_SETTLE_MS = 2_000

    def _settle_uploader(self, page) -> None:
        with contextlib.suppress(Exception):
            page.wait_for_load_state("networkidle", timeout=10_000)
        page.wait_for_timeout(self.UPLOAD_SETTLE_MS)

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        form = page.locator(self.FORM)
        # The uploader's scripts load after the form: set the file once the page is quiet.
        with contextlib.suppress(Exception):
            page.wait_for_load_state("networkidle", timeout=10_000)
        for attempt in (1, 2):
            resume = form.locator(self._RESUME_INPUT)
            if resume.count() != 1 or (resume.first.get_attribute("type") or "").casefold() != "file":
                raise BlockedHuman(
                    "resume_field_missing",
                    "Greenhouse resume upload field was not found unambiguously",
                    "upload_cv",
                )
            if attempt == 2:
                # The same file set again fires no change event: clear it first.
                resume.first.set_input_files([])
            # On the real input, never through the Attach button's file dialog.
            resume.first.set_input_files(str(self.cv_path))
            page.wait_for_timeout(300)
            error = self._upload_outcome(page, form)
            if not error:
                return
            if not self._UPLOADER_SCRIPT_ERROR.search(error):
                raise BlockedHuman("upload_rejected", "Greenhouse reported a CV upload error", "upload_cv")
            if attempt == 1:
                # The widget was not ready: one more time, after the page settles.
                LOG.warning("[apply-flow] Greenhouse uploader not ready; one retry after settle")
                self._settle_uploader(page)
        raise BlockedHuman(
            "upload_widget_unavailable",
            "Greenhouse's upload widget failed to start (a script error, not a rejected file)",
            "upload_cv",
        )

    def _upload_outcome(self, page, form) -> str:
        """"" when the CV is attached; otherwise the error text the field shows ("?" if none)."""
        retained = form.locator(self._RESUME_INPUT)
        # Current Greenhouse replaces the file input with an exact filename
        # and a Remove file button after accepting the upload.  Older forms
        # retain the input.  Verify either observable effect; the vanished
        # input by itself is not proof of acceptance.
        if retained.count() == 1:
            scope = retained.first.locator(
                "xpath=ancestor::*[contains(@class, 'field-wrapper') or contains(@class, 'field')][1]"
            )
            error = self._visible_error_text(scope.first) if scope.count() else ""
            if error:
                return error
            if retained.first.evaluate("element => element.files.length") == 1:
                return ""
            return "Greenhouse did not retain the selected CV"
        filename = form.get_by_text(self.cv_path.name, exact=True)
        try:
            filename.first.wait_for(state="visible", timeout=5_000)
        except Exception:
            return "Greenhouse did not show the selected CV filename"
        if filename.count() != 1:
            return "Greenhouse did not show the selected CV filename"
        scope = filename.first.locator(
            "xpath=ancestor::*[contains(@class, 'field-wrapper') or contains(@class, 'field')][1]"
        )
        if not scope.count() or "resume" not in _normalise_label(scope.first.inner_text()):
            return "Greenhouse showed the filename outside the resume field"
        return self._visible_error_text(scope.first)


    @staticmethod
    def _visible_error_text(scope) -> str:
        selectors = (
            "[role=alert]",
            ".field-error",
            ".error-message",
            "[id$='-error']",
            "[aria-invalid=true]",
        )
        for selector in selectors:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if match.is_visible():
                    return (match.inner_text() or match.get_attribute("aria-label") or selector).strip()
        return ""

    @staticmethod
    def _challenge_reason(page) -> str:
        common = AshbyRecipe._challenge_reason(page)
        if common:
            return common
        selectors = (
            "#security_code",
            "input[name='security_code']",
            "input[name*='captcha' i]",
        )
        for selector in selectors:
            matches = page.locator(selector)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    return "captcha"
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if "verification code" in text and "not a robot" in text:
            return "captcha"
        if "flagged as potential bot traffic" in text:
            return "captcha"
        return ""

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(
                challenge,
                f"Greenhouse requires human intervention ({challenge})",
                "review",
            )
        if self._visible_error_text(page):
            raise BlockedHuman("form_error", "Greenhouse reports a form validation error", "review")

        entries = self._entries(page)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Greenhouse field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator(
                "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
            )
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Greenhouse rejected the format of: {_safe_label(label)}",
                        "review",
                    )

        forms = page.locator(self.FORM)
        if forms.count() == 1 and not forms.first.evaluate(
            "form => typeof form.checkValidity !== 'function' || form.checkValidity()"
        ):
            # A required consent or survey control outside the questions: the
            # browser would refuse the click and nothing would be sent (the
            # same hole a fullstack developer found in the Lever recipe).
            raise BlockedHuman(
                "required_field_unanswered",
                "A required Greenhouse control outside the application questions is empty or invalid",
                "review",
            )

        submit = page.locator(self.SUBMIT)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Greenhouse submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # ApplicationFlow has already persisted submit_started and repeated
        # the authorisation gate before this irreversible click.
        page.locator(self.SUBMIT).click(timeout=10_000)

    # 1967 (patch 25): after Submit, "A verification code was sent to <email>.
    # To submit your application, enter the 8-character code to confirm you're
    # human", with eight "Security code" boxes above the Submit button.
    SECURITY_CODE_INPUTS = (
        "input[aria-label*='security code' i], input[id^='security-input'], "
        "input[name*='security_code' i], input[autocomplete='one-time-code']"
    )
    SECURITY_CODE_SENDERS = ("greenhouse.io", "greenhouse-mail.io")

    @classmethod
    def _security_code_boxes(cls, page) -> list:
        boxes = page.locator(cls.SECURITY_CODE_INPUTS)
        return [boxes.nth(index) for index in range(boxes.count()) if boxes.nth(index).is_visible()]

    @classmethod
    def security_code_screen(cls, page) -> bool:
        """The code screen after Submit: visible code boxes and the page saying a code was sent."""
        if not cls._security_code_boxes(page):
            return False
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        return "verification code" in text or "security code" in text

    @classmethod
    def enter_security_code(cls, page, code: str) -> None:
        boxes = cls._security_code_boxes(page)
        if len(boxes) == 1:
            _fill_secret(boxes[0], code)
        elif len(boxes) == len(code):
            for box, character in zip(boxes, code):
                _fill_secret(box, character)
        else:
            raise BlockedHuman(
                "greenhouse_verification_failed",
                "The Greenhouse verification code boxes are not the ones the recipe knows",
                "submit",
            )

    @classmethod
    def clear_security_code(cls, page) -> None:
        """Before any screenshot: a typed code never stays on the page."""
        for box in cls._security_code_boxes(page):
            with contextlib.suppress(Exception):
                box.fill("")
