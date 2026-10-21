#!/usr/bin/env python3
"""text_language.py — which language a piece of free text is written in, roughly.

A cheap, deterministic guess (stop words plus a few letters that belong to one language), meant for
a WARNING and never a refusal: everything the user reads is written in the user's language
(RULE-T14), and a validator can tell when a long enough text is clearly in another one. Short or
mixed text gives no answer (None), so a job title or a list of tools never raises it.

    python3 text_language.py lang                 # the user's language now (i18n-prefs.json, JHT_LANG)
    python3 text_language.py guess "some text"    # the language the text looks to be in, or "unknown"
    python3 text_language.py check "some text"    # exit 0 if it fits the user's language or is unclear, 3 if not
"""
from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIN_WORDS = 8
MIN_SCORE = 3
# The winner must beat the runner-up by this factor, or the text is mixed and there is no answer.
MARGIN = 1.5
LANGUAGES = ("en", "it", "hu", "es", "de", "fr", "pt")
# Letters that belong to one language (among these seven) and weigh more than a stop word.
SIGNATURE_LETTERS = {"hu": "őű", "de": "ß", "es": "ñ¿¡", "pt": "ãõ", "fr": "œ"}
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


@lru_cache(maxsize=1)
def _words() -> dict[str, frozenset[str]]:
    raw = json.loads((HERE / "text_language_words.json").read_text(encoding="utf-8"))
    return {lang: frozenset(raw[lang]) for lang in LANGUAGES}


def guess_language(text: str) -> str | None:
    """The language `text` is written in, or None when it is too short or too mixed to say."""
    if not isinstance(text, str):
        return None
    tokens = [w.lower() for w in _WORD.findall(text)]
    if len(tokens) < MIN_WORDS:
        return None
    scores = {lang: 0 for lang in LANGUAGES}
    for lang, words in _words().items():
        scores[lang] += sum(1 for t in tokens if t in words)
    lowered = text.lower()
    for lang, letters in SIGNATURE_LETTERS.items():
        scores[lang] += 3 * sum(lowered.count(ch) for ch in letters)
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (best, top), (_, second) = ranked[0], ranked[1]
    if top < MIN_SCORE or top < MARGIN * second:
        return None
    return best


def user_language() -> str:
    """The user's language now: i18n-prefs.json, then $JHT_LANG, then host.env, then en."""
    sys.path.insert(0, str(HERE.parent))
    try:
        import i18n  # shared/i18n.py: the same resolution the shell, the CLI and the bridges use

        return i18n.current_lang()
    except Exception:
        return "en"
    finally:
        sys.path.pop(0)


def wrong_language(text: str, expected: str | None = None) -> str | None:
    """The language `text` is clearly written in when it is not `expected` (default: the user's), else None."""
    guess = guess_language(text)
    if guess is None:
        return None
    return guess if guess != (expected or user_language()) else None


def main(argv: list[str]) -> int:
    if len(argv) >= 1 and argv[0] == "lang":
        print(user_language())
        return 0
    if len(argv) == 2 and argv[0] in ("guess", "check"):
        guess = guess_language(argv[1])
        if argv[0] == "guess":
            print(guess or "unknown")
            return 0
        expected = user_language()
        if guess is not None and guess != expected:
            print(f"WRONG_LANGUAGE: the text looks {guess}, the user's language is {expected}", file=sys.stderr)
            return 3
        print("OK")
        return 0
    print("usage: text_language.py lang | guess TEXT | check TEXT", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
