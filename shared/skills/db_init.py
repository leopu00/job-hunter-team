#!/usr/bin/env python3
"""Inizializza il database SQLite jobs.db con lo schema completo."""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema, DB_PATH


def check_profile_warnings():
    """Controlla candidate_profile.yml per edge case comuni."""
    profile_path = os.path.join(os.path.dirname(__file__), '..', '..', 'candidate_profile.yml')
    if not os.path.exists(profile_path):
        return
    try:
        import yaml
        with open(profile_path) as f:
            p = yaml.safe_load(f)
        if not p:
            return
        candidate = p.get('candidate', {})
        projects = candidate.get('projects', None)
        if projects is not None and len(projects) == 0:
            print("⚠️  WARNING: candidate.projects e' una lista vuota — lo scrittore non avra' progetti da inserire nel CV")
    except ImportError:
        pass
    except Exception:
        pass


def main():
    conn = get_db()
    ensure_schema(conn)
    conn.execute("PRAGMA user_version = 2")
    conn.commit()
    print(f"Database inizializzato: {os.path.abspath(DB_PATH)}")
    check_profile_warnings()

    # Mostra tabelle create
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    for t in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {t['name']}").fetchone()[0]
        print(f"  {t['name']}: {count} righe")

    conn.close()


if __name__ == '__main__':
    main()
