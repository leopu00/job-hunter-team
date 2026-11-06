"""Greenhouse form answers — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

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


class GreenhouseAnswersMixin:
    @staticmethod
    def _answer_request(page, entry, label: str) -> dict[str, Any] | None:
        exact_label = _exact_form_text(label)
        key = _normalise_label(exact_label)
        if not exact_label or not key:
            return None
        radios = entry.locator("input[type=radio]")
        if radios.count():
            options = _control_option_labels(radios)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "radio", "options": options}
        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1:
                return {
                    "key": key,
                    "label": exact_label,
                    "field_type": "checkbox",
                    "options": ["Yes", "No"],
                }
            options = _control_option_labels(checkboxes)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "checkboxes", "options": options}
        select = entry.locator("select")
        if select.count() == 1:
            options: list[str] = []
            choices = select.first.locator("option")
            for index in range(choices.count()):
                choice = choices.nth(index)
                text = _exact_form_text(choice.inner_text(), maximum=500)
                value = choice.get_attribute("value")
                if text and value not in {None, ""} and text not in options:
                    options.append(text)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "select", "options": options}
        combo = entry.locator("[role=combobox]")
        if combo.count() == 1:
            combo.first.click()
            options = []
            visible = page.locator("[role=option]")
            # React boards fetch the options after the click (1967, 14/09: read
            # at once they were none, and Country came back as a text question).
            try:
                page.locator("[role=option]:visible").first.wait_for(state="visible", timeout=5_000)
            except Exception:
                pass
            for index in range(visible.count()):
                option = visible.nth(index)
                if option.is_visible():
                    text = _exact_form_text(option.inner_text(), maximum=500)
                    if text and text not in options:
                        options.append(text)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "select", "options": options}
        if entry.locator("textarea").count() == 1:
            return {"key": key, "label": exact_label, "field_type": "textarea", "options": []}
        inputs = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]):not([type=file])"
        )
        if inputs.count() == 1:
            input_type = (inputs.first.get_attribute("type") or "text").casefold()
            if input_type in {"text", "email", "tel", "url", "number", "date"}:
                return {"key": key, "label": exact_label, "field_type": input_type, "options": []}
        return None

    def fill_screening(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(
                challenge,
                f"Greenhouse requires human intervention ({challenge})",
                "screening",
            )
        entries = self._entries(page)
        core_ids = tuple(self._CORE_CONTROLS) + ("resume",)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if any(entry.locator(f"#{control_id}").count() for control_id in core_ids):
                continue
            label = self._label(entry)
            if _normalise_label(label) in self._CORE_LABELS or self._is_answered(entry):
                continue
            field_key = self._field_key(entry)
            present, answer = self._answer_for(label, field_key)
            if not present:
                if self._required(entry):
                    request = self._answer_request(page, entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Greenhouse required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Greenhouse question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill_answer(page, entry, label, answer)
                if not self._is_answered(entry):
                    raise BlockedHuman(
                        "answer_not_accepted",
                        f"Greenhouse did not retain the answer for: {_safe_label(label)}",
                        "screening",
                    )
            except BlockedHuman as refused:
                raise _inferred_answer_refused(self, refused, lambda: self._answer_request(page, entry, label)) from None

    def _fill_answer(self, page, entry, label: str, answer: Any) -> None:
        if not entry.count():
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse field has no recognised container: {_safe_label(label)}",
                "screening",
            )
        radios = entry.locator("input[type=radio]")
        if radios.count():
            wanted = _normalise_label(str(answer))
            matches = []
            for index in range(radios.count()):
                radio = radios.nth(index)
                labels = radio.evaluate(
                    "element => Array.from(element.labels || []).map(label => label.innerText)"
                )
                if any(_normalise_label(str(value)) == wanted for value in labels):
                    matches.append(radio)
            if len(matches) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single Greenhouse option matches the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            matches[0].check()
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1 and isinstance(answer, bool):
                checkboxes.first.set_checked(answer)
                return
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Greenhouse checkbox question needs explicit option labels: {_safe_label(label)}",
                    "screening",
                )
            wanted = {_normalise_label(str(value)) for value in values}
            matched: dict[str, Any] = {}
            for index in range(checkboxes.count()):
                checkbox = checkboxes.nth(index)
                labels = checkbox.evaluate(
                    "element => Array.from(element.labels || []).map(label => label.innerText)"
                )
                for option_label in labels:
                    normalised = _normalise_label(str(option_label))
                    if normalised in wanted:
                        matched[normalised] = checkbox
            if set(matched) != wanted:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Greenhouse checkbox options do not exactly match the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            for checkbox in matched.values():
                checkbox.check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                select.first.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Greenhouse select has no option matching the saved answer for: {_safe_label(label)}",
                    "screening",
                ) from exc
            return

        comboboxes = entry.locator("input[role=combobox]")
        if comboboxes.count() == 1:
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Greenhouse select needs explicit option labels: {_safe_label(label)}",
                    "screening",
                )
            for value in values:
                comboboxes.first.click()
                option = page.get_by_role("option", name=str(value), exact=True)
                try:
                    option.first.wait_for(state="visible", timeout=3_000)
                except Exception as exc:
                    raise BlockedHuman(
                        "answer_option_unknown",
                        f"Greenhouse select has no option matching the saved answer for: {_safe_label(label)}",
                        "screening",
                    ) from exc
                if option.count() != 1:
                    raise BlockedHuman(
                        "answer_option_unknown",
                        f"Greenhouse select option is ambiguous for: {_safe_label(label)}",
                        "screening",
                    )
                option.first.click()
            selected = entry.locator(".select__single-value, .select__multi-value__label")
            observed = {_normalise_label(selected.nth(i).inner_text()) for i in range(selected.count())}
            wanted = {_normalise_label(str(value)) for value in values}
            if not wanted.issubset(observed):
                raise BlockedHuman(
                    "answer_not_accepted",
                    f"Greenhouse did not retain the selected answer for: {_safe_label(label)}",
                    "screening",
                )
            return

        text = entry.locator(
            "textarea, input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]):not([role=combobox])"
        )
        if text.count() == 1:
            self._fill_scalar(text.first, label, answer, "screening")
            return
        raise BlockedHuman(
            "unknown_required_control",
            f"Greenhouse field type is not supported safely: {_safe_label(label)}",
            "screening",
        )
