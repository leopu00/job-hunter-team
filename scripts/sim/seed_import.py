#!/usr/bin/env python3
"""Importa seed.json (output dello scout su 206 record) nel jobs.db
del container di simulazione `jht-sim-d2`.

Uso (da host Mac, fa exec nel container):
    docker compose -f scripts/sim/docker-compose.sim.yml exec jht-sim-d2 \
        python3 /jht_home_sim/seed_import.py

Lo script:
1. Esegue `db_init.py` per creare schema vuoto + applicare migrations
   (incluse quelle nuove role_family + 10 colonne location).
2. Legge `/jht_home_sim/seed.json` (montato dall'host).
3. Inserisce ogni record via INSERT diretto SQLite (più rapido di 206
   chiamate `db_insert.py`).
4. NON popola: role_family, loc_*, work_*, status (default 'new'),
   notes — quelli saranno popolati dagli analisti.

Idempotente: salta record già presenti (match per url+title).
"""
import json
import os
import sqlite3
import subprocess
import sys

SEED_PATH = os.environ.get('JHT_SIM_SEED', '/jht_home_sim/seed.json')
DB_PATH = os.environ.get('JHT_DB_PATH', '/jht_home_sim/jobs.db')

def init_schema():
    """Esegue db_init.py per creare/migrare schema."""
    print("→ db_init.py (schema + migrations)...")
    r = subprocess.run(
        ['python3', '/app/shared/skills/db_init.py'],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"✗ db_init.py failed:\n{r.stderr}", file=sys.stderr)
        sys.exit(1)
    print(r.stdout.strip())

def import_seed():
    if not os.path.exists(SEED_PATH):
        print(f"✗ Seed non trovato: {SEED_PATH}", file=sys.stderr)
        sys.exit(2)
    with open(SEED_PATH) as f:
        records = json.load(f)
    print(f"→ Importing {len(records)} records into {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    inserted = 0
    skipped = 0
    failed = 0

    for r in records:
        # Skip se già presente (idempotenza)
        url = r.get('url')
        if url:
            existing = conn.execute(
                "SELECT id FROM positions WHERE url = ? LIMIT 1", (url,)
            ).fetchone()
            if existing:
                skipped += 1
                continue
        try:
            conn.execute("""
                INSERT INTO positions
                  (title, company, location, remote_type,
                   salary_declared_min, salary_declared_max, salary_declared_currency,
                   salary_estimated_min, salary_estimated_max, salary_estimated_currency,
                   salary_estimated_source,
                   url, source, jd_text, requirements,
                   found_by, found_at, deadline,
                   status, notes)
                VALUES (?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?)
            """, (
                r.get('title'), r.get('company'), r.get('location'), r.get('remote_type'),
                r.get('salary_declared_min'), r.get('salary_declared_max'), r.get('salary_declared_currency'),
                r.get('salary_estimated_min'), r.get('salary_estimated_max'), r.get('salary_estimated_currency'),
                r.get('salary_estimated_source'),
                url, r.get('source'), r.get('jd_text'), r.get('requirements'),
                r.get('found_by'), r.get('found_at'), r.get('deadline'),
                r.get('status', 'new'), r.get('notes'),
            ))
            inserted += 1
        except sqlite3.IntegrityError as e:
            print(f"✗ Skip {r.get('title')!r}: {e}", file=sys.stderr)
            failed += 1
        except Exception as e:
            print(f"✗ Fail {r.get('title')!r}: {e}", file=sys.stderr)
            failed += 1

    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    by_status = conn.execute(
        "SELECT status, COUNT(*) FROM positions GROUP BY status"
    ).fetchall()
    conn.close()

    print(f"✓ Done. inserted={inserted} skipped={skipped} failed={failed}")
    print(f"  jobs.db now has {total} positions:")
    for row in by_status:
        print(f"    {row[0]}: {row[1]}")

if __name__ == '__main__':
    init_schema()
    import_seed()
