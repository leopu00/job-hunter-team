#!/usr/bin/env python3
"""Migrazione database jobs.db → Schema V2.

Uso:
  python3 db_migrate_v2.py --dry-run     # Mostra cosa farebbe senza toccare il DB
  python3 db_migrate_v2.py               # Esegui migrazione
  python3 db_migrate_v2.py --verify      # Verifica integrità post-migrazione
"""

import sqlite3
import shutil
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from _db import DB_PATH


def backup_db():
    """Crea backup con timestamp."""
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_path = DB_PATH.replace('.db', f'-backup-{ts}.db')
    shutil.copy2(DB_PATH, backup_path)
    print(f"Backup creato: {backup_path}")
    return backup_path


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")  # OFF durante migrazione
    conn.row_factory = sqlite3.Row
    return conn


def step1_cleanup(conn, dry_run=False):
    """Step 1: Pulizia record morti, duplicati, companies orfane."""
    print("\n=== STEP 1: PULIZIA ===")

    # 1a. Excluded senza score e senza application
    dead = conn.execute("""
        SELECT p.id, p.title, p.company FROM positions p
        WHERE p.status = 'excluded'
        AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.position_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.position_id = p.id)
    """).fetchall()
    print(f"\nExcluded senza score/app: {len(dead)}")
    if dead and not dry_run:
        dead_ids = [r['id'] for r in dead]
        # Rimuovi highlights associati
        conn.execute(f"DELETE FROM position_highlights WHERE position_id IN ({','.join('?' * len(dead_ids))})", dead_ids)
        conn.execute(f"DELETE FROM positions WHERE id IN ({','.join('?' * len(dead_ids))})", dead_ids)
        print(f"  Eliminati {len(dead_ids)} record morti + highlights")

    # 1b. Deduplicazione URL — tenere il record con più dati (score/app/status avanzato)
    dupes = conn.execute("""
        SELECT url, GROUP_CONCAT(id) as ids FROM positions
        WHERE url IS NOT NULL GROUP BY url HAVING COUNT(*) > 1
    """).fetchall()
    print(f"\nURL duplicate: {len(dupes)}")

    for d in dupes:
        ids = [int(x) for x in d['ids'].split(',')]
        # Per ogni gruppo, tenere quello con status più avanzato o con score/app
        rows = conn.execute(f"""
            SELECT p.id, p.status, p.title, p.company,
                   EXISTS(SELECT 1 FROM scores s WHERE s.position_id = p.id) as has_score,
                   EXISTS(SELECT 1 FROM applications a WHERE a.position_id = p.id) as has_app
            FROM positions p WHERE p.id IN ({','.join('?' * len(ids))})
            ORDER BY
                has_app DESC, has_score DESC,
                CASE p.status
                    WHEN 'applied' THEN 10 WHEN 'response' THEN 9
                    WHEN 'ready' THEN 8 WHEN 'review' THEN 7
                    WHEN 'writing' THEN 6 WHEN 'scored' THEN 5
                    WHEN 'checked' THEN 4 WHEN 'new' THEN 3
                    WHEN 'excluded' THEN 1
                END DESC,
                p.id ASC
        """, ids).fetchall()

        keep = rows[0]
        remove = rows[1:]
        print(f"  URL: {d['url'][:60]}...")
        print(f"    TENGO: #{keep['id']} ({keep['company']}) [{keep['status']}] score={keep['has_score']} app={keep['has_app']}")
        for r in remove:
            print(f"    RIMUOVO: #{r['id']} ({r['company']}) [{r['status']}]")
            if not dry_run:
                conn.execute("DELETE FROM position_highlights WHERE position_id = ?", (r['id'],))
                conn.execute("DELETE FROM scores WHERE position_id = ?", (r['id'],))
                conn.execute("DELETE FROM positions WHERE id = ?", (r['id'],))

    # 1c. Companies orfane
    orphans = conn.execute("""
        SELECT c.id, c.name FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE LOWER(p.company) = LOWER(c.name))
    """).fetchall()
    print(f"\nCompanies orfane: {len(orphans)}")
    if orphans and not dry_run:
        orphan_ids = [r['id'] for r in orphans]
        conn.execute(f"DELETE FROM companies WHERE id IN ({','.join('?' * len(orphan_ids))})", orphan_ids)
        print(f"  Eliminate {len(orphan_ids)} companies orfane")

    if not dry_run:
        conn.commit()
    print("Step 1 completato.")


