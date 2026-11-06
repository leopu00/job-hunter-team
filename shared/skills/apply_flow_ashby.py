"""Ashby form and core fields — moved unchanged from apply_flow.py."""
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
        application_answers,
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
    from apply_flow_ashby_screening import (
        AshbyScreeningMixin,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        application_answers,
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
    from shared.skills.apply_flow_ashby_screening import (
        AshbyScreeningMixin,
    )


class AshbyRecipe(AshbyScreeningMixin):
    FIELD_ENTRY = ".ashby-application-form-field-entry"
    QUESTION = ".ashby-application-form-question-title"
    SUBMIT = ".ashby-application-form-submit-button"
    SUCCESS = ".ashby-application-form-success-container"

    _CORE_LABELS = {
        "name": ("name",),
        "full name": ("name",),
        "email": ("contacts", "email"),
        "email address": ("contacts", "email"),
        "phone": ("contacts", "phone"),
        "phone number": ("contacts", "phone"),
        "linkedin": ("contacts", "linkedin"),
        "linkedin profile": ("contacts", "linkedin"),
        "github": ("contacts", "github"),
        "github profile": ("contacts", "github"),
        "website": ("contacts", "website"),
        "personal website": ("contacts", "website"),
        "personal web": ("contacts", "website"),
        "portfolio url": ("contacts", "website"),
        "address": ("contacts", "address"),
        "location": ("location",),
        "current location": ("location",),
        "where do you currently live": ("location",),
        "where are you currently located": ("location",),
    }

    _SEMANTIC_ANSWER_KEYS = (
        (re.compile(r"sponsor|sponsorship", re.I), "sponsorship"),
        (re.compile(r"relocat", re.I), "relocation"),
        (re.compile(r"authorized to work|authorised to work|work authorization", re.I), "work_authorization"),
        (re.compile(r"how did you hear|how you heard", re.I), "how_heard"),
        (re.compile(r"notice period", re.I), "notice_period"),
        (re.compile(r"available to start|start date|availability", re.I), "availability"),
        (re.compile(r"salary expectation|desired salary", re.I), "salary_expectations"),
    )

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = self._answer_index(profile.get("application_answers"))
        # Set by the flow: key → origin of each saved answer; unknown means the profile.
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""

    @staticmethod
    def _answer_index(value: Any) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if isinstance(value, Mapping):
            for key, answer in value.items():
                result[_normalise_label(str(key))] = answer
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, Mapping) and item.get("question"):
                    result[_normalise_label(str(item["question"]))] = item.get("answer")
        return result

    @staticmethod
    def _label(entry) -> str:
        label = entry.locator(AshbyRecipe.QUESTION)
        if label.count():
            return label.first.inner_text().replace("\u00a0", " ").strip()
        controls = entry.locator("input, textarea, select")
        if controls.count():
            return controls.first.get_attribute("id") or ""
        return ""

    @staticmethod
    def _field_path(entry) -> str:
        return entry.get_attribute("data-field-path") or ""

    @staticmethod
    def _required(entry) -> bool:
        if entry.locator("input[required], textarea[required], select[required]").count():
            return True
        label = entry.locator(AshbyRecipe.QUESTION)
        if not label.count():
            return False
        classes = label.first.get_attribute("class") or ""
        return "required" in classes.casefold() or label.first.get_attribute("aria-required") == "true"

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> Any:
        value: Any = profile
        for part in path:
            if not isinstance(value, Mapping):
                return None
            value = value.get(part)
        # Core Ashby identity/contact controls are textual.  Coercing a
        # malformed boolean or object to a plausible-looking string would
        # bypass the profile schema instead of failing closed.
        if not isinstance(value, str):
            return None
        return value.strip() or None

    @staticmethod
    def _first_control(entry):
        controls = entry.locator("input:not([type=hidden]), textarea, select")
        return controls.first if controls.count() else None

    @staticmethod
    def _is_answered(entry) -> bool:
        if entry.locator("button[aria-pressed=true]").count():
            return True
        if entry.locator("input[type=radio]:checked, input[type=checkbox]:checked").count():
            return True
        controls = entry.locator("input:not([type=hidden]), textarea, select")
        for index in range(controls.count()):
            control = controls.nth(index)
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"radio", "checkbox"}:
                continue
            if control_type == "file":
                if control.evaluate("element => element.files.length") > 0:
                    return True
            elif control.input_value().strip():
                return True
        return False

    def form_present(self, page) -> bool:
        return page.locator(self.FIELD_ENTRY).count() > 0

    def apply_control_present(self, page) -> bool:
        """The control `open_form` would click; only without it can a closed notice count."""
        return page.get_by_text("Apply for this Job", exact=False).count() > 0

    def _container(self, page, step: str):
        """The one application form every Ashby action is confined to.

        Fields, the CV upload and the submit button are looked up inside it,
        never on the whole page: a newsletter, search box or demo form next to
        the application is not part of the application.  A field entry outside
        that form means the page is not the layout the recipe knows.
        """
        forms = page.locator("form", has=page.locator(self.FIELD_ENTRY))
        if forms.count() != 1:
            raise BlockedHuman(
                "application_form_ambiguous",
                "The Ashby application form cannot be identified as exactly one form",
                step,
            )
        container = forms.first
        if container.locator(self.FIELD_ENTRY).count() != page.locator(self.FIELD_ENTRY).count():
            raise BlockedHuman(
                "application_field_outside_form",
                "An Ashby application field sits outside the application form",
                step,
            )
        return container

    def open_form(self, page) -> None:
        if page.locator(self.FIELD_ENTRY).count():
            self._container(page, "detect")
            return
        apply_link = page.get_by_text("Apply for this Job", exact=False)
        if not apply_link.count():
            raise BlockedHuman(
                "ashby_form_missing",
                "Ashby application form or Apply button was not found",
                "detect",
            )
        if apply_link.count() != 1:
            raise BlockedHuman(
                "ashby_apply_ambiguous",
                "more than one Ashby Apply button was found",
                "detect",
            )
        apply_link.click()
        try:
            page.locator(self.FIELD_ENTRY).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "ashby_form_missing",
                "Ashby Apply button did not open an application form",
                "detect",
            ) from exc
        self._container(page, "detect")

    def fill_core(self, page) -> None:
        entries = self._container(page, "fill").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            label = self._label(entry)
            field_path = self._field_path(entry)
            key = _normalise_label(label)
            profile_path = None
            if field_path == "_systemfield_name":
                profile_path = ("name",)
            elif field_path == "_systemfield_email":
                profile_path = ("contacts", "email")
            elif key in self._CORE_LABELS:
                profile_path = self._CORE_LABELS[key]
            if not profile_path:
                continue
            value = self._profile_value(self.profile, profile_path)
            if value is None and profile_path == ("contacts", "email"):
                value = self._profile_value(self.profile, ("email",))
            if value is None:
                value = _profile_fact(self.profile, (profile_path,))
            if value is None:
                present, answer = self._answer_for(label, field_path)
                if present and isinstance(answer, str) and answer.strip():
                    value = answer.strip()
            if value is None:
                if self._required(entry):
                    control = self._first_control(entry)
                    raise _core_fact_missing(
                        "Ashby", label, "fill", (control.get_attribute("type") or "text") if control else "text"
                    )
                continue
            control = self._first_control(entry)
            if control is None:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Required Ashby field has no recognised control: {_safe_label(label)}",
                    "fill",
                )
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"file", "radio", "checkbox"}:
                continue
            control.fill(str(value))
            self.answer_sources[key or _normalise_label(field_path)] = "profile"

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        resume = self._container(page, "upload_cv").locator("#_systemfield_resume")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "") != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Ashby resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        if resume.first.evaluate("element => element.files.length") != 1:
            raise BlockedHuman("upload_rejected", "Ashby did not retain the selected CV", "upload_cv")
        group = resume.first.locator("xpath=ancestor::*[contains(@class, 'ashby-application-form-field-entry')][1]")
        if group.count() and self._visible_error_text(group.first):
            raise BlockedHuman("upload_rejected", "Ashby reported a CV upload error", "upload_cv")

    def _answer_for(self, label: str, field_path: str) -> tuple[bool, Any]:
        keys = [_normalise_label(field_path), _normalise_label(label)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key in self.answers:
                self.answer_sources[key] = self.answer_origins.get(key, "profile")
                self.last_answer_key = key
                return True, self.answers[key]
        return False, None
