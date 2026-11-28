#!/usr/bin/env python3
"""profile_gaps.py — what the profile still lacks for the search the person asked for, and what the onboarding already asked.

A profile with «anywhere» as the place, no residence, no radius, no pay and generic skills makes a scattered search: onsite jobs
far away come first. The fix is not a gate (a search wide on purpose must stay possible, JHT-T351): the
Assistente says what is missing and what it means, and the person decides. This module names the gaps, the
Assistente says them in the person's words, and a gap the person accepted on purpose is not raised again.

  GAP              WHEN                                                         WHAT IT MEANS FOR THE SEARCH
  place_anywhere   `location` says anywhere (Ovunque, anywhere, worldwide...)   results from everywhere, onsite far away too
  residence        no `residence.place`                                          no distance check: far onsite jobs not lowered
  commute          a residence, no `commute_max_km`, work not only remote        no limit on the way to the office
  salary           no `preferences.salary_annual_eur`                            offers without pay are not lowered
  skills           fewer than 3 `skills.primary`                                 the match is generic
  cv               no file in profile/sources                                    skills and experience from the chat only

The onboarding keeps its own notes in $JHT_HOME/profile/onboarding-state.json = {"asked": [...], "accepted": [...]}:
`asked` the topics already asked (a topic is asked once; deeper once on a vague answer), `accepted` the gaps the person chose to
keep. profile_apply.py writes both (`asked`, `accept` in its request) and answers `gaps`, `accepted` and `asked`.

  python3 /app/shared/skills/profile_gaps.py      # {"gaps": [...], "accepted": [...], "asked": [...]}, reads only
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

GAPS = ("place_anywhere", "residence", "commute", "salary", "skills", "cv")
TOPIC = re.compile(r"[a-z][a-z0-9_.-]{0,59}")
MAX_TOPICS = 100
MAX_STATE_BYTES = 16 * 1024
# «anywhere» in the seven languages, as a whole location: a city that only contains one of these words is a city
ANYWHERE = re.compile(
    r"^\s*(ovunque|dovunque|ovunque nel mondo|in tutto il mondo|qualsiasi|anywhere|everywhere|worldwide|world ?wide|any|global|"
    r"überall|ueberall|weltweit|egal|en cualquier lugar|cualquier lugar|cualquiera|en todo el mundo|partout|n'importe où|"
    r"dans le monde entier|em qualquer lugar|qualquer lugar|qualquer|em todo o mundo|bárhol|barhol|mindegy|az egész világon)\s*[.!]?\s*$",
    re.IGNORECASE,
)


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")


def state_path(home: Path | None = None) -> Path:
    return (home or _home()) / "profile" / "onboarding-state.json"


def read_state(home: Path | None = None) -> dict:
    """The notes of the onboarding; anything that is not a clean list of topics is dropped, never an error."""
    path = state_path(home)
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_STATE_BYTES:
            raise ValueError
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    data = data if isinstance(data, dict) else {}
    asked = [t for t in data.get("asked") or [] if isinstance(t, str) and TOPIC.fullmatch(t)][:MAX_TOPICS]
    accepted = [g for g in data.get("accepted") or [] if g in GAPS]
    return {"asked": list(dict.fromkeys(asked)), "accepted": list(dict.fromkeys(accepted))}


def check_notes(asked, accept) -> None:
    """Refuses, before anything is written, a request whose `asked` or `accept` is not what the onboarding can keep."""
    if asked is not None and (not isinstance(asked, list) or any(not isinstance(t, str) or not TOPIC.fullmatch(t) for t in asked)):
        raise ValueError("asked: a list of short topic names (lowercase letters, digits, _ . -), for example [\"residence\", \"salary\"]")
    if accept is not None and (not isinstance(accept, list) or any(g not in GAPS for g in accept)):
        raise ValueError("accept: a list of gaps among " + ", ".join(GAPS))


def write_notes(asked, accept, home: Path | None = None) -> dict:
    state = read_state(home)
    state["asked"] = list(dict.fromkeys(state["asked"] + list(asked or [])))[:MAX_TOPICS]
    state["accepted"] = list(dict.fromkeys(state["accepted"] + list(accept or [])))
    path = state_path(home)
    if path.is_symlink():
        return state
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return state


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _has_cv(home: Path) -> bool:
    sources = home / "profile" / "sources"
    try:
        return any(entry.is_file() and not entry.name.startswith(".") for entry in sources.iterdir())
    except OSError:
        return False


def gaps_of(profile: dict, home: Path | None = None) -> list[str]:
    """Every gap the profile has, in the order the table above gives them (accepted ones included)."""
    profile = profile if isinstance(profile, dict) else {}
    home = home or _home()
    found: list[str] = []
    if ANYWHERE.match(_text(profile.get("location"))):
        found.append("place_anywhere")
    residence = profile.get("residence")
    place = _text(residence.get("place")) if isinstance(residence, dict) else ""
    if not place:
        found.append("residence")
    prefs = profile.get("preferences") if isinstance(profile.get("preferences"), dict) else {}
    if place and profile.get("commute_max_km") in (None, "") and _text(prefs.get("work_mode")).lower() != "remote":
        found.append("commute")
    if not _text(prefs.get("salary_annual_eur")):
        found.append("salary")
    skills = profile.get("skills") if isinstance(profile.get("skills"), dict) else {}
    primary = skills.get("primary") if isinstance(skills.get("primary"), list) else []
    if len([s for s in primary if _text(s)]) < 3:
        found.append("skills")
    if not _has_cv(home):
        found.append("cv")
    return found


def report(profile: dict, home: Path | None = None) -> dict:
    """`gaps` still to say (not accepted), `accepted`, `asked`."""
    state = read_state(home)
    return {"gaps": [g for g in gaps_of(profile, home) if g not in state["accepted"]], "accepted": state["accepted"],
            "asked": state["asked"]}


def main() -> int:
    if any(arg in ("-h", "--help") for arg in sys.argv[1:]):
        print((__doc__ or "").strip())
        return 0
    import yaml

    path = _home() / "profile" / "candidate_profile.yml"
    try:
        profile = yaml.safe_load(path.read_text(encoding="utf-8")) if path.is_file() else {}
    except (OSError, yaml.YAMLError):
        profile = {}
    print(json.dumps(report(profile if isinstance(profile, dict) else {}), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