def step2_evolve_positions(conn, dry_run=False):
    """Step 2: Evoluzione schema positions — aggiunta campi, rimozione ridondanti."""
    print("\n=== STEP 2: EVOLUZIONE SCHEMA POSITIONS ===")

    # Leggi tutte le posizioni prima della migrazione
    positions = conn.execute("SELECT * FROM positions").fetchall()
    highlights = conn.execute("SELECT * FROM position_highlights").fetchall()
    scores = conn.execute("SELECT * FROM scores").fetchall()
    applications = conn.execute("SELECT * FROM applications").fetchall()
    print(f"Posizioni da migrare: {len(positions)}")
    print(f"Highlights: {len(highlights)}")
    print(f"Scores: {len(scores)}")
    print(f"Applications: {len(applications)}")

    if dry_run:
        print("  [DRY RUN] Saltando creazione tabelle")
        return

    # Rinomina vecchia tabella
    conn.execute("ALTER TABLE positions RENAME TO positions_old")
    conn.execute("ALTER TABLE position_highlights RENAME TO position_highlights_old")
    conn.execute("ALTER TABLE scores RENAME TO scores_old")
    conn.execute("ALTER TABLE applications RENAME TO applications_old")

    # Crea nuove tabelle con schema V2
    conn.executescript("""
    CREATE TABLE positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        company_id INTEGER,
        location TEXT,
        remote_type TEXT,
        salary_declared_min INTEGER,
        salary_declared_max INTEGER,
        salary_declared_currency TEXT DEFAULT 'EUR',
        salary_estimated_min INTEGER,
        salary_estimated_max INTEGER,
        salary_estimated_currency TEXT DEFAULT 'EUR',
        salary_estimated_source TEXT,
        url TEXT,
        source TEXT,
        jd_text TEXT,
        requirements TEXT,
        found_by TEXT,
        found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deadline TEXT,
        status TEXT DEFAULT 'new',
        notes TEXT,
        last_checked TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE position_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL UNIQUE,
        total_score INTEGER NOT NULL,
        stack_match INTEGER,
        remote_fit INTEGER,
        salary_fit INTEGER,
        experience_fit INTEGER,
        strategic_fit INTEGER,
        breakdown TEXT,
        notes TEXT,
        scored_by TEXT,
        scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL UNIQUE,
        cv_path TEXT,
        cl_path TEXT,
        cv_pdf_path TEXT,
        cl_pdf_path TEXT,
        critic_verdict TEXT,
        critic_score REAL,
        critic_notes TEXT,
        status TEXT DEFAULT 'draft',
        written_at TIMESTAMP,
        applied_at TIMESTAMP,
        applied_via TEXT,
        response TEXT,
        response_at TIMESTAMP,
        written_by TEXT,
        reviewed_by TEXT,
        critic_reviewed_at TIMESTAMP,
        applied BOOLEAN DEFAULT 0,
        interview_round INTEGER DEFAULT NULL,
        cv_drive_id TEXT,
        cl_drive_id TEXT,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );
    """)

    print("Tabelle V2 create.")


