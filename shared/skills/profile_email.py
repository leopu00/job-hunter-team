#!/usr/bin/env python3
"""Where the candidate's email lives in the profile, in one place.

The same email is read by the checklist `jht profile import` runs
(validate_profile.py), by every application recipe (profile_facts, apply_flow,
workday_apply, apply_generic) and by the email channel. They used to keep their
own lists, so a profile could pass the checklist and still not be found by the
application (or the other way round).

The places are the ones the canonical schema (shared/config/profile-schema.ts) and
the app (web/lib/profile-completion.ts hasEmail) accept, plus the two the Assistant
has always written. The first non-empty string wins, in this order.
"""

from __future__ import annotations

from typing import Any, Mapping

EMAIL_PATHS: tuple[tuple[str, ...], ...] = (
    ("contacts", "email"),  # schema: contacts at the root
    ("email",),  # schema and app: the root
    ("candidate", "contacts", "email"),  # the Assistant's
    ("personal", "email"),  # the Assistant's
    ("positioning", "contacts", "email"),  # app hasEmail
)


def profile_email(profile: Any) -> str | None:
    """The profile's email, stripped, or None when no place holds a non-empty string."""
    if not isinstance(profile, Mapping):
        return None
    for path in EMAIL_PATHS:
        value: Any = profile
        for part in path:
            if not isinstance(value, Mapping):
                value = None
                break
            value = value.get(part)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None
