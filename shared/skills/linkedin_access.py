#!/usr/bin/env python3
"""linkedin_access — search and fetch LinkedIn jobs WITHOUT login (F-2.A).

Method retained from the legacy job-hunter/scout-3 repository:

  `/comm/jobs/view/ID` link from a LinkedIn email (login required)
    → convert to `/jobs/view/ID`
    → PUBLIC endpoint, HTML 200, job description readable with BeautifulSoup

  Search:  `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
    → guest endpoint, no authentication, HTML containing the job-posting ID

LinkedIn does not need Playwright here: requests with a realistic user agent
are sufficient. No cookies, persistent browser context, or login are used.

Rate limit (429): LinkedIn answers 429 («Too Many Requests», or its own 999) to a guest that asks too much. Until
02/11/2026 a 429 in `search` looked like «no more results» and in `fetch-job` like a closed page, and the scout
insisted. Now every request goes through `_get`: a cap of requests per window (state shared by all the scouts in
`$JHT_HOME/state/linkedin-rate.json`), a short backoff that honours `Retry-After`, a cooldown shared by every call
after the backoff is exhausted, and an explicit outcome:
    {"rate_limited": true, "reason": "http_429"|"cooldown"|"request_cap", "retry_after_s": N, "retry_at": "<UTC>"}
(on `search` it is the last JSON line, exit code 3; on `fetch-job` it is the whole answer, exit code 3). The scout
takes another source and comes back to LinkedIn at `retry_at`; while the cooldown lasts LinkedIn is not called at all.

CLI:
    python3 linkedin_access.py search \\
        --keywords "python junior" --location "Italy" --limit 25 \\
        --posted-within-days 7
    → stdout JSONL: one job per row

    python3 linkedin_access.py fetch-job <URL_o_ID>
    → stdout JSON: {url, title, company, location, jd_text, deadline,
                    seniority, employment_type, posted_at, ...}

    python3 linkedin_access.py convert-url <URL_o_ID>
    → normalize /comm/jobs/view/<ID> to /jobs/view/<ID>
"""
from __future__ import annotations

import argparse
import contextlib
import email.utils
import json
import math
import os
import random
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))


USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:134.0) Gecko/20100101 Firefox/134.0",
]


def _ua() -> str:
    return random.choice(USER_AGENTS)


