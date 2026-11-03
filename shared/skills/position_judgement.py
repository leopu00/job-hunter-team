#!/usr/bin/env python3
"""The user's judgement on a position, from the desktop app, for a team on a VPS.

The app reaches this one file through its pinned SSH connection (host key and
container fixed): never a free command, never a generic Python runner. The
arguments are closed (argparse choices, a numeric id); the only free text, the
user's note, travels on stdin as ONE JSON line ({"note": "..."}), never in an
argument, so it is in no process list and in no SSH command line.

This file holds no rule of its own: each operation calls today's writer, with
its refusals.

  feedback ID --value like|dislike|hide|star|clear [--score 1-5]
           [--direction more_like_this|less_like_this] [--reason CODE] [--note-on-stdin]
                                                   feedback_record.record
  exclude ID --reason CODE [--note-on-stdin]       user_exclude.exclude
  restore ID                                       user_exclude.restore
  note ID                                          the private note box (stdin)
  write-request ID --on|--off [--kind cv|cover_letter]
                                                   write_request.request_cv
  apply-preview ID                                 what the person confirms (no write)
  apply-request ID --on --expect DIGEST|--off      apply_gate consent, then
                                                   apply_request.toggle
  recheck ID --on|--off                            positions.recheck_requested
  geocode ID --on|--off                            geocode_request.request_geocode
  ticket ID --kind rescore|custom --text-on-stdin  ticket.open_ticket (a rescore is asked once)
  mark-applied ID --on|--off [--note-on-stdin]     «I applied by hand» and taking it back
  outcome ID --value interview|rejected [--reason CODE] [--note-on-stdin]
                                                   the answer of the company, and
  outcome-undo ID                                  taking it back

The reasons are the closed vocabulary of feedback_reasons (shared with the web
and the other writers). The note stays the user's: it is written only where the
user reads it (position_feedback.note, positions.user_excluded_note,
position_user_notes) and no agent reads those columns.

Output: one JSON line, {"ok": true, "op": ..., "id": ...} or
{"ok": false, "op": ..., "id": ..., "code": <closed code>}. Exit 0 done,
1 refused, 2 usage.
"""

import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import ensure_schema, get_db  # noqa: E402
from feedback_reasons import NOTE_MAX, REASONS, clean_note  # noqa: E402

# One line of stdin, at most this many bytes: a note is 200 characters, so
# 4 KiB is room for any of them in UTF-8 and nothing more is ever read.
STDIN_MAX_BYTES = 4096
# A ticket's text is up to 2000 characters (the web route's limit): four bytes each in UTF-8, escaped.
TEXT_STDIN_MAX_BYTES = 16 * 1024
REQUEST_TEXT_MAX = 2000
APPLIED_NOTE_MAX = 500
REJECTION_NOTE_MAX = 500
REJECTION_REASONS = ("location", "salary", "experience", "language")
OUTCOMES = ("interview", "rejected")
RESCORE_KIND = "rescore"
FIRST_INTERVIEW_ROUND = 1
APPLIED_VIA_USER = "user_manual"
BOX_NOTE_MAX = 4000  # the web route's limit for the private note box
FEEDBACK_VALUES = ("like", "dislike", "hide", "star", "clear")
FEEDBACK_DIRECTIONS = ("more_like_this", "less_like_this")
WRITE_KINDS = ("cv", "cover_letter")


class Refused(Exception):
    def __init__(self, code, detail=None):
        super().__init__(code)
        self.code = code
        self.detail = detail


def read_line(key, max_bytes):
    """The text from the one JSON line on stdin ({key: text}): at most `max_bytes` read, never cut silently."""
    raw = sys.stdin.buffer.readline(max_bytes + 1)
    if len(raw) > max_bytes:
        raise Refused("note_too_long")
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        raise Refused("note_invalid")
    if not isinstance(payload, dict) or set(payload) - {key}:
        raise Refused("note_invalid")
    value = payload.get(key)
    if value is not None and not isinstance(value, str):
        raise Refused("note_invalid")
    return value


def read_note(keep_lines=False):
    """The note from the one JSON line on stdin: cleaned, never cut silently."""
    return clean_note(read_line("note", STDIN_MAX_BYTES), keep_lines)


def position_exists(pid):
    conn = get_db()
    try:
        ensure_schema(conn)
        # Explicit columns: this file never selects a note.
        return conn.execute("SELECT id FROM positions WHERE id = ?", (pid,)).fetchone() is not None
    finally:
        conn.close()


