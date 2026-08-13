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


def request_cv(position_id: int, mode: str, kind: str = "cv") -> dict:
    conn = get_db()
    ensure_schema(conn)
    if kind not in ("cv", "cover_letter"):
        conn.close()
        return {
            "ok": False,
            "error": "Unknown write request kind",
            "status_code": "BAD_KIND",
        }
    conn.execute("BEGIN IMMEDIATE")

    def fail(result: dict) -> dict:
        conn.rollback()
        conn.close()
        return result

    row = conn.execute(
        """
        SELECT p.id, p.title, p.company, p.status, p.write_requested,
               p.write_requested_at, p.write_request_kind,
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
        return fail({
            "ok": False,
            "error": f"Position #{position_id} not found",
            "status_code": "NOT_FOUND",
        })

    active_kind = (
        (row["write_request_kind"] or "cv")
        if row["write_requested"] else None
    )
    if mode == "on" and active_kind != kind:
        if kind == "cv" and row["status"] != "scored":
            return fail({
                "ok": False,
                "error": (
                    f"Position has status '{row['status']}': a CV request "
                    f"is allowed only from 'scored'"
                ),
                "status_code": "BAD_STATUS",
                "id": row["id"],
                "title": row["title"],
                "company": row["company"],
            })
        if kind == "cv" and row["has_application"] == 1:
            return fail({
                "ok": False,
                "error": (
                    f"An application is already being processed (or was "
                    f"delivered) for #{position_id}"
                ),
                "status_code": "ALREADY_APPLIED",
                "id": row["id"],
                "title": row["title"],
                "company": row["company"],
            })

        if kind == "cover_letter" and row["has_application"] != 1:
            return fail({
                "ok": False,
                "error": "A cover letter requires an existing application",
                "status_code": "APPLICATION_REQUIRED",
                "id": row["id"],
                "title": row["title"],
                "company": row["company"],
            })

    flag = 1 if mode == "on" else 0
    should_write = active_kind != kind if flag else active_kind == kind
    if should_write:
        conn.execute(
            # NULL su toggle-off: la FIFO ordina solo richieste vive.
            "UPDATE positions "
            "   SET write_requested = ?, "
            "       write_requested_at = CASE "
            "         WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
            "              > COALESCE(write_requested_at, '') "
            "         THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
            "         ELSE strftime('%Y-%m-%d %H:%M:%f', write_requested_at, "+
            "                       '+0.001 seconds') END, "
            "       write_request_kind = ?, "
            "       updated_at = CASE "
            "         WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
            "              > COALESCE(updated_at, '') "
            "         THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
            "         ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at, "+
            "                       '+0.001 seconds') END "
            " WHERE id = ?",
            (flag, kind if flag else None, position_id),
        )
    updated = conn.execute(
        "SELECT write_requested, write_request_kind FROM positions WHERE id = ?",
        (position_id,),
    ).fetchone()
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "id": row["id"],
        "title": row["title"],
        "company": row["company"],
        "score": row["total_score"],
        "previous": row["write_requested"],
        "current": updated["write_requested"],
        "kind": updated["write_request_kind"],
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
    p.add_argument(
        "--kind",
        choices=["cv", "cover_letter"],
        default="cv",
        help="Writer request type; both values share the same durable queue.",
    )
    args = p.parse_args()

    try:
        result = request_cv(args.position_id, args.mode, args.kind)
    except Exception as e:
        result = {"ok": False, "error": str(e), "status_code": "DB_ERROR"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
