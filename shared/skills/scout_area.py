#!/usr/bin/env python3
"""scout_area.py — is a position PROVABLY outside the area the profile accepts?

Measured on a real burst (11/11): 19 of the 30 positions the Scouts handed over and the Analistas excluded were onsite or
hybrid in another country («Stockholm, Sweden», «Zürich, CH», «United Kingdom») for a candidate based in Bologna who asked for
remote or hybrid and did not say she would relocate. Each of them cost a Scout search, an INSERT and an analysis.

A position is OUTSIDE when ALL of these hold; any doubt is «ok», because a city name proves nothing about distance:
  * its work is onsite or hybrid (`remote_type`), and its location does not say «remote»;
  * the location NAMES a country (a country name, in English or the country's own language, or a country code such as `CH`);
  * that country is not one of the profile's home countries: the country written in the profile's own places («Bologna, Italy»),
    else the home of its native language (`language_home` in scout_coverage_table.json; English says nothing);
  * the profile does not say it is willing to relocate (`preferences.relocation`: true or a text that is not a no).
No place is geocoded and nothing goes out on the network. A profile that cannot be read, or says nothing about where the person
lives, gives «ok».

    python3 scout_area.py check --location "Stockholm, Sweden" --remote-type onsite [--profile FILE]

Output: one JSON line: {"verdict": "ok"|"outside", "reason": ...}. Exit 0 ok, 4 outside, 2 usage.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

OUTSIDE_EXIT = 4
NOT_MOBILE = {"", "no", "none", "never", "false", "0", "n/a", "na", "non", "nessuno", "no relocation", "not willing", "unknown"}


def _table() -> dict:
    return json.loads((HERE / "scout_coverage_table.json").read_text(encoding="utf-8"))


def _plain(text: str) -> str:
    text = "".join(c for c in unicodedata.normalize("NFKD", str(text).casefold()) if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9.]+", text))


def country_of(location, table: dict | None = None):
    """The country code a location string NAMES (a name or a code in one of its comma, slash or bracket parts), or None."""
    if not isinstance(location, str) or not location.strip():
        return None
    table = table or _table()
    names = {}
    for code, listed in table["country_names"].items():
        names[code] = code
        for name in listed:
            names[_plain(name)] = code
    codes = set(table["country_names"])
    found = []
    for part in re.split(r"[,;/|()\-–]+", location):
        raw = part.strip()
        if not raw:
            continue
        plain = _plain(raw)
        if plain in names and (plain not in codes or raw.isupper() or len(plain) > 2):
            found.append(names[plain])
        elif len(raw) == 2 and raw.isupper() and raw.lower() in codes:
            found.append(raw.lower())
        else:
            for word in plain.split():
                if word in names and len(word) > 3:
                    found.append(names[word])
    return found[-1] if found else None


def relocation_allowed(value) -> bool:
    """`preferences.relocation`: True, or a text that is not a no. Unset (None) is NOT willing: it is never assumed."""
    if value is True:
        return True
    if isinstance(value, str):
        return _plain(value) not in NOT_MOBILE and not _plain(value).startswith("no ")
    return False


def _profile_path(profile=None) -> Path:
    return Path(profile) if profile else Path(os.environ.get("JHT_HOME") or "/jht_home") / "profile" / "candidate_profile.yml"


def read_area(profile=None, table: dict | None = None) -> dict | None:
    """{"home": [codes], "relocation": bool, "work_mode": str} from the profile, or None when it cannot be read or says nothing about
    where the person lives (then nothing can be proven)."""
    table = table or _table()
    try:
        import scout_search_scope as scope_mod
        import scout_language as lang
        path = _profile_path(profile)
        scope = scope_mod.read_scope(path)
        spoken = lang.read_languages(path)
    except Exception:  # noqa: BLE001 — no profile, no yaml, a broken file: no answer, never a guess
        return None
    home = sorted({c for c in (country_of(place, table) for place in scope.places) if c})
    if not home and spoken:
        top = max(spoken.values())
        for code, score in sorted(spoken.items()):
            if score == top and code in table.get("language_home", {}):
                home.extend(table["language_home"][code])
        home = sorted(set(home))
    if not home:
        return None
    return {"home": home, "relocation": relocation_allowed(scope.relocation), "work_mode": scope.work_mode}


def verdict(location, remote_type, area: dict | None, table: dict | None = None) -> dict:
    if not area:
        return {"verdict": "ok", "reason": "no profile area to compare with"}
    if area["relocation"]:
        return {"verdict": "ok", "reason": "the profile is willing to relocate"}
    if remote_type not in ("onsite", "hybrid"):
        return {"verdict": "ok", "reason": "not an onsite or hybrid position"}
    if isinstance(location, str) and re.search(r"\bremot[eo]\b|\bfull[- ]remote\b|\bsmart ?working\b", location, re.I):
        return {"verdict": "ok", "reason": "the location says remote"}
    country = country_of(location, table)
    if country is None:
        return {"verdict": "ok", "reason": "the location names no country"}
    if country in area["home"]:
        return {"verdict": "ok", "reason": "the country is the profile's"}
    return {"verdict": "outside", "country": country, "home": area["home"],
            "reason": "%s in %s: the profile lives in %s, wants remote or hybrid and says nothing about relocating" % (
                remote_type, country.upper(), "/".join(h.upper() for h in area["home"]))}


def check_position(location, remote_type, profile=None) -> dict:
    """The verdict for one position against the profile. Never raises: a doubt is «ok»."""
    try:
        table = _table()
        return verdict(location, remote_type, read_area(profile, table), table)
    except Exception as exc:  # noqa: BLE001
        return {"verdict": "ok", "reason": "could not compare (%s)" % type(exc).__name__}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scout_area", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("--location", required=True)
    c.add_argument("--remote-type", choices=["full_remote", "hybrid", "onsite"], default=None)
    c.add_argument("--profile", default=None)
    args = ap.parse_args(argv)
    result = check_position(args.location, args.remote_type, args.profile)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return OUTSIDE_EXIT if result["verdict"] == "outside" else 0


if __name__ == "__main__":
    sys.exit(main())
