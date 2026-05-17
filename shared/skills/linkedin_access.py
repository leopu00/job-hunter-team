#!/usr/bin/env python3
"""linkedin_access — search + fetch LinkedIn jobs SENZA login (F-2.A).

**Metodo documentato dal repo legacy job-hunter/scout-3/** (febbraio 2026,
ri-confermato 2026-05-17):

  Link `/comm/jobs/view/ID`  (dalle email LinkedIn, richiede login)
    → conversione → `/jobs/view/ID`
    → endpoint **PUBBLICO**, HTML 200, JD leggibile via parser BS4

  Search:  `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
    → endpoint guest, no auth, HTML con `data-entity-urn="urn:li:jobPosting:<ID>"`

**Niente Playwright per LinkedIn**: requests + UA realistico sono
sufficienti. Niente cookies, niente persistent context, niente login.

CLI:
    python3 linkedin_access.py search \\
        --keywords "python junior" --location "Italy" --limit 25 \\
        --posted-within-days 7
    → stdout JSONL: 1 job per riga {job_id, url, title, company, location, source}

    python3 linkedin_access.py fetch-job <URL_o_ID>
    → stdout JSON: {url, title, company, location, jd_text, deadline,
                    seniority, employment_type, posted_at, ...}

    python3 linkedin_access.py convert-url <URL_o_ID>
    → normalizza /comm/jobs/view/<ID> in /jobs/view/<ID>
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.parse
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
    """Cerca via guest endpoint. Niente login.

    `f_TPR=r<seconds>` = posted in last N seconds.
    Pagination: parametro `start` (offset di 10/25 alla volta).
    """
    import requests

    f_tpr = f"r{posted_within_days * 86400}"
    results: list[dict] = []
    seen_ids = set()
    start = 0

    while len(results) < limit:
        params = {
            "keywords": keywords,
            "location": location,
            "f_TPR": f_tpr,
            "start": start,
        }
        url = GUEST_SEARCH + "?" + urllib.parse.urlencode(params)
        try:
            r = requests.get(url, headers=_headers(), timeout=20)
        except Exception:
            break
        if r.status_code != 200 or not r.text.strip():
            break

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(r.text, "lxml")
        cards = soup.select(".base-card[data-entity-urn], .job-search-card[data-entity-urn]")
        if not cards:
            # Fallback regex se i selettori cambiano nome
            ids = ENTITY_URN_RE.findall(r.text)
            for jid in ids:
                if jid in seen_ids:
                    continue
                seen_ids.add(jid)
                results.append({
                    "job_id": jid,
                    "url": public_url(jid),
                    "title": "",
                    "company": "",
                    "location": "",
                    "source": "linkedin-guest",
                })
                if len(results) >= limit:
                    break
            break

        before = len(results)
        for card in cards:
            urn = card.get("data-entity-urn", "")
            m = re.search(r"urn:li:jobPosting:(\d+)", urn)
            if not m:
                continue
            jid = m.group(1)
            if jid in seen_ids:
                continue
            seen_ids.add(jid)
            title_el = card.select_one("h3, .base-search-card__title, .job-search-card__title")
            company_el = card.select_one(".base-search-card__subtitle, .job-search-card__subtitle, h4")
            loc_el = card.select_one(".job-search-card__location, .base-search-card__metadata")
            results.append({
                "job_id": jid,
                "url": public_url(jid),
                "title": (title_el.get_text(strip=True) if title_el else "")[:200],
                "company": (company_el.get_text(strip=True) if company_el else "")[:120],
                "location": (loc_el.get_text(strip=True) if loc_el else "")[:120],
                "source": "linkedin-guest",
            })
            if len(results) >= limit:
                break
        # Se la pagina non ha aggiunto nuovi risultati, stop (fine paginazione)
        if len(results) == before:
            break
        start += 25
        time.sleep(0.6 + random.uniform(0, 0.5))  # cortesia, anti-rate

    return results


# ── Fetch JD pubblico ────────────────────────────────────────────────
def fetch_job(url_or_id: str) -> dict:
    """Fetch JD via /jobs/view/<ID> pubblico. Estrae title, company,
    location, JD body, criteri, posted_at, deadline (deadline_extract)."""
    import requests
    from bs4 import BeautifulSoup

    jid = extract_job_id(url_or_id)
    if not jid:
        return {"error": f"job_id non estraibile da: {url_or_id}"}
    url = public_url(jid)

    try:
        from deadline_extract import parse_deadline  # type: ignore
    except ImportError:
        parse_deadline = lambda t: None  # noqa: E731

    try:
        r = requests.get(url, headers=_headers(), timeout=25, allow_redirects=True)
    except Exception as e:
        return {"job_id": jid, "url": url, "error": str(e)}

    if r.status_code != 200:
        return {"job_id": jid, "url": url, "status": r.status_code, "blocked": True}

    html = r.text
    final_url = r.url
    soup = BeautifulSoup(html, "lxml")

    # Title (anchor structure: "<Company> hiring <Role> in <City>, <Region>, <Country>")
    page_title = soup.title.get_text(strip=True) if soup.title else ""

    title_role = ""
    company = ""
    location = ""
    m = re.match(r"^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn\s*$", page_title)
    if m:
        company = m.group(1).strip()
        title_role = m.group(2).strip()
        location = m.group(3).strip()
    else:
        # Job scaduto → page_title è cose tipo "476 Python jobs in Italy"
        if "jobs in" in page_title.lower() or "offerte di lavoro" in page_title.lower():
            return {"job_id": jid, "url": final_url, "status": 200,
                    "expired": True, "note": "redirect a SERP — job scaduto"}

    # JD body
    jd_text = ""
    for sel in [".show-more-less-html__markup", ".description__text",
                ".decorated-job-posting__details"]:
        el = soup.select_one(sel)
        if el:
            jd_text = el.get_text("\n", strip=True)
            break

    # Criteri (seniority / employment type / job function / industries)
    criteria: dict[str, str] = {}
    for li in soup.select(".description__job-criteria-list li, ul.description__job-criteria-list li"):
        parts = list(li.stripped_strings)
        if len(parts) >= 2:
            criteria[parts[0]] = parts[1]

    # Posted at (meta og:description di solito ha "Posted X:XX:XX AM")
    posted_at = ""
    for prop in ("og:description", "description"):
        meta = soup.find("meta", attrs={"property": prop}) or \
               soup.find("meta", attrs={"name": prop})
        if meta:
            posted_at = meta.get("content", "")
            break

    deadline = parse_deadline(jd_text) if jd_text else None

    return {
        "job_id": jid,
        "url": final_url,
        "status": 200,
        "title": title_role[:200],
        "company": company[:120],
        "location": location[:120],
        "jd_text": jd_text[:8000],
        "jd_chars": len(jd_text),
        "deadline": deadline or "",
        "seniority": criteria.get("Seniority level", ""),
        "employment_type": criteria.get("Employment type", ""),
        "job_function": criteria.get("Job function", ""),
        "industries": criteria.get("Industries", ""),
        "posted_meta": posted_at[:300],
        "source": "linkedin",
    }


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search")
    s.add_argument("--keywords", required=True)
    s.add_argument("--location", default="")
    s.add_argument("--limit", type=int, default=25)
    s.add_argument("--posted-within-days", type=int, default=7)

    f = sub.add_parser("fetch-job")
    f.add_argument("url_or_id")

    c = sub.add_parser("convert-url")
    c.add_argument("url_or_id")

    args = p.parse_args(argv)

    if args.cmd == "search":
        for j in search(args.keywords, args.location, args.limit, args.posted_within_days):
            print(json.dumps(j))
        return 0

    if args.cmd == "fetch-job":
        print(json.dumps(fetch_job(args.url_or_id), indent=2, ensure_ascii=False))
        return 0

    if args.cmd == "convert-url":
        jid = extract_job_id(args.url_or_id)
        if jid:
            print(public_url(jid))
            return 0
        else:
            print(f"job_id non estraibile da: {args.url_or_id}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