def _headers() -> dict:
    return {
        "User-Agent": _ua(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
    }


# ── Rate limit ───────────────────────────────────────────────────────
def _env_number(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if value == value and abs(value) != float("inf") and value > 0 else default


RATE_STATE = JHT_HOME / "state" / "linkedin-rate.json"
WINDOW_S = _env_number("JHT_LINKEDIN_WINDOW_S", 600.0)          # the window of the request cap
MAX_REQUESTS = int(_env_number("JHT_LINKEDIN_MAX_REQUESTS", 40))  # requests per window, all scouts together
MAX_RETRIES = 2                 # tries after the first 429, inside one call
BASE_BACKOFF_S = 2.0            # 2 s, 4 s … when LinkedIn gives no Retry-After
MAX_INLINE_WAIT_S = 20.0        # never keep a tool call waiting longer than this on a 429
COOLDOWN_BASE_S = 300.0         # LinkedIn is not called for 5 min after a 429 that the backoff did not clear…
COOLDOWN_MAX_S = 3600.0         # …10, 20, … minutes if it keeps happening, never more than an hour
RETRY_AFTER_MAX_S = 86400.0
RATE_LIMITED_STATUS = (429, 999)   # 999 is LinkedIn's own «you look like a bot»


@contextlib.contextmanager
def _state_lock():
    """Exclusive lock on the shared state (the scouts are separate processes). Without fcntl: no lock."""
    try:
        import fcntl
    except ImportError:
        yield
        return
    handle = None
    try:
        RATE_STATE.parent.mkdir(parents=True, exist_ok=True)
        handle = open(RATE_STATE.with_suffix(".lock"), "a+")
        fcntl.flock(handle, fcntl.LOCK_EX)
    except OSError:
        if handle is not None:
            handle.close()
        handle = None
    try:
        yield
    finally:
        if handle is not None:
            try:
                fcntl.flock(handle, fcntl.LOCK_UN)
            finally:
                handle.close()


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _read_state(now: float = None) -> dict:
    """The shared state, with every field brought back to something sane: a file with valid JSON but absurd values
    (Infinity, a cooldown years away, a text where a count goes) must not stop a scout nor turn into «no results»."""
    try:
        data = json.loads(RATE_STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    now = time.time() if now is None else now
    until = data.get("cooldown_until")
    data["cooldown_until"] = until if _finite(until) and until <= now + COOLDOWN_MAX_S else 0
    strikes = data.get("strikes")
    data["strikes"] = int(strikes) if _finite(strikes) and 0 <= strikes <= 1000 else 0
    last = data.get("last_429")
    data["last_429"] = last if _finite(last) else 0
    reqs = data.get("requests")
    data["requests"] = [t for t in reqs if _finite(t)] if isinstance(reqs, list) else []
    return data


def _write_state(state: dict) -> None:
    try:
        RATE_STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = RATE_STATE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, RATE_STATE)
    except OSError:
        pass   # a state that cannot be written is the old behaviour (no cap), never a failure of the search


def parse_retry_after(value, now=None):
    """Seconds to wait from a `Retry-After` header (a number of seconds, or an HTTP date), or None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        seconds = float(text)
    except ValueError:
        try:
            when = email.utils.parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        seconds = when.timestamp() - (time.time() if now is None else now)
    if seconds != seconds:
        return None
    return min(max(seconds, 0.0), RETRY_AFTER_MAX_S)


def _limited(reason: str, retry_after_s: float, now: float) -> dict:
    retry_after = max(1, int(round(retry_after_s)))
    return {
        "rate_limited": True,
        "reason": reason,
        "retry_after_s": retry_after,
        "retry_at": datetime.fromtimestamp(now + retry_after, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "linkedin",
    }


def _gate(now: float):
    """None if a request may go out (and it is counted), else the rate_limited outcome. Reads and writes the state."""
    with _state_lock():
        state = _read_state(now)
        until = state.get("cooldown_until")
        if isinstance(until, (int, float)) and until > now:
            return _limited("cooldown", until - now, now)
        recent = [t for t in state.get("requests") or [] if isinstance(t, (int, float)) and now - WINDOW_S < t <= now]
        if len(recent) >= MAX_REQUESTS:
            return _limited("request_cap", recent[0] + WINDOW_S - now, now)
        recent.append(now)
        state["requests"] = recent
        _write_state(state)
        return None


def _note_rate_limit(now: float, retry_after) -> dict:
    """The backoff did not clear the 429: a cooldown shared by every call, longer each time it happens again."""
    with _state_lock():
        state = _read_state(now)
        strikes = int(state.get("strikes") or 0) + 1 if now - float(state.get("last_429") or 0) < 6 * 3600 else 1
        cooldown = min(COOLDOWN_MAX_S, max(retry_after or 0.0, COOLDOWN_BASE_S * 2 ** (strikes - 1)))
        state.update({"strikes": strikes, "last_429": now, "cooldown_until": now + cooldown})
        _write_state(state)
    return _limited("http_429", cooldown, now)


def _note_success() -> None:
    with _state_lock():
        state = _read_state()
        if state.get("strikes") or state.get("cooldown_until"):
            state.update({"strikes": 0, "cooldown_until": 0})
            _write_state(state)


def _get(url: str, **kwargs):
    """GET with the rate limit rules. Returns (response, None) or (None, rate_limited outcome).

    A network error is raised as it always was. The first 429 waits (Retry-After, or 2 s, 4 s…) up to
    MAX_INLINE_WAIT_S and tries again, MAX_RETRIES times; then the cooldown starts and the outcome is returned."""
    import requests

    for attempt in range(MAX_RETRIES + 1):
        now = time.time()
        blocked = _gate(now)
        if blocked is not None:
            return None, {**blocked, "source_attempted": attempt > 0}
        r = requests.get(url, headers=_headers(), **kwargs)
        if r.status_code == 403:
            # A 403 is not retried (this call answers «closed» as before), but LinkedIn is suspended for EVERY Scout, for
            # longer each time, exactly like after a 429 the backoff did not clear.
            _note_rate_limit(time.time(), parse_retry_after(r.headers.get("Retry-After")))
            return r, None
        if r.status_code not in RATE_LIMITED_STATUS:
            if r.status_code == 200:
                _note_success()
            return r, None
        retry_after = parse_retry_after(r.headers.get("Retry-After"))
        wait = retry_after if retry_after is not None else BASE_BACKOFF_S * 2 ** attempt
        if attempt >= MAX_RETRIES or wait > MAX_INLINE_WAIT_S:
            return None, _note_rate_limit(time.time(), retry_after)
        time.sleep(wait + random.uniform(0, 0.5))
    return None, _note_rate_limit(time.time(), None)   # unreachable: the loop always returns


# ── URL conversion ────────────────────────────────────────────────────
JOB_ID_RE = re.compile(r"/(?:comm/)?jobs/view/(\d+)")


def extract_job_id(url_or_id: str) -> str | None:
    """Accetta URL completo, /comm/jobs/view/<ID>, /jobs/view/<ID>, o solo <ID>."""
    if url_or_id.isdigit():
        return url_or_id
    m = JOB_ID_RE.search(url_or_id or "")
    return m.group(1) if m else None


def public_url(job_id: str) -> str:
    return f"https://www.linkedin.com/jobs/view/{job_id}"


# ── Search via guest endpoint ─────────────────────────────────────────
GUEST_SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
ENTITY_URN_RE = re.compile(r'data-entity-urn="urn:li:jobPosting:(\d+)"')


def search(keywords: str, location: str = "", limit: int = 25,
           posted_within_days: int = 7) -> list[dict]:
    """Cerca via guest endpoint. Niente login. Solo i risultati (vedi `search_ex` per l'esito di un 429)."""
    from scout_search_outcomes import SearchSourceError
    results, outcome = search_ex(keywords, location, limit, posted_within_days)
    if outcome and not outcome.get("rate_limited"):
        raise SearchSourceError(results, outcome)
    return results


def search_ex(keywords: str, location: str = "", limit: int = 25,
              posted_within_days: int = 7) -> tuple[list[dict], dict | None]:
    """Guest results plus an explicit error outcome (including rate limits)."""
    from linkedin_search import search_ex as run_search
    return run_search(sys.modules[__name__], keywords, location, limit, posted_within_days)


# ── Fetch JD pubblico ────────────────────────────────────────────────
def fetch_job(url_or_id: str) -> dict:
    """Read a public job page, retaining explicit source failures."""
    from linkedin_fetch import fetch_job as run_fetch
    return run_fetch(sys.modules[__name__], url_or_id)


RATE_LIMITED_EXIT = 3   # exit code of `search` / `fetch-job` when LinkedIn says wait


def main(argv):
    import scout_pass_log
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search")
    s.add_argument("--keywords", required=True)
    s.add_argument("--location", default=None, help="select a target place declared in the profile")
    s.add_argument("--profile", default=None, help="default: $JHT_HOME/profile/candidate_profile.yml")
    s.add_argument("--limit", type=int, default=25)
    s.add_argument("--posted-within-days", type=int, default=7)
    s.add_argument("--log", action="store_true", help="record the actual outcome for coverage")
    s.add_argument("--country", default="multi", help="source country for the pass log, not a geographic filter")
    s.add_argument("--query-kind", default="other", choices=scout_pass_log.QUERY_KINDS)
    s.add_argument("--agent", default=None)

    f = sub.add_parser("fetch-job")
    f.add_argument("url_or_id")

    c = sub.add_parser("convert-url")
    c.add_argument("url_or_id")

    args = p.parse_args(argv)

    if args.cmd == "search":
        from scout_search_outcomes import ERROR_EXIT, record_pass
        from scout_search_scope import run_search
        results, limited = run_search(sys.modules[__name__], args)
        log_error = record_pass(args, results, limited) if args.log else None
        for j in results:
            print(json.dumps(j))
        if limited is not None:
            print(json.dumps(limited))
            return RATE_LIMITED_EXIT if limited.get("rate_limited") else ERROR_EXIT
        if log_error:
            print(json.dumps(log_error))
            return ERROR_EXIT
        return 0

    if args.cmd == "fetch-job":
        from scout_search_outcomes import ERROR_EXIT
        job = fetch_job(args.url_or_id)
        print(json.dumps(job, indent=2, ensure_ascii=False))
        if job.get("rate_limited"):
            return RATE_LIMITED_EXIT
        return ERROR_EXIT if job.get("search_outcome") else 0

    if args.cmd == "convert-url":
        jid = extract_job_id(args.url_or_id)
        if jid:
            print(public_url(jid))
            return 0
        else:
            print(f"could not extract job_id from: {args.url_or_id}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
