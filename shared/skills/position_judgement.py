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
  apply-request ID --on|--off                      apply_gate consent, then
                                                   apply_request.toggle
  recheck ID --on|--off                            positions.recheck_requested

The reasons are the closed vocabulary of feedback_reasons (shared with the web
and the other writers). The note stays the user's: it is written only where the
user reads it (position_feedback.note, positions.user_excluded_note,
position_user_notes) and no agent reads those columns.

Output: one JSON line, {"ok": true, "op": ..., "id": ...} or
{"ok": false, "op": ..., "id": ..., "code": <closed code>}. Exit 0 done,
1 refused, 2 usage.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import ensure_schema, get_db  # noqa: E402
from feedback_reasons import NOTE_MAX, REASONS, clean_note  # noqa: E402

# One line of stdin, at most this many bytes: a note is 200 characters, so
# 4 KiB is room for any of them in UTF-8 and nothing more is ever read.
STDIN_MAX_BYTES = 4096
BOX_NOTE_MAX = 4000  # the web route's limit for the private note box
FEEDBACK_VALUES = ("like", "dislike", "hide", "star", "clear")
FEEDBACK_DIRECTIONS = ("more_like_this", "less_like_this")
WRITE_KINDS = ("cv", "cover_letter")


class Refused(Exception):
    def __init__(self, code, detail=None):
        super().__init__(code)
        self.code = code
        self.detail = detail


def read_note():
    """The note from the one JSON line on stdin: cleaned, never cut silently."""
    raw = sys.stdin.buffer.readline(STDIN_MAX_BYTES + 1)
    if len(raw) > STDIN_MAX_BYTES:
        raise Refused("note_too_long")
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        raise Refused("note_invalid")
    if not isinstance(payload, dict) or set(payload) - {"note"}:
        raise Refused("note_invalid")
    note = payload.get("note")
    if note is not None and not isinstance(note, str):
        raise Refused("note_invalid")
    return clean_note(note)


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
    note = read_note()
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
    if args.on:
        # Authorising an application needs the user's consent first: without it
        # nothing is written, with the gate's own reason.
        from apply_gate import consent_verdict
        consent = consent_verdict()
        if not consent.allowed:
            raise Refused(consent.reason, consent.detail)
    from apply_request import toggle
    out, status = toggle(args.id, bool(args.on))
    if status != 0:
        raise Refused(out.get("reason") or "apply_request_refused", out.get("detail"))
    return {"apply_requested": bool(args.on), "result": out.get("reason")}


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


OPS = {
    "feedback": do_feedback, "exclude": do_exclude, "restore": do_restore, "note": do_note,
    "write-request": do_write_request, "apply-request": do_apply_request, "recheck": do_recheck,
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
    for name in ("write-request", "apply-request", "recheck"):
        one = sub.add_parser(name)
        one.add_argument("id", type=position_id)
        switch = one.add_mutually_exclusive_group(required=True)
        switch.add_argument("--on", action="store_true")
        switch.add_argument("--off", action="store_true")
        if name == "write-request":
            one.add_argument("--kind", choices=WRITE_KINDS, default="cv")
    return p


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
