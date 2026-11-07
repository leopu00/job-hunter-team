"""Geographic search intent from the profile, independent of keywords and languages.

Place strings stay as declared. Spelling aliases do not imply a country, radius,
visa or permission to relocate. This module performs no geocoding or network I/O.
"""
from __future__ import annotations

import os
import re
import stat
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from city_names import canonical_city

MAX_PROFILE_BYTES = 64 * 1024


class ScopeError(ValueError):
    def __init__(self, code="scout_search_scope_unavailable"):
        super().__init__(code)
        self.code = code


def normalized(text: str) -> str:
    text = "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c))
    return " ".join(re.findall(r"[^\W_]+", text, re.UNICODE))


def _places(value) -> list[str]:
    values = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    return [v.strip() for v in values if isinstance(v, str) and v.strip()]


def place_key(place: str) -> tuple:
    return (canonical_city(place), tuple(normalized(part) for part in place.split(",")[1:]))


def place_match(place: str, returned: str) -> str:
    """Compare declared place names, without claiming a geocoder verified them.

    Different names may still be within commuting distance. They are unmatched,
    not proof of exclusion; a missing location is unknown and must be inspected.
    """
    if not returned.strip():
        return "unknown"
    wanted = canonical_city(place)
    parts = [normalized(part) for part in returned.split(",")]
    if canonical_city(returned) != wanted:
        return "unmatched"
    qualifiers = [normalized(part) for part in place.split(",")[1:] if part.strip()]
    if any(part not in parts[1:] for part in qualifiers):
        return "unmatched" if len(parts) > 1 else "unknown"
    return "matched"


@dataclass(frozen=True)
class SearchScope:
    places: tuple[str, ...]
    work_mode: str
    relocation: object

    def select(self, requested: str | None = None) -> str:
        if not requested:
            return self.places[0]
        # A source's suggested city never becomes permission to relocate. A
        # translated spelling is allowed, but keep the profile's canonical text.
        for place in self.places:
            if place_key(requested) == place_key(place):
                return place
        raise ScopeError("scout_search_scope_conflict")

    def assess(self, results: list[dict], selected: str) -> tuple[list, dict | None]:
        from scout_search_outcomes import failure
        assessed = [{**row, "scope_match": place_match(selected, row.get("location") or "")} for row in results]
        states = {row["scope_match"] for row in assessed}
        if "unmatched" in states and "matched" not in states:
            return assessed, failure("scout_search_geo_mismatch")
        return assessed, None


def from_profile(profile: dict) -> SearchScope:
    if not isinstance(profile, dict):
        raise ScopeError()
    prefs = profile.get("preferences") or {}
    personal = profile.get("personal") or {}
    if not isinstance(prefs, dict) or not isinstance(personal, dict):
        raise ScopeError()
    base = _places(profile.get("location") or personal.get("location"))
    preferred = _places(profile.get("location_preferences") or prefs.get("location_preferences"))
    # Named preferences are the search target; a residence is only the fallback.
    places = preferred or base
    if not places:
        raise ScopeError()
    mode = prefs.get("work_mode") or profile.get("work_mode") or ""
    if not isinstance(mode, str):
        raise ScopeError()
    relocation = prefs.get("relocation", profile.get("relocation"))
    return SearchScope(tuple(dict.fromkeys(places)), mode, relocation)


def read_scope(path: Path) -> SearchScope:
    import yaml
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PROFILE_BYTES:
            raise ScopeError()
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(MAX_PROFILE_BYTES + 1)
        if len(raw) > MAX_PROFILE_BYTES:
            raise ScopeError()
        return from_profile(yaml.safe_load(raw))
    except (yaml.YAMLError, UnicodeError) as exc:
        raise ScopeError() from exc
    finally:
        os.close(fd)


def resolve(args) -> SearchScope | None:
    path = Path(args.profile) if args.profile else Path(os.environ.get("JHT_HOME", "/jht_home")) / "profile/candidate_profile.yml"
    try:
        return read_scope(path)
    except FileNotFoundError as exc:
        if args.profile:
            raise ScopeError() from exc
        # Standalone maintenance commands may still use an explicit location.
        if args.location:
            return SearchScope((args.location,), "", None)
        raise ScopeError() from exc
    except OSError as exc:
        raise ScopeError() from exc


def run_search(access, args) -> tuple[list, dict | None]:
    from scout_search_outcomes import failure
    if args.limit <= 0 or args.posted_within_days <= 0:
        return [], failure("scout_search_input_invalid", source_attempted=False)
    try:
        scope = resolve(args)
        location = scope.select(args.location)
    except ScopeError as exc:
        return [], failure(exc.code, source_attempted=False)
    results, outcome = access.search_ex(args.keywords, location, args.limit, args.posted_within_days)
    if outcome:
        return results, outcome
    return scope.assess(results, location)
