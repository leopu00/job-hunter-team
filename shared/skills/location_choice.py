#!/usr/bin/env python3
"""A location field that only takes one of its own suggestions.

Why. Position 1888 (14/09): Lever's "Current location" is an autocomplete —
the typed text is not what Lever keeps, a hidden `selectedLocation` filled by
clicking a suggestion is — and the recipe stopped with unknown_required_control
plus a Telegram question, though the profile says where the candidate lives.
Greenhouse's "Location (City)" (a react-select fed by a geocoder) and company
forms with a combobox are the same control.

The rule, for every recipe:

  1. type the saved answer, else the profile's location, as a person would,
     key by key (Lever searches on keydown, react-select on each input);
  2. read the suggestions the page shows;
  3. pick one only when it is certainly the same place: the exact suggestion
     text, or the same city AND the same country (first and last comma part);
  4. otherwise the suggestions become a pending_question with those exact
     options, for the CLOSER to choose from with its basis (CL-08) — never an
     ask to the user by itself, never a guess between two Milans.

Pure matching plus one browser primitive; the flow owns the stops.
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Callable, Iterable

SUGGESTION_TIMEOUT_MS = 5_000
SUGGESTION_SETTLE_MS = 600
_POLL_MS = 150
_MAX_OPTIONS = 50


def _norm(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text or ""))
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()
    return " ".join(re.sub(r"[^\w,]+", " ", plain).split())


def _flat(text: str) -> str:
    return " ".join(_norm(text).replace(",", " ").split())


def parts(text: str) -> tuple[str, str]:
    """(city, country): the first and the last comma-separated part, "" when absent."""
    tokens = [token.strip() for token in _norm(text).split(",")]
    tokens = [token for token in tokens if token]
    if not tokens:
        return "", ""
    return tokens[0], tokens[-1] if len(tokens) > 1 else ""


def pick(wanted: str, suggestions: Iterable[str]) -> str | None:
    """The one suggestion that is certainly `wanted`, else None.

    The exact text wins (a saved option). Otherwise the city and the country
    must both match, and only one suggestion may do so: "Milan" alone, or two
    "Milan, ..., Italy", is a choice for the CLOSER, not for a regex.
    """
    options = [str(option) for option in suggestions if str(option).strip()]
    exact = [option for option in options if _flat(option) == _flat(wanted)]
    if exact:
        return exact[0] if len(exact) == 1 else None
    city, country = parts(wanted)
    if not city or not country:
        return None
    same = [option for option in options if parts(option) == (city, country)]
    return same[0] if len(same) == 1 else None


# A profile "location" that names no place to search for (1888 after patch 21,
# 14/09: a "…wide" work preference typed into Lever's geocoder returned two
# villages called Wide). Whole words only, seven languages.
_NOT_A_PLACE = frozenset(
    "remote remotely worldwide wide anywhere global globally international internationally hybrid "
    "flexible relocation relocate nationwide countrywide online distributed telecommute homeoffice "
    "remoto remota ovunque mondo mondiale qualsiasi ibrido "
    "weltweit überall ueberall mobil hybrid "
    "télétravail teletravail partout monde mondial hybride distance "
    "cualquier mundial híbrido hibrido teletrabajo "
    "qualquer mundial híbrido teletrabalho "
    "távmunka tavmunka bárhol barhol világszerte vilagszerte hibrid".split()
)

SEARCH_KEY = "location search"
SEARCH_LABEL = "Location search"


def _words(text: str) -> list[str]:
    return [word for word in _flat(text).split() if word]


def searchable(text: str) -> bool:
    """Does `text` name a place a geocoder can look up (a city, a country)?"""
    words = _words(text)
    return bool(words) and any(ch.isalpha() for ch in "".join(words)) and not any(
        word in _NOT_A_PLACE for word in words
    )


def related(wanted: str, suggestions: Iterable[str]) -> list[str]:
    """The suggestions that share a word with the searched place.

    A geocoder answers something for anything: "Wide, Aceh, Indonesia" for a
    work preference is not an option the CLOSER should be offered. A word in
    common, or four letters in common at the start ("Milano" for "Milan",
    "Italia" for "Italy"), keeps a suggestion.
    """
    stems = [word for word in _words(wanted) if len(word) >= 3 and word not in _NOT_A_PLACE]

    def near(word: str, stem: str) -> bool:
        return word == stem or (len(word) >= 4 and len(stem) >= 4 and word[:4] == stem[:4])

    return [
        option
        for option in suggestions
        if any(near(word, stem) for word in _words(option) for stem in stems)
    ]


def queries(wanted: str) -> list[str]:
    """What to type: the whole value, then its city alone."""
    whole = " ".join(str(wanted or "").split())
    city = whole.split(",")[0].strip()
    return [whole, city] if city and city != whole else ([whole] if whole else [])


def _visible_texts(options: Any) -> list[str]:
    texts: list[str] = []
    try:
        count = min(options.count(), _MAX_OPTIONS)
        for index in range(count):
            option = options.nth(index)
            if not option.is_visible():
                continue
            text = " ".join(str(option.inner_text() or "").split())
            if text and text not in texts:
                texts.append(text)
    except Exception:
        return texts
    return texts


def suggestions(
    page: Any,
    control: Any,
    options: Callable[[], Any],
    query: str,
    *,
    timeout_ms: int = SUGGESTION_TIMEOUT_MS,
    settle_ms: int = SUGGESTION_SETTLE_MS,
) -> list[str]:
    """Type `query` key by key and return the suggestions once they stop changing."""
    control.click()
    control.fill("")
    control.press_sequentially(query, delay=25)
    deadline = time.monotonic() + timeout_ms / 1000
    last: list[str] = []
    stable_since = None
    while time.monotonic() < deadline:
        page.wait_for_timeout(_POLL_MS)
        current = _visible_texts(options())
        if current and current == last:
            stable_since = stable_since or time.monotonic()
            if (time.monotonic() - stable_since) * 1000 >= settle_ms:
                return current
        else:
            stable_since = None
        last = current
    return last


# True when a click on the element cannot send its form. A <button> inside a
# form with no type (or type submit/reset) IS the form's submit: a drop-down
# toggle or an option written that way would send the application before the
# gate, the cap and submit_started (review of c45133af9, 14/09: a contact form
# went out empty from a listbox click).
NEVER_SUBMITS_JS = (
    "el => el.tagName !== 'BUTTON' || !el.form"
    " || (el.getAttribute('type') || '').trim().toLowerCase() === 'button'"
)


def never_submits(element: Any) -> bool:
    try:
        return bool(element.evaluate(NEVER_SUBMITS_JS))
    except Exception:
        return False


def click_option(options: Any, text: str) -> bool:
    """Click the visible suggestion whose text is exactly `text`, never a submit."""
    count = min(options.count(), _MAX_OPTIONS)
    for index in range(count):
        option = options.nth(index)
        if option.is_visible() and " ".join(str(option.inner_text() or "").split()) == text:
            if not never_submits(option):
                return False
            option.click()
            return True
    return False


def dismiss(page: Any, control: Any) -> None:
    """Leave the field empty and closed: nothing typed stays behind a refused pick."""
    try:
        control.press("Escape")
        control.fill("")
        page.wait_for_timeout(50)
    except Exception:
        pass
