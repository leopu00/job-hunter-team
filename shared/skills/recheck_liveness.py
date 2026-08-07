#!/usr/bin/env python3
"""recheck_liveness.py — verifica REALE se un annuncio è ancora aperto.

Sostituisce il curl ad-hoc dell'analista (`code=200 marker=none`) che dava falsi
"aperti": curl vede solo l'HTML GREZZO → non coglie l'expiry JS-rendered
(Ashby/Workday/Greenhouse) né l'authwall LinkedIn (200 anche per i chiusi).

Approccio TIERED:
  1. curl veloce: HTTP code + scan marker-chiusura + 404/410.
  2. host ATS-JS noto o LinkedIn o code ambiguo → ESCALA al BROWSER (Playwright
     render) e ri-scan dei marker sull'HTML RENDERIZZATO.
  3. inconcludente → OPEN_UNVERIFIED (MAI falso-aperto; pattern `resilience`).

Output JSON: {state: OPEN|CLOSED|OPEN_UNVERIFIED, method, http, evidence}
Exit: 0 OPEN · 1 CLOSED · 2 OPEN_UNVERIFIED · 3 errore-uso.

Uso:  python3 recheck_liveness.py <url> [title]
"""
import json
import re
import subprocess
import sys

# Marker di CHIUSURA/SCADENZA — per-ATS + generici, EN + IT. Cercati
# case-insensitive sull'HTML (grezzo da curl e, se si escala, RENDERIZZATO).
CLOSED_MARKERS = [
    r"no longer accepting applications",
    r"not accepting applications",
    r"this job is no longer available",
    r"position (has been )?filled",
    r"job (has )?expired",
    r"applications (are )?closed",
    r"no longer accepting",
    r"posting (has been )?closed",
    r"this position is (now )?closed",
    r"vacancy (is )?closed",
    r"offert[ae].{0,12}(chius|scadut|non più disponibil)",
    r"posizion[ei].{0,12}(chius|scadut|non più disponibil)",
    r"annunci[oi].{0,12}(scadut|chius|non più disponibil)",
    r"candidature chiuse",
]
CLOSED_RE = re.compile("|".join(CLOSED_MARKERS), re.I)

# Host ATS che renderizzano lo status in JS → il curl grezzo NON basta.
JS_ATS_HOSTS = ("ashbyhq.com", "myworkdayjobs.com", "greenhouse.io",
                "boards.greenhouse", "lever.co", "workable.com", "linkedin.com",
                "smartrecruiters.com", "wd1.myworkdayjobs", "eightfold.ai")

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")


def _curl(url, timeout=15):
    """Ritorna (http_code:str|None, html:str)."""
    try:
        r = subprocess.run(
            ["curl", "-s", "-L", "-A", UA, "-w", "\n%{http_code}",
             "--max-time", str(timeout), url],
            capture_output=True, text=True, timeout=timeout + 5)
        out = r.stdout
        if "\n" in out:
            html, _, code = out.rpartition("\n")
            return (code.strip() or None), html
        return None, out
    except (subprocess.TimeoutExpired, OSError):
        return None, ""


def _render(url, timeout_s=25):
    """HTML RENDERIZZATO col browser (Playwright headless), o None se il browser
    non è disponibile/fallisce. Stesso path di linkedin_check.py."""
    code = (
        "import sys\n"
        "from playwright.sync_api import sync_playwright\n"
        "with sync_playwright() as p:\n"
        "    b=p.chromium.launch(headless=True)\n"
        "    pg=b.new_page()\n"
        "    pg.goto(sys.argv[1], wait_until='load', timeout=%d)\n"
        "    pg.wait_for_timeout(1500)\n"
        "    sys.stdout.write(pg.content())\n"
        "    b.close()\n" % (timeout_s * 1000)
    )
    try:
        r = subprocess.run([sys.executable, "-c", code, url],
                           capture_output=True, text=True, timeout=timeout_s + 10)
        return r.stdout if r.returncode == 0 and r.stdout else None
    except (subprocess.TimeoutExpired, OSError):
        return None


def _has_closed_marker(html):
    return bool(CLOSED_RE.search(html or ""))


def recheck(url, title=None):
    """Verdetto liveness tiered. Vedi docstring del modulo."""
    host = (url or "").lower()
    is_js_ats = any(h in host for h in JS_ATS_HOSTS)
    code, html = _curl(url)
    if code in ("404", "410"):
        return {"state": "CLOSED", "method": "curl", "http": code,
                "evidence": "HTTP %s" % code}
    if _has_closed_marker(html):
        return {"state": "CLOSED", "method": "curl", "http": code,
                "evidence": "closed marker in raw HTML"}
    # Aperto SOLO se NON è un ATS-JS/LinkedIn (curl basta) e HTTP 200.
    if not is_js_ats and code == "200":
        return {"state": "OPEN", "method": "curl", "http": code,
                "evidence": "200, no closed marker (non-JS host)"}
    # Ambiguo (ATS-JS / LinkedIn / code strano) → ESCALA al browser.
    rendered = _render(url)
    if rendered is None:
        return {"state": "OPEN_UNVERIFIED", "method": "curl-only", "http": code,
                "evidence": "JS host or auth wall, but browser unavailable — "
                            "do NOT mark as open"}
    if _has_closed_marker(rendered):
        return {"state": "CLOSED", "method": "browser", "http": code,
                "evidence": "closed marker in rendered HTML"}
    return {"state": "OPEN", "method": "browser", "http": code,
            "evidence": "rendered, no closed marker"}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"state": "OPEN_UNVERIFIED",
                          "evidence": "usage: recheck_liveness.py <url> [title]"}))
        sys.exit(3)
    res = recheck(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(json.dumps(res, ensure_ascii=False))
    sys.exit({"OPEN": 0, "CLOSED": 1, "OPEN_UNVERIFIED": 2}.get(res["state"], 3))


if __name__ == "__main__":
    main()
