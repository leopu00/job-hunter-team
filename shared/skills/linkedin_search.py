"""Guest search parsing and explicit outcomes; transport/rate limiting stay in the caller."""
from __future__ import annotations

import re
import urllib.parse

from scout_search_outcomes import exception_outcome, failure, response_outcome

ENTITY_URN_RE = re.compile(r'data-entity-urn="urn:li:jobPosting:(\d+)"')


def _card(access, card) -> dict | None:
    match = re.search(r"urn:li:jobPosting:(\d+)", card.get("data-entity-urn", ""))
    if not match:
        return None
    title = card.select_one("h3, .base-search-card__title, .job-search-card__title")
    company = card.select_one(".base-search-card__subtitle, .job-search-card__subtitle, h4")
    location = card.select_one(".job-search-card__location, .base-search-card__metadata")
    return {"job_id": match[1], "url": access.public_url(match[1]),
            "title": title.get_text(strip=True)[:200] if title else "",
            "company": company.get_text(strip=True)[:120] if company else "",
            "location": location.get_text(strip=True)[:120] if location else "", "source": "linkedin-guest"}


def _page(access, text: str) -> tuple[list, bool]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(text, "lxml")
    cards = soup.select(".base-card[data-entity-urn], .job-search-card[data-entity-urn]")
    if cards:
        jobs = [job for card in cards if (job := _card(access, card))]
        return jobs, bool(jobs)
    ids = ENTITY_URN_RE.findall(text)
    if ids:
        return [{"job_id": jid, "url": access.public_url(jid), "title": "", "company": "",
                 "location": "", "source": "linkedin-guest"} for jid in ids], True
    # The guest pagination endpoint returns an empty fragment at the end. A full
    # unknown HTML document is not an empty market, even when it has status 200.
    empty = not text.strip() or soup.select_one(".jobs-search-no-results-banner, .no-results") is not None
    return [], empty


def search_ex(access, keywords: str, location: str = "", limit: int = 25,
              posted_within_days: int = 7) -> tuple[list, dict | None]:
    results, seen = [], set()
    if limit <= 0 or posted_within_days <= 0:
        return [], failure("scout_search_input_invalid", source_attempted=False)
    start = 0
    while len(results) < limit:
        params = {"keywords": keywords, "location": location, "f_TPR": f"r{posted_within_days * 86400}", "start": start}
        url = access.GUEST_SEARCH + "?" + urllib.parse.urlencode(params)
        try:
            response, outcome = access._get(url, timeout=20)
        except Exception as exc:
            return results, exception_outcome(exc)
        if outcome is not None:
            if results and outcome.get("source_attempted") is False:
                outcome = {**outcome, "source_attempted": True}
            return results, outcome
        outcome = response_outcome(response)
        if outcome:
            return results, outcome
        try:
            jobs, recognized = _page(access, response.text)
        except Exception:
            return results, failure("scout_search_unrecognized", 200)
        if not recognized:
            return results, failure("scout_search_unrecognized", 200)
        before = len(results)
        for job in jobs:
            if job["job_id"] not in seen:
                seen.add(job["job_id"])
                results.append(job)
                if len(results) >= limit:
                    break
        if len(results) == before:
            break
        start += 25
        access.time.sleep(0.6 + access.random.uniform(0, 0.5))
    return results, None
