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

The automatic request is bounded [JHT-CV-REWORK-ROUNDS]: one request per CV
file (by content), at most `MAX_AUTO_ROUNDS` per position, so a CV that never
passes cannot loop between the queue and the Scrittore, and a request the
user or the Scrittore turned off is not turned on again for the same PDF.
Past the bound the queue holds the position as `cv_rework_exhausted` and tells
the user once. The ledger is local (`cv_rework_rounds`, never synced), and
the Scrittore claims a rework before doing it, so two Scrittori never take the
same one.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apply_gate  # noqa: E402

REWORK_STATUSES = ("scored", "ready")
EMAIL_STARTED_STATES = tuple(apply_gate.EMAIL_UNRESOLVED_STATES) + ("sent",)
LEDGER_TABLE = "cv_rework_rounds"
MAX_AUTO_ROUNDS = 2
CLAIM_TTL = timedelta(hours=2)


class _Exhausted(Exception):
    """The automatic rounds are over and the notice is due (after the commit)."""


def _clear_notified(conn: sqlite3.Connection, position_id: int) -> None:
    """A notice that did not go out is due again at the next queue read."""
    try:
        conn.execute(
            f"UPDATE {LEDGER_TABLE} SET exhausted_notified_at = NULL WHERE position_id = ?", (int(position_id),)
        )
    except sqlite3.Error:
        pass


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


def sent_blocker(conn: sqlite3.Connection, position_id: int, *, jht_home: Path | None = None) -> str:
    """Why this application's CV must no longer change (it went out, or its send started), or `""`."""
    row = conn.execute(
        "SELECT applied FROM applications WHERE position_id = ?", (int(position_id),)
    ).fetchone()
    if row is not None and row[0] in (1, True):
        return "already_sent"
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
    return sent_blocker(conn, position_id, jht_home=jht_home)


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


def _ensure_ledger(conn: sqlite3.Connection) -> None:
    conn.execute(
        f"CREATE TABLE IF NOT EXISTS {LEDGER_TABLE} ("
        " position_id INTEGER PRIMARY KEY,"
        " rounds INTEGER NOT NULL DEFAULT 0,"
        " last_cv_sha TEXT,"
        " requested_at TEXT,"
        " claimed_by TEXT,"
        " claimed_request_at TEXT,"
        " claimed_at TEXT,"
        " exhausted_notified_at TEXT,"
        " notified_request_at TEXT)"
    )
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({LEDGER_TABLE})")}
    if "notified_request_at" not in columns:
        conn.execute(f"ALTER TABLE {LEDGER_TABLE} ADD COLUMN notified_request_at TEXT")


def _ledger(conn: sqlite3.Connection, position_id: int) -> dict[str, Any]:
    if not _table_exists(conn, LEDGER_TABLE):
        return {}
    cur = conn.execute(f"SELECT * FROM {LEDGER_TABLE} WHERE position_id = ?", (int(position_id),))
    row = cur.fetchone()
    return dict(zip([c[0] for c in cur.description], row)) if row else {}


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def automatic_flag(conn: sqlite3.Connection, position_id: int) -> bool:
    """Was the live CV request turned on by the queue (not by the user)?"""
    requested = conn.execute(
        "SELECT write_requested_at FROM positions WHERE id = ?", (int(position_id),)
    ).fetchone()
    ledger = _ledger(conn, position_id)
    return bool(requested and requested[0] and ledger.get("requested_at") == requested[0])


def claimed_elsewhere(conn: sqlite3.Connection, position_id: int, agent: str, now: datetime | None = None) -> bool:
    """Is this rework claimed by another Scrittore, for the request that is live now?"""
    ledger = _ledger(conn, position_id)
    if not ledger.get("claimed_by") or ledger["claimed_by"] == agent:
        return False
    requested = conn.execute(
        "SELECT write_requested_at FROM positions WHERE id = ?", (int(position_id),)
    ).fetchone()
    if not requested or ledger.get("claimed_request_at") != requested[0]:
        return False
    at = apply_gate._parse_instant(ledger.get("claimed_at"))
    return at is not None and (now or datetime.now(timezone.utc)) - at < CLAIM_TTL


def _agent_name(agent: str | None) -> str:
    return (agent or os.environ.get("JHT_AGENT_NAME") or os.environ.get("JHT_AGENT_ID") or "scrittore").strip()


