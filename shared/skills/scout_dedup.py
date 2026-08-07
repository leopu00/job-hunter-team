#!/usr/bin/env python3
"""scout_dedup.py — dedup gerarchica come CHECK standalone (SC-05, bug #25).

Lo Scout chiama questo PRIMA di `db_insert.py position` per sapere se la
posizione è nuova o un duplicato, senza dover replicare a mano le query di
dedup (e senza il rischio di bypassarle con `python3 -c "import sqlite3…"`).

È un wrapper SOTTILE: la logica e il logging (`scout-dedup.log`) vivono in
`db_insert.check_duplicate()` — qui esponiamo solo l'interfaccia CLI/JSON
che i prompt di Scout ed email-monitor già documentano (SC-05).

Uso:
  python3 scout_dedup.py check --url URL [--company C] [--title T] [--location L]

Output JSON su stdout:
  {"action": "insert"}
  {"action": "skip", "level": 2, "existing_id": 28, "match": "azienda+titolo+city-norm"}

Exit code (per gateare anche in bash: `scout_dedup.py check … && db_insert.py …`):
  0  → insert (nessun duplicato)
  10 → skip (duplicato trovato)
  2  → errore di uso/DB

Livelli (gerarchia di check_duplicate):
  0 = LinkedIn job ID · 1 = URL esatto · 2 = azienda+titolo+city-norm
  3 = azienda+titolo simile (>0.85)+city-norm
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import get_db, ensure_schema  # noqa: E402
from db_insert import check_duplicate  # noqa: E402

# `check_duplicate` ritorna una stringa descrittiva di match, non il numero
# di livello — la rimappiamo qui sul livello SC-05 (stabile per prefisso).
_LEVEL_BY_PREFIX = (
    ("LinkedIn job ID", 0),
    ("URL esatto", 1),
    ("azienda+titolo+city", 2),
    ("azienda+titolo simile", 3),
)


def _level_from_match(match_type):
    if not match_type:
        return None
    for prefix, lvl in _LEVEL_BY_PREFIX:
        if match_type.startswith(prefix):
            return lvl
    return None


def dedup_check(url, company=None, title=None, location=None):
    """Ritorna il dict di risposta SC-05 (insert | skip). Pura sul DB:
    apre/chiude la connessione, non scrive nulla (il logging dello skip è
    in check_duplicate)."""
    conn = get_db()
    try:
        ensure_schema(conn)  # robusto su DB fresco (primo check prima di ogni INSERT)
        existing, match_type = check_duplicate(conn, url, company, title, location)
    finally:
        conn.close()
    if existing:
        return {
            "action": "skip",
            "level": _level_from_match(match_type),
            "existing_id": existing["id"],
            "match": match_type,
        }
    return {"action": "insert"}


def main():
    parser = argparse.ArgumentParser(description="Hierarchical pre-INSERT deduplication (SC-05)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="Check whether a position is a duplicate")
    c.add_argument("--url", default="", help="Position URL")
    c.add_argument("--company", default=None)
    c.add_argument("--title", default=None)
    c.add_argument("--location", default=None)
    args = parser.parse_args()

    if not (args.url or (args.company and args.title)):
        print(json.dumps({"action": "error",
                          "reason": "provide --url, or both --company and --title"}))
        sys.exit(2)

    result = dedup_check(args.url, args.company, args.title, args.location)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(10 if result["action"] == "skip" else 0)


if __name__ == "__main__":
    main()