def step3_migrate_data(conn, dry_run=False):
    """Step 3-4: Migrazione dati nelle nuove tabelle."""
    print("\n=== STEP 3-4: MIGRAZIONE DATI ===")

    if dry_run:
        # Mostra preview migrazione
        # Salary split preview
        declared = conn.execute("SELECT COUNT(*) FROM positions WHERE salary_type = 'declared'").fetchone()[0]
        estimated = conn.execute("SELECT COUNT(*) FROM positions WHERE salary_type = 'estimated'").fetchone()[0]
        unknown = conn.execute("SELECT COUNT(*) FROM positions WHERE salary_type = 'unknown' OR salary_type IS NULL").fetchone()[0]
        print(f"  Salary split preview: declared={declared}, estimated={estimated}, unknown={unknown}")

        # Company_id match preview
        matched = conn.execute("""
            SELECT COUNT(*) FROM positions p
            WHERE EXISTS (SELECT 1 FROM companies c WHERE LOWER(c.name) = LOWER(p.company))
        """).fetchone()[0]
        total = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
        print(f"  Company match preview: {matched}/{total} positions matchano una company")

        # Location consolidation preview
        has_work_loc = conn.execute("SELECT COUNT(*) FROM positions WHERE work_location IS NOT NULL AND work_location != ''").fetchone()[0]
        has_location = conn.execute("SELECT COUNT(*) FROM positions WHERE location IS NOT NULL AND location != ''").fetchone()[0]
        print(f"  Location: {has_work_loc} con work_location, {has_location} con location")
        return

    # Migra positions
    old_positions = conn.execute("SELECT * FROM positions_old").fetchall()
    for p in old_positions:
        # Consolidare location: work_location ha priorità su location
        location = p['work_location'] or p['location'] or None

        # Split salary in base a salary_type
        salary_type = p['salary_type'] or 'unknown'
        d_min = d_max = d_cur = e_min = e_max = e_cur = e_src = None

        if salary_type == 'declared':
            d_min = p['salary_min']
            d_max = p['salary_max']
            d_cur = p['salary_currency'] or 'EUR'
        elif salary_type == 'estimated':
            e_min = p['salary_min']
            e_max = p['salary_max']
            e_cur = p['salary_currency'] or 'EUR'
            e_src = 'manual'
        else:
            # unknown — se ci sono dati salary, li mettiamo in declared per default
            if p['salary_min'] or p['salary_max']:
                d_min = p['salary_min']
                d_max = p['salary_max']
                d_cur = p['salary_currency'] or 'EUR'

        # Auto-resolve company_id
        company_row = conn.execute(
            "SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", (p['company'],)
        ).fetchone()
        company_id = company_row['id'] if company_row else None

        conn.execute("""
            INSERT INTO positions (id, title, company, company_id, location, remote_type,
                                   salary_declared_min, salary_declared_max, salary_declared_currency,
                                   salary_estimated_min, salary_estimated_max, salary_estimated_currency,
                                   salary_estimated_source,
                                   url, source, jd_text, requirements,
                                   found_by, found_at, deadline, status, notes, last_checked)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (p['id'], p['title'], p['company'], company_id, location, p['remote_type'],
              d_min, d_max, d_cur, e_min, e_max, e_cur, e_src,
              p['url'], p['source'], p['jd_text'], p['requirements'],
              p['found_by'], p['found_at'], p['deadline'], p['status'], p['notes'], p['last_checked']))

    print(f"  Migrate {len(old_positions)} posizioni")

    # Migra highlights
    old_hl = conn.execute("SELECT * FROM position_highlights_old").fetchall()
    for h in old_hl:
        conn.execute("""
            INSERT INTO position_highlights (id, position_id, type, text)
            VALUES (?, ?, ?, ?)
        """, (h['id'], h['position_id'], h['type'], h['text']))
    print(f"  Migrati {len(old_hl)} highlights")

    # Migra scores
    old_scores = conn.execute("SELECT * FROM scores_old").fetchall()
    for s in old_scores:
        conn.execute("""
            INSERT INTO scores (id, position_id, total_score, stack_match, remote_fit,
                                salary_fit, experience_fit, strategic_fit,
                                breakdown, notes, scored_by, scored_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (s['id'], s['position_id'], s['total_score'], s['stack_match'],
              s['remote_fit'], s['salary_fit'], s['experience_fit'], s['strategic_fit'],
              s['breakdown'], s['notes'], s['scored_by'], s['scored_at']))
    print(f"  Migrati {len(old_scores)} scores")

    # Migra applications (aggiungendo written_at e response_at come NULL)
    old_apps = conn.execute("SELECT * FROM applications_old").fetchall()
    for a in old_apps:
        conn.execute("""
            INSERT INTO applications (id, position_id, cv_path, cl_path, cv_pdf_path, cl_pdf_path,
                                       critic_verdict, critic_score, critic_notes,
                                       status, written_at, applied_at, applied_via,
                                       response, response_at, written_by, reviewed_by,
                                       critic_reviewed_at, applied, interview_round,
                                       cv_drive_id, cl_drive_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (a['id'], a['position_id'], a['cv_path'], a['cl_path'],
              a['cv_pdf_path'], a['cl_pdf_path'],
              a['critic_verdict'], a['critic_score'], a['critic_notes'],
              a['status'], None, a['applied_at'], a['applied_via'],
              a['response'], None, a['written_by'], a['reviewed_by'],
              a['critic_reviewed_at'], a['applied'],
              a['interview_round'] if 'interview_round' in a.keys() else None,
              a['cv_drive_id'] if 'cv_drive_id' in a.keys() else None,
              a['cl_drive_id'] if 'cl_drive_id' in a.keys() else None))
    print(f"  Migrate {len(old_apps)} applications")

    # Rimuovi tabelle old
    conn.execute("DROP TABLE positions_old")
    conn.execute("DROP TABLE position_highlights_old")
    conn.execute("DROP TABLE scores_old")
    conn.execute("DROP TABLE applications_old")
    print("  Tabelle old rimosse")

    # Ricrea indici
    conn.executescript("""
    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
    CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id);
    CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
    CREATE INDEX IF NOT EXISTS idx_scores_total ON scores(total_score);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    """)
    print("  Indici ricreati")

    # Setta user_version
    conn.execute("PRAGMA user_version = 2")

    conn.commit()
    print("Migrazione dati completata.")


def verify(conn):
    """Verifica integrità post-migrazione."""
    print("\n=== VERIFICA INTEGRITÀ ===")
    ok = True

    # PRAGMA checks
    conn.execute("PRAGMA foreign_keys=ON")
    fk_check = conn.execute("PRAGMA foreign_key_check").fetchall()
    if fk_check:
        print(f"ERRORE: {len(fk_check)} violazioni FK!")
        for r in fk_check:
            print(f"  {r}")
        ok = False
    else:
        print("FK check: OK")

    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != 'ok':
        print(f"ERRORE integrity_check: {integrity}")
        ok = False
    else:
        print("Integrity check: OK")

    # User version
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    print(f"User version: {version}")
    if version != 2:
        print("  ATTENZIONE: versione non è 2!")
        ok = False

    # URL duplicate
    dupes = conn.execute("""
        SELECT url, COUNT(*) FROM positions WHERE url IS NOT NULL
        GROUP BY url HAVING COUNT(*) > 1
    """).fetchall()
    if dupes:
        print(f"ATTENZIONE: {len(dupes)} URL duplicate rimaste!")
        for d in dupes:
            print(f"  {d[0]}: {d[1]} occorrenze")
        ok = False
    else:
        print("Nessuna URL duplicata: OK")

    # Tutti gli score hanno position_id valido
    orphan_scores = conn.execute("""
        SELECT s.id, s.position_id FROM scores s
        WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = s.position_id)
    """).fetchall()
    if orphan_scores:
        print(f"ERRORE: {len(orphan_scores)} scores orfani!")
        ok = False
    else:
        print("Scores tutti collegati a posizioni: OK")

    # Tutte le applications hanno position_id valido
    orphan_apps = conn.execute("""
        SELECT a.id, a.position_id FROM applications a
        WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = a.position_id)
    """).fetchall()
    if orphan_apps:
        print(f"ERRORE: {len(orphan_apps)} applications orfane!")
        ok = False
    else:
        print("Applications tutte collegate a posizioni: OK")

    # Statistiche post-migrazione
    stats = {}
    for table in ['positions', 'companies', 'scores', 'applications', 'position_highlights']:
        stats[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    print(f"\nStatistiche post-migrazione:")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    # Company_id coverage
    with_cid = conn.execute("SELECT COUNT(*) FROM positions WHERE company_id IS NOT NULL").fetchone()[0]
    total = stats['positions']
    pct = (100 * with_cid // total) if total > 0 else 0
    print(f"\nCompany ID popolati: {with_cid}/{total} ({pct}%)")

    # Salary split
    d_count = conn.execute("SELECT COUNT(*) FROM positions WHERE salary_declared_min IS NOT NULL OR salary_declared_max IS NOT NULL").fetchone()[0]
    e_count = conn.execute("SELECT COUNT(*) FROM positions WHERE salary_estimated_min IS NOT NULL OR salary_estimated_max IS NOT NULL").fetchone()[0]
    print(f"Salary declared: {d_count} | estimated: {e_count}")

    # Schema check — verifica nuove colonne
    cols = [r[1] for r in conn.execute("PRAGMA table_info(positions)").fetchall()]
    required = ['company_id', 'salary_declared_min', 'salary_declared_max', 'salary_estimated_min',
                'salary_estimated_max', 'salary_estimated_source']
    missing = [c for c in required if c not in cols]
    if missing:
        print(f"ERRORE: colonne mancanti in positions: {missing}")
        ok = False
    else:
        print("Schema positions V2: OK")

    removed = ['company_hq', 'work_location', 'salary_type', 'salary_min', 'salary_max', 'salary_currency']
    still_there = [c for c in removed if c in cols]
    if still_there:
        print(f"ATTENZIONE: colonne vecchie ancora presenti: {still_there}")
        ok = False
    else:
        print("Colonne V1 rimosse: OK")

    # Applications schema check
    app_cols = [r[1] for r in conn.execute("PRAGMA table_info(applications)").fetchall()]
    app_required = ['written_at', 'response_at', 'interview_round', 'cv_drive_id', 'cl_drive_id']
    app_missing = [c for c in app_required if c not in app_cols]
    if app_missing:
        print(f"ERRORE: colonne mancanti in applications: {app_missing}")
        ok = False
    else:
        print("Schema applications V2: OK")

    print(f"\n{'VERIFICA PASSATA' if ok else 'VERIFICA FALLITA — CONTROLLARE ERRORI'}")
    return ok


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Migrazione DB V2')
    parser.add_argument('--dry-run', action='store_true', help='Mostra cosa farebbe senza eseguire')
    parser.add_argument('--verify', action='store_true', help='Verifica integrità post-migrazione')
    args = parser.parse_args()

    if args.verify:
        conn = get_conn()
        verify(conn)
        conn.close()
        return

    print("=" * 60)
    print("  MIGRAZIONE DATABASE V1 → V2")
    print("=" * 60)

    if args.dry_run:
        print("\n*** DRY RUN — nessuna modifica al database ***\n")

    # Controlla se già migrato
    conn = get_conn()
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version >= 2:
        print(f"Database già a versione {version}. Niente da fare.")
        conn.close()
        return

    if not args.dry_run:
        backup_path = backup_db()
        print(f"Backup pronto. In caso di problemi: cp {backup_path} {DB_PATH}")

    step1_cleanup(conn, dry_run=args.dry_run)
    step2_evolve_positions(conn, dry_run=args.dry_run)
    step3_migrate_data(conn, dry_run=args.dry_run)

    if not args.dry_run:
        verify(conn)

    conn.close()
    print("\n" + "=" * 60)
    if args.dry_run:
        print("  DRY RUN completato — nessuna modifica")
    else:
        print("  MIGRAZIONE V2 COMPLETATA CON SUCCESSO")
    print("=" * 60)


if __name__ == '__main__':
    main()
