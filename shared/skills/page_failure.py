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

classify, safe_url and note_transient are pure. observe, visit and settle read
a page the flow passes in (never open a browser); decide turns a classified page
into the flow's action; retry_pending is the queue's side of retry_later.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping

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
        r"<title>\s*checking your browser\.{0,3}\s*</title>",  # WordPress.com / a8c CDN (1798)
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


# --- The browser side and the decision --------------------------------------
#
# Read-only probes from outside the box (14/09) told the two live stops apart:
#   1798  HTTP 403 with a "Checking your browser..." proof-of-work page (a CDN
#         bot check that a real browser passes by itself, nothing clicked).
#   1893  HTTP 410 Gone, and the page says the vacancy is closed.
#
#   ok              the checkpoint keeps the HTTP status and the final URL.
#   not_found       vacancy_closed when the page itself proves it (a closed
#                   notice, a redirect away), else page_not_found.
#   bot_protection  a passive wait first; still a wall in a headless browser
#                   with a live screen → one headed try; then bot_protection.
#   temporary       retry_later with retry_after, no stop and no notice; the
#                   third in 24 hours is page_temporarily_unavailable.
#
# Nothing here opens a browser or imports the flow: the flow passes the page
# and the closed-vacancy evidence it already reads.

RETRY_LATER_STATE = "retry_later"

PROCEED = "proceed"
BLOCK = "block"
RETRY_HEADED = "retry_headed"
RETRY_LATER = "retry_later"

NAVIGATION_TIMEOUT_MS = 30_000
# A proof-of-work check (WordPress.com, Cloudflare "Just a moment") reloads the
# page by itself within a few seconds.
CHALLENGE_WAIT_MS = 12_000
CHALLENGE_POLL_MS = 1_000

# The status of the document the page shows now, whoever navigated to it:
# after a challenge reloads the page, the first response is stale.
_DOCUMENT_STATUS_JS = """() => {
  const entry = performance.getEntriesByType('navigation')[0];
  return entry && entry.responseStatus ? entry.responseStatus : null;
}"""


@dataclass(frozen=True)
class Access:
    verdict: Verdict
    status: int | None
    final_url: str

    @property
    def kind(self) -> str:
        return self.verdict.kind


@dataclass(frozen=True)
class Decision:
    action: str
    reason: str = ""
    detail: str = ""


def _document_status(page: Any) -> int | None:
    try:
        value = page.evaluate(_DOCUMENT_STATUS_JS)
    except Exception:
        return None
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _is_timeout(error: BaseException) -> bool:
    return any(cls.__name__ == "TimeoutError" for cls in type(error).__mro__)


def observe(page: Any, *, response: Any = None, error: BaseException | None = None) -> Access:
    """Classify the page as it is now.

    `response` is what page.goto returned, when this process navigated;
    without it the status comes from the document's navigation timing, so a
    page opened by someone else (a test, a redirect) is still classified.
    """
    try:
        final_url = safe_url(page.url)
    except Exception:
        final_url = ""
    if error is not None:
        verdict = classify(
            None, timed_out=_is_timeout(error), network_error=not _is_timeout(error)
        )
        return Access(verdict, None, final_url)
    status = None
    if response is not None:
        raw = getattr(response, "status", None)
        status = raw if isinstance(raw, int) and not isinstance(raw, bool) else None
    if status is None:
        status = _document_status(page)
    try:
        html = page.content()
    except Exception:
        html = ""
    if status is None:
        # No response and no error: content set in place, about:blank, an old
        # engine. Nothing says the page failed; only a challenge fingerprint
        # can speak against it.
        wall = challenge_evidence(html)
        verdict = (
            Verdict(BOT_PROTECTION, wall)
            if wall
            else Verdict(OK, "status_unknown")
        )
        return Access(verdict, None, final_url)
    return Access(classify(status, html), status, final_url)


def visit(page: Any, url: str, *, timeout_ms: int = NAVIGATION_TIMEOUT_MS) -> Access:
    """page.goto that never raises for the page's own failures."""
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    except Exception as exc:
        return observe(page, error=exc)
    return observe(page, response=response)


def settle(
    page: Any,
    access: Access,
    *,
    wait_ms: int = CHALLENGE_WAIT_MS,
    poll_ms: int = CHALLENGE_POLL_MS,
) -> Access:
    """Wait, without touching the page, for a bot check to clear by itself."""
    waited = 0
    while access.kind == BOT_PROTECTION and waited < wait_ms:
        try:
            page.wait_for_timeout(poll_ms)
        except Exception:
            return access
        waited += poll_ms
        access = observe(page)
    return access


def decide(
    access: Access,
    *,
    headless: bool,
    headed_available: bool,
    headed_retry_used: bool,
    closed_evidence: str = "",
    transient_history: list[str] | None = None,
    now: datetime | None = None,
) -> tuple[Decision, list[str], str]:
    """What the flow does with a classified page.

    Returns (decision, transient history to keep, retry_after). The history
    and retry_after matter only for RETRY_LATER; a page that opened clears
    the history. `closed_evidence` is the flow's own reading of the page (a
    closed notice language, "redirected"), empty when there is none.
    """
    kind = access.kind
    if kind == OK:
        return Decision(PROCEED), [], ""
    if kind == NOT_FOUND:
        status = access.status if access.status is not None else "unknown"
        if closed_evidence:
            return (
                Decision(
                    BLOCK,
                    "vacancy_closed",
                    f"The page answered HTTP {status} and says the vacancy is no longer open ({closed_evidence})",
                ),
                [],
                "",
            )
        return (
            Decision(BLOCK, "page_not_found", f"The application page answered HTTP {status}: the page is gone"),
            [],
            "",
        )
    if kind == BOT_PROTECTION:
        if headless and headed_available and not headed_retry_used:
            return Decision(RETRY_HEADED), list(transient_history or []), ""
        return (
            Decision(
                BLOCK,
                "bot_protection",
                f"The careers site shows an anti-bot check ({access.verdict.evidence}); the CLOSER does not solve it",
            ),
            list(transient_history or []),
            "",
        )
    history, exhausted, retry_after = note_transient(transient_history or [], now)
    if exhausted:
        return (
            Decision(
                BLOCK,
                "page_temporarily_unavailable",
                f"The application page failed {len(history)} times in 24 hours ({access.verdict.evidence})",
            ),
            history,
            "",
        )
    return Decision(RETRY_LATER, detail=access.verdict.evidence), history, retry_after




def retry_pending(checkpoint: Mapping[str, Any], now: datetime | None = None) -> bool:
    """True while a retry_later checkpoint must not be opened again.

    An unreadable retry_after is not pending: the position is tried, never
    held forever by a broken file.
    """
    if not isinstance(checkpoint, Mapping) or checkpoint.get("state") != RETRY_LATER_STATE:
        return False
    after = _instant(checkpoint.get("retry_after", ""))
    if after is None:
        return False
    return (now or datetime.now(timezone.utc)) < after


def headed_screen_available(resolve_headless: Callable[..., bool]) -> bool:
    """A headed browser can open only on a live local display."""
    try:
        return resolve_headless(None) is False
    except Exception:
        return False
