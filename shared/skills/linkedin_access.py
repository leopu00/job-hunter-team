#!/usr/bin/env python3
"""linkedin_access — search + parse posti LinkedIn da Scout/Analista (F-2.A).

Strategia (decisione utente 2026-05-17):
1. Sessione Playwright persistente in $JHT_HOME/.cache/playwright/linkedin/
2. Login one-shot: la prima volta serve check sessione, se non loggato
   l'utente apre il container con `--no-headless` (modalità dev) e fa il
   login a mano. Lì in poi i cookies persistono.
3. Search via URL `linkedin.com/jobs/search/?keywords=...&location=...`
   (API pubblica, no scraping login-only).
4. Parsing risultati: estrazione job_id + url canonico + title + company
   + location (con BeautifulSoup, lxml parser).
5. Output JSONL: 1 riga per job → consumabile direttamente dallo Scout
   per fare `db_insert.py position`.

Pattern cross-provider osservato (F-2 doc):
- Claude: LinkedIn fonte principale by default
- Codex: accede ma non spontaneamente
- Kimi: cookie wall → questa skill chiude il gap (Playwright comune)

CLI:
    python3 /app/shared/skills/linkedin_access.py search \\
        --keywords "python junior" --location "Italy" --limit 25
    → stdout JSONL, 1 job per riga

    python3 /app/shared/skills/linkedin_access.py login-check
    → exit 0 se logged in, 1 altrimenti (con istruzioni)

    python3 /app/shared/skills/linkedin_access.py fetch-job <URL>
    → stdout JSON con jd_text + requirements + deadline (se trovate)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
LINKEDIN_PROFILE = JHT_HOME / ".cache" / "playwright" / "linkedin-session"
CREDS_PATH = JHT_HOME / "credentials" / "linkedin.json"


def _ensure_profile_dir() -> Path:
    LINKEDIN_PROFILE.mkdir(parents=True, exist_ok=True)
    return LINKEDIN_PROFILE


def login_check() -> bool:
    """Apre linkedin.com/feed con il profilo persistente. Se redirect a
    /login o vede 'Sign in', la sessione è scaduta/mai fatta."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright non installato", file=sys.stderr)
        return False

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(_ensure_profile_dir()),
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=CompanyControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto("https://www.linkedin.com/feed/",
                      wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)
            url_final = page.url
            text = page.content()
        finally:
            ctx.close()

    if "/login" in url_final or "/checkpoint" in url_final or "/authwall" in url_final:
        return False
    # Login form ancora visibile = redirect SPA
    if 'name="session_password"' in text or 'id="organic-div"' in text and 'Sign in' in text:
        return False
    return True


