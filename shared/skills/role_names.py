#!/usr/bin/env python3
"""role_names.py — the names of the team's roles as the person reads them (JHT-T358).

One catalog, shared/i18n/role-names.json, for the seven languages. The ids stay what they are everywhere else (sessions
CAPITANO, SCOUT-2, folders agents/<role>, the database, the files): only the name shown changes.

    name("capitano", "hu")        -> "Kapitány"
    title("SCOUT-2", "hu")        -> "Felderítő 2"        title("CRITICO-S1", "de") -> "Kritiker S1"
    fill("Ask the {role:capitano}.", "fr") -> "Ask the Capitaine."
    line("hu")                    -> the [ROLE-NAMES] line of an agent's kickoff

    python3 role_names.py line [<lang>]     the [ROLE-NAMES] line (lang: the team's language when omitted)
    python3 role_names.py name <role> [<lang>]
"""
from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG_PATHS = (HERE.parent / "i18n" / "role-names.json", Path("/app/shared/i18n/role-names.json"))
PLACEHOLDER = re.compile(r"\{role:([a-z]+)\}")


@lru_cache(maxsize=1)
def catalog() -> dict:
    for path in CATALOG_PATHS:
        try:
            return json.loads(path.read_text(encoding="utf-8"))["roles"]
        except (OSError, ValueError, KeyError):
            continue
    return {}


def _lang(lang) -> str:
    code = str(lang or "").lower()[:2]
    return code if code in ("en", "it", "de", "es", "fr", "pt", "hu") else "en"


def name(role: str, lang=None) -> str:
    """The role's name in `lang` (English when the language is not one of the seven); an unknown role, capitalised."""
    role = str(role or "").lower()
    names = catalog().get(role)
    if not names:
        return role[:1].upper() + role[1:]
    return names.get(_lang(lang)) or names.get("en") or role


def title(session: str, lang=None) -> str:
    """A session as the person reads it: the role's name, then the instance («SCOUT-2» -> «Felderítő 2»)."""
    role, *rest = str(session or "").strip().lower().removeprefix("jht-").split("-")
    return " ".join([name(role, lang), *(part.upper() for part in rest if part)])


def fill(text: str, lang=None) -> str:
    """Every {role:<id>} of a text replaced with the name in `lang`; the rest of the text as it is."""
    if not isinstance(text, str) or "{role:" not in text:
        return text
    return PLACEHOLDER.sub(lambda found: name(found.group(1), lang), text)


def line(lang=None) -> str:
    """[ROLE-NAMES] for a kickoff: the names to use with the person, the ids stay in the commands."""
    roles = catalog()
    pairs = ", ".join(f"{role}={name(role, lang)}" for role in roles)
    return f"[ROLE-NAMES] {_lang(lang)}: {pairs}"


def _team_lang():
    try:
        sys.path.insert(0, str(HERE))
        import text_language

        return text_language.user_language()
    except Exception:  # noqa: BLE001 — no language known: English
        return None


def main(argv) -> int:
    if len(argv) >= 2 and argv[1] == "line":
        print(line(argv[2] if len(argv) > 2 else _team_lang()))
        return 0
    if len(argv) >= 3 and argv[1] == "name":
        print(name(argv[2], argv[3] if len(argv) > 3 else _team_lang()))
        return 0
    print("usage: role_names.py line [<lang>] | name <role> [<lang>]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
