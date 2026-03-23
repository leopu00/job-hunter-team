#!/usr/bin/env python3
"""Verifica se un job LinkedIn è ancora attivo, usando profilo autenticato.

Uso:
    python3 linkedin_check.py <URL> [output.png]
    python3 linkedin_check.py --batch ID1 ID2 ID3 ...

Variabili d'ambiente:
    LINKEDIN_PROFILE_PATH — percorso al profilo Chrome persistente per LinkedIn
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from _db import get_db, DB_PATH

PROFILE_PATH = os.environ.get(
    "LINKEDIN_PROFILE_PATH",
    os.path.join(os.path.dirname(__file__), '..', 'secrets', 'linkedin-profile')
)


def check_job(url, output_png="/tmp/linkedin-check.png"):
    """Screenshot autenticato con profilo persistente + verifica testo."""
    from playwright.sync_api import sync_playwright
    import time

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(PROFILE_PATH, headless=True)
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
        print("Uso: python3 linkedin_check.py <URL> [output.png]")
        print("     python3 linkedin_check.py --batch ID1 ID2 ID3 ...")
        sys.exit(1)

    if sys.argv[1] == "--batch":
        ids = [int(x) for x in sys.argv[2:]]
        print(f"Verifica batch: {len(ids)} posizioni")
        results = batch_check(ids)
        print(f"\nRiepilogo:")
        for pid, status, title, company, url in results:
            print(f"  {pid}: {status} — {company} — {title}")
        closed = [r for r in results if r[1] == "CLOSED"]
        print(f"\nChiusi: {len(closed)} / {len(results)}")
    else:
        url = sys.argv[1]
        out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/linkedin-check.png"
        status, path = check_job(url, out)
        print(f"Status: {status}")
        print(f"Screenshot: {path}")
