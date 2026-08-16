#!/usr/bin/env python3
"""web_scrape_robust — robust HTML/text fetching against anti-bot systems (F-2.B).

Layered anti-detection strategy:

  LEVEL 1 — requests + random UA + cookie jar
            fast, low cost, fails on SPAs / hard Cloudflare / 403
  LEVEL 2 — Playwright stealth (headless Chromium)
            handles JS, sets navigator.webdriver=false, uses a realistic UA,
            and keeps cookies per domain
  LEVEL 3 — Playwright + persistent context (user session)
            requires user credentials (for example, a LinkedIn login).
            Fallback when L2 still sees "Just a moment..." / a login wall.

Detection patterns: Cloudflare challenge, "Just a moment...", "Access
denied", "Please verify you are a human", reCAPTCHA. When detected in L1+L2,
the skill does not retry beyond L3 and returns `blocked:True`; the caller can
temporarily blacklist the source.

CLI:
    python3 /app/shared/skills/web_scrape_robust.py <URL> [--level 1|2|3]
    python3 /app/shared/skills/web_scrape_robust.py <URL> --level 2 --out /tmp/page.html

JSON output on stdout:
    {"url":"...", "status":200, "level":2, "blocked":false,
     "html_path":"/tmp/page.html", "text_chars":48213, "title":"...",
     "elapsed_ms":2317}

Exit codes:
    0 fetch succeeded (including blocked:true, which is reported in the JSON)
    1 invalid URL / refused by the guard / unexpected error
    2 all levels failed (network down, unreachable host, etc.)

Network boundary: the URL arrives from outside (a scraped ad, a forwarded
email), and from inside the container private, loopback and link-local
addresses answer while the public internet does not. Before any level runs,
`fetch()` checks the URL with `url_guard` **and resolves the host** with
`safe_fetch.resolve_public_address`: the guard judges a string, and where a
name points is something only the DNS knows. Levels 2 and 3 drive Playwright,
a real browser that resolves and follows redirects on its own, so the
resolution at the entrance is the only thing standing between them and an
internal address.

⚠️ A refusal must never escalate. `fetch()` stops on `refused`, because the
reaction to a level that failed is to try the next one — and that would hand
the request to the levels where the chain is not re-checked. A refused
address is not a level that failed.

Level 1 additionally walks redirects with `safe_fetch`, re-checking every
hop; on the browser levels the chain is not re-checked, which is why the
address is settled before they start.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from safe_fetch import (  # noqa: E402  (dopo sys.path, per costruzione)
    resolve_public_address,
    walk as safe_walk,
)
from url_guard import UrlRejected, check_url  # noqa: E402

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


def _refused(url: str, exc: Exception, level: int = 0, elapsed_ms: int = 0) -> dict:
    """L'esito di un indirizzo che non si scarica, nella forma dei livelli.

    `refused` e' il campo su cui il ciclo di `fetch` si ferma: senza un campo
    suo, un rifiuto e' indistinguibile da un livello che ha fallito, e la
    reazione a un livello fallito e' provare quello dopo.
    """
    return {
        "level": level,
        "status": 0,
        "html": "",
        "blocked": True,
        "error": f"refused: {exc}",
        "refused": True,
        "elapsed_ms": elapsed_ms,
        "url_final": url,
    }


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

    def hop(hop_url: str, address: str):
        """Un salto solo, senza seguire redirect: a percorrerli e' `walk`.

        Il trasporto resta `requests` perche' a questo livello servono gli
        header e la rotazione dello UA — quello che cambia e' chi decide dove
        si va: `allow_redirects=True` lasciava la destinazione finale al
        server remoto, che e' esattamente il salto con cui un URL pubblico
        arriva a `169.254.169.254`.
        """
        resp = requests.get(
            hop_url, headers=headers, timeout=timeout, allow_redirects=False
        )
        return resp.status_code, resp.headers.get("Location", ""), resp.content

    start = _now_ms()
    try:
        status, final_url, body = safe_walk(url, hop=hop)
        text = body.decode("utf-8", errors="replace")
        blocked = _detect_block(text) or status in (403, 429, 503)
        return {
            "level": 1,
            "status": status,
            "html": text,
            "blocked": blocked,
            "elapsed_ms": _now_ms() - start,
            "url_final": final_url,
        }
    except UrlRejected as exc:
        # Distinto dall'errore di rete PRIMA dell'except generico: un rifiuto
        # e' una decisione, non un tentativo andato male, e chi legge questo
        # dict decide se salire di livello.
        return _refused(url, exc, level=1, elapsed_ms=_now_ms() - start)
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
                "error": "playwright is not installed", "elapsed_ms": 0}

    start = _now_ms()
    ua = random.choice(USER_AGENTS)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
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
                "error": "playwright is not installed", "elapsed_ms": 0}

    start = _now_ms()
    profile_dir.mkdir(parents=True, exist_ok=True)
    ua = random.choice(USER_AGENTS)
    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                str(profile_dir),
                headless=True,
                user_agent=ua,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
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
    # Prima di qualunque livello: l'URL arriva da fuori (annuncio scrapato,
    # email inoltrata), e da dentro il container gli indirizzi privati
    # rispondono mentre la rete pubblica non li vede. Il guard sta QUI e non
    # solo nel livello 1 perche' i livelli 2 e 3 navigano con Playwright, che
    # e' un browser vero: nessun controllo lo attraverserebbe.
    #
    # E non basta `check_url`: quello giudica la STRINGA, e per costruzione un
    # nome non lo risolve — dove punta lo dice il DNS al momento della
    # richiesta. Sui livelli 2 e 3 non manca solo il ricontrollo dei redirect,
    # manca la risoluzione: `boards.example.com` che risponde 169.254.169.254
    # passerebbe il controllo della stringa e verrebbe navigato dal browser.
    # Qui si risolve una volta sola, all'ingresso, per tutti i livelli.
    try:
        url = check_url(url)
        parts = urllib.parse.urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        resolve_public_address(parts.hostname, port)
    except UrlRejected as exc:
        return _refused(url, exc)

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
            # UN RIFIUTO NON FA SALIRE DI LIVELLO. Senza questa riga il
            # rifiuto del livello 1 diventa la condizione che manda la stessa
            # richiesta al livello 2, dove il controllo non c'e': la difesa
            # consegnerebbe il fetch alla strada scoperta, e il chiamante
            # riceverebbe 200 con `refused` a False. Un indirizzo che non si
            # scarica non e' un livello che ha fallito.
            if r.get("refused"):
                return r
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
    p.add_argument("url", help="URL to fetch")
    p.add_argument("--level", type=int, default=3, choices=[1, 2, 3],
                   help="Maximum level to try (default: 3)")
    p.add_argument("--out", help="Path where the complete HTML will be saved")
    p.add_argument("--profile-dir", help="Persistent profile directory for L3, e.g. linkedin-session")
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT,
                   help=f"Request timeout in seconds (default: {DEFAULT_TIMEOUT})")
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
    # Un URL rifiutato non e' «la rete non ha risposto»: e' un indirizzo che
    # non si scarica, e riprovarlo non cambia nulla. Esce 1, come gli altri
    # URL non validi, cosi' il chiamante non lo mette in coda di retry.
    if result.get("refused"):
        return 1
    return 0 if not result.get("error") and result.get("status", 0) > 0 else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
