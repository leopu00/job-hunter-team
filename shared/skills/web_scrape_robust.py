#!/usr/bin/env python3
"""web_scrape_robust — fetch HTML/text robusto contro anti-bot (F-2.B).

Strategia gerarchica anti-detection:

  LIVELLO 1 — requests + UA random + cookie jar
              veloce, basso costo, fallisce su SPA / Cloudflare hard / 403
  LIVELLO 2 — Playwright stealth (chromium headless)
              gestisce JS, set navigator.webdriver=false, UA realistica,
              cookies persistenti per dominio
  LIVELLO 3 — Playwright + persistent context (sessione utente)
              richiede credenziali utente (es. LinkedIn login).
              Fallback se anche L2 vede "Just a moment..." / login wall.

Detection patterns: Cloudflare challenge, "Just a moment...", "Access
denied", "Please verify you are a human", reCAPTCHA. Quando riconosciuti
in L1+L2, la skill non insiste oltre il L3 e ritorna `blocked:True` —
il chiamante può marcare la source come "blacklist temporanea".

CLI:
    python3 /app/shared/skills/web_scrape_robust.py <URL> [--level 1|2|3]
    python3 /app/shared/skills/web_scrape_robust.py <URL> --level 2 --out /tmp/page.html

Output JSON su stdout:
    {"url":"...", "status":200, "level":2, "blocked":false,
     "html_path":"/tmp/page.html", "text_chars":48213, "title":"...",
     "elapsed_ms":2317}

Exit code:
    0 fetch ok (anche se blocked:true, lo dice nel JSON)
    1 URL non parsabile / errore inatteso
    2 tutti i livelli falliti (network down, host morto, ecc.)
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.parse
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CACHE_DIR = JHT_HOME / ".cache" / "web-scrape"
DEFAULT_TIMEOUT = 25


# ── User-Agent pool (realistico, aggiornato fine 2025) ────────────────
USER_AGENTS = [
    # Chrome 132 macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    # Chrome 132 Win11
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    # Firefox 134 macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:134.0) Gecko/20100101 Firefox/134.0",
    # Firefox 134 Linux
    "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
    # Safari 18 macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    # Edge 132 Win11
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
]


# ── Detection patterns: marker testuali per anti-bot/login walls ──────
DETECTION_PATTERNS = [
    # Cloudflare
    "Just a moment...",
    "Checking your browser",
    "cf-browser-verification",
    "Please enable JavaScript and cookies",
    "Sorry, you have been blocked",
    # Access wall
    "Access Denied",
    "403 Forbidden",
    # CAPTCHA
    "Please verify you are a human",
    "g-recaptcha",
    "hcaptcha",
    # Login wall comune (LinkedIn / Indeed Premium)
    "Please log in to continue",
    "Sign in to continue",
    "Authwall",
]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _detect_block(text: str | None) -> bool:
    if not text:
        return False
    snippet = text[:8000].lower()  # solo primo blocco — basta per i marker
    return any(p.lower() in snippet for p in DETECTION_PATTERNS)


def _backoff_sleep(attempt: int) -> None:
    base = min(2 ** attempt, 30)
    time.sleep(base + random.uniform(0, base * 0.3))


# ── Livello 1: requests con UA random ─────────────────────────────────
def fetch_level1(url: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Fetch via requests + UA rotation. Fallisce su SPA / Cloudflare hard."""
    import requests

    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    }

    start = _now_ms()
    try:
        r = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        text = r.text
        blocked = _detect_block(text) or r.status_code in (403, 429, 503)
        return {
            "level": 1,
            "status": r.status_code,
            "html": text,
            "blocked": blocked,
            "elapsed_ms": _now_ms() - start,
            "url_final": r.url,
        }
    except Exception as e:
        return {
            "level": 1,
            "status": 0,
            "html": "",
            "blocked": True,
            "error": str(e),
            "elapsed_ms": _now_ms() - start,
        }


