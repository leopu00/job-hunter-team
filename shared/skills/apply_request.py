#!/usr/bin/env python3
"""apply_request.py — the user authorises (or withdraws) ONE application. [JHT-CLOSER]

The writer behind `jht apply request|cancel` on the box: it sets
`positions.apply_requested` with `apply_requested_by = user_local`. The web
route writes the same columns with `user_web`; both decide with
`apply_gate.toggle_verdict`, which reads `shared/cloud/apply-request-rule.json`.

⚠️ This flag IS the authorisation to send. With consent on, the CLOSER fills
and submits the application without a second click. That is why this module
never picks positions, never flags more than the one id it is given, and
refuses anything that is not `ready` or has already gone out.

Usage::

    python3 apply_request.py show 42      # what would be authorised (no write)
    python3 apply_request.py request 42   # authorise
    python3 apply_request.py cancel 42    # withdraw before it is sent

Output: one JSON line on stdout. Exit 0 = done (or `show` answered), 1 =
refused (`reason` says why), 2 = usage or database error.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from _db import ensure_schema, get_db
from apply_gate import USER_REQUEST_ORIGINS, _parse_instant, application_queue, toggle_verdict

ORIGIN = "user_local"


def _position(conn, pid: int):
    return conn.execute(
        "SELECT id, title, company, url, status, apply_requested, apply_requested_at, "
        "apply_requested_by FROM positions WHERE id = ?",
        (pid,),
    ).fetchone()


def _describe(row) -> dict:
    if row is None:
        return {}
    return {
        "id": row["id"],
        "title": row["title"],
        "company": row["company"],
        "url": row["url"],
        "status": row["status"],
        "apply_requested": bool(row["apply_requested"]),
        "apply_requested_at": row["apply_requested_at"],
        "apply_requested_by": row["apply_requested_by"],
    }


def _next_instant(previous) -> str:
    """Now in UTC, and strictly after the previous authorisation.

    Strictly after, not just "now": the CLOSER's queue puts a position that
    stopped on `blocked_human` back only when the user's authorisation is
    NEWER than the stopped checkpoint, and the cloud pull only sees rows that
    moved. Two clicks in the same millisecond must still be two instants.
    """
    now = datetime.now(timezone.utc)
    prev = _parse_instant(previous)
    if prev is not None and now <= prev:
        now = prev + timedelta(milliseconds=1)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def write_authorisation(conn, pid: int, requested: bool, origin: str) -> str:
    """Write the flag, its instant and its author. The caller holds the transaction
    and has already asked `toggle_verdict`.

    Shared by `jht apply` (`user_local`) and a Telegram answer
    (`user_telegram`): one writer shape, so the queue, the push cursor and the
    gate see the same row whichever channel the user spoke on.
    """
    if requested and origin not in USER_REQUEST_ORIGINS:
        raise ValueError(f"{origin!r} is not a user channel")
    previous = conn.execute(
        "SELECT apply_requested_at FROM positions WHERE id = ?", (pid,)
    ).fetchone()
    at = _next_instant(previous[0] if previous else None)
    conn.execute(
        "UPDATE positions "
        "   SET apply_requested = ?, "
        "       apply_requested_at = ?, "
        "       apply_requested_by = ?, "
        # `updated_at` moves too: it is the cursor the box push reads,
        # and a flag that does not move it never reaches the cloud.
        "       updated_at = CASE "
        "         WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
        "              > COALESCE(updated_at, '') "
        "         THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
        "         ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds') END "
        " WHERE id = ?",
        (1 if requested else 0, at, origin if requested else None, pid),
    )
    return at


def _queue_summary() -> dict:
    """Will the CLOSER actually pick it up? Said now, not discovered later."""
    try:
        q = application_queue()
    except Exception as err:  # the flag is written; the summary is only advice
        return {"ready": False, "reason": "queue_unreadable", "detail": str(err)}
    return {
        "ready": q["ready"],
        "reason": q["reason"],
        "detail": q["detail"],
        "held": q["held"],
    }


def show(pid: int) -> tuple[dict, int]:
    conn = get_db()
    try:
        ensure_schema(conn)
        row = _position(conn, pid)
        verdict = toggle_verdict(pid, True, conn)
    finally:
        conn.close()
    out = {
        "ok": verdict.allowed,
        "action": "show",
        "reason": verdict.reason,
        "detail": verdict.detail,
        **_describe(row),
    }
    return out, 0 if row is not None else 1


def toggle(pid: int, requested: bool) -> tuple[dict, int]:
    action = "request" if requested else "cancel"
    conn = get_db()
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        verdict = toggle_verdict(pid, requested, conn)
        row = _position(conn, pid)
        if not verdict.allowed:
            conn.rollback()
            return {
                "ok": False,
                "action": action,
                "reason": verdict.reason,
                "detail": verdict.detail,
                **_describe(row),
            }, 1

        previous = bool(row["apply_requested"])
        # Withdrawing what is not authorised writes nothing: a no-op that moved
        # `updated_at` would push a row that did not change.
        if requested or previous:
            write_authorisation(conn, pid, requested, ORIGIN)
        after = _position(conn, pid)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # Asking is not getting: the row is read back and must say what we wrote.
    if bool(after["apply_requested"]) is not requested or (
        requested and after["apply_requested_by"] != ORIGIN
    ):
        return {
            "ok": False,
            "action": action,
            "reason": "write_not_observed",
            "detail": "the update ran but the row does not carry the new flag",
            **_describe(after),
        }, 2

    out = {
        "ok": True,
        "action": action,
        "reason": "authorised" if requested else ("withdrawn" if previous else "not_authorised"),
        "previous": previous,
        **_describe(after),
    }
    if requested:
        out["queue"] = _queue_summary()
    return out, 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Authorise or withdraw one application (user_local).")
    parser.add_argument("action", choices=("show", "request", "cancel"))
    parser.add_argument("position_id", type=int)
    args = parser.parse_args(argv)
    try:
        if args.action == "show":
            out, code = show(args.position_id)
        else:
            out, code = toggle(args.position_id, args.action == "request")
    except Exception as err:
        out, code = {"ok": False, "action": args.action, "reason": "db_error", "detail": str(err)}, 2
    print(json.dumps(out, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