def do_feedback(args):
    if args.reason is not None and args.reason not in REASONS:
        raise Refused("reason_invalid")
    note = read_note() if args.note_on_stdin else None
    if note is not None and len(note) > NOTE_MAX:
        raise Refused("note_too_long")
    if not position_exists(args.id):
        raise Refused("position_not_found")
    from feedback_record import record
    out = record(str(args.id), args.value, reason=args.reason, note=note or None,
                 score=args.score, direction=args.direction)
    if not out.get("ok"):
        raise Refused("feedback_refused", out.get("error"))
    return {"value": args.value, "reason": args.reason, "score": args.score, "direction": args.direction,
            "cloud_synced": out.get("cloud_synced")}


def do_exclude(args):
    if args.reason not in REASONS:
        raise Refused("reason_invalid")
    note = read_note() if args.note_on_stdin else None
    if note is not None and len(note) > NOTE_MAX:
        raise Refused("note_too_long")
    from user_exclude import exclude
    out = exclude(args.id, args.reason, note or None)
    if not out.get("ok"):
        raise Refused("position_not_found" if "not found" in str(out.get("error")) else "exclude_refused",
                      out.get("error"))
    return {"status": out["status"], "previous_status": out["previous_status"], "reason": args.reason}


def do_restore(args):
    from user_exclude import restore
    out = restore(args.id)
    if not out.get("ok"):
        raise Refused("position_not_found", out.get("error"))
    return {"status": out["status"], "previous_status": out["previous_status"]}


def do_note(args):
    # the private note box keeps its lines, as the web route's does (the one-line notes of a verdict do not)
    note = read_note(keep_lines=True)
    if len(note) > BOX_NOTE_MAX:
        raise Refused("note_too_long")
    conn = get_db()
    try:
        ensure_schema(conn)
        if conn.execute("SELECT id FROM positions WHERE id = ?", (args.id,)).fetchone() is None:
            raise Refused("position_not_found")
        # The same row the box's web route writes: origin 'box', one per position.
        if note:
            conn.execute(
                "INSERT INTO position_user_notes (position_id, origin, body) VALUES (?, 'box', ?) "
                "ON CONFLICT(position_id, origin) DO UPDATE SET body = excluded.body, "
                "updated_at = CURRENT_TIMESTAMP",
                (args.id, note))
        else:
            conn.execute("DELETE FROM position_user_notes WHERE position_id = ? AND origin = 'box'", (args.id,))
        conn.commit()
    finally:
        conn.close()
    return {"saved": bool(note)}


def do_write_request(args):
    from write_request import request_cv
    out = request_cv(args.id, "on" if args.on else "off", args.kind)
    if not out.get("ok"):
        code = {"NOT_FOUND": "position_not_found", "BAD_STATUS": "bad_status",
                "ALREADY_APPLIED": "already_applied",
                "APPLICATION_REQUIRED": "cover_letter_requires_application"}.get(
                    out.get("status_code"), "write_request_refused")
        raise Refused(code, out.get("error"))
    return {"write_requested": bool(out.get("current")), "write_request_kind": out.get("kind")}


def do_apply_request(args):
    # The app reaches this script for the person; an agent never does. Written from an
    # agent's terminal, `user_local` would turn an agent's text into an application:
    # the same refusal as apply_request.py's own command, before consent or the gate.
    # A brake, not a boundary (see apply_request._agent_caller).
    from apply_request import _agent_caller
    if _agent_caller():
        raise Refused("agent_caller", "an application is authorised or withdrawn by the user only")
    if args.on:
        # Authorising an application needs the user's consent first: without it
        # nothing is written, with the gate's own reason.
        from apply_gate import consent_verdict
        consent = consent_verdict()
        if not consent.allowed:
            raise Refused(consent.reason, consent.detail)
    from apply_request import toggle
    out, status = toggle(args.id, bool(args.on), args.expect)
    if status != 0:
        raise Refused(out.get("reason") or "apply_request_refused", out.get("detail"))
    result = {"apply_requested": bool(args.on), "result": out.get("reason")}
    if args.on:
        # What the app records in the broker, from the host: the instant of this write and the
        # destination of the preview the person confirmed.
        result.update(instant=out.get("apply_requested_at"), destination=out.get("destination"))
    else:
        result["broker"] = out.get("broker")
    return result


