"""Profile facts, locations and saved answer provenance — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import hashlib
import json
from dataclasses import field
from typing import Any, Callable, Mapping


try:
    from apply_flow_constants import (
        _CORE_PATH_FACTS, ANSWER_ORIGINS, _REFUSED_ANSWER_REASONS, profile_facts,
        location_choice,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _normalise_label, _safe_label, _exact_form_text,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        _CORE_PATH_FACTS, ANSWER_ORIGINS, _REFUSED_ANSWER_REASONS, profile_facts,
        location_choice,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _normalise_label, _safe_label, _exact_form_text,
    )


def _profile_fact(profile: Mapping[str, Any], paths: tuple[tuple[str, ...], ...]) -> str | None:
    """A core fact from the profile: the recipe's own paths, then the known aliases."""
    for path in paths:
        fact = _CORE_PATH_FACTS.get(tuple(path))
        value = profile_facts.profile_value(profile, fact) if fact else None
        if value is not None:
            return value
    return None


def _core_fact_missing(platform: str, label: str, step: str, control_type: str = "text") -> "BlockedHuman":
    """A required core field the profile and the saved answers do not hold.

    1967 (14/09): Greenhouse "First Name" with a profile holding only `name`
    was a hard stop. It is a question the CLOSER works out from the profile
    (CL-08), never a name split in code.
    """
    request = profile_facts.core_answer_request(label, control_type)
    if request is None:
        return BlockedHuman(
            "required_profile_field_missing",
            f"Required {platform} field needs profile data: {_safe_label(label)}",
            step,
        )
    return BlockedHuman(
        "required_answer_missing",
        f"Required {platform} field needs a fact the profile does not state: {_safe_label(label)}",
        step,
        answer_request=request,
    )


def _location_input(recipe, platform, label, field_key, source_key, step):
    def text_answer(present: bool, value: Any) -> str:
        if present and (isinstance(value, bool) or not isinstance(value, (str, int, float))):
            raise _inferred_answer_refused(
                recipe,
                BlockedHuman("answer_type_unknown", f"{platform} location needs text: {_safe_label(label)}", step),
                lambda: None,
            )
        return str(value).strip() if present else ""

    # What to type, in order: the suggestion the CLOSER chose for this field;
    # the place it worked out to search for ("location search", CL-08, from
    # the profile or the CV); the profile's location, only when it names a
    # place (1888 after patch 21: a "…wide" work preference found two villages).
    chosen_present, chosen = recipe._answer_for(label, field_key)
    wanted, origin = text_answer(chosen_present, chosen), "chosen"
    if not wanted:
        search_present, search = recipe._answer_for(location_choice.SEARCH_LABEL, location_choice.SEARCH_KEY)
        wanted, origin = text_answer(search_present, search), "search"
    if not wanted:
        profile_location = profile_facts.profile_value(recipe.profile, "location") or ""
        if location_choice.searchable(profile_location):
            wanted, origin = profile_location, "profile"
            recipe.answer_sources[source_key] = "profile"
    return wanted, origin


def _fill_suggested_location(
    recipe: Any,
    page: Any,
    *,
    platform: str,
    control: Any,
    options: Callable[[], Any],
    accepted: Callable[[str], bool],
    label: str,
    field_key: str,
    required: bool,
    step: str,
) -> None:
    """A location field that keeps only one of its own suggestions (location_choice).

    1888 (14/09): Lever "Current location" stopped with unknown_required_control
    though the profile says where the candidate lives. A place is typed; a
    suggestion is clicked only when it is certainly that place; otherwise the
    suggestions near it are the question's exact options, for the CLOSER to
    choose (CL-08). Suggestions that share nothing with the place are never
    options: the CLOSER is asked what to search for instead.
    """
    source_key = _normalise_label(label) or _normalise_label(field_key)
    search_request = {
        "key": location_choice.SEARCH_KEY,
        "label": location_choice.SEARCH_LABEL,
        "field_type": "text",
        "options": [],
    }

    wanted, origin = _location_input(recipe, platform, label, field_key, source_key, step)
    if not wanted:
        if not required:
            return
        raise BlockedHuman(
            "required_answer_missing",
            f"{platform} location needs a place to search for: {_safe_label(label)}",
            step,
            answer_request=search_request,
        )

    seen: list[str] = []
    answered = False
    for query in location_choice.queries(wanted):
        found = location_choice.suggestions(page, control, options, query)
        answered = answered or bool(found)
        near = location_choice.related(wanted, found)
        seen = seen or near
        choice = location_choice.pick(wanted, near)
        if not choice:
            continue
        if location_choice.click_option(options(), choice):
            page.wait_for_timeout(200)
            if accepted(choice):
                return
        location_choice.dismiss(page, control)
        raise _inferred_answer_refused(
            recipe,
            BlockedHuman("answer_not_accepted", f"{platform} did not keep the chosen location for: {_safe_label(label)}", step),
            lambda: None,
        )
    return _location_stop(
        recipe, page, platform, control, label, required, step,
        source_key, search_request, origin, seen, answered,
    )


