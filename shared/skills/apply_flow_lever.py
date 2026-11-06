"""Lever form recipe — moved unchanged from apply_flow.py."""
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
        application_answers, profile_facts,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _normalise_label, _safe_label,
    )
    from apply_flow_profile import (
        _profile_fact, _core_fact_missing, _fill_suggested_location, _inferred_answer_refused,
    )
    from apply_flow_ashby import (
        AshbyRecipe,
    )
    from apply_flow_greenhouse import (
        GreenhouseRecipe,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        application_answers, profile_facts,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _normalise_label, _safe_label,
    )
    from shared.skills.apply_flow_profile import (
        _profile_fact, _core_fact_missing, _fill_suggested_location, _inferred_answer_refused,
    )
    from shared.skills.apply_flow_ashby import (
        AshbyRecipe,
    )
    from shared.skills.apply_flow_greenhouse import (
        GreenhouseRecipe,
    )


class LeverRecipe:
    """Fail-closed adapter for the public Lever application form (jobs.lever.co).

    One page, native controls: `li.application-question` entries inside one
    form, the CV in `input[name=resume]`, one submit button.  Every action is
    confined to that form; a newsletter or search form next to it is not the
    application.
    """

    PLATFORM = "lever"
    VENDOR = "Lever"
    FORM = "form:has(li.application-question)"
    FIELD_ENTRY = "li.application-question"
    SUBMIT = "form:has(li.application-question) button[type=submit]"
    SUCCESS = ".application-confirmation, [data-qa=application-confirmation]"
    _CONTROLS = "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
    _ERRORS = ("[role=alert]", ".application-error", ".error-message", "[aria-invalid=true]")
    # Lever translates the posting's Apply control with the posting's language.
    _APPLY_LABEL = re.compile(
        r"^\s*(apply|postuler|bewerben|jetzt bewerben|candidati|candidatarsi|candidatar-se|"
        r"candidatura|aplicar|solicitar|jelentkez\w*)\b[^\n]{0,40}$",
        re.I,
    )
    # Lever's own field names.  A full name is one field: the profile's own
    # full name, never joined from first and last names nor split (D1).
    # Current company and "other" links are questions, not profile facts.
    _CORE_NAMES = {
        "name": (("name",),),
        "email": profile_facts.EMAIL_PATHS,
        "phone": (("contacts", "phone"),),
        "location": (("location",),),
        "urls[LinkedIn]": (("contacts", "linkedin"),),
        "urls[GitHub]": (("contacts", "github"),),
        "urls[Portfolio]": (("contacts", "website"),),
    }
    _SEMANTIC_ANSWER_KEYS = AshbyRecipe._SEMANTIC_ANSWER_KEYS

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = AshbyRecipe._answer_index(profile.get("application_answers"))
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""

    def _form(self, page, step: str):
        forms = page.locator(self.FORM)
        if forms.count() != 1:
            raise BlockedHuman(
                "lever_form_ambiguous",
                "The Lever application form cannot be identified as exactly one form",
                step,
            )
        form = forms.first
        if form.locator(self.FIELD_ENTRY).count() != page.locator(self.FIELD_ENTRY).count():
            raise BlockedHuman(
                "application_field_outside_form",
                "A Lever application field sits outside the application form",
                step,
            )
        return form

    @staticmethod
    def _label(entry) -> str:
        label = entry.locator(".application-label")
        if label.count():
            text = label.first.evaluate(
                "element => { const copy = element.cloneNode(true);"
                " copy.querySelectorAll('.required').forEach(mark => mark.remove());"
                " return copy.textContent; }"
            )
            return " ".join(str(text or "").replace("\u00a0", " ").split()).rstrip("\u2731*").strip()
        controls = entry.locator(LeverRecipe._CONTROLS)
        if controls.count():
            return (controls.first.get_attribute("aria-label") or "").strip()
        return ""

    @staticmethod
    def _field_key(entry) -> str:
        controls = entry.locator(LeverRecipe._CONTROLS)
        return (controls.first.get_attribute("name") or "") if controls.count() else ""

    @staticmethod
    def _required(entry) -> bool:
        return bool(
            entry.locator(".application-label .required, .required-field").count()
            or entry.locator("[required], [aria-required=true]").count()
        )

    @staticmethod
    def _is_answered(entry) -> bool:
        return AshbyRecipe._is_answered(entry)

    def _answer_for(self, label: str, field_key: str) -> tuple[bool, Any]:
        return GreenhouseRecipe._answer_for(self, label, field_key)

    def _core_value(self, name: str, label: str, paths: tuple[tuple[str, ...], ...]) -> tuple[bool, Any]:
        # profile_facts rule, as for Ashby and Greenhouse: the profile (own
        # paths, then aliases), then a saved answer.  No first + last join:
        # "Test" and "Candidate" say nothing about how the person writes the
        # full name; without one the caller asks for it.
        value = None
        for path in paths:
            value = AshbyRecipe._profile_value(self.profile, path)
            if value is not None:
                break
        if value is None:
            value = _profile_fact(self.profile, paths)
        if value is not None:
            self.answer_sources[_normalise_label(label) or _normalise_label(name)] = "profile"
            return True, value
        return self._answer_for(label, name)

    def _apply_controls(self, page) -> list:
        found = []
        for role in ("link", "button"):
            matches = page.get_by_role(role, name=self._APPLY_LABEL)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    found.append(matches.nth(index))
        return found

    def form_present(self, page) -> bool:
        return page.locator(self.FORM).count() > 0

    def apply_control_present(self, page) -> bool:
        """The control `open_form` would click; only without it can a closed notice count."""
        return bool(self._apply_controls(page))

    def open_form(self, page) -> None:
        if page.locator(self.FORM).count():
            self._form(page, "detect")
            return
        controls = self._apply_controls(page)
        # A posting page repeats "Apply for this job" at the top and bottom:
        # links to one and the same address are one control.
        targets = {
            control.evaluate("element => element.tagName === 'A' ? element.href : ''")
            for control in controls
        }
        if not controls or (len(controls) > 1 and (len(targets) != 1 or "" in targets)):
            raise BlockedHuman(
                "lever_form_missing" if not controls else "lever_apply_ambiguous",
                "Lever application form or a single Apply control was not found",
                "detect",
            )
        controls[0].click()
        try:
            page.locator(self.FORM).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "lever_form_missing",
                "Lever Apply control did not open an application form",
                "detect",
            ) from exc
        self._form(page, "detect")

    def fill_core(self, page) -> None:
        entries = self._form(page, "fill").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            name = self._field_key(entry)
            paths = self._CORE_NAMES.get(name)
            if not paths or self._is_answered(entry):
                continue
            label = self._label(entry)
            if name == "location" and entry.locator("input[type=hidden]").count():
                # An autocomplete: the typed text is not the value Lever keeps
                # (the hidden selectedLocation a clicked suggestion fills is).
                control = entry.locator("input[name=location]").first
                hidden = entry.locator("input[type=hidden]").first
                _fill_suggested_location(
                    self,
                    page,
                    platform="Lever",
                    control=control,
                    options=lambda scope=entry: scope.locator(".dropdown-location"),
                    accepted=lambda text, c=control, h=hidden: bool(h.input_value().strip())
                    and " ".join(c.input_value().split()) == text,
                    label=label or name,
                    field_key=name,
                    required=self._required(entry),
                    step="fill",
                )
                continue
            present, value = self._core_value(name, label, paths)
            if not present:
                if self._required(entry):
                    control = entry.locator("input, textarea").first
                    kind = (control.get_attribute("type") or "text").casefold() if control.count() else "text"
                    raise _core_fact_missing("Lever", label or name, "fill", kind)
                continue
            self._fill_answer(entry, label or name, value, "fill")

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        resume = self._form(page, "upload_cv").locator("input[name='resume']")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "").casefold() != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Lever resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        if resume.first.evaluate("element => element.files.length") != 1:
            raise BlockedHuman("upload_rejected", "Lever did not retain the selected CV", "upload_cv")
        entry = resume.first.locator("xpath=ancestor::li[contains(@class, 'application-question')][1]")
        if entry.count() and self._visible_error_text(entry.first):
            raise BlockedHuman("upload_rejected", "Lever reported a CV upload error", "upload_cv")

    def fill_screening(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"{self.VENDOR} requires human intervention ({challenge})", "screening")
        entries = self._form(page, "screening").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            field_key = self._field_key(entry)
            if field_key in self._CORE_NAMES or field_key == "resume" or self._is_answered(entry):
                continue
            label = self._label(entry)
            present, answer = self._answer_for(label, field_key)
            if not present:
                if self._required(entry):
                    request = GreenhouseRecipe._answer_request(page, entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"{self.VENDOR} required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required {self.VENDOR} question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill_answer(entry, label, answer, "screening")
                if not self._is_answered(entry):
                    raise BlockedHuman(
                        "answer_not_accepted",
                        f"{self.VENDOR} did not retain the answer for: {_safe_label(label)}",
                        "screening",
                    )
            except BlockedHuman as refused:
                raise _inferred_answer_refused(
                    self, refused, lambda: GreenhouseRecipe._answer_request(page, entry, label)
                ) from None

    @staticmethod
    def _option_matches(controls, values: list[Any]) -> dict[str, Any]:
        wanted = {_normalise_label(str(value)) for value in values}
        matched: dict[str, Any] = {}
        for index in range(controls.count()):
            control = controls.nth(index)
            labels = control.evaluate(
                "element => Array.from(element.labels || []).map(label => label.innerText)"
            )
            for option_label in labels:
                normalised = _normalise_label(str(option_label))
                if normalised in wanted:
                    if normalised in matched:
                        return {}
                    matched[normalised] = control
        return matched if set(matched) == wanted else {}

    def _fill_answer(self, entry, label: str, answer: Any, step: str) -> None:
        scalar = isinstance(answer, (str, int, float)) and not isinstance(answer, bool)
        radios = entry.locator("input[type=radio]")
        if radios.count():
            matched = self._option_matches(radios, [answer]) if scalar else {}
            if len(matched) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single {self.VENDOR} option matches the saved answer for: {_safe_label(label)}",
                    step,
                )
            next(iter(matched.values())).check()
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1 and isinstance(answer, bool):
                checkboxes.first.set_checked(answer)
                return
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(
                not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values
            ):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"{self.VENDOR} checkbox question needs explicit option labels: {_safe_label(label)}",
                    step,
                )
            matched = self._option_matches(checkboxes, values)
            if not matched:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"{self.VENDOR} checkbox options do not exactly match the saved answer for: {_safe_label(label)}",
                    step,
                )
            for checkbox in matched.values():
                checkbox.check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                if not scalar:
                    raise ValueError("not a single option label")
                select.first.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"{self.VENDOR} select has no option matching the saved answer for: {_safe_label(label)}",
                    step,
                ) from exc
            return

        text = entry.locator("textarea, input:not([type=hidden]):not([type=file])")
        if text.count() == 1:
            GreenhouseRecipe._fill_scalar(text.first, label, answer, step)
            return
        raise BlockedHuman(
            "unknown_required_control",
            f"{self.VENDOR} field type is not supported safely: {_safe_label(label)}",
            step,
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        for selector in LeverRecipe._ERRORS:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if match.is_visible():
                    return (match.inner_text() or match.get_attribute("aria-label") or selector).strip()
        return ""

    @staticmethod
    def _challenge_reason(page) -> str:
        # Lever's hCaptcha is invisible until it challenges: only a visible
        # frame counts, which the common check already requires.
        return AshbyRecipe._challenge_reason(page)

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"Lever requires human intervention ({challenge})", "review")
        form = self._form(page, "review")
        if self._visible_error_text(form):
            raise BlockedHuman("form_error", "Lever reports a form validation error", "review")
        entries = form.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Lever field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator(self._CONTROLS)
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Lever rejected the format of: {_safe_label(label)}",
                        "review",
                    )
        if not form.evaluate("form => form.checkValidity()"):
            # A required consent or survey control outside the questions: the
            # browser would refuse the click and nothing would be sent.
            raise BlockedHuman(
                "required_field_unanswered",
                "A required Lever control outside the application questions is empty or invalid",
                "review",
            )
        submit = form.locator("button[type=submit]")
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Lever submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # ApplicationFlow has already persisted submit_started and repeated
        # the authorisation gate before this irreversible click.
        self._form(page, "submit").locator("button[type=submit]").click(timeout=10_000)