def do_apply_preview(args):
    """What the person confirms before authorising: «title @ company · host», and the digest a
    confirmation must carry back. Nothing is written."""
    from apply_request import _agent_caller, show
    if _agent_caller():
        raise Refused("agent_caller", "an application is authorised or withdrawn by the user only")
    from apply_gate import consent_verdict
    consent = consent_verdict()
    if not consent.allowed:
        raise Refused(consent.reason, consent.detail)
    out, _status = show(args.id)
    if not out.get("ok"):
        raise Refused(out.get("reason") or "apply_request_refused", out.get("detail"))
    return {"summary": out["summary"], "confirm": out["confirm"], "destination": out["destination"]}


def do_recheck(args):
    conn = get_db()
    try:
        ensure_schema(conn)
        if conn.execute("SELECT id FROM positions WHERE id = ?", (args.id,)).fetchone() is None:
            raise Refused("position_not_found")
        # As the web route: the analyst serves the queue and closes it with last_open_check.
        conn.execute("UPDATE positions SET recheck_requested = ?, recheck_requested_at = CURRENT_TIMESTAMP "
                     "WHERE id = ?", (1 if args.on else 0, args.id))
        conn.commit()
    finally:
        conn.close()
    return {"recheck_requested": bool(args.on)}


def now_iso():
    """The instant as the web writes it (`toISOString`): never the word 'now', which a trigger refuses."""
    moment = datetime.datetime.now(datetime.timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (moment.microsecond // 1000)


def columns_of(conn, table):
    return {row[1] for row in conn.execute("PRAGMA table_info(" + table + ")")}


def do_ticket(args):
    text = clean_note(read_line("text", TEXT_STDIN_MAX_BYTES), keep_lines=True)
    if not text:
        raise Refused("request_empty")
    if len(text) > REQUEST_TEXT_MAX:
        raise Refused("request_too_long")
    kind = RESCORE_KIND if args.kind == RESCORE_KIND else "custom"
    conn = get_db()
    try:
        ensure_schema(conn)
        # The parent and the ticket are one write, and a rescore that is already waiting is the one asked for.
        conn.execute("BEGIN IMMEDIATE")
        try:
            if conn.execute("SELECT id FROM positions WHERE id = ?", (args.id,)).fetchone() is None:
                raise Refused("position_not_found")
            if kind == RESCORE_KIND:
                active = conn.execute(
                    "SELECT id, status FROM position_tickets WHERE position_id = ? AND kind = ? "
                    "AND status IN ('open','assigned') ORDER BY created_at ASC, id ASC LIMIT 1",
                    (args.id, kind)).fetchone()
                if active:
                    conn.execute("COMMIT")
                    return {"ticket_id": active[0], "ticket_status": active[1], "deduplicated": True}
            cur = conn.execute(
                "INSERT INTO position_tickets (position_id, request_text, kind, status) VALUES (?, ?, ?, 'open')",
                (args.id, text, kind))
            conn.execute("COMMIT")
            return {"ticket_id": int(cur.lastrowid), "ticket_status": "open", "deduplicated": False}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


def derived_previous_state(has_cv, has_score):
    return "ready" if has_cv else "scored" if has_score else "new"


def do_mark_applied(args):
    note = None
    if args.note_on_stdin:
        note = (clean_note(read_line("note", STDIN_MAX_BYTES)) or None)
        if note is not None and len(note) > APPLIED_NOTE_MAX:
            raise Refused("note_too_long")
    conn = get_db()
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute("SELECT id, status FROM positions WHERE id = ?", (args.id,)).fetchone()
            if row is None:
                raise Refused("position_not_found")
            if args.on:
                applied_at = now_iso()
                # one transaction: the position and the application must not tell two stories
                conn.execute(
                    "INSERT INTO applications (position_id, status, applied, applied_at, applied_via, critic_notes) "
                    "VALUES (?, 'applied', 1, ?, ?, ?) ON CONFLICT(position_id) DO UPDATE SET "
                    "status = 'applied', applied = 1, applied_at = excluded.applied_at, "
                    "applied_via = excluded.applied_via, updated_at = CURRENT_TIMESTAMP",
                    (args.id, applied_at, APPLIED_VIA_USER, note))
                conn.execute("UPDATE positions SET status = 'applied', last_actor = 'user' WHERE id = ?", (args.id,))
                if row[1] != "applied":
                    conn.execute(
                        "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) "
                        "VALUES (?, ?, 'applied', 'user', ?)", (args.id, row[1], note))
                conn.execute("COMMIT")
                return {"status": "applied", "applied_at": applied_at, "applied_via": APPLIED_VIA_USER}
            # taking it back: only what the person marked, and only while it is still «applied»
            if row[1] != "applied":
                raise Refused("not_applied")
            app = conn.execute("SELECT applied_via, cv_path, cv_pdf_path FROM applications WHERE position_id = ?",
                               (args.id,)).fetchone()
            if app and app[0] and app[0] != APPLIED_VIA_USER:
                raise Refused("applied_by_team")
            # The state it was in when the person marked it. Taking back an answer (outcome-undo) also writes a
            # transition to «applied» by the user, from «response»: that one is not where this mark came from.
            previous = conn.execute(
                "SELECT from_state FROM position_state_transitions WHERE position_id = ? AND to_state = 'applied' "
                "AND by_agent = 'user' AND COALESCE(from_state, '') <> 'response' ORDER BY id DESC LIMIT 1",
                (args.id,)).fetchone()
            scored = conn.execute("SELECT COUNT(*) FROM scores WHERE position_id = ?", (args.id,)).fetchone()[0]
            restored = (previous[0] if previous and previous[0] else
                        derived_previous_state(bool(app and (app[1] or app[2])), scored > 0))
            conn.execute(
                "UPDATE applications SET applied = 0, applied_at = NULL, applied_via = NULL, "
                "status = CASE WHEN status = 'applied' THEN 'draft' ELSE status END, "
                "updated_at = CURRENT_TIMESTAMP WHERE position_id = ?", (args.id,))
            conn.execute("UPDATE positions SET status = ?, last_actor = 'user' WHERE id = ?", (restored, args.id))
            conn.execute(
                "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) "
                "VALUES (?, 'applied', ?, 'user', ?)", (args.id, restored, "annullata dall'utente"))
            conn.execute("COMMIT")
            return {"status": restored}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


def do_outcome(args):
    if args.reason is not None and args.reason not in REJECTION_REASONS:
        raise Refused("invalid_reason")
    note = None
    if args.note_on_stdin:
        note = (clean_note(read_line("note", STDIN_MAX_BYTES)) or None)
        if note is not None and len(note) > REJECTION_NOTE_MAX:
            raise Refused("invalid_note")
    # the reason belongs to the rejection: an interview has no question it would answer
    if args.value != "rejected" and (args.reason or note):
        raise Refused("reason_only_on_rejection")
    conn = get_db()
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        try:
            position = conn.execute("SELECT id, status FROM positions WHERE id = ?", (args.id,)).fetchone()
            if position is None:
                raise Refused("position_not_found")
            application = conn.execute("SELECT applied, interview_round FROM applications WHERE position_id = ?",
                                       (args.id,)).fetchone()
            # an answer follows a sent application: without one it is an error
            if not application or not application[0]:
                raise Refused("not_applied")
            response_at = now_iso()
            round_ = (application[1] if application[1] is not None else FIRST_INTERVIEW_ROUND) \
                if args.value == "interview" else application[1]
            if {"rejection_reason", "rejection_note"} <= columns_of(conn, "applications"):
                conn.execute(
                    "UPDATE applications SET status = 'response', response = ?, response_at = ?, interview_round = ?, "
                    "rejection_reason = ?, rejection_note = ?, updated_at = CURRENT_TIMESTAMP WHERE position_id = ?",
                    (args.value, response_at, round_, args.reason, note, args.id))
            else:
                conn.execute(
                    "UPDATE applications SET status = 'response', response = ?, response_at = ?, interview_round = ?, "
                    "updated_at = CURRENT_TIMESTAMP WHERE position_id = ?", (args.value, response_at, round_, args.id))
            conn.execute("UPDATE positions SET status = 'response', last_actor = 'user' WHERE id = ?", (args.id,))
            if position[1] != "response":
                conn.execute(
                    "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) "
                    "VALUES (?, ?, 'response', 'user', ?)", (args.id, position[1], args.value))
            conn.execute("COMMIT")
            return {"status": "response", "response": args.value, "response_at": response_at,
                    "interview_round": round_}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


def do_outcome_undo(args):
    conn = get_db()
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        try:
            position = conn.execute("SELECT id, status FROM positions WHERE id = ?", (args.id,)).fetchone()
            if position is None:
                raise Refused("position_not_found")
            application = conn.execute("SELECT response, interview_round FROM applications WHERE position_id = ?",
                                       (args.id,)).fetchone()
            if not application or not application[0]:
                raise Refused("no_outcome")
            # a round beyond the first was written by the team: it is not this button's to delete
            kept = None if application[1] == FIRST_INTERVIEW_ROUND else application[1]
            reason = ", rejection_reason = NULL, rejection_note = NULL" \
                if "rejection_reason" in columns_of(conn, "applications") else ""
            conn.execute(
                "UPDATE applications SET status = 'applied', response = NULL, response_at = NULL, "
                "interview_round = ?" + reason + ", updated_at = CURRENT_TIMESTAMP WHERE position_id = ?",
                (kept, args.id))
            conn.execute("UPDATE positions SET status = 'applied', last_actor = 'user' WHERE id = ?", (args.id,))
            if position[1] != "applied":
                conn.execute(
                    "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) "
                    "VALUES (?, ?, 'applied', 'user', ?)", (args.id, position[1], "esito annullato dall'utente"))
            conn.execute("COMMIT")
            return {"status": "applied", "interview_round": kept}
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


def do_geocode(args):
    from geocode_request import request_geocode
    out = request_geocode(args.id, "on" if args.on else "off")
    if not out.get("ok"):
        raise Refused("position_not_found" if out.get("status_code") == "NOT_FOUND" else "geocode_refused",
                      out.get("error"))
    return {"geocode_requested": bool(out.get("current"))}


OPS = {
    "feedback": do_feedback, "exclude": do_exclude, "restore": do_restore, "note": do_note,
    "write-request": do_write_request, "apply-request": do_apply_request, "recheck": do_recheck,
    "apply-preview": do_apply_preview, "geocode": do_geocode, "ticket": do_ticket,
    "mark-applied": do_mark_applied, "outcome": do_outcome, "outcome-undo": do_outcome_undo,
}


def position_id(value):
    if not value.isdigit() or len(value) > 15 or int(value) <= 0:
        raise argparse.ArgumentTypeError("a positive numeric id")
    return int(value)


def parser():
    p = argparse.ArgumentParser(description="The user's judgement on a position (closed arguments).")
    sub = p.add_subparsers(dest="op", required=True)
    fb = sub.add_parser("feedback")
    fb.add_argument("id", type=position_id)
    fb.add_argument("--value", required=True, choices=FEEDBACK_VALUES)
    fb.add_argument("--score", type=int, choices=range(1, 6))
    fb.add_argument("--direction", choices=FEEDBACK_DIRECTIONS)
    fb.add_argument("--reason")
    fb.add_argument("--note-on-stdin", action="store_true")
    ex = sub.add_parser("exclude")
    ex.add_argument("id", type=position_id)
    ex.add_argument("--reason", required=True)
    ex.add_argument("--note-on-stdin", action="store_true")
    for name in ("restore", "note"):
        sub.add_parser(name).add_argument("id", type=position_id)
    for name in ("write-request", "apply-request", "recheck", "geocode"):
        one = sub.add_parser(name)
        one.add_argument("id", type=position_id)
        switch = one.add_mutually_exclusive_group(required=True)
        switch.add_argument("--on", action="store_true")
        switch.add_argument("--off", action="store_true")
        if name == "write-request":
            one.add_argument("--kind", choices=WRITE_KINDS, default="cv")
        if name == "apply-request":
            one.add_argument("--expect", type=confirm_digest)
    sub.add_parser("apply-preview").add_argument("id", type=position_id)
    tk = sub.add_parser("ticket")
    tk.add_argument("id", type=position_id)
    tk.add_argument("--kind", required=True, choices=(RESCORE_KIND, "custom"))
    tk.add_argument("--text-on-stdin", action="store_true", required=True)
    ma = sub.add_parser("mark-applied")
    ma.add_argument("id", type=position_id)
    ma_switch = ma.add_mutually_exclusive_group(required=True)
    ma_switch.add_argument("--on", action="store_true")
    ma_switch.add_argument("--off", action="store_true")
    ma.add_argument("--note-on-stdin", action="store_true")
    oc = sub.add_parser("outcome")
    oc.add_argument("id", type=position_id)
    oc.add_argument("--value", required=True, choices=OUTCOMES)
    oc.add_argument("--reason")
    oc.add_argument("--note-on-stdin", action="store_true")
    sub.add_parser("outcome-undo").add_argument("id", type=position_id)
    return p


def confirm_digest(value):
    if len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        raise argparse.ArgumentTypeError("a sha-256 hex digest")
    return value


def main(argv=None):
    try:
        args = parser().parse_args(argv)
    except SystemExit:
        print(json.dumps({"ok": False, "code": "request_invalid"}))
        return 2
    try:
        result = OPS[args.op](args)
    except Refused as refused:
        out = {"ok": False, "op": args.op, "id": args.id, "code": refused.code}
        if refused.detail:
            out["detail"] = str(refused.detail)[:200]
        print(json.dumps(out, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "op": args.op, "id": args.id, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
