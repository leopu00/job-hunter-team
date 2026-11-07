"""Public job-page parsing, with search's error catalog and transport contract."""
from __future__ import annotations

import re

from scout_search_outcomes import exception_outcome, failure, response_outcome


def _description(soup) -> str:
    for selector in (".show-more-less-html__markup", ".description__text", ".decorated-job-posting__details"):
        element = soup.select_one(selector)
        if element:
            return element.get_text("\n", strip=True)
    return ""


def _criteria(soup) -> dict:
    result = {}
    for item in soup.select(".description__job-criteria-list li, ul.description__job-criteria-list li"):
        parts = list(item.stripped_strings)
        if len(parts) >= 2:
            result[parts[0]] = parts[1]
    return result


def _posted(soup) -> str:
    for prop in ("og:description", "description"):
        meta = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        if meta:
            return meta.get("content", "")[:300]
    return ""


def fetch_job(access, url_or_id: str) -> dict:
    from bs4 import BeautifulSoup
    jid = access.extract_job_id(url_or_id)
    if not jid:
        return failure("scout_search_unrecognized")
    base = {"job_id": jid, "url": access.public_url(jid)}
    try:
        response, limited = access._get(base["url"], timeout=25, allow_redirects=True)
    except Exception as exc:
        return {**base, **exception_outcome(exc)}
    if limited is not None:
        return {**base, "status": 429, **limited}
    outcome = response_outcome(response)
    if outcome:
        return {**base, **outcome, "search_status": outcome["status"],
                "status": response.status_code, "blocked": True}
    soup = BeautifulSoup(response.text, "lxml")
    page_title = soup.title.get_text(strip=True) if soup.title else ""
    match = re.match(r"^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn\s*$", page_title)
    if not match and ("jobs in" in page_title.lower() or "offerte di lavoro" in page_title.lower()):
        return {**base, "url": response.url, "status": 200, "expired": True,
                "note": "redirected to a SERP — expired job"}
    jd = _description(soup)
    if not jd:
        return {**base, **failure("scout_search_unrecognized", 200)}
    try:
        from deadline_extract import parse_deadline
    except ImportError:
        parse_deadline = lambda text: None
    criteria = _criteria(soup)
    return {**base, "url": response.url, "status": 200,
            "title": match.group(2).strip()[:200] if match else "",
            "company": match.group(1).strip()[:120] if match else "",
            "location": match.group(3).strip()[:120] if match else "",
            "jd_text": jd[:8000], "jd_chars": len(jd), "deadline": parse_deadline(jd) or "",
            "seniority": criteria.get("Seniority level", ""),
            "employment_type": criteria.get("Employment type", ""),
            "job_function": criteria.get("Job function", ""), "industries": criteria.get("Industries", ""),
            "posted_meta": _posted(soup), "source": "linkedin"}