def search(keywords: str, location: str = "", limit: int = 25,
           posted_within_days: int = 7) -> list[dict]:
    """Cerca job su LinkedIn. Filtro freshness: posted in last N days
    (param `f_TPR` = `r<seconds>`).

    Ritorna lista di dict: {job_id, url, title, company, location, posted_at}.
    Se sessione non loggata, prova endpoint pubblico (limitato ma a volte
    fornisce snippet utili).
    """
    f_tpr = f"r{posted_within_days * 86400}"
    params = {
        "keywords": keywords,
        "location": location,
        "f_TPR": f_tpr,
        "sortBy": "DD",  # DD = date posted desc
    }
    url = "https://www.linkedin.com/jobs/search/?" + urllib.parse.urlencode(params)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []

    results = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(_ensure_profile_dir()),
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=CompanyControlled"],
        )
        ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            time.sleep(3)
            # Scroll per caricare più risultati (LinkedIn fa lazy-load)
            for _ in range(min(limit // 10, 5)):
                page.mouse.wheel(0, 3000)
                time.sleep(1.2)
            html = page.content()
        finally:
            ctx.close()

    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []
    soup = BeautifulSoup(html, "lxml")

    # LinkedIn jobs cards: il marker varia tra logged/anonymous. Coprire
    # entrambi: cerca data-job-id o href con /jobs/view/<id>.
    seen_ids = set()
    for a in soup.select("a[href*='/jobs/view/']"):
        href = a.get("href", "")
        m = re.search(r"/jobs/view/(\d+)", href)
        if not m:
            continue
        job_id = m.group(1)
        if job_id in seen_ids:
            continue
        seen_ids.add(job_id)
        # Sale al primo li/card che contiene company+location
        card = a.find_parent(["li", "div"])
        title = a.get_text(strip=True) or ""
        company = ""
        loc = ""
        if card:
            # Vari selettori — best-effort: prima riga, ultimo span/div
            for sel in [".job-card-container__company-name", ".base-search-card__subtitle",
                        ".artdeco-entity-lockup__subtitle"]:
                el = card.select_one(sel)
                if el:
                    company = el.get_text(strip=True)
                    break
            for sel in [".job-card-container__metadata-item", ".job-search-card__location"]:
                el = card.select_one(sel)
                if el:
                    loc = el.get_text(strip=True)
                    break
        results.append({
            "job_id": job_id,
            "url": f"https://www.linkedin.com/jobs/view/{job_id}",
            "title": title[:120],
            "company": company[:80],
            "location": loc[:80],
            "source": "linkedin-search",
        })
        if len(results) >= limit:
            break

    return results


def fetch_job(url: str) -> dict:
    """Apre una pagina /jobs/view/<id> e estrae JD + requirements + deadline.
    Usa la sessione loggata (se disponibile) per testo completo, fallback a
    public view (snippet limitato)."""
    # Import deadline_extract helper (bug F-4): se trova deadline nel JD,
    # popoliamo subito così lo Scout può passarla a db_insert.
    try:
        from deadline_extract import parse_deadline  # type: ignore
    except ImportError:
        parse_deadline = lambda t: None  # noqa: E731

    try:
        from playwright.sync_api import sync_playwright
        from bs4 import BeautifulSoup
    except ImportError:
        return {"error": "playwright o bs4 mancanti"}

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(_ensure_profile_dir()),
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=CompanyControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            time.sleep(2.5)
            # "Show more" del JD se visibile (login mode)
            try:
                page.click("button:has-text('Show more')", timeout=2000)
                time.sleep(0.8)
            except Exception:
                pass
            html = page.content()
            url_final = page.url
        finally:
            ctx.close()

    soup = BeautifulSoup(html, "lxml")
    # Selettori candidati per JD body
    jd = ""
    for sel in [".jobs-description__container", ".description__text",
                ".show-more-less-html__markup", "[data-test-description]"]:
        el = soup.select_one(sel)
        if el:
            jd = el.get_text("\n", strip=True)
            break
    # Title
    title_el = soup.select_one("h1") or soup.title
    title = title_el.get_text(strip=True) if title_el else ""
    # Company name
    company = ""
    for sel in [".jobs-unified-top-card__company-name", ".topcard__org-name-link",
                ".job-details-jobs-unified-top-card__company-name"]:
        el = soup.select_one(sel)
        if el:
            company = el.get_text(strip=True)
            break

    deadline = parse_deadline(jd) if jd else None
    return {
        "url": url_final,
        "title": title[:200],
        "company": company[:100],
        "jd_text": jd[:8000],  # cap per evitare oversize DB row
        "deadline": deadline or "",
        "source": "linkedin",
    }


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login-check")

    s = sub.add_parser("search")
    s.add_argument("--keywords", required=True)
    s.add_argument("--location", default="")
    s.add_argument("--limit", type=int, default=25)
    s.add_argument("--posted-within-days", type=int, default=7)

    f = sub.add_parser("fetch-job")
    f.add_argument("url")

    args = p.parse_args(argv)

    if args.cmd == "login-check":
        ok = login_check()
        if ok:
            print(json.dumps({"logged_in": True, "profile_dir": str(LINKEDIN_PROFILE)}))
            return 0
        else:
            print(json.dumps({"logged_in": False, "profile_dir": str(LINKEDIN_PROFILE),
                              "hint": "Per fare il login: docker exec -it jht "
                                      "python3 -m playwright open https://www.linkedin.com/login "
                                      "(o usa interface desktop con LINKEDIN_PROFILE_PATH)"}))
            return 1

    if args.cmd == "search":
        jobs = search(args.keywords, args.location, args.limit, args.posted_within_days)
        for j in jobs:
            print(json.dumps(j))
        return 0

    if args.cmd == "fetch-job":
        print(json.dumps(fetch_job(args.url), indent=2))
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
