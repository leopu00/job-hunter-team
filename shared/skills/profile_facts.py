#!/usr/bin/env python3
"""Core identity facts of the candidate profile, for every CLOSER recipe.

Why. Position 1967 (14/09): Greenhouse asked for "First Name", the recipe
looked for `first_name` at the root of the profile, the real profile has only
`name`, and the application stopped with required_profile_field_missing —
a hard stop for a fact the CLOSER can work out from the profile itself
(CL-08). Each recipe also had its own idea of where the facts live.

The rule, the same for Ashby, Greenhouse, Lever and the generic recipe:

  1. the profile, under the known aliases (`profile_value`);
  2. the saved application answers (the recipe's `_answer_for`);
  3. otherwise the field is a question: `core_answer_request(label)` gives
     the exact answer_request (field_type text), the flow hands it to the
     CLOSER as pending_question, and the CLOSER saves "first name" / "last
     name" from `name` with --basis profile.

Never split or join a name in code: "María José García López" has no rule
a regex can know. The CLOSER decides, and says on what basis.
"""

from __future__ import annotations

from typing import Any, Mapping

try:
    from application_answers import normalise_label
except ImportError:  # pragma: no cover - package import
    from shared.skills.application_answers import normalise_label

CORE_ALIASES: dict[str, tuple[tuple[str, ...], ...]] = {
    "first name": (("first_name",), ("given_name",), ("firstName",), ("givenName",), ("contacts", "first_name")),
    "last name": (("last_name",), ("family_name",), ("surname",), ("lastName",), ("familyName",), ("contacts", "last_name")),
    "full name": (("name",), ("full_name",), ("fullName",), ("contacts", "name")),
    "email": (("contacts", "email"), ("email",)),
    "phone": (("contacts", "phone"), ("phone",)),
    "linkedin": (("contacts", "linkedin"), ("linkedin",)),
    "github": (("contacts", "github"), ("github",)),
    "website": (("contacts", "website"), ("website",), ("contacts", "portfolio"), ("portfolio",)),
    "location": (("location",), ("contacts", "location"), ("city",)),
}

TEXT_FIELD_TYPES = frozenset({"text", "email", "tel", "url"})


def _at(profile: Mapping[str, Any], path: tuple[str, ...]) -> Any:
    value: Any = profile
    for part in path:
        if not isinstance(value, Mapping):
            return None
        value = value.get(part)
    return value


def profile_value(profile: Mapping[str, Any] | None, fact: str) -> str | None:
    """The profile's own string for `fact` under a known alias, else None.

    Only non-empty strings: a boolean or an object is not a name, and turning
    it into text would bypass the profile schema.
    """
    if not isinstance(profile, Mapping):
        return None
    for path in CORE_ALIASES.get(fact, ()):
        value = _at(profile, path)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return None


def core_answer_request(label: str, field_type: str = "text") -> dict[str, Any] | None:
    """The question for a core field the profile does not hold, or None."""
    exact = " ".join(str(label or "").replace(" ", " ").split()).rstrip("*✱ ").strip()[:1000]
    key = normalise_label(exact)
    if not exact or not key:
        return None
    kind = field_type if field_type in TEXT_FIELD_TYPES else "text"
    return {"key": key, "label": exact, "field_type": kind, "options": []}
