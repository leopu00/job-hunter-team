#!/usr/bin/env python3
"""scout_seniority.py — is the level a title names above, below or at the level of THIS profile? A closed code, for ordering.

Measured on a first run: of 35 positions the Scouts inserted, 10 never got a score, and 5 of them were dropped by the Analista
for seniority («Head of Data», «Senior Consultant», «Principal …»), a word that stood in the TITLE the list had shown. Each
had cost a search, the fetch of the full ad, a dedup and an INSERT, and the 20th score came about four minutes later for it.

The Scout may not drop it (rule SC-04: priority yes, exclusion no: the Scorer owns the seniority gap), but it may put it
LATER. This module says when a title is not for the level of the profile, and the Scout inserts the candidates without that
code first. The level is the profile's, never a fixed one: for a senior profile «Senior» and «Principal» are the target and
get no code at all; for a junior one they are `above`.

  profile level   `seniority_target` (junior|mid|senior, also under `positioning`), else from `experience_years`
                  (up to 2 junior, 3 to 6 mid, 7 and more senior). Not readable: no code (`unknown`).
  title level     the level words of the title (scout_seniority_lexicon.json): junior < mid < senior < executive.
                  No level word, or words of several levels that offer a choice («Junior / Senior»): no code.
  code            `above` (the title is higher than the profile), `below` (lower), `compatible`, `unknown`.

`screen` of scout_language.py adds `"seniority": "above"|"below"` to its answer when it applies (and nothing otherwise).

What it outputs is a closed set of codes: never the text it was given.

Use:
  python3 scout_seniority.py check --title "Head of Data & BI"
  python3 scout_seniority.py profile
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
RANK = {"junior": 0, "mid": 1, "senior": 2, "executive": 3}


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "").lower().replace("ß", "ss"))
    return "".join(c for c in text if not unicodedata.combining(c))


def _lexicon() -> dict:
    return json.loads((HERE / "scout_seniority_lexicon.json").read_text(encoding="utf-8"))


_LEX = _lexicon()
_WORDS = {level: frozenset(spec["words"]) for level, spec in _LEX["levels"].items()}
_PHRASES = {level: tuple(spec["phrases"]) for level, spec in _LEX["levels"].items()}
_IGNORE = tuple(_LEX["ignore"])


def _normal(title: str) -> str:
    """Folded, punctuation read as a space, one space between words."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", fold(title)).split())


def title_levels(title: str) -> set[str]:
    text = " %s " % _normal(title)
    for phrase in _IGNORE:
        text = text.replace(" %s " % phrase, "  ")
    found = set()
    for level, phrases in _PHRASES.items():
        if any(" %s " % p in text for p in phrases):
            found.add(level)
    tokens = set(text.split())
    for level, words in _WORDS.items():
        if tokens & words:
            found.add(level)
    return found


def title_level(title: str):
    """The one level a title names, or None: no level word, or words that offer a choice («Junior / Senior»)."""
    found = title_levels(title)
    if len(found) == 1:
        return next(iter(found))
    if found and found <= {"senior", "executive"}:
        return "executive"  # «Senior Director»: the higher word is the level
    return None


def _from_target(value) -> str | None:
    text = fold(value)
    if not text:
        return None
    for level, words in (("executive", ("executive", "director", "head", "vp", "chief")), ("senior", ("senior", "sr", "lead", "principal")),
                         ("junior", ("junior", "jr", "entry", "trainee", "intern", "graduate")), ("mid", ("mid", "middle", "intermediate", "pleno", "medior"))):
        if any(w in re.findall(r"[a-z]+", text) for w in words):
            return level
    return None


def _from_years(value) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return "junior" if value <= 2 else "mid" if value <= 6 else "senior"


def profile_level(profile_path=None):
    """junior|mid|senior|executive of the profile, or None when it cannot be told."""
    path = Path(profile_path) if profile_path else Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht")) / "profile" / "candidate_profile.yml"
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001 — no profile, no yaml, a broken file: no answer, never a guess
        return None
    if not isinstance(data, dict):
        return None
    positioning = data.get("positioning") if isinstance(data.get("positioning"), dict) else {}
    candidate = data.get("candidate") if isinstance(data.get("candidate"), dict) else {}
    for source in (data, positioning, candidate):
        level = _from_target(source.get("seniority_target"))
        if level:
            return level
    for source in (data, candidate):
        level = _from_years(source.get("experience_years"))
        if level:
            return level
    return None


def compare(title: str, level) -> str:
    """`above`, `below`, `compatible` or `unknown` (the profile's level is not known)."""
    if level not in RANK:
        return "unknown"
    named = title_level(title)
    if named is None:
        return "compatible"
    diff = RANK[named] - RANK[level]
    return "above" if diff > 0 else "below" if diff < 0 else "compatible"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scout_seniority", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "profile"):
        p = sub.add_parser(name)
        p.add_argument("--profile", default=None, help="default: $JHT_HOME/profile/candidate_profile.yml")
    sub.choices["check"].add_argument("--title", required=True)
    args = ap.parse_args(argv)
    level = profile_level(args.profile)
    if args.cmd == "profile":
        print(json.dumps({"profile_level": level or "unknown"}, sort_keys=True))
        return 0
    print(json.dumps({"seniority": compare(args.title, level), "title_level": title_level(args.title) or "none",
                      "profile_level": level or "unknown"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
