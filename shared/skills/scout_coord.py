#!/usr/bin/env python3
"""
Coordinazione Scout — Database di distribuzione lavoro.

Gli scout usano questo DB per solidificare la divisione di cerchi e fonti
dopo la negoziazione via tmux. Storico incluso per sessioni future.

Uso:
  python3 scout_coord.py show                          # Distribuzione attuale
  python3 scout_coord.py history                       # Storico distribuzioni
  python3 scout_coord.py assign scout-1 --cerchi "1,2" --fonti "remoteok,pyjobs"
  python3 scout_coord.py assign scout-2 --cerchi "3,4" --fonti "greenhouse,lever"
  python3 scout_coord.py reset                         # Chiudi sessione corrente
  python3 scout_coord.py claim <job_id>  <scout_name>  # Claim posizione (anti-collisione)
  python3 scout_coord.py check-claim <job_id>          # Verifica se già claimata
"""

import sqlite3
import sys
import os
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "scout_coordination.db"


def get_db():
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS coordination (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scout TEXT NOT NULL,
            cerchi TEXT,
            fonti TEXT,
            note TEXT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            superseded_at TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            job_id TEXT PRIMARY KEY,
            scout TEXT NOT NULL,
            claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.commit()
    return db


def cmd_show():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM coordination WHERE superseded_at IS NULL ORDER BY scout"
    ).fetchall()
    if not rows:
        print("Nessuna distribuzione attiva.")
        return
    started = rows[0]["started_at"]
    print(f"=== DISTRIBUZIONE ATTIVA (dal {started}) ===\n")
    for r in rows:
        print(f"  {r['scout']}")
        print(f"    Cerchi: {r['cerchi'] or '-'}")
        print(f"    Fonti:  {r['fonti'] or '-'}")
        if r["note"]:
            print(f"    Note:   {r['note']}")
        print()
    db.close()


def cmd_history():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM coordination ORDER BY started_at DESC, scout"
    ).fetchall()
    if not rows:
        print("Nessuno storico.")
        return
    current_session = None
    for r in rows:
        session_key = r["started_at"]
        if session_key != current_session:
            current_session = session_key
            status = "ATTIVA" if r["superseded_at"] is None else f"chiusa {r['superseded_at']}"
            print(f"\n--- Sessione {r['started_at']} ({status}) ---")
        active = " *" if r["superseded_at"] is None else ""
        print(f"  {r['scout']}: cerchi={r['cerchi'] or '-'}, fonti={r['fonti'] or '-'}{active}")
    db.close()


def cmd_assign(scout, cerchi=None, fonti=None, note=None):
    db = get_db()
    # Se esiste gia un record attivo per questo scout, aggiornalo
    existing = db.execute(
        "SELECT id FROM coordination WHERE scout=? AND superseded_at IS NULL", (scout,)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE coordination SET cerchi=?, fonti=?, note=?, started_at=CURRENT_TIMESTAMP WHERE id=?",
            (cerchi, fonti, note, existing["id"])
        )
        print(f"Aggiornato: {scout} → cerchi={cerchi}, fonti={fonti}")
    else:
        db.execute(
            "INSERT INTO coordination (scout, cerchi, fonti, note) VALUES (?, ?, ?, ?)",
            (scout, cerchi, fonti, note)
        )
        print(f"Assegnato: {scout} → cerchi={cerchi}, fonti={fonti}")
    db.commit()
    db.close()


def cmd_reset():
    db = get_db()
    now = datetime.now().isoformat()
    updated = db.execute(
        "UPDATE coordination SET superseded_at=? WHERE superseded_at IS NULL", (now,)
    ).rowcount
    # Pulisci anche i claim vecchi (> 24h)
    db.execute("DELETE FROM claims WHERE claimed_at < datetime('now', '-24 hours')")
    db.commit()
    print(f"Sessione chiusa: {updated} assegnazioni archiviate.")
    db.close()


def cmd_claim(job_id, scout):
    db = get_db()
    existing = db.execute("SELECT scout, claimed_at FROM claims WHERE job_id=?", (job_id,)).fetchone()
    if existing:
        print(f"GIA_CLAIMATA da {existing['scout']} alle {existing['claimed_at']}")
        db.close()
        return False
    try:
        db.execute("INSERT INTO claims (job_id, scout) VALUES (?, ?)", (job_id, scout))
        db.commit()
        print(f"CLAIMATA da {scout}")
        db.close()
        return True
    except sqlite3.IntegrityError:
        print(f"GIA_CLAIMATA (race condition)")
        db.close()
        return False


def cmd_check_claim(job_id):
    db = get_db()
    existing = db.execute("SELECT scout, claimed_at FROM claims WHERE job_id=?", (job_id,)).fetchone()
    if existing:
        print(f"CLAIMATA da {existing['scout']} alle {existing['claimed_at']}")
    else:
        print("LIBERA")
    db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "show":
        cmd_show()
    elif cmd == "history":
        cmd_history()
    elif cmd == "assign" and len(sys.argv) >= 3:
        scout = sys.argv[2]
        cerchi = fonti = note = None
        args = sys.argv[3:]
        for i, arg in enumerate(args):
            if arg == "--cerchi" and i + 1 < len(args):
                cerchi = args[i + 1]
            elif arg == "--fonti" and i + 1 < len(args):
                fonti = args[i + 1]
            elif arg == "--note" and i + 1 < len(args):
                note = args[i + 1]
        cmd_assign(scout, cerchi, fonti, note)
    elif cmd == "reset":
        cmd_reset()
    elif cmd == "claim" and len(sys.argv) >= 4:
        cmd_claim(sys.argv[2], sys.argv[3])
    elif cmd == "check-claim" and len(sys.argv) >= 3:
        cmd_check_claim(sys.argv[2])
    else:
        print(__doc__)