def claim_cv_rework(position_id: int, *, agent: str | None = None, db_path: str | None = None) -> dict[str, Any]:
    """Take this rework for one Scrittore. {"claimed": bool, "by": name, "reason": ...}.

    Atomic (`BEGIN IMMEDIATE`): of two Scrittori only one gets it. A claim holds
    for the live request and `CLAIM_TTL`; a Scrittore that died frees it then.
    """
    me = _agent_name(agent)
    try:
        import _db

        conn = sqlite3.connect(db_path or str(_db.DB_PATH), timeout=30, isolation_level=None)
    except Exception as err:  # noqa: BLE001
        return {"claimed": False, "by": "", "reason": f"db_unavailable:{type(err).__name__}"}
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            requested = conn.execute(
                "SELECT write_requested, write_requested_at FROM positions WHERE id = ?", (int(position_id),)
            ).fetchone()
            if not requested or requested[0] != 1:
                conn.execute("ROLLBACK")
                return {"claimed": False, "by": "", "reason": "no_request"}
            _ensure_ledger(conn)
            if claimed_elsewhere(conn, position_id, me):
                by = _ledger(conn, position_id)["claimed_by"]
                conn.execute("ROLLBACK")
                return {"claimed": False, "by": by, "reason": "claimed_elsewhere"}
            conn.execute(
                f"INSERT INTO {LEDGER_TABLE} (position_id) VALUES (?) ON CONFLICT(position_id) DO NOTHING",
                (int(position_id),),
            )
            conn.execute(
                f"UPDATE {LEDGER_TABLE} SET claimed_by = ?, claimed_request_at = ?, claimed_at = ? "
                "WHERE position_id = ?",
                (me, requested[1], datetime.now(timezone.utc).isoformat(), int(position_id)),
            )
            conn.execute("COMMIT")
            return {"claimed": True, "by": me, "reason": ""}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


