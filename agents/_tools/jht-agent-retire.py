#!/usr/bin/env python3
"""Retire a worker on purpose: declare it `retired` in the roster, THEN close its session.

The order is the point. The watchdog respawns a worker the roster still lists as
`active` once its tmux session is gone, so stopping the session first (or only)
gets the worker revived within a tick. Here the roster is written first and
read back; only a confirmed `retired` entry lets the session be closed. A
crash is untouched: a session that dies WITHOUT going through this command
stays `active` in the roster and the watchdog still revives it.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone

REASON_MAX = 200
USER = "user"  # `contained_by` of the hold the user sets from the app (agent_control.py)


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def load_roster():
    candidates = (
        Path("/app/shared/skills/team_roster.py"),
        Path(__file__).resolve().parents[2] / "shared" / "skills" / "team_roster.py",
    )
    for candidate in candidates:
        if not candidate.exists():
            continue
        spec = importlib.util.spec_from_file_location("jht_retire_roster", candidate)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    raise RuntimeError("team_roster.py not found")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def exact_tmux(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["tmux", *args], capture_output=True, text=True, timeout=15)


def session_alive(session: str) -> bool:
    return exact_tmux("has-session", "-t", f"={session}").returncode == 0


def journal(event: dict) -> None:
    path = home() / "logs" / "agent-retirements.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def clean_reason(raw: str) -> str:
    """One line of plain text: NFC, no control or format (bidi) characters, single spaces.

    The reason is the agent's free text and lands in the roster and the journal.
    Too long is refused, never silently cut."""
    text = unicodedata.normalize("NFC", raw or "")
    kept = []
    for ch in text:
        category = unicodedata.category(ch)
        if ch in "\r\n\t\u2028\u2029" or category == "Zs":
            kept.append(" ")
        elif category in ("Cc", "Cf", "Cs", "Co", "Cn"):
            continue
        else:
            kept.append(ch)
    reason = " ".join("".join(kept).split())
    if not reason:
        raise ValueError("--reason is empty (after removing control characters)")
    if len(reason) > REASON_MAX:
        raise ValueError(f"--reason is {len(reason)} characters; the limit is {REASON_MAX}")
    return reason


def held_by(roster, session: str, entry: dict | None) -> str | None:
    """None, or who holds the session contained (the marker counts as much as the entry)."""
    if not (entry and entry.get("status") == "contained") and not roster.is_contained(session):
        return None
    by = (entry or {}).get("contained_by")
    if not by:
        try:
            by = json.loads(roster.containment_marker(session).read_text(encoding="utf-8")).get("by")
        except (OSError, ValueError, AttributeError):
            by = None
    return str(by or "unknown")


def retirable_session(roster, raw: str) -> str:
    """Only a numbered worker the watchdog could respawn is retired this way."""
    session = raw.strip().upper()
    match = roster._SESSION_RE.fullmatch(session)
    role = match.group(1).lower() if match else ""
    if not match or match.group(2) is None or role not in roster.WORKER_ROLES:
        raise ValueError(
            f"{session or raw!r} is not a numbered worker session "
            f"({', '.join(r.upper() + '-N' for r in roster.WORKER_ROLES)}); "
            "the core roles are kept up by the watchdog and are not retired")
    return session


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Mark a worker retired in the roster, then close its session.")
    parser.add_argument("session")
    parser.add_argument("--reason", required=True)
    args = parser.parse_args()

    try:
        roster = load_roster()
        session = retirable_session(roster, args.session)
        reason = clean_reason(args.reason)
        entry = roster.load().get("agents", {}).get(session)
        holder = held_by(roster, session, entry)
        if holder is not None:
            if holder.strip().lower() == USER:
                raise RuntimeError(
                    f"{session} was stopped by the user from the app: "
                    "it is neither retired nor released from here")
            raise RuntimeError(
                f"{session} is held by a containment: it is not retired from here; "
                "ask whoever set the hold")
        if entry is None:
            # Never recorded: the watchdog has nothing to respawn, so closing is safe.
            declared = False
        else:
            if not roster.retire(session, reason):
                raise RuntimeError(f"could not mark {session} retired")
            # `save` fails open (an unwritable roster must not block a spawn), so
            # `retire` can report success without a write: read it back.
            after = roster.load().get("agents", {}).get(session) or {}
            if after.get("status") != "retired":
                raise RuntimeError(
                    f"{session} is still {after.get('status')!r} in the roster; "
                    "the session was NOT closed (the watchdog would revive it)")
            declared = True

        closed = False
        if session_alive(session):
            killed = exact_tmux("kill-session", "-t", f"={session}")
            if killed.returncode != 0:
                raise RuntimeError(
                    f"{session} is retired but tmux kill failed: "
                    f"{killed.stderr.strip() or 'tmux error'}")
            closed = True
        journal({"ts": now_iso(), "event": "retired", "session": session,
                 "reason": reason, "declared": declared, "closed": closed})
        print(f"retired {session}"
              + ("" if declared else " (not in the roster: nothing to respawn)")
              + ("; session closed" if closed else "; session was already down"))
        return 0
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
        print(f"jht-agent-retire: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