# ── Livello 2: Playwright stealth (chromium headless) ─────────────────
def fetch_level2(url: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Playwright + tweak anti-detection. Gestisce SPA + alcuni CF wall."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"level": 2, "status": 0, "html": "", "blocked": True,
                "error": "playwright non installato", "elapsed_ms": 0}

    start = _now_ms()
    ua = random.choice(USER_AGENTS)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=CompanyControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            )
            context = browser.new_context(
                user_agent=ua,
                locale="en-US",
                viewport={"width": 1280, "height": 800},
            )
            # Stealth tweaks classici: rimuovi navigator.webdriver,
            # popola plugins/languages così bot-detect non scatta.
            context.add_init_script("""
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
              Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
              Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
              window.chrome = { runtime: {} };
            """)
            page = context.new_page()
            resp = page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            status = resp.status if resp else 0
            # Lasciamo che la SPA finisca render iniziale (sleep breve, no networkidle
            # che blocca su pagine con polling continuo).
            time.sleep(2.5)
            text = page.content()
            title = page.title()
            url_final = page.url
            context.close()
            browser.close()

        blocked = _detect_block(text) or status in (403, 429, 503)
        return {
            "level": 2,
            "status": status,
            "html": text,
            "title": title,
            "blocked": blocked,
            "elapsed_ms": _now_ms() - start,
            "url_final": url_final,
        }
    except Exception as e:
        return {"level": 2, "status": 0, "html": "", "blocked": True,
                "error": str(e), "elapsed_ms": _now_ms() - start}


# ── Livello 3: persistent context (sessione utente, es. LinkedIn) ────
def fetch_level3(url: str, profile_dir: Path, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Playwright persistent context: riusa cookies di una sessione utente
    (es. LinkedIn login fatto una volta sola). Stessa dir = stessa
    sessione. profile_dir tipicamente sotto JHT_HOME/.cache/playwright/."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"level": 3, "status": 0, "html": "", "blocked": True,
                "error": "playwright non installato", "elapsed_ms": 0}

    start = _now_ms()
    profile_dir.mkdir(parents=True, exist_ok=True)
    ua = random.choice(USER_AGENTS)
    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                str(profile_dir),
                headless=True,
                user_agent=ua,
                args=["--disable-blink-features=CompanyControlled", "--no-sandbox"],
            )
            page = context.pages[0] if context.pages else context.new_page()
            resp = page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            status = resp.status if resp else 0
            time.sleep(3)
            text = page.content()
            title = page.title()
            url_final = page.url
            context.close()

        blocked = _detect_block(text) or status in (403, 429, 503)
        return {
            "level": 3,
            "status": status,
            "html": text,
            "title": title,
            "blocked": blocked,
            "elapsed_ms": _now_ms() - start,
            "url_final": url_final,
            "profile_dir": str(profile_dir),
        }
    except Exception as e:
        return {"level": 3, "status": 0, "html": "", "blocked": True,
                "error": str(e), "elapsed_ms": _now_ms() - start}


# ── Public API: cascade L1 → L2 → L3 con backoff ──────────────────────
def fetch(url: str, max_level: int = 3, profile_dir: Path | None = None,
          retries_per_level: int = 1) -> dict:
    """Cascade fetcher. Ritorna il primo result senza blocco, o l'ultimo
    se nessuno passa.

    `max_level=1` → solo requests (no Playwright). Utile per pages note OK.
    `max_level=2` → escalation a Playwright stealth.
    `max_level=3` → escalation a persistent profile (richiede profile_dir).
    """
    results = []
    last = None

    for lvl in range(1, max_level + 1):
        for attempt in range(retries_per_level + 1):
            if lvl == 1:
                r = fetch_level1(url)
            elif lvl == 2:
                r = fetch_level2(url)
            else:
                if profile_dir is None:
                    profile_dir = JHT_HOME / ".cache" / "playwright" / "default"
                r = fetch_level3(url, profile_dir)
            results.append({k: v for k, v in r.items() if k != "html"})
            last = r
            if not r.get("blocked") and r.get("status", 0) == 200:
                return r
            if attempt < retries_per_level:
                _backoff_sleep(attempt)
        # bumpa livello se ancora blocked

    return last or {"level": 0, "status": 0, "html": "", "blocked": True,
                    "error": "no level succeeded"}


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("url")
    p.add_argument("--level", type=int, default=3, choices=[1, 2, 3],
                   help="Massimo livello da provare (default 3)")
    p.add_argument("--out", help="Path dove salvare l'HTML completo")
    p.add_argument("--profile-dir", help="(L3) directory di profilo persistente, es. linkedin-session")
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    args = p.parse_args(argv)

    profile = Path(args.profile_dir) if args.profile_dir else None
    result = fetch(args.url, max_level=args.level, profile_dir=profile)

    html = result.pop("html", "")
    text_chars = len(html)

    if args.out and html:
        Path(args.out).write_text(html, encoding="utf-8")
        result["html_path"] = args.out
    elif html:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        slug = urllib.parse.quote(args.url, safe="")[:80]
        path = CACHE_DIR / f"{int(time.time())}_{slug}.html"
        path.write_text(html, encoding="utf-8")
        result["html_path"] = str(path)

    result["url"] = args.url
    result["text_chars"] = text_chars

    print(json.dumps(result, indent=2))
    return 0 if not result.get("error") and result.get("status", 0) > 0 else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
