#!/usr/bin/env python3
"""Why a vacancy page did not open: gone, guarded by an anti-bot wall, or down for now.

Why. Positions 1798 and 1893 (14/09) stopped with page_unavailable ("Application
page did not return a successful response") on real careers sites. That one
reason hid three situations with three different remedies:

  not_found       404/410 — the page is gone. The flow calls it vacancy_closed
                  only when the vacancy-closed evidence agrees; otherwise
                  page_not_found.
  bot_protection  401/403/429, or a challenge page (Cloudflare "Just a moment",
                  DataDome, PerimeterX, Incapsula, Sucuri, Akamai), even behind
                  a 200 — one try in a visible browser, then a human stop. The
                  CLOSER never solves a challenge.
  temporary       5xx, a timeout, a network error — nothing for the user to do:
                  the position waits and is tried again later, at most
                  MAX_TRANSIENT times in TRANSIENT_WINDOW, without a notice.

Pure functions, no browser and no network: the flow gives the status, the
final URL, the title and the HTML it saw.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

OK = "ok"
NOT_FOUND = "not_found"
BOT_PROTECTION = "bot_protection"
TEMPORARY = "temporary"

MAX_TRANSIENT = 3
TRANSIENT_WINDOW = timedelta(hours=24)
RETRY_DELAY = timedelta(hours=1)

# Vendor fingerprints of challenge / block pages.  Specific strings only: a
# careers page that merely loads a captcha widget in its form is not a wall.
_CHALLENGE_MARKERS = tuple(
    re.compile(pattern, re.I)
    for pattern in (
        r"<title>\s*just a moment\.{0,3}\s*</title>",
        r"<title>\s*attention required!?\s*\|\s*cloudflare\s*</title>",
        r"cdn-cgi/challenge-platform",
        r"\bcf-chl-",
        r"checking your browser before accessing",
        r"enable javascript and cookies to continue",
        r"captcha-delivery\.com",  # DataDome
        r"\bpx-captcha\b|press (?:&amp;|&) hold",  # PerimeterX / HUMAN
        r"_incapsula_resource|incapsula incident id",  # Imperva
        r"sucuri website firewall",
        r"<title>\s*access denied\s*</title>[\s\S]{0,4000}reference\s*#",  # Akamai
        r"verify you are (?:a )?human",
        r"are you a robot\??",
    )
)
_BOT_STATUSES = frozenset({401, 403, 429})
_GONE_STATUSES = frozenset({404, 410})


@dataclass(frozen=True)
class Verdict:
    kind: str
    evidence: str


def challenge_evidence(html: str) -> str:
    """The first challenge fingerprint in the page, or ""."""
    for marker in _CHALLENGE_MARKERS:
        found = marker.search(html or "")
        if found:
            return " ".join(found.group(0).split())[:80]
    return ""


def classify(
    status: int | None,
    html: str = "",
    *,
    timed_out: bool = False,
    network_error: bool = False,
) -> Verdict:
    """What a navigation result means for the application."""
    if timed_out:
        return Verdict(TEMPORARY, "timeout")
    if network_error or status is None:
        return Verdict(TEMPORARY, "network_error")
    wall = challenge_evidence(html)
    if status in _BOT_STATUSES:
        return Verdict(BOT_PROTECTION, f"http_{status}" + (f" {wall}" if wall else ""))
    if wall:
        return Verdict(BOT_PROTECTION, f"http_{status} {wall}")
    if status in _GONE_STATUSES:
        return Verdict(NOT_FOUND, f"http_{status}")
    if status >= 500 or status == 408:
        return Verdict(TEMPORARY, f"http_{status}")
    if status >= 400:
        return Verdict(NOT_FOUND, f"http_{status}")
    return Verdict(OK, f"http_{status}")


def safe_url(url: str) -> str:
    """scheme://host[:port]/path — no query, no fragment, no credentials."""
    try:
        parts = urllib.parse.urlsplit(str(url or ""))
        host = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
    except ValueError:
        return ""
    if not parts.scheme or not host:
        return ""
    return urllib.parse.urlunsplit((parts.scheme, f"{host}{port}", parts.path, "", ""))


def _instant(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def note_transient(
    history: Iterable[str], now: datetime | None = None
) -> tuple[list[str], bool, str]:
    """Record one temporary failure.

    Returns (history within the window including this one, exhausted,
    retry_after ISO). `exhausted` is true on the MAX_TRANSIENT-th failure
    inside TRANSIENT_WINDOW: the flow stops for a human instead of waiting.
    Unreadable entries are dropped, never counted as recent.
    """
    now = now or datetime.now(timezone.utc)
    recent = []
    for value in history or ():
        at = _instant(value)
        if at is not None and now - at < TRANSIENT_WINDOW:
            recent.append(at)
    recent.append(now)
    recent.sort()
    stamps = [at.isoformat().replace("+00:00", "Z") for at in recent]
    retry_after = (now + RETRY_DELAY).isoformat().replace("+00:00", "Z")
    return stamps, len(recent) >= MAX_TRANSIENT, retry_after