def _location_stop(
    recipe, page, platform, control, label, required, step,
    source_key, search_request, origin, seen, answered,
):
    location_choice.dismiss(page, control)
    if origin == "profile":
        recipe.answer_sources.pop(source_key, None)
    if not required:
        return
    exact_label = _exact_form_text(label)
    choices = [text for text in (_exact_form_text(option, maximum=500) for option in seen) if text]
    if choices and exact_label and _normalise_label(exact_label):
        request = {"key": _normalise_label(exact_label), "label": exact_label, "field_type": "select", "options": choices}
        if origin == "chosen":
            # A chosen suggestion the page no longer offers: the CLOSER's own
            # choice is asked again with the options; a user's stays a stop.
            raise _inferred_answer_refused(
                recipe,
                BlockedHuman("answer_option_unknown", f"No {platform} location suggestion matches the saved answer for: {_safe_label(label)}", step),
                lambda: request,
            )
        raise BlockedHuman(
            "required_answer_missing",
            f"Required {platform} location needs one of the page's suggestions: {_safe_label(label)}",
            step,
            answer_request=request,
        )
    if origin == "profile":
        # Nothing near the profile's place: the CLOSER works out what to search.
        raise BlockedHuman(
            "required_answer_missing",
            f"{platform} location found nothing near the profile's place: {_safe_label(label)}",
            step,
            answer_request=search_request,
        )
    if not answered:
        raise BlockedHuman(
            "unknown_required_control",
            f"{platform} location shows no suggestions to choose from: {_safe_label(label)}",
            step,
        )
    # The CLOSER's own search found nothing near it either: asked again, and
    # after the refusal cap only its explicit ask reaches the user.
    raise _inferred_answer_refused(
        recipe,
        BlockedHuman("answer_option_unknown", f"No {platform} location suggestion is near the searched place: {_safe_label(label)}", step),
        lambda: search_request,
    )


def _inferred_answer_refused(recipe: Any, refused: BlockedHuman, request_of: Callable[[], Any]) -> BlockedHuman:
    """An answer the CLOSER worked out that the form refuses is its question again.

    The CLOSER can correct its own answer (a different option, another
    wording); a user's or the profile's answer that does not fit stays a
    human stop, as before.
    """
    key = getattr(recipe, "last_answer_key", "")
    if refused.reason not in _REFUSED_ANSWER_REASONS or recipe.answer_sources.get(key) != "agent_inferred":
        return refused
    try:
        request = request_of()
    except Exception:
        request = None
    if not request:
        return refused
    value = recipe.answers.get(key)
    recipe.answer_sources.pop(key, None)
    again = BlockedHuman(
        "required_answer_missing",
        f"The worked-out answer does not fit the form ({refused.reason})",
        refused.step,
        answer_request=request,
    )
    # Which value was refused, as a digest only: the flow counts repeats.
    again.refused_digest = _value_digest(value)
    return again


def _value_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()[:16]


def _answer_fits(payload: Mapping[str, Any], value: Any) -> bool:
    """Would this saved value fill the question as asked? Exact options, never a guess."""
    field_type = str(payload.get("field_type", ""))
    options = [str(option) for option in payload.get("options") or []]
    if field_type in {"radio", "select"}:
        return isinstance(value, str) and value in options
    if field_type == "checkbox":
        return isinstance(value, bool) or value in {"Yes", "No"}
    if field_type == "checkboxes":
        return (
            isinstance(value, list)
            and bool(value)
            and all(isinstance(item, str) and item in options for item in value)
            and len(set(value)) == len(value)
        )
    if isinstance(value, bool) or value is None:
        return False
    return bool(str(value).strip())


def _answer_sources(value: Any) -> dict[str, str]:
    """A clean key → origin map; anything else in it is dropped, never trusted."""
    if not isinstance(value, Mapping):
        return {}
    return {
        str(key): str(origin)
        for key, origin in value.items()
        if isinstance(key, str) and key and origin in ANSWER_ORIGINS
    }
