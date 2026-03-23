#!/usr/bin/env python3
"""
Verifica batch link posizioni attive.
Controlla se le posizioni LinkedIn (e altri) sono ancora aperte.
"""

import sqlite3
import requests
import time
import sys
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs.db')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

# Pattern che indicano posizione scaduta
EXPIRED_PATTERNS = [
    'no longer accepting applications',
    'no longer available',
    'applications are closed',
    'this job has expired',
    'position has been filled',
    'job is closed',
    'posting has expired',
    'application period has ended',
    'no longer open',
    'this position is no longer',
    'job has been removed',
    'listing has expired',
]

def check_url(url, timeout=15):
    """Verifica se un URL è ancora attivo e accetta candidature."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)

        if resp.status_code == 404:
            return 'DEAD', '404 Not Found'
        if resp.status_code == 410:
            return 'DEAD', '410 Gone'
        if resp.status_code >= 400:
            return 'ERROR', f'HTTP {resp.status_code}'

        body = resp.text.lower()

        for pattern in EXPIRED_PATTERNS:
            if pattern in body:
                return 'EXPIRED', pattern

        # LinkedIn specifico: se redirect a pagina ricerca = posizione rimossa
        if 'linkedin.com/jobs/search' in str(resp.url) and 'linkedin.com/jobs/view' in url:
            return 'EXPIRED', 'Redirect to search page'

        return 'OK', ''

    except requests.exceptions.Timeout:
        return 'TIMEOUT', 'Request timeout'
    except requests.exceptions.ConnectionError:
        return 'ERROR', 'Connection error'
    except Exception as e:
        return 'ERROR', str(e)


def main():
    # Filtro opzionale per status
    status_filter = sys.argv[1] if len(sys.argv) > 1 else None

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if status_filter:
        rows = conn.execute(
            "SELECT id, company, title, url, status FROM positions WHERE status = ? ORDER BY id",
            (status_filter,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, company, title, url, status FROM positions WHERE status NOT IN ('excluded') ORDER BY status, id"
        ).fetchall()

    conn.close()

    total = len(rows)
    expired = []
    dead = []
    errors = []
    ok_count = 0

    print(f"\n{'='*70}")
    print(f"  VERIFICA LINK — {total} posizioni da controllare")
    print(f"{'='*70}\n")

    for i, row in enumerate(rows, 1):
        pid = row['id']
        company = row['company'][:25]
        title = row['title'][:30]
        url = row['url']
        status = row['status']

        sys.stdout.write(f"  [{i}/{total}] #{pid} {company} — ")
        sys.stdout.flush()

        result, detail = check_url(url)

        if result == 'EXPIRED':
            print(f"⛔ SCADUTA ({detail})")
            expired.append(row)
        elif result == 'DEAD':
            print(f"💀 MORTA ({detail})")
            dead.append(row)
        elif result == 'ERROR' or result == 'TIMEOUT':
            print(f"⚠️  {result} ({detail})")
            errors.append(row)
        else:
            print(f"✅ OK")
            ok_count += 1

        # Rate limiting: 1.5s tra richieste LinkedIn, 0.5s per altri
        if 'linkedin.com' in url:
            time.sleep(1.5)
        else:
            time.sleep(0.5)

    # RIEPILOGO
    print(f"\n{'='*70}")
    print(f"  RIEPILOGO")
    print(f"{'='*70}")
    print(f"  ✅ OK: {ok_count}")
    print(f"  ⛔ SCADUTE: {len(expired)}")
    print(f"  💀 MORTE: {len(dead)}")
    print(f"  ⚠️  ERRORI: {len(errors)}")

    if expired:
        print(f"\n  --- POSIZIONI SCADUTE (da escludere) ---")
        for r in expired:
            print(f"  #{r['id']:>4} [{r['status']:>8}] {r['company'][:25]:<25} {r['title'][:40]}")

    if dead:
        print(f"\n  --- POSIZIONI MORTE (link non funziona) ---")
        for r in dead:
            print(f"  #{r['id']:>4} [{r['status']:>8}] {r['company'][:25]:<25} {r['title'][:40]}")

    if errors:
        print(f"\n  --- ERRORI (da verificare manualmente) ---")
        for r in errors:
            print(f"  #{r['id']:>4} [{r['status']:>8}] {r['company'][:25]:<25} {r['title'][:40]}")

    # Stampa comandi per escludere
    all_bad = expired + dead
    if all_bad:
        print(f"\n  --- COMANDI PER ESCLUDERE ---")
        for r in all_bad:
            print(f"  python3 shared/skills/db_update.py position {r['id']} --status excluded --notes \"Link scaduto/morto - verifica {time.strftime('%Y-%m-%d')}\"")

    print()


if __name__ == '__main__':
    main()
