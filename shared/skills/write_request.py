"""User-driven CV write request (Writer-on-demand, V6).

Sets `positions.write_requested = 1|0` atomically and emits a JSON
result line on stdout. Used by:
  - tg-bridge handler `/cv <id>` (single source of truth for the
    validation+UPDATE pair)
  - web/api/positions/[id]/write-request (TS-side already inline, but
    can fall back to this for parity)
  - Capitano (manual override / debug)

Validates (on mode='on'): position exists, status='scored', no
application yet. Same gating as the web API.

Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) + migration V6 in `_db.py`.

Output (single JSON line on stdout, exit 0 on success / 1 on failure):
  {"ok": true, "id": 42, "title": "...", "company": "...", "score": 75,
   "previous": 0, "current": 1}
  {"ok": false, "error": "...", "status_code":
   "NOT_FOUND" | "BAD_STATUS" | "ALREADY_APPLIED" | "DB_ERROR"}
"""

import argparse
import json
import sys

from _db import get_db, ensure_schema


def request_cv(position_id: int, mode: str) -> dict:
    conn = get_db()
    ensure_schema(conn)

    row = conn.execute(
        """
        SELECT p.id, p.title, p.company, p.status, p.write_requested,
               s.total_score,
               CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_application
          FROM positions p
          LEFT JOIN scores s ON s.position_id = p.id
          LEFT JOIN applications a ON a.position_id = p.id
         WHERE p.id = ?
        """,
        (position_id,),
    ).fetchone()

    if not row:
        return {
            "ok": False,
            "error": f"Position #{position_id} not found",
            "status_code": "NOT_FOUND",
        }

    if mode == "on":
        if row["status"] != "scored":
            return {
                "ok": False,
                "error": (
                    f"Position has status '{row['status']}': a CV request "
                    f"is allowed only from 'scored'"
                ),
                "status_code": "BAD_STATUS",
                "id": row["id"],
                "title": row["title"],
                "company": row["company"],
            }
        if row["has_application"] == 1:
            return {
                "ok": False,
                "error": (
                    f"An application is already being processed (or was "
                    f"delivered) for #{position_id}"
                ),
                "status_code": "ALREADY_APPLIED",
                "id": row["id"],
                "title": row["title"],
                "company": row["company"],
            }

    flag = 1 if mode == "on" else 0
    conn.execute(
        # `CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END` mantiene
        # `write_requested_at` allineato al flag (NULL su toggle-off → la
        # query `next-for-scrittore` ordina FIFO solo sulle richieste vive).
        "UPDATE positions "
        "   SET write_requested = ?, "
        "       write_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END "
        " WHERE id = ?",
        (flag, flag, position_id),
    )
    conn.commit()

    return {
        "ok": True,
        "id": row["id"],
        "title": row["title"],
        "company": row["company"],
        "score": row["total_score"],
        "previous": row["write_requested"],
        "current": flag,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="User-driven CV request (Writer-on-demand, V6)"
    )
    p.add_argument("position_id", type=int)
    p.add_argument(
        "--mode",
        choices=["on", "off"],
        default="on",
        help="'on' sets write_requested=1; 'off' cancels the request.",
    )
    args = p.parse_args()

    try:
        result = request_cv(args.position_id, args.mode)
    except Exception as e:
        result = {"ok": False, "error": str(e), "status_code": "DB_ERROR"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
