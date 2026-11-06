"""Greenhouse location and phone controls — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import re
import time
from dataclasses import field
from typing import Any


try:
    from apply_flow_constants import (
        profile_facts,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _safe_label, _exact_form_text,
    )
    from apply_flow_profile import (
        _fill_suggested_location, _inferred_answer_refused,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        profile_facts,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _safe_label, _exact_form_text,
    )
    from shared.skills.apply_flow_profile import (
        _fill_suggested_location, _inferred_answer_refused,
    )


class GreenhouseLocationMixin:
    def _fill_location_choice(self, page, entry, control, label: str, required: bool) -> None:
        _fill_suggested_location(
            self,
            page,
            platform="Greenhouse",
            control=control,
            options=lambda scope=entry: scope.locator("[role=option]"),
            accepted=lambda text, scope=entry: any(
                " ".join(value.split()) == text
                for value in scope.locator(".select__single-value").all_inner_texts()
            ),
            label=label,
            field_key=control.get_attribute("id") or "location",
            required=required,
            step="fill",
        )

    PHONE_COUNTRY_KEY = "phone country"
    _DIALLING_CODE = re.compile(r"\+\s*(\d[\d\s-]{0,7})\s*$")

    @staticmethod
    def _phone_country_options(page, control) -> tuple[Any, list[tuple[str, str, str]]]:
        """Open the dialling-code menu: (listbox, [(option text, country, code digits)])."""
        try: from apply_flow_greenhouse import GreenhouseRecipe
        except ImportError: from shared.skills.apply_flow_greenhouse import GreenhouseRecipe
        control.click()
        listbox = None
        try:
            page.wait_for_function(
                "e => { const id = e.getAttribute('aria-controls');"
                " const box = id && document.getElementById(id);"
                " return !!(box && box.querySelector('[role=option]')); }",
                arg=control.element_handle(),
                timeout=5_000,
            )
            listbox = page.locator(f"#{control.get_attribute('aria-controls')}")
        except Exception:
            return None, []
        options: list[tuple[str, str, str]] = []
        # Only the menu this control owns: the page also carries a hidden
        # intl-tel-input country list with its own role=option items.
        found = listbox.locator("[role=option]")
        for index in range(found.count()):
            text = _exact_form_text(found.nth(index).inner_text(), maximum=200)
            match = GreenhouseRecipe._DIALLING_CODE.search(text)
            if text and match:
                code = re.sub(r"\D", "", match.group(1))
                options.append((text, text[: match.start()].strip(), code))
        return listbox, options

    @staticmethod
    def _phone_country_kept(page, container, chosen: str, code: str) -> bool:
        """Did the menu keep the option?  1967 (patch 21): the chosen value shows
        as a flag and "+39" only, never the option's "Italy +39"; and it renders
        a moment after the click."""
        deadline = time.monotonic() + 3
        while True:
            shown = container.locator(".select__single-value") if container.count() else None
            if shown is not None and shown.count():
                text = _exact_form_text(shown.first.inner_text(), maximum=200)
                if text == chosen or ("+" in text and re.sub(r"\D", "", text) == code):
                    return True
            if time.monotonic() >= deadline:
                return False
            page.wait_for_timeout(200)

    def _fill_phone_country(self, page, control, label: str, required: bool) -> None:
        listbox, options = self._phone_country_options(page, control)
        if not options:
            with contextlib.suppress(Exception):
                page.keyboard.press("Escape")
            if not required:
                return
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse phone country options are not readable: {_safe_label(label)}",
                "fill",
            )
        texts = [text for text, _country, _code in options]
        chosen = ""
        saved = self.answers.get(self.PHONE_COUNTRY_KEY)
        if isinstance(saved, str) and saved in texts:
            chosen = saved
            self.answer_sources[self.PHONE_COUNTRY_KEY] = self.answer_origins.get(self.PHONE_COUNTRY_KEY, "profile")
            self.last_answer_key = self.PHONE_COUNTRY_KEY
        candidates = texts
        if not chosen:
            phone = profile_facts.profile_value(self.profile, "phone") or ""
            compact = re.sub(r"[\s().-]", "", phone)
            digits = compact[1:] if compact.startswith("+") else compact[2:] if compact.startswith("00") else ""
            if digits.isdigit():
                matching = [(text, country, code) for text, country, code in options if digits.startswith(code)]
                longest = max((len(code) for _t, _c, code in matching), default=0)
                matching = [item for item in matching if len(item[2]) == longest]
                if len(matching) > 1:
                    # Several countries share the code (+1, +7, +44): the profile's own place decides.
                    place = " ".join(
                        value.casefold()
                        for value in (profile_facts.profile_value(self.profile, "location"), self.profile.get("country"))
                        if isinstance(value, str)
                    )
                    named = [item for item in matching if item[1] and item[1].casefold() in place]
                    matching = named if len(named) == 1 else matching
                if len(matching) == 1:
                    chosen = matching[0][0]
                    self.answer_sources[self.PHONE_COUNTRY_KEY] = "profile"
                elif matching:
                    candidates = [text for text, _country, _code in matching]
        if not chosen:
            with contextlib.suppress(Exception):
                page.keyboard.press("Escape")
            if not required:
                return
            raise BlockedHuman(
                "required_answer_missing",
                f"Greenhouse phone country needs one of the page's dialling codes: {_safe_label(label)}",
                "fill",
                answer_request={
                    "key": self.PHONE_COUNTRY_KEY,
                    "label": "Phone country (dialling code)",
                    "field_type": "select",
                    "options": candidates,
                },
            )
        option = listbox.get_by_role("option", name=chosen, exact=True)
        if option.count() != 1:
            raise BlockedHuman(
                "answer_option_unknown",
                f"Greenhouse phone country option is ambiguous: {_safe_label(label)}",
                "fill",
            )
        option.first.click()
        container = control.locator("xpath=ancestor::*[contains(@class, 'select__container')][1]")
        code = next(item_code for text, _country, item_code in options if text == chosen)
        if not self._phone_country_kept(page, container, chosen, code):
            raise BlockedHuman(
                "answer_not_accepted",
                f"Greenhouse did not keep the phone country: {_safe_label(label)}",
                "fill",
            )

    def _fill_core_choice(self, page, control, control_id: str, label: str, required: bool) -> None:
        entry = control.locator(
            "xpath=ancestor::*[contains(@class, 'field-wrapper') or self::fieldset][1]"
        )
        if not entry.count():
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse core choice has no recognised container: {_safe_label(label)}",
                "fill",
            )
        if control_id == "location" and control.get_attribute("role") == "combobox":
            self._fill_location_choice(page, entry.first, control, label, required)
            return
        present, value = self._answer_for(label, control_id)
        if not present:
            if not required:
                return
            request = self._answer_request(page, entry.first, label)
            if request is None:
                # A text answer never fills a choice: asking for one would only
                # come back as the same question (1967, 15:19Z).
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Greenhouse choice options not readable: {_safe_label(label)}",
                    "fill",
                )
            raise BlockedHuman(
                "required_answer_missing",
                f"Required Greenhouse choice needs one of the page's options: {_safe_label(label)}",
                "fill",
                answer_request=request,
            )
        try:
            self._fill_answer(page, entry.first, label, value)
        except BlockedHuman as refused:
            raise _inferred_answer_refused(
                self, refused, lambda: self._answer_request(page, entry.first, label)
            ) from None
