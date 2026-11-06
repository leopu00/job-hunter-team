"""Ashby screening, challenges and submit — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import time
import urllib.parse
from dataclasses import field
from typing import Any


try:
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _normalise_label, _safe_label, _exact_form_text, _control_option_labels,
    )
    from apply_flow_profile import (
        _inferred_answer_refused,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _normalise_label, _safe_label, _exact_form_text, _control_option_labels,
    )
    from shared.skills.apply_flow_profile import (
        _inferred_answer_refused,
    )


class AshbyScreeningMixin:
    @staticmethod
    def _answer_request(entry, label: str) -> dict[str, Any] | None:
        exact_label = _exact_form_text(label)
        key = _normalise_label(exact_label)
        if not exact_label or not key:
            return None
        yes_no = entry.locator(".ashby-application-form-input-yesno-option")
        if yes_no.count():
            return {
                "key": key,
                "label": exact_label,
                "field_type": "radio",
                "options": ["Yes", "No"],
            }
        radios = entry.locator("input[type=radio]")
        if radios.count():
            options = _control_option_labels(radios)
            if not options:
                return None
            return {
                "key": key,
                "label": exact_label,
                "field_type": "radio",
                "options": options,
            }
        select = entry.locator("select")
        if select.count() == 1:
            options = []
            choices = select.first.locator("option")
            for index in range(choices.count()):
                choice = choices.nth(index)
                text = _exact_form_text(choice.inner_text(), maximum=500)
                value = choice.get_attribute("value")
                if text and value not in {None, ""} and text not in options:
                    options.append(text)
            if not options:
                return None
            return {
                "key": key,
                "label": exact_label,
                "field_type": "select",
                "options": options,
            }
        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count() == 1:
            return {
                "key": key,
                "label": exact_label,
                "field_type": "checkbox",
                "options": ["Yes", "No"],
            }
        text = entry.locator("textarea")
        if text.count() == 1:
            return {"key": key, "label": exact_label, "field_type": "textarea", "options": []}
        inputs = entry.locator("input:not([type=hidden]):not([type=file])")
        if inputs.count() == 1:
            input_type = (inputs.first.get_attribute("type") or "text").casefold()
            if input_type in {"text", "email", "tel", "url", "number", "date"}:
                return {"key": key, "label": exact_label, "field_type": input_type, "options": []}
        return None

    def fill_screening(self, page) -> None:
        entries = self._container(page, "screening").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            field_path = self._field_path(entry)
            if field_path in {"_systemfield_name", "_systemfield_email", "_systemfield_resume"}:
                continue
            label = self._label(entry)
            key = _normalise_label(label)
            if key in self._CORE_LABELS or self._is_answered(entry):
                continue
            present, answer = self._answer_for(label, field_path)
            if not present:
                if self._required(entry):
                    request = self._answer_request(entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Ashby required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Ashby question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill_answer(entry, label, answer)
                if not self._is_answered(entry):
                    raise BlockedHuman(
                        "answer_not_accepted",
                        f"Ashby did not retain the answer for: {_safe_label(label)}",
                        "screening",
                    )
            except BlockedHuman as refused:
                raise _inferred_answer_refused(self, refused, lambda: self._answer_request(entry, label)) from None

    def _fill_answer(self, entry, label: str, answer: Any) -> None:
        yes_no = entry.locator(".ashby-application-form-input-yesno-option")
        if yes_no.count():
            if isinstance(answer, bool):
                wanted = "yes" if answer else "no"
            elif isinstance(answer, str) and _normalise_label(answer) in {"yes", "no"}:
                wanted = _normalise_label(answer)
            else:
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Yes/no question has no explicit boolean answer: {_safe_label(label)}",
                    "screening",
                )
            option = entry.locator(f"button[data-option={wanted}]")
            if option.count() != 1:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Ashby yes/no options are ambiguous for: {_safe_label(label)}",
                    "screening",
                )
            option.click()
            return

        radios = entry.locator("input[type=radio]")
        if radios.count():
            wanted = _normalise_label(str(answer))
            matches = []
            for index in range(radios.count()):
                radio = radios.nth(index)
                labels = radio.evaluate("element => Array.from(element.labels || []).map(label => label.innerText)")
                if any(_normalise_label(str(value)) == wanted for value in labels):
                    matches.append(radio)
            if len(matches) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single Ashby option matches the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            matches[0].check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                select.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Ashby select has no option matching the saved answer for: {_safe_label(label)}",
                    "screening",
                ) from exc
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count() == 1 and isinstance(answer, bool):
            checkboxes.first.set_checked(answer)
            return

        text = entry.locator("textarea, input:not([type=hidden]):not([type=file])")
        if text.count() == 1 and isinstance(answer, (str, int, float)) and not isinstance(answer, bool):
            rendered = str(answer).strip()
            if not rendered:
                raise BlockedHuman(
                    "required_answer_missing",
                    f"Saved answer is empty for: {_safe_label(label)}",
                    "screening",
                )
            text.first.fill(rendered)
            return

        raise BlockedHuman(
            "unknown_required_control",
            f"Ashby field type is not supported safely: {_safe_label(label)}",
            "screening",
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        selectors = (
            ".ashby-application-form-error",
            "[role=alert]",
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
        try: from apply_flow_ashby import AshbyRecipe
        except ImportError: from shared.skills.apply_flow_ashby import AshbyRecipe
        selectors = (
            ("iframe[title*='captcha' i]", "captcha"),
            ("iframe[src*='recaptcha' i]", "captcha"),
            ("iframe[src*='hcaptcha' i]", "captcha"),
            ("input[autocomplete='one-time-code']", "two_factor"),
            ("input[name*='otp' i]", "two_factor"),
        )
        for selector, reason in selectors:
            matches = page.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if (
                    reason == "captcha"
                    and match.evaluate("element => element.tagName") == "IFRAME"
                    and AshbyRecipe._is_invisible_recaptcha_badge(
                        match.get_attribute("src") or ""
                    )
                ):
                    continue
                if match.is_visible():
                    return reason
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if any(marker in text for marker in ("verify you are human", "complete the captcha")):
            return "captcha"
        if any(marker in text for marker in ("enter verification code", "two-factor authentication")):
            return "two_factor"
        return ""

    @staticmethod
    def _is_invisible_recaptcha_badge(src: str) -> bool:
        try:
            parsed = urllib.parse.urlsplit(src)
            sizes = urllib.parse.parse_qs(parsed.query).get("size", [])
        except ValueError:
            return False
        return parsed.path.rstrip("/").endswith("/anchor") and any(
            size.casefold() == "invisible" for size in sizes
        )

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"Ashby requires human intervention ({challenge})", "review")
        error = self._visible_error_text(page)
        if error:
            raise BlockedHuman("form_error", "Ashby reports a form validation error", "review")

        container = self._container(page, "review")
        entries = container.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Ashby field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator("input:not([type=hidden]), textarea, select")
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Ashby rejected the format of: {_safe_label(label)}",
                        "review",
                    )

        # The pre-submit boundary exists only if the final button belongs to the
        # application form: a submit-looking button elsewhere is not it.
        if page.locator(self.SUBMIT).count() != container.locator(self.SUBMIT).count():
            raise BlockedHuman(
                "submit_outside_form",
                "An Ashby submit button sits outside the application form",
                "review",
            )
        submit = container.locator(self.SUBMIT)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Ashby submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # Called once only.  The checkpoint that makes retries impossible is
        # persisted by ApplicationFlow before entering this method.
        self._container(page, "submit").locator(self.SUBMIT).click(timeout=10_000)
