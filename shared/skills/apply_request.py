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
`request` and `cancel` also refuse to run for an agent (`agent_caller`): no
text an agent reads, a board directive or a chat turn included, becomes an
application.

Usage::

    python3 apply_request.py show 42      # what would be authorised (no write)
    python3 apply_request.py request 42   # authorise
    python3 apply_request.py cancel 42    # withdraw before it is sent

Output: one JSON line on stdout. Exit 0 = done (or `show` answered), 1 =
refused (`reason` says why), 2 = usage or database error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

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


SHOWN_FIELD_MAX = 80


def _shown(value, limit: int = SHOWN_FIELD_MAX) -> str:
    """A field as the person is shown it: no control, hiding or reordering characters, one
    line, at most `limit` characters. The text comes from the agents' database."""
    from external_content import INVISIBLE_COMMANDS, WRITING_INVISIBLES

    text = "".join(
        " " if ch.isspace() else ch for ch in str(value or "")
        if ch.isspace() or ch not in INVISIBLE_COMMANDS
        and (unicodedata.category(ch) not in ("Cc", "Cf", "Cs", "Co", "Zl", "Zp") or ch in WRITING_INVISIBLES)
    )
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def preview(row) -> dict:
    """What the person confirms: «title @ company · host», the destination the broker will bind
    the authorisation to, and `confirm`, the digest of exactly that. A confirmation carries the
    digest back: if the position changed in between, it confirms nothing."""
    import apply_notary

    url = str(row["url"] or "")
    destination = apply_notary.destination_of_url(url)
    host = (urlsplit(url).hostname or "") if destination else ""
    summary = f"{_shown(row['title'])} @ {_shown(row['company'])} · {host}"
    digest = hashlib.sha256(json.dumps([row["id"], url, summary], ensure_ascii=False).encode("utf-8")).hexdigest()
    return {"summary": summary, "destination": destination, "confirm": digest}


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


def write_authorisation(conn, pid: int, requested: bool, origin: str, *, instant: str | None = None) -> str:
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
    if instant is None:
        at = _next_instant(previous[0] if previous else None)
    else:
        parsed = _parse_instant(instant)
        previous_at = _parse_instant(previous[0] if previous else None)
        if parsed is None or (previous_at is not None and parsed <= previous_at):
            raise ValueError("authorisation instant is not newer")
        at = instant
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


def _wake_closer() -> bool:
    """A live CLOSER that already exited on an empty queue is told now.

    The same claimed wake as the Telegram bridge (`application_answers.wake_closer`,
    key per authorisation): the bridge poll would find it already announced.
    Best effort: with no CLOSER alive, the ready queue is what the Capitano's
    spawn rule reads.
    """
    try:
        import os
        from pathlib import Path

        import application_answers
        import yaml

        home = Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")
        try:
            profile = yaml.safe_load((home / "profile" / "candidate_profile.yml").read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — the profile only filters essentials wakes
            profile = {}
        conn = get_db()
        try:
            ensure_schema(conn)
            return bool(application_answers.wake_closer(conn, profile if isinstance(profile, dict) else {}))
        finally:
            conn.close()
    except Exception as err:  # noqa: BLE001 — the flag is written; waking is only a nudge
        print(f"[apply-request] closer wake failed: {type(err).__name__}", file=sys.stderr)
        return False


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
        **(preview(row) if row is not None else {}),
    }
    if out["ok"] and row is not None and out.get("destination") is None:
        out.update(ok=False, reason="destination_invalid",
                   detail="the position's URL names no place an authorisation can be bound to")
    return out, 0 if row is not None else 1


