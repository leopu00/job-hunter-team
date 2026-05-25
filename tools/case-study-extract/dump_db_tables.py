#!/usr/bin/env python3
"""Dump all SQLite tables from a JHT VPS as JSON files (plus the raw .db).

The DB lives inside the running container at /jht_home/jobs.db (bind-mounted
from host /root/.jht/jobs.db). We query it via `docker exec jht python3` to
avoid installing sqlite3 on the host.

Read-only: never modifies the DB, never triggers any agent. The container
must already be running but no `team start` is invoked.

Usage:
    python3 dump_db_tables.py --host IP --key KEYPATH --out OUTDIR [--cutoff ISO]

Cutoff (optional): only rows with timestamp_column < cutoff are exported.
The column is per-table: positions.found_at, applications.created_at,
scores.scored_at, companies.analyzed_at, position_highlights.created_at,
position_state_transitions.ts, pending_user_messages.created_at.
"""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path

TABLES_AND_TS_COL = {
    "positions": "found_at",
    "applications": "created_at",
    "scores": "scored_at",
    "companies": "analyzed_at",
    "position_highlights": "created_at",
    "position_state_transitions": "ts",
    "pending_user_messages": "created_at",
}


def ssh_run(host: str, key: Path, command: str, capture: bool = True) -> str:
    """Execute a command on the VPS via SSH. Always read-only operations."""
    cmd = [
        "ssh",
        "-i",
        str(key),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        f"root@{host}",
        command,
    ]
    result = subprocess.run(cmd, capture_output=capture, text=True, check=True)
    return result.stdout


def scp_get(host: str, key: Path, remote_path: str, local_path: Path) -> None:
    subprocess.run(
        [
            "scp",
            "-i",
            str(key),
            "-o",
            "BatchMode=yes",
            f"root@{host}:{remote_path}",
            str(local_path),
        ],
        check=True,
    )


def dump_table(host: str, key: Path, table: str, cutoff: str | None) -> list[dict]:
    """Dump one table as JSON via docker exec python3 inside the container."""
    where = ""
    if cutoff:
        ts_col = TABLES_AND_TS_COL.get(table)
        if ts_col:
            # NOTE: cutoff format must match the column format (SQLite TEXT, ISO).
            where = f' WHERE {ts_col} < "{cutoff}"'
    sql = f'SELECT * FROM {table}{where}'

    # Build the python one-liner. Quoting via repr() in caller is fragile; we
    # write it as a here-doc piped to python3 inside the container.
    py_program = f"""
import sqlite3, json, sys
con = sqlite3.connect('/jht_home/jobs.db')
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute({sql!r})]
sys.stdout.write(json.dumps(rows, default=str, ensure_ascii=False))
"""
    # Pipe the program to docker exec via SSH stdin.
    cmd = [
        "ssh",
        "-i",
        str(key),
        "-o",
        "BatchMode=yes",
        f"root@{host}",
        "docker exec -i jht python3",
    ]
    result = subprocess.run(
        cmd, input=py_program, capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", required=True, help="VPS IPv4 or hostname")
    ap.add_argument("--key", required=True, type=Path, help="SSH private key path")
    ap.add_argument("--out", required=True, type=Path, help="Local output directory")
    ap.add_argument("--cutoff", help='ISO timestamp, e.g. "2026-05-20 00:00:00"')
    args = ap.parse_args()

    out = args.out / "db"
    out.mkdir(parents=True, exist_ok=True)

    # 1. Copy the raw .db file (without cutoff filtering — kept for forensics).
    print(f"  copying raw jobs.db → {out / 'jobs.db'}")
    # Use docker cp to extract from container, then scp from host.
    ssh_run(
        args.host,
        args.key,
        "docker exec jht cp /jht_home/jobs.db /tmp/jobs-snapshot.db && "
        "docker cp jht:/tmp/jobs-snapshot.db /tmp/jobs-snapshot.db && "
        "docker exec jht rm /tmp/jobs-snapshot.db",
    )
    scp_get(args.host, args.key, "/tmp/jobs-snapshot.db", out / "jobs.db")
    ssh_run(args.host, args.key, "rm -f /tmp/jobs-snapshot.db")

    # 2. Dump each table as JSON, filtered by cutoff when applicable.
    summary = {}
    for table in TABLES_AND_TS_COL:
        try:
            rows = dump_table(args.host, args.key, table, args.cutoff)
        except subprocess.CalledProcessError as e:
            print(f"  ! table {table} failed: {e.stderr[:200]}")
            continue
        (out / f"{table}.json").write_text(
            json.dumps(rows, indent=2, ensure_ascii=False, default=str)
        )
        summary[table] = len(rows)
        print(f"  {table:32}  {len(rows):>5} rows")

    # 3. Summary file
    (out / "_summary.json").write_text(
        json.dumps(
            {
                "cutoff": args.cutoff,
                "tables": summary,
                "total_rows": sum(summary.values()),
            },
            indent=2,
        )
    )
    print(f"  total rows extracted: {sum(summary.values())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
