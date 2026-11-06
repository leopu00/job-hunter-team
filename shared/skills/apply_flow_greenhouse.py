"""Greenhouse form and core fields — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import re
from dataclasses import field, replace
from pathlib import Path
from typing import Any, Mapping


try:
    from apply_flow_constants import (
        application_answers, profile_facts, location_choice,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _normalise_label, _safe_label,
    )
    from apply_flow_profile import (
        _profile_fact, _core_fact_missing,
    )
    from apply_flow_ashby import (
        AshbyRecipe,
    )
    from apply_flow_greenhouse_location import (
        GreenhouseLocationMixin,
    )
    from apply_flow_greenhouse_answers import (
        GreenhouseAnswersMixin,
    )
    from apply_flow_greenhouse_review import (
        GreenhouseReviewMixin,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        application_answers, profile_facts, location_choice,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _normalise_label, _safe_label,
    )
    from shared.skills.apply_flow_profile import (
        _profile_fact, _core_fact_missing,
    )
    from shared.skills.apply_flow_ashby import (
        AshbyRecipe,
    )
    from shared.skills.apply_flow_greenhouse_location import (
        GreenhouseLocationMixin,
    )
    from shared.skills.apply_flow_greenhouse_answers import (
        GreenhouseAnswersMixin,
    )
    from shared.skills.apply_flow_greenhouse_review import (
        GreenhouseReviewMixin,
    )


class GreenhouseRecipe(GreenhouseLocationMixin, GreenhouseAnswersMixin, GreenhouseReviewMixin):
    """Fail-closed adapter for current and legacy public Greenhouse forms."""

    PLATFORM = "greenhouse"
    FORM = "#application-form.application--form, #application_form"
    FIELD_ENTRY = (
        "#application-form .field-wrapper, "
        "#application-form fieldset.phone-input, "
        "#application_form .field"
    )
    SUBMIT = (
        "#application-form button[type=submit], "
        "#application_form button[type=submit], "
        "#application_form input[type=submit]"
    )
    SUCCESS = (
        ".application--confirmation, .application-confirmation, "
        "#application_confirmation, [data-testid=application-confirmation]"
    )

    _CORE_CONTROLS = {
        "first_name": (("first_name",),),
        "last_name": (("last_name",),),
        "preferred_name": (("preferred_name",),),
        "email": profile_facts.EMAIL_PATHS,
        # A telephone country, nationality, and current residence are not
        # interchangeable.  Country therefore needs an exact saved answer.
        "country": (),
        "phone": (("contacts", "phone"),),
        "location": (("location",),),
    }
    _CORE_LABELS = {
        "linkedin": (("contacts", "linkedin"),),
        "linkedin profile": (("contacts", "linkedin"),),
        "website": (("contacts", "website"),),
        "website portfolio": (("contacts", "website"),),
        "portfolio": (("contacts", "website"),),
        "location city": (("location",),),
        "current location": (("location",),),
    }
    _SEMANTIC_ANSWER_KEYS = AshbyRecipe._SEMANTIC_ANSWER_KEYS

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = AshbyRecipe._answer_index(profile.get("application_answers"))
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> str | None:
        return AshbyRecipe._profile_value(profile, path)

    @staticmethod
    def _entries(page):
        return page.locator(GreenhouseRecipe.FIELD_ENTRY)

    @staticmethod
    def _label(entry) -> str:
        legend = entry.locator("legend")
        if legend.count():
            return legend.first.inner_text().replace("\u00a0", " ").strip()
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        for index in range(controls.count()):
            control = controls.nth(index)
            label = control.get_attribute("aria-label")
            if label:
                return label.replace("\u00a0", " ").strip()
            labelled_by = control.get_attribute("aria-labelledby")
            if labelled_by:
                labelled = entry.locator(f"#{labelled_by}")
                if labelled.count():
                    return labelled.first.inner_text().replace("\u00a0", " ").strip()
            control_id = control.get_attribute("id")
            if control_id:
                associated = entry.locator(f"label[for='{control_id}']")
                if associated.count():
                    return associated.first.inner_text().replace("\u00a0", " ").strip()
        label = entry.locator("label")
        return label.first.inner_text().replace("\u00a0", " ").strip() if label.count() else ""

    @staticmethod
    def _field_key(entry) -> str:
        fieldset = entry.locator("fieldset[id]")
        if fieldset.count():
            return (fieldset.first.get_attribute("id") or "").removesuffix("[]")
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        if not controls.count():
            return ""
        control = controls.first
        return (
            control.get_attribute("name")
            or control.get_attribute("id")
            or ""
        ).removesuffix("[]")

    @staticmethod
    def _required(entry) -> bool:
        if (
            entry.get_attribute("aria-required") == "true"
            or entry.locator("[aria-required=true], input[required], textarea[required], select[required]").count()
            or entry.locator(".required, .asterisk, .field-required").count()
        ):
            return True
        labels = entry.locator("legend, label")
        return any(
            labels.nth(index).inner_text().replace("\u00a0", " ").strip().endswith("*")
            for index in range(labels.count())
        )

    @staticmethod
    def _is_answered(entry) -> bool:
        if entry.locator("input[type=radio]:checked, input[type=checkbox]:checked").count():
            return True
        if entry.locator(".select__single-value, .select__multi-value__label").count():
            return True
        if entry.locator(".file-upload__filename").count():
            return True
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        for index in range(controls.count()):
            control = controls.nth(index)
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"radio", "checkbox"}:
                continue
            if control_type == "file":
                if control.evaluate("element => element.files.length") > 0:
                    return True
            elif control_type != "search" and control.input_value().strip():
                return True
        return False

    def _answer_for(self, label: str, field_key: str) -> tuple[bool, Any]:
        keys = [_normalise_label(field_key), _normalise_label(label)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key in self.answers:
                self.answer_sources[key] = self.answer_origins.get(key, "profile")
                self.last_answer_key = key
                return True, self.answers[key]
        return False, None

    def _core_value(
        self, control_id: str, label: str, paths: tuple[tuple[str, ...], ...]
    ) -> tuple[bool, Any]:
        # profile_facts rule: the profile (own paths, then aliases), then a
        # saved answer; the caller turns a missing required one into a question.
        for path in paths:
            value = self._profile_value(self.profile, path)
            if value is not None:
                self.answer_sources[_normalise_label(label) or _normalise_label(control_id)] = "profile"
                return True, value
        value = _profile_fact(self.profile, paths)
        if value is not None:
            self.answer_sources[_normalise_label(label) or _normalise_label(control_id)] = "profile"
            return True, value
        return self._answer_for(label, control_id)

    @staticmethod
    def _control_label(scope, control) -> str:
        label = control.get_attribute("aria-label")
        if label:
            return label.strip()
        labelled_by = control.get_attribute("aria-labelledby")
        if labelled_by:
            labelled = scope.locator(f"#{labelled_by}")
            if labelled.count():
                return labelled.first.inner_text().replace("\u00a0", " ").strip()
        control_id = control.get_attribute("id") or ""
        associated = scope.locator(f"label[for='{control_id}']") if control_id else None
        if associated is not None and associated.count():
            return associated.first.inner_text().replace("\u00a0", " ").strip()
        return control_id

    @staticmethod
    def _control_required(control) -> bool:
        if (
            control.get_attribute("aria-required") == "true"
            or control.get_attribute("required") is not None
        ):
            return True
        entry = control.locator(
            "xpath=ancestor::*[contains(@class, 'field-wrapper') or "
            "contains(concat(' ', normalize-space(@class), ' '), ' field ') or self::fieldset][1]"
        )
        return bool(entry.count() and GreenhouseRecipe._required(entry.first))

    @staticmethod
    def _fill_scalar(control, label: str, answer: Any, step: str) -> None:
        if not isinstance(answer, (str, int, float)) or isinstance(answer, bool):
            raise BlockedHuman(
                "answer_type_unknown",
                f"Greenhouse text field has no explicit scalar answer: {_safe_label(label)}",
                step,
            )
        rendered = str(answer).strip()
        if not rendered:
            raise BlockedHuman(
                "required_answer_missing",
                f"Saved answer is empty for: {_safe_label(label)}",
                step,
            )
        control.fill(rendered)
        if control.input_value().strip() != rendered:
            raise BlockedHuman(
                "answer_not_accepted",
                f"Greenhouse did not retain the answer for: {_safe_label(label)}",
                step,
            )

    def form_present(self, page) -> bool:
        return page.locator(self.FORM).count() > 0

    def apply_control_present(self, page) -> bool:
        """The control `open_form` would click; only without it can a closed notice count."""
        pattern = re.compile(r"^(apply|apply for this job|click to apply|submit an application)$", re.I)
        return any(page.get_by_role(role, name=pattern).count() for role in ("button", "link"))

    def open_form(self, page) -> None:
        forms = page.locator(self.FORM)
        if forms.count() == 1:
            return
        if forms.count() > 1:
            raise BlockedHuman(
                "greenhouse_form_ambiguous",
                "More than one Greenhouse application form was found",
                "detect",
            )
        candidates = []
        pattern = re.compile(r"^(apply|apply for this job|click to apply|submit an application)$", re.I)
        for role in ("button", "link"):
            matches = page.get_by_role(role, name=pattern)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    candidates.append(matches.nth(index))
        if len(candidates) != 1:
            raise BlockedHuman(
                "greenhouse_form_missing",
                "Greenhouse application form or a single Apply control was not found",
                "detect",
            )
        candidates[0].click()
        try:
            page.locator(self.FORM).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "greenhouse_form_missing",
                "Greenhouse Apply control did not open an application form",
                "detect",
            ) from exc

    def fill_core(self, page) -> None:
        form = page.locator(self.FORM)
        if form.count() != 1:
            raise BlockedHuman(
                "greenhouse_form_ambiguous",
                "Greenhouse application form is missing or ambiguous",
                "fill",
            )
        scope = form.first
        for control_id, paths in self._CORE_CONTROLS.items():
            matches = scope.locator(f"#{control_id}")
            if not matches.count():
                continue
            if matches.count() != 1:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Greenhouse core field is ambiguous: {_safe_label(control_id)}",
                    "fill",
                )
            control = matches.first
            label = self._control_label(scope, control)
            required = self._control_required(control)
            if control_id == "country" and control.evaluate("e => !!e.closest('fieldset.phone-input')"):
                # 1967 (patch 20): this "Country*" is the dialling code of the
                # phone number, not where the candidate lives.
                self._fill_phone_country(page, control, label, required)
                continue
            if control.get_attribute("role") == "combobox" or control.evaluate("e => e.tagName") == "SELECT":
                # A core choice (country, location...): the page's options are
                # the only valid answers. 1967 (14/09) stopped on "Country*"
                # and the CLOSER asked the user, though the profile says where
                # they live. Only an exact saved option fills it; otherwise it
                # is a question with the exact options, and the CLOSER picks
                # the one the profile supports (CL-08).
                self._fill_core_choice(page, control, control_id, label, required)
                continue
            present, value = self._core_value(control_id, label, paths)
            if not present:
                if required:
                    raise _core_fact_missing(
                        "Greenhouse", label, "fill", (control.get_attribute("type") or "text").casefold()
                    )
                continue
            self._fill_scalar(control, label, value, "fill")

        entries = self._entries(page)
        for index in range(entries.count()):
            entry = entries.nth(index)
            label = self._label(entry)
            paths = self._CORE_LABELS.get(_normalise_label(label))
            if not paths or self._is_answered(entry):
                continue
            combo = entry.locator("input[role=combobox]")
            if paths == (("location",),) and combo.count() == 1:
                # "Location (City)": a react-select fed by a geocoder, empty
                # until typed into (location_choice).
                self._fill_location_choice(page, entry, combo.first, label, self._required(entry))
                continue
            present, value = self._core_value(self._field_key(entry), label, paths)
            if present:
                self._fill_answer(page, entry, label, value)
            elif self._required(entry):
                raise _core_fact_missing("Greenhouse", label, "fill")