def toggle(pid: int, requested: bool, expect: str | None = None) -> tuple[dict, int]:
    """Write the flag. Authorising needs `expect`, the `confirm` of the preview the person saw:
    the flag is what the pages show, and the broker records the authorisation from the
    person's own channel with the destination of that same preview."""
    action = "request" if requested else "cancel"
    conn = get_db()
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        verdict = toggle_verdict(pid, requested, conn)
        row = _position(conn, pid)
        if verdict.allowed and requested and row is not None:
            shown = preview(row)
            if shown["destination"] is None:
                verdict = type(verdict)(False, "destination_invalid",
                                        "the position's URL names no place an authorisation can be bound to")
            elif expect is None:
                verdict = type(verdict)(False, "confirmation_required",
                                        "authorising needs the confirmation of the preview the person saw")
            elif expect != shown["confirm"]:
                verdict = type(verdict)(False, "position_changed",
                                        "the position is not the one the confirmation was given for")
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
        out["destination"] = preview(after)["destination"]
    else:
        # The broker's register narrows too, from here: withdrawing needs no proof.
        import apply_notary

        instant = after["apply_requested_at"] if previous else _next_instant(after["apply_requested_at"])
        done, status = apply_notary.revoke(pid, instant)
        out["broker"] = status if done else f"unreachable:{status}"
    if requested:
        out["queue"] = _queue_summary()
        out["closer_woken"] = _wake_closer() if out["queue"].get("ready") else False
    return out, 0


def _agent_caller(environ=None, placed=None) -> str | None:
    """The agent this command runs for, or None when it is the person's.

    `user_local` says the person authorised: written from an agent it would be
    an agent's text turned into an application (a board directive, a chat
    turn, a page it read), the one thing that must never happen. The person
    runs this through `jht apply`, from a terminal or the app, and neither
    carries `JHT_AGENT_NAME`; every agent's terminal exports it. The tmux pane
    the process descends from is asked too, because a variable is easy to
    unset: the same check as the user's turn in `jht_mail`.

    A brake on an agent that follows a text, not a boundary: a process that
    detaches (setsid, a double fork) loses the ancestry, and an agent can write
    jobs.db directly. What keeps a text from becoming an application is the
    user's fence, the prompts and the Closer's gate.
    """
    env = os.environ if environ is None else environ
    named = str(env.get("JHT_AGENT_NAME") or "").strip()
    if named:
        return named
    if placed is not None:
        return placed() or None
    try:
        import message_origin

        panes = message_origin.tmux_pane_owners()
        if not panes:
            return None
        return message_origin.session_from_ancestry(os.getpid(), message_origin.parent_of, panes.get)
    except Exception:  # noqa: BLE001 — no tmux to ask: the variable was the check
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Authorise or withdraw one application (user_local).")
    parser.add_argument("action", choices=("show", "request", "cancel"))
    parser.add_argument("position_id", type=int)
    parser.add_argument("--expect", help="the `confirm` of the preview the person confirmed (request)")
    parser.add_argument("--host", action="store_true",
                        help="one tab-separated line of closed fields, for the host's `jht apply`")
    args = parser.parse_args(argv)
    if args.action != "show":
        agent = _agent_caller()
        if agent:
            print(json.dumps({
                "ok": False,
                "action": args.action,
                "reason": "agent_caller",
                "detail": "an application is authorised or withdrawn by the user only, "
                          "never from an agent's terminal",
            }, ensure_ascii=False))
            return 1
    try:
        if args.action == "show":
            out, code = show(args.position_id)
        else:
            out, code = toggle(args.position_id, args.action == "request", args.expect)
    except Exception as err:
        out, code = {"ok": False, "action": args.action, "reason": "db_error", "detail": str(err)}, 2
    print(_host_line(out) if args.host else json.dumps(out, ensure_ascii=False))
    return code


def _host_line(out: dict) -> str:
    """ok, reason, confirm, destination, instant, summary: tab-separated, every field closed
    (a code, a digest, a closed destination, the box's instant) or already shown-safe (the
    summary, one line with no control characters). The host's shell reads it with no parser."""
    def closed(value, allowed: str) -> str:
        text = str(value or "")
        return text if text and all(ch in allowed for ch in text) and len(text) <= 300 else "-"

    code = "abcdefghijklmnopqrstuvwxyz0123456789_"
    fields = [
        "1" if out.get("ok") else "0",
        closed(out.get("reason"), code),
        closed(out.get("confirm"), "0123456789abcdef"),
        closed(out.get("destination"), code + ".-:"),
        closed(out.get("apply_requested_at") if out.get("action") == "request" else "", "0123456789-T:.Z"),
        _shown(out.get("summary"), 200).replace("\t", " ") or "-",
    ]
    return "\t".join(fields)


if __name__ == "__main__":
    sys.exit(main())
