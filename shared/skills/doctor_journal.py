#!/usr/bin/env python3
"""doctor_journal.py — the Dottore's journal row and the right to recreate a session, both from the DECISION.

On a 31/10 round of a beta VPS the Dottore recreated three coordinators that were 3 hours old and 8-42% used and wrote
86/96/86 as their context_pct: the number and the decision were typed by the model, nothing in code looked at them
(the next day the same model wrote the right number: it changed from one round to the next).

`session_context.py --age-h` computes the decision (refresh or skip, why, the share used) and leaves it here
(`save_decision`). From then on:

  may-recreate S   exit 0 only when the decision for S is `refresh` and recent: the step that kills the session asks it
                   first, so a session at 20% used (or one that could not be measured) is not recreated by a model
                   that decided otherwise.
  append S ...     writes the row of the round's journal. `action` and `context_pct` are the decision's, not the
                   model's: refresh -> recreated, skip -> skipped_lowctx / skipped_unmeasured, with used_pct as
                   context_pct. The model only adds what it knows (analytics, interview) and, for the two reasons the
                   decision cannot see, `--override skipped_fresh|skipped_parked`. A `recreated` row without a refresh
                   decision is refused.
  resume S ...     the row that says the resume message reached the fresh session.

The journal is append-only: logs/doctor-retrospective.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DECISION_MAX_AGE_S = 30 * 60
OVERRIDES = ("skipped_fresh", "skipped_parked")
_SESSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_TIMINGS = ("start+30", "mid", "fallback")
JOURNAL_NAME = "doctor-retrospective.jsonl"


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME", "/jht_home"))


def decision_path(session: str, home: Optional[Path] = None) -> Path:
    if not _SESSION.match(session):
        raise ValueError("not a session name")
    return (home or jht_home()) / "agents" / "dottore" / "tmp" / f"ctx-decision-{session.lower()}.json"


def journal_path(home: Optional[Path] = None) -> Path:
    return (home or jht_home()) / "logs" / JOURNAL_NAME


def save_decision(session: str, decision: dict, home: Optional[Path] = None, now: Optional[float] = None) -> bool:
    """Leaves the decision for `session`. False when it cannot be written (then nothing may be recreated)."""
    try:
        path = decision_path(session, home)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps({"at": time.time() if now is None else now, **decision}), encoding="utf-8")
        os.replace(temporary, path)
        return True
    except (OSError, ValueError):
        return False


def load_decision(session: str, home: Optional[Path] = None, now: Optional[float] = None) -> Optional[dict]:
    """The recent decision for `session`, or None (never made, unreadable, or older than half an hour)."""
    try:
        data = json.loads(decision_path(session, home).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("action") not in ("refresh", "skip"):
        return None
    at = data.get("at")
    current = time.time() if now is None else now
    if not isinstance(at, (int, float)) or isinstance(at, bool) or not (0 <= current - at <= DECISION_MAX_AGE_S):
        return None
    return data


def may_recreate(session: str, home: Optional[Path] = None, now: Optional[float] = None) -> bool:
    decision = load_decision(session, home, now)
    return decision is not None and decision["action"] == "refresh"


def action_of(decision: Optional[dict], override: Optional[str] = None) -> str:
    """The row's action: the decision's, unless the model names one of the two reasons the decision cannot see."""
    if override is not None:
        if override not in OVERRIDES:
            raise ValueError("override must be skipped_fresh or skipped_parked")
        return override
    if decision is None:
        raise ValueError("no recent decision for this session: run session_context.py --age-h first")
    if decision["action"] == "refresh":
        return "recreated"
    return "skipped_unmeasured" if decision.get("reason") == "unmeasured" else "skipped_lowctx"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write(entry: dict, home: Optional[Path]) -> None:
    path = journal_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def append_entry(session: str, round_id: str, day: str, timing: str, role: str, age_h: Optional[float],
                 analytics: dict, interview: dict, override: Optional[str] = None,
                 home: Optional[Path] = None, now: Optional[float] = None) -> dict:
    """Writes the row of one session in one round. Raises ValueError when the row would say more than the decision."""
    if timing not in _TIMINGS:
        raise ValueError("timing must be start+30, mid or fallback")
    decision = load_decision(session, home, now)
    action = action_of(decision, override)
    entry = {
        "ts": _now_iso(), "round_id": round_id, "day": day, "timing": timing,
        "session": session, "role": role, "session_age_h": age_h,
        "analytics": analytics, "interview": interview,
        "action": action,
        # always the decision's share used; null when this row is not about the context (fresh, parked, no decision)
        "context_pct": decision.get("used_pct") if decision else None,
        "decision_reason": decision.get("reason") if decision else None,
        "resume_msg_sent": False,
    }
    _write(entry, home)
    return entry


def resume_entry(session: str, round_id: str, timing: str, role: str, home: Optional[Path] = None) -> dict:
    entry = {"ts": _now_iso(), "round_id": round_id, "timing": timing, "session": session, "role": role,
             "action": "resume_confirmed", "resume_msg_sent": True}
    _write(entry, home)
    return entry


def _load_json_file(path: str) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"{path}: not a readable JSON file") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path}: not a JSON object")
    return data


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    guard = sub.add_parser("may-recreate")
    guard.add_argument("session")
    add = sub.add_parser("append")
    add.add_argument("session")
    add.add_argument("--round-id", required=True)
    add.add_argument("--day", required=True)
    add.add_argument("--timing", required=True)
    add.add_argument("--role", required=True)
    add.add_argument("--age-h", type=float, default=None)
    add.add_argument("--analytics-file", default=None)
    add.add_argument("--interview-file", default=None)
    add.add_argument("--override", default=None)
    res = sub.add_parser("resume")
    res.add_argument("session")
    res.add_argument("--round-id", required=True)
    res.add_argument("--timing", required=True)
    res.add_argument("--role", required=True)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "may-recreate":
            if may_recreate(args.session):
                print("refresh")
                return 0
            print(f"NOT recreating {args.session}: no recent refresh decision "
                  "(run session_context.py --age-h; a skip is final)", file=sys.stderr)
            return 1
        if args.cmd == "append":
            entry = append_entry(
                args.session, args.round_id, args.day, args.timing, args.role, args.age_h,
                _load_json_file(args.analytics_file) if args.analytics_file else {},
                _load_json_file(args.interview_file) if args.interview_file else {},
                override=args.override)
            print(json.dumps({"appended": args.session, "action": entry["action"], "context_pct": entry["context_pct"]}))
            return 0
        resume_entry(args.session, args.round_id, args.timing, args.role)
        print(f"appended resume_confirmed {args.session}")
        return 0
    except (ValueError, OSError) as exc:
        print(f"doctor_journal: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
