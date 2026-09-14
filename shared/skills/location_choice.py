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


def click_option(options: Any, text: str) -> bool:
    """Click the visible suggestion whose text is exactly `text`."""
    count = min(options.count(), _MAX_OPTIONS)
    for index in range(count):
        option = options.nth(index)
        if option.is_visible() and " ".join(str(option.inner_text() or "").split()) == text:
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
