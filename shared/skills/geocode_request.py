"""User-driven geocoding request (Geocoding-on-demand, V8).

Sets `positions.geocode_requested = 1|0` atomically and emits a JSON
result line on stdout. Used by:
  - tg-bridge handler `/geo <id>` (single source of truth for the
    validate+UPDATE pair)
  - web/api/positions/[id]/geocode-request (TS-side already inline, but
    can fall back to this for parity)
  - Capitano / Analista (manual override / debug)

Differenze rispetto a `write_request.py`:
  - Nessun guard di status: il geocoding ha senso su qualunque posizione,
    indipendentemente da scored / writing / ready / applied / excluded.
    L'Analista skippa autonomamente quando non ha materiale geografico
    utile (skill `office-geocoding` — REGOLA-16).
  - Nessun guard application: la presenza di application non blocca il
    re-geocoding (l'utente puo' voler raffinare le coordinate anche
    dopo aver applicato).

Vedi BACKLOG [Cloud Sync — Geocoding opt-in/out] (2026-05-31) + migration
V8 in `_db.py::_migrate_positions_geocode_requested` + Supabase mig 027.

Output (single JSON line on stdout, exit 0 on success / 1 on failure):
  {"ok": true, "id": 42, "title": "...", "company": "...",
   "loc_city": "Berlin", "loc_country_code": "DE",
   "office_geocoded": false, "previous": 0, "current": 1}
  {"ok": false, "error": "...", "status_code": "NOT_FOUND" | "DB_ERROR"}
"""

import argparse
import json
import sys

from _db import get_db, ensure_schema


def request_geocode(position_id: int, mode: str) -> dict:
    conn = get_db()
    ensure_schema(conn)

    row = conn.execute(
        """
        SELECT id, title, company, status,
               loc_city, loc_country_code,
               geocode_requested, office_geocoded
          FROM positions
         WHERE id = ?
        """,
        (position_id,),
    ).fetchone()

    if not row:
        return {
            "ok": False,
            "error": f"Position #{position_id} not found",
            "status_code": "NOT_FOUND",
        }

    flag = 1 if mode == "on" else 0
    conn.execute(
        # `CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END` mantiene
        # `geocode_requested_at` allineato al flag (NULL su toggle-off → la
        # query `next-for-geocoding` ordina FIFO solo sulle richieste vive).
        "UPDATE positions "
        "   SET geocode_requested = ?, "
        "       geocode_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END "
        " WHERE id = ?",
        (flag, flag, position_id),
    )
    conn.commit()

    return {
        "ok": True,
        "id": row["id"],
        "title": row["title"],
        "company": row["company"],
        "status": row["status"],
        "loc_city": row["loc_city"],
        "loc_country_code": row["loc_country_code"],
        "office_geocoded": bool(row["office_geocoded"]),
        "previous": row["geocode_requested"],
        "current": flag,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="User-driven geocoding request (Geocoding-on-demand, V8)"
    )
    p.add_argument("position_id", type=int)
    p.add_argument(
        "--mode",
        choices=["on", "off"],
        default="on",
        help="'on' sets geocode_requested=1; 'off' cancels the request.",
    )
    args = p.parse_args()

    try:
        result = request_geocode(args.position_id, args.mode)
    except Exception as e:
        result = {"ok": False, "error": str(e), "status_code": "DB_ERROR"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
