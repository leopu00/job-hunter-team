#!/usr/bin/env python3
"""Verifica se un job LinkedIn è ancora attivo, usando profilo autenticato.

Uso:
    python3 linkedin_check.py <URL> [output.png]
    python3 linkedin_check.py --batch ID1 ID2 ID3 ...

Variabili d'ambiente:
    LINKEDIN_PROFILE_PATH — percorso al profilo Chrome persistente per LinkedIn
    JHT_HOME              — cartella dati; il profilo di default sta in
                            $JHT_HOME/secrets/linkedin-profile (0700)

Il profilo NON sta sotto la cartella dello script: dentro l'immagine `/app` è
di root e gli agenti girano come utente non root, quindi una scrittura lì
fallisce con EACCES e il tier LinkedIn salta per tutta la squadra.
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from _db import get_db, DB_PATH

# Esce con questo codice se la cartella del profilo non si può creare o scrivere:
# `tool_health` lo legge come BROKEN invece di un generico UNKNOWN.
EXIT_PROFILE_NOT_WRITABLE = 4
PROFILE_ERROR_TAG = "LINKEDIN_PROFILE_NOT_WRITABLE"


def profile_path():
    """Dove sta il profilo del browser: l'override esplicito, o sotto $JHT_HOME."""
    explicit = os.environ.get("LINKEDIN_PROFILE_PATH")
    if explicit:
        return explicit
    home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
    return str(home / "secrets" / "linkedin-profile")


def ensure_profile_dir(path=None):
    """Crea la cartella del profilo con permessi 0700 (anche `secrets/` sopra) e
    verifica che ci si possa scrivere. Alza OSError con un messaggio chiaro.

    Con il percorso di default la cartella padre e' `$JHT_HOME/secrets`: la si
    crea chiusa e, se esisteva gia' piu' aperta, la si restringe a 0700. Con un
    percorso esplicito (LINKEDIN_PROFILE_PATH) il padre e' di chi l'ha scelto e
    non si tocca: si chiude solo la cartella del profilo."""
    default = path is None and not os.environ.get("LINKEDIN_PROFILE_PATH")
    path = Path(path or profile_path())
    try:
        # `makedirs(mode=)` vale solo per l'ultimo livello: la cartella padre
        # (`secrets/`) la creiamo a parte, già chiusa.
        if not path.parent.exists():
            os.makedirs(path.parent, mode=0o700, exist_ok=True)
        if default:
            try:
                os.chmod(path.parent, 0o700)
            except OSError:
                pass  # non e' nostra: il profilo qui sotto resta comunque 0700
        os.makedirs(path, mode=0o700, exist_ok=True)
        os.chmod(path, 0o700)
        if not os.access(path, os.W_OK | os.X_OK):
            raise PermissionError(13, "not writable", str(path))
    except OSError as e:
        raise OSError(
            e.errno,
            "%s: the browser profile directory %s cannot be created or written "
            "(%s). Set LINKEDIN_PROFILE_PATH or JHT_HOME to a writable place."
            % (PROFILE_ERROR_TAG, path, e.strerror or e),
        ) from e
    return str(path)


def check_job(url, output_png="/tmp/linkedin-check.png"):
    """Screenshot autenticato con profilo persistente + verifica testo."""
    from playwright.sync_api import sync_playwright
    import time

    profile = ensure_profile_dir()
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, headless=True)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(url, wait_until="load", timeout=45000)
        time.sleep(3)
        page.screenshot(path=output_png, full_page=False)
        text = page.text_content("body") or ""
        context.close()

    closed = "No longer accepting" in text or "isn't accepting" in text
    return "CLOSED" if closed else "ACTIVE", output_png


def batch_check(position_ids):
    """Verifica batch di posizioni dal DB. Apre contesto fresco per ogni URL."""
    conn = get_db()
    results = []

    for pid in position_ids:
        row = conn.execute("SELECT id, title, company, url FROM positions WHERE id = ?", (pid,)).fetchone()
        if not row:
            results.append((pid, "NOT_FOUND", "", "", ""))
            continue
        url = row["url"]
        if "linkedin.com" not in (url or ""):
            results.append((pid, "SKIP_NOT_LINKEDIN", row["title"], row["company"], url))
            continue
        try:
            status, _ = check_job(url, f"/tmp/linkedin_{pid}.png")
            results.append((pid, status, row["title"], row["company"], url))
            print(f"  ID {pid}: {status} — {row['company']} — {row['title']}")
        except Exception as e:
            results.append((pid, f"ERROR: {e}", row["title"], row["company"], url))
            print(f"  ID {pid}: ERROR — {e}")

    conn.close()
    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 linkedin_check.py <URL> [output.png]")
        print("     python3 linkedin_check.py --batch ID1 ID2 ID3 ...")
        sys.exit(1)

    # Prima di tutto la cartella del profilo: se non è scrivibile lo si dice una
    # volta, con un codice d'uscita proprio, invece di un EACCES per ogni URL
    # (e il canary `tool_health --batch` senza id lo vede).
    try:
        ensure_profile_dir()
    except OSError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(EXIT_PROFILE_NOT_WRITABLE)

    if sys.argv[1] == "--batch":
        ids = [int(x) for x in sys.argv[2:]]
        print(f"Batch check: {len(ids)} positions")
        results = batch_check(ids)
        print(f"\nSummary:")
        for pid, status, title, company, url in results:
            print(f"  {pid}: {status} — {company} — {title}")
        closed = [r for r in results if r[1] == "CLOSED"]
        print(f"\nClosed: {len(closed)} / {len(results)}")
    else:
        url = sys.argv[1]
        out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/linkedin-check.png"
        status, path = check_job(url, out)
        print(f"Status: {status}")
        print(f"Screenshot: {path}")
