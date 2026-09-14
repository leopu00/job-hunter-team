"""application_rework.py — may the CV PDF of an application be done again? [JHT-CV-REWORK]

Seen live (score > 95 on a box): positions whose application row exists but
was never sent, with a CV PDF the layout check refuses. `jht positions
request-cv` answered ALREADY_APPLIED or BAD_STATUS, the Scrittore's queue
only takes positions without an application, and the queue held them as
cv_pdf_layout_bad for ever.

One rule, used by the CLI and Telegram request (`write_request.py`), by the
Scrittore's queue (`db_query.py next-for-scrittore`) and by the queue's own
request (`apply_gate.application_queue`):

- the application exists and was never sent: `applied` is not 1, no email
  attempt has started (send_started · send_outcome_unknown ·
  receipt_incomplete · sent), and no browser checkpoint has started a submit
  or holds a receipt;
- the position is `scored` or `ready`;
- the CV PDF fails the layout check (`cv_pdf_layout_bad`). A PDF that cannot
  be measured (`cv_pdf_check_unavailable`) allows the user's own request but
  never an automatic one: its remedy is the box, not the Scrittore.

A sent application is never reworked, whatever its CV.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apply_gate  # noqa: E402

REWORK_STATUSES = ("scored", "ready")
EMAIL_STARTED_STATES = tuple(apply_gate.EMAIL_UNRESOLVED_STATES) + ("sent",)


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone() is not None


def _browser_submit_started(position_id: int, jht_home: Path | None) -> bool:
    path = apply_gate.checkpoint_path(position_id, jht_home)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False
    except (OSError, ValueError):
        return True  # unreadable: it may hold a submit, so never rework
    if not isinstance(data, dict):
        return True
    return bool(data.get("submit_started")) or bool(data.get("receipt"))


def unsent_application_blocker(
    conn: sqlite3.Connection, position_id: int, *, jht_home: Path | None = None
) -> str:
    """Why this position's application is not a never-sent one, or `""`."""
    row = conn.execute(
        "SELECT p.status, a.id, a.applied FROM positions p "
        "LEFT JOIN applications a ON a.position_id = p.id WHERE p.id = ?",
        (int(position_id),),
    ).fetchone()
    if row is None:
        return "position_not_found"
    status, application_id, applied = row[0], row[1], row[2]
    if application_id is None:
        return "application_missing"
    if applied in (1, True):
        return "already_sent"
    if status not in REWORK_STATUSES:
        return "status_not_reworkable"
    if _table_exists(conn, apply_gate.EMAIL_ATTEMPTS_TABLE):
        marks = ",".join("?" for _ in EMAIL_STARTED_STATES)
        started = conn.execute(
            f"SELECT 1 FROM {apply_gate.EMAIL_ATTEMPTS_TABLE} "
            f"WHERE position_id = ? AND state IN ({marks}) LIMIT 1",
            (int(position_id), *EMAIL_STARTED_STATES),
        ).fetchone()
        if started:
            return "send_started"
    if _browser_submit_started(int(position_id), jht_home):
        return "submit_started"
    return ""


def rework_verdict(
    conn: sqlite3.Connection,
    position_id: int,
    *,
    manual: bool,
    jht_home: Path | None = None,
) -> dict[str, Any]:
    """{"allowed": bool, "reason": str}: may this CV PDF be done again now?

    `manual` is the user's own request (CLI, Telegram, a dashboard request
    validated on the box); the automatic request passes False.
    """
    blocker = unsent_application_blocker(conn, position_id, jht_home=jht_home)
    if blocker:
        return {"allowed": False, "reason": blocker}
    cv_value = conn.execute(
        "SELECT cv_pdf_path FROM applications WHERE position_id = ?", (int(position_id),)
    ).fetchone()[0]
    cv = apply_gate._resolve_file(cv_value, jht_home)
    if cv is None:
        return {"allowed": False, "reason": "cv_pdf_missing"}
    layout = apply_gate.cv_layout_hold(cv)
    if layout == "cv_pdf_layout_bad":
        return {"allowed": True, "reason": layout}
    if layout == "cv_pdf_check_unavailable":
        return {"allowed": bool(manual), "reason": layout}
    return {"allowed": False, "reason": "cv_layout_ok"}


def request_cv_rework(
    position_id: int,
    *,
    jht_home: Path | None = None,
    db_path: str | None = None,
    manual: bool = False,
) -> dict[str, str]:
    """Turn on the Scrittore's CV request for a CV that needs doing again. Idempotent.

    Opens its own connection and re-reads the verdict inside the same
    `BEGIN IMMEDIATE` as the write, so a send that starts in between wins.
    Writes the flag the way `write_request.py` does (the flag's one writer
    shape). Returns {"status": requested · already_requested · not_needed,
    "reason": ...}; never raises — the queue calling it must keep answering.
    """
    try:
        import _db

        path = db_path or str(_db.DB_PATH)
        conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    except Exception as err:  # noqa: BLE001
        print(f"[application-rework] cannot open jobs.db: {type(err).__name__}", file=sys.stderr)
        return {"status": "not_needed", "reason": "cv_rework_unavailable"}
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            flag = conn.execute(
                "SELECT write_requested, COALESCE(write_request_kind, 'cv') FROM positions WHERE id = ?",
                (int(position_id),),
            ).fetchone()
            verdict = rework_verdict(conn, position_id, manual=manual, jht_home=jht_home)
            if not verdict["allowed"]:
                conn.execute("ROLLBACK")
                return {"status": "not_needed", "reason": verdict["reason"]}
            if flag and flag[0] == 1 and flag[1] == "cv":
                conn.execute("ROLLBACK")
                return {"status": "already_requested", "reason": verdict["reason"]}
            conn.execute(
                "UPDATE positions "
                "   SET write_requested = 1, "
                "       write_requested_at = CASE "
                "         WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') > COALESCE(write_requested_at, '') "
                "         THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
                "         ELSE strftime('%Y-%m-%d %H:%M:%f', write_requested_at, '+0.001 seconds') END, "
                "       write_request_kind = 'cv', "
                "       updated_at = CASE "
                "         WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') > COALESCE(updated_at, '') "
                "         THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') "
                "         ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds') END "
                " WHERE id = ?",
                (int(position_id),),
            )
            conn.execute("COMMIT")
            return {"status": "requested", "reason": verdict["reason"]}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    except Exception as err:  # noqa: BLE001
        print(f"[application-rework] request failed: {type(err).__name__}", file=sys.stderr)
        return {"status": "not_needed", "reason": "cv_rework_unavailable"}
    finally:
        conn.close()