def _notify_exhausted(position_id: int, sha: str) -> None:
    """One alert for the user: the automatic rewrites are over. No profile value, no page text."""
    candidates = [
        os.environ.get("JHT_NOTIFY_USER_BIN"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    command = [
        executable, "--agent", "closer", "--kind", "alert", "--position-id", str(int(position_id)),
        "--source-id", f"closer-cv-rework-exhausted:{int(position_id)}:{sha[:12]}",
        "--source-action", "closer_cv_rework_exhausted",
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    command.append(
        f"CLOSER is holding the application for position #{int(position_id)}: its CV PDF still fails "
        f"the layout check after {MAX_AUTO_ROUNDS} automatic rewrites [cv_rework_exhausted]. "
        "Open the CV preview in the dashboard, and ask for a new CV when you want another try."
    )
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=45)
    if result.returncode != 0:
        raise RuntimeError(f"jht-notify-user failed with exit {result.returncode}")


_EXHAUST = {"status": "not_needed", "reason": "cv_rework_exhausted", "notice": "due"}


def _decide(
    conn: sqlite3.Connection, position_id: int, *, manual: bool, jht_home: Path | None
) -> tuple[dict[str, str] | None, str, str]:
    """(answer or None to write, CV sha, verdict reason). Reads only.

    `_EXHAUST` as the answer: the rounds are over and the user's notice is due.
    """
    flag = conn.execute(
        "SELECT write_requested, COALESCE(write_request_kind, 'cv') FROM positions WHERE id = ?",
        (int(position_id),),
    ).fetchone()
    verdict = rework_verdict(conn, position_id, manual=manual, jht_home=jht_home)
    reason = verdict["reason"]
    if not verdict["allowed"]:
        return {"status": "not_needed", "reason": reason}, "", reason
    if flag and flag[0] == 1 and flag[1] == "cv":
        return {"status": "already_requested", "reason": reason}, "", reason
    if flag and flag[0] == 1 and not manual:
        # The flag has one kind: an automatic request never replaces
        # the cover letter the user is waiting for.  It asks again on
        # a later queue read, once the Scrittore has cleared the flag.
        return {"status": "not_needed", "reason": "write_request_pending"}, "", reason
    if manual:
        return None, "", reason
    cv_value = conn.execute(
        "SELECT cv_pdf_path FROM applications WHERE position_id = ?", (int(position_id),)
    ).fetchone()[0]
    sha = _file_sha(apply_gate._resolve_file(cv_value, jht_home))
    ledger = _ledger(conn, position_id)
    # Over the rounds, or this very PDF was already sent back once and came
    # back unchanged (the Scrittore gave up, or the request was switched off):
    # no new request, and the user hears it once. A request the user made
    # since that notice makes the next failure worth a notice again.
    if int(ledger.get("rounds") or 0) >= MAX_AUTO_ROUNDS or ledger.get("last_cv_sha") == sha:
        requested = conn.execute(
            "SELECT write_requested_at FROM positions WHERE id = ?", (int(position_id),)
        ).fetchone()
        if ledger.get("exhausted_notified_at") and ledger.get("notified_request_at") == (requested[0] if requested else None):
            return {"status": "not_needed", "reason": "cv_rework_exhausted"}, sha, reason
        return _EXHAUST, sha, reason
    return None, sha, reason


def request_cv_rework(
    position_id: int,
    *,
    jht_home: Path | None = None,
    db_path: str | None = None,
    manual: bool = False,
    notifier: Callable[[int, str], None] | None = None,
) -> dict[str, str]:
    """Turn on the Scrittore's CV request for a CV that needs doing again. Idempotent.

    Opens its own connection and re-reads the verdict inside the same
    `BEGIN IMMEDIATE` as the write, so a send that starts in between wins.
    Writes the flag the way `write_request.py` does (the flag's one writer
    shape).
    Returns {"status": requested · already_requested · not_needed,
    "reason": ...}; never raises — the queue calling it must keep answering.
    The automatic request (`manual=False`) asks once per CV file and at most
    `MAX_AUTO_ROUNDS` times; past either, `cv_rework_exhausted` with one notice.
    """
    notify_sha = ""
    try:
        import _db

        path = db_path or str(_db.DB_PATH)
        conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    except Exception as err:  # noqa: BLE001
        print(f"[application-rework] cannot open jobs.db: {type(err).__name__}", file=sys.stderr)
        return {"status": "not_needed", "reason": "cv_rework_unavailable"}
    try:
        if not manual:
            # Every queue read of a held position comes here: decide without
            # the write lock first, and take it only for a write.
            early, _sha, _reason = _decide(conn, position_id, manual=manual, jht_home=jht_home)
            if early is not None and early is not _EXHAUST:
                return early
        conn.execute("BEGIN IMMEDIATE")
        try:
            early, sha, reason = _decide(conn, position_id, manual=manual, jht_home=jht_home)
            if early is _EXHAUST:
                _ensure_ledger(conn)
                conn.execute(
                    f"UPDATE {LEDGER_TABLE} SET exhausted_notified_at = ?, "
                    "notified_request_at = (SELECT write_requested_at FROM positions WHERE id = ?) "
                    "WHERE position_id = ?",
                    (datetime.now(timezone.utc).isoformat(), int(position_id), int(position_id)),
                )
                conn.execute("COMMIT")
                notify_sha = sha
                raise _Exhausted()
            if early is not None:
                conn.execute("ROLLBACK")
                return early
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
            if not manual:
                _ensure_ledger(conn)
                conn.execute(
                    f"INSERT INTO {LEDGER_TABLE} (position_id, rounds, last_cv_sha, requested_at) "
                    "SELECT id, 1, ?, write_requested_at FROM positions WHERE id = ? "
                    "ON CONFLICT(position_id) DO UPDATE SET rounds = rounds + 1, "
                    "last_cv_sha = excluded.last_cv_sha, requested_at = excluded.requested_at, "
                    "claimed_by = NULL, claimed_request_at = NULL, claimed_at = NULL",
                    (sha, int(position_id)),
                )
            conn.execute("COMMIT")
            return {"status": "requested", "reason": reason}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    except _Exhausted:
        try:
            (notifier or _notify_exhausted)(int(position_id), notify_sha)
        except Exception as err:  # noqa: BLE001
            print(f"[application-rework] exhausted notice not sent: {type(err).__name__}", file=sys.stderr)
            _clear_notified(conn, position_id)
        return {"status": "not_needed", "reason": "cv_rework_exhausted"}
    except Exception as err:  # noqa: BLE001
        print(f"[application-rework] request failed: {type(err).__name__}", file=sys.stderr)
        return {"status": "not_needed", "reason": "cv_rework_unavailable"}
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CV rework: the Scrittore claims one before doing it.")
    sub = parser.add_subparsers(dest="command", required=True)
    claim = sub.add_parser("claim", help="take a cv_rework for this Scrittore; exit 0 claimed, 3 taken")
    claim.add_argument("position_id", type=int)
    claim.add_argument("--agent", default=None)
    args = parser.parse_args(argv)
    out = claim_cv_rework(args.position_id, agent=args.agent)
    print(json.dumps(out))
    return 0 if out["claimed"] else 3


if __name__ == "__main__":
    sys.exit(main())
