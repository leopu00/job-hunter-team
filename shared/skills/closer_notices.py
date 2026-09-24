#!/usr/bin/env python3
"""What the CLOSER tells the user: in the user's language, and one summary per round.

Why. On 14/09 position 1817 stopped with `ats_unsupported` and the user got a
Telegram message in English ("CLOSER stopped before any blind retry. Reason:
ats_unsupported…") while the profile is Italian; six more LinkedIn positions
were about to send six more of the same. The facts were right, the delivery
was not: a stop the user cannot act on one by one is a list, and it has to be
readable.

1. `stop_message(reason, detail, position_id)` — the per-position stop, in the
   language of the profile (`shared/i18n.py`: i18n-prefs.json → JHT_LANG →
   host.env), saying why and what the user can do. The technical reason and
   detail stay at the end, in brackets, for support.
2. `defer(position_id, reason, url)` — every stop that is not a form question
   (HQ-BACKEND-3, 14/09): nothing is sent now, the stop joins the pending
   list, one line per position (the latest stop wins). `flush()` sends ONE message for all
   of them; the CLOSER runs `closer_notices.py flush` when it ends its round.
   If a stop waits longer than FLUSH_AFTER (the CLOSER died before the end of
   its round), the next `defer` flushes by itself.
3. The prose of the form questions (`question_dashboard_hint`,
   `question_essential_note`, `question_telegram_hint`, `email_stop_message`).
   NOT the head of a question: "CLOSER needs one required application answer
   before it can continue.\\nQuestion: …\\nField type: …\\nOptions:" up to the
   first blank line is read by web/lib/application-answer-request.ts and by
   the Telegram reply matcher. Only what follows the blank line is localized.

State: $JHT_HOME/.cache/apply-flow/notices.json, written atomically. A key per
position + reason + authorisation instant: a rerun of the same stop is not a
second line, a stop after the user authorised the position again is — and it
replaces that position's older pending line (patch 20, 14/09: 2071 and 1798
were listed twice, once per authorisation).

The message goes through agents/_tools/jht-notify-user, which accepts a
source id only with its action and payload (source metadata incomplete →
exit 1): patch 20 flushed nothing for that, behind a test with a fake notifier.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

SHARED = Path(__file__).resolve().parents[1]
if str(SHARED) not in sys.path:
    sys.path.insert(0, str(SHARED))

import i18n  # noqa: E402

try:
    from external_content import flatten_to_one_line
except ImportError:  # pragma: no cover - package import
    from shared.skills.external_content import flatten_to_one_line

# Reasons with their own why/action text. Any other reason gets the default.
KNOWN_REASONS = (
    "ats_unsupported",
    "ats_conflict",
    "linkedin_easy_apply",
    "application_form_embedded",
    "application_redirect_untrusted",
    "generic_form_missing",
    "vacancy_closed",
    "captcha",
    "two_factor",
    "login_required",
    "account_creation",
    "cover_letter_required",
    "cv_pdf_layout_bad",
    "cv_pdf_check_unavailable",
    "submit_outcome_unknown",
    "receipt_missing",
    "confirmation_ambiguous",
    "page_unavailable",
    "browser_uncertainty",
    "url_refused",
    "page_not_found",
    "bot_protection",
    "page_temporarily_unavailable",
    # Every stop goes to the summary now (HQ-BACKEND-3, 14/09): the live round
    # had 8 separate notices, 6 of them linkedin_credentials_missing. A sent or
    # probably sent email must never read as "nothing was sent".
    "receipt_incomplete",
    "send_outcome_unknown",
    "linkedin_credentials_missing",
    "linkedin_login_failed",
    "linkedin_challenge",
    "linkedin_session_expired",
    "unknown_required_control",
)
FLUSH_AFTER = timedelta(hours=6)
SOURCE_ACTION = "closer_digest"
KEEP_SENT = 500
MAX_LINES = 25


# ── localisation ────────────────────────────────────────────────────────────


class _Blank(dict):
    def __missing__(self, key: str) -> str:
        return ""


def text(key: str, **params: Any) -> str:
    """The catalog string for `key` in the user's language, with {named} fields."""
    template = i18n.t(key)
    try:
        return template.format_map(_Blank({k: "" if v is None else v for k, v in params.items()}))
    except (ValueError, IndexError):
        return template


def localized(key: str, default: str, **params: Any) -> str:
    """`text(key)`, or `default` when the key is unknown or anything fails.

    For callers whose message must go out whatever happens (a question that
    does not leave blocks the application): never an exception, never a key.
    """
    try:
        if i18n.t(key) == key:
            return default
        rendered = text(key, **params)
    except Exception:
        return default
    return rendered if rendered.strip() else default


def reason_why(reason: str) -> str:
    key = f"closer.reason.{reason}.why"
    value = i18n.t(key)
    return value if value != key else text("closer.reason.default.why")


def reason_action(reason: str) -> str:
    key = f"closer.reason.{reason}.action"
    value = i18n.t(key)
    return value if value != key else text("closer.reason.default.action")


# ── the database, best effort ───────────────────────────────────────────────


def _jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def _db_path() -> Path:
    return Path(os.environ["JHT_DB"]) if os.environ.get("JHT_DB") else _jht_home() / "jobs.db"


def _position(position_id: int) -> dict[str, str]:
    """Title, company and authorisation instant; empty strings when unreadable."""
    empty = {"title": "", "company": "", "apply_requested_at": ""}
    db = _db_path()
    if not db.is_file():
        return empty
    try:
        with contextlib.closing(sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True, timeout=5)) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(positions)")}
            wanted = [c for c in ("title", "company", "apply_requested_at") if c in columns]
            if not wanted:
                return empty
            row = conn.execute(f"SELECT {', '.join(wanted)} FROM positions WHERE id = ?", (int(position_id),)).fetchone()
    except (sqlite3.Error, ValueError, OSError):
        return empty
    if not row:
        return empty
    found = dict(empty)
    for name, value in zip(wanted, row):
        # Scraped from the vacancy: no bidi overrides or format characters in a notice.
        found[name] = flatten_to_one_line(value)
    return found


def _position_label(position_id: int, facts: Mapping[str, str]) -> str:
    if facts.get("title") and facts.get("company"):
        return text("closer.position.full", id=position_id, title=facts["title"], company=facts["company"])
    if facts.get("title"):
        return text("closer.position.title", id=position_id, title=facts["title"])
    return text("closer.position.bare", id=position_id)


# ── per-position messages ───────────────────────────────────────────────────


def _stop(key: str, reason: str, detail: str, position_id: int, default: str) -> str:
    try:
        return localized(
            key,
            default,
            position=_position_label(position_id, _position(position_id)),
            why=reason_why(reason),
            action=reason_action(reason),
            reason=reason,
            detail=flatten_to_one_line(detail)[:300],
        )
    except Exception:
        return default


def stop_message(reason: str, detail: str, position_id: int, default: str = "") -> str:
    """The stop of one application, in the user's language (`default` if that fails)."""
    return _stop("closer.stop.message", reason, detail, position_id, default)


def email_stop_message(reason: str, detail: str, position_id: int, default: str = "") -> str:
    """The stop of an email application, in the user's language (`default` if that fails)."""
    return _stop("closer.email.stop", reason, detail, position_id, default)


def question_dashboard_hint(default: str = "") -> str:
    return localized("closer.question.dashboard_hint", default)


def question_essential_note(default: str = "") -> str:
    return localized("closer.question.essential_note", default)


def question_telegram_hint(code: str, default: str = "") -> str:
    """The code stays the same token: application_answers._CODE finds it anywhere."""
    hint = localized("closer.question.telegram_hint", default, code=code)
    return hint if code in hint else default


# ── the per-round summary ───────────────────────────────────────────────────


def _state_path() -> Path:
    return _jht_home() / ".cache" / "apply-flow" / "notices.json"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _read_state(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"version": 1, "pending": [], "sent": []}
    except (OSError, ValueError):
        # An unreadable file must not swallow the stops: start again, the
        # checkpoints still hold every one of them.
        return {"version": 1, "pending": [], "sent": []}
    if not isinstance(value, dict):
        return {"version": 1, "pending": [], "sent": []}
    value.setdefault("pending", [])
    value.setdefault("sent", [])
    return value


def _write_state(path: Path, state: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    try:
        with handle:
            json.dump(state, handle, ensure_ascii=False, sort_keys=True)
        os.chmod(handle.name, 0o600)
        os.replace(handle.name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(handle.name)
        raise


def _entry_key(position_id: int, reason: str, authorised_at: str) -> str:
    return f"{int(position_id)}:{reason}:{authorised_at}"


def _entry_position(entry: Mapping[str, Any]) -> int | None:
    try:
        return int(entry.get("position_id"))
    except (TypeError, ValueError):
        return None


def _latest_per_position(pending: list[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The last pending entry of each position, in queue order."""
    last: dict[Any, int] = {}
    for index, entry in enumerate(pending):
        last[_entry_position(entry)] = index
    return [entry for index, entry in enumerate(pending) if last[_entry_position(entry)] == index]


def defer(position_id: int, reason: str, url: str) -> None:
    """Queue a site stop for the round's summary instead of notifying now."""
    path = _state_path()
    state = _read_state(path)
    facts = _position(position_id)
    key = _entry_key(position_id, reason, facts["apply_requested_at"])
    known = {entry.get("key") for entry in state["pending"]} | set(state["sent"])
    if key not in known:
        # One line per position: a newer stop replaces the older pending one.
        state["pending"] = [
            entry for entry in state["pending"] if _entry_position(entry) != int(position_id)
        ]
        try:
            host = (urllib.parse.urlsplit(str(url)).hostname or "").casefold()
        except ValueError:
            host = ""
        state["pending"].append({
            "key": key,
            "position_id": int(position_id),
            "reason": str(reason),
            "host": host,
            "at": _now().isoformat(),
        })
        _write_state(path, state)
    oldest = min((entry.get("at", "") for entry in state["pending"]), default="")
    try:
        stale = bool(oldest) and _now() - datetime.fromisoformat(oldest) > FLUSH_AFTER
    except ValueError:
        stale = True
    if stale:
        flush()


def summary_message(pending: list[Mapping[str, Any]]) -> str:
    lines = [text("closer.digest.header", count=len(pending))]
    for entry in pending[:MAX_LINES]:
        pid = int(entry["position_id"])
        lines.append(text(
            "closer.digest.line",
            position=_position_label(pid, _position(pid)),
            why=reason_why(str(entry["reason"])),
            action=reason_action(str(entry["reason"])),
            host=flatten_to_one_line(entry.get("host", "")),
        ))
    if len(pending) > MAX_LINES:
        lines.append(text("closer.digest.more", count=len(pending) - MAX_LINES))
    lines.append("")
    lines.append(text("closer.digest.footer"))
    return "\n".join(lines)


def _default_notifier(*, message: str, source_id: str, payload: Mapping[str, Any]) -> str:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    command = [
        executable, "--agent", "closer", "--kind", "digest",
        "--source-id", source_id,
        "--source-action", SOURCE_ACTION,
        "--source-payload", json.dumps(dict(payload), sort_keys=True),
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    command.append(message)
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"jht-notify-user failed with exit {result.returncode}")
    return result.stdout.strip()


def flush(notifier: Callable[..., Any] | None = None) -> dict[str, Any]:
    """Send the pending site stops as one message. Returns {status, count}."""
    path = _state_path()
    state = _read_state(path)
    queued = list(state["pending"])
    if not queued:
        return {"status": "empty", "count": 0}
    # Every queued key is settled by this message, the replaced lines too.
    keys = [str(entry.get("key")) for entry in queued]
    pending = _latest_per_position(queued)
    source_id = "closer-digest:" + hashlib.sha256("\n".join(keys).encode("utf-8")).hexdigest()[:24]
    message = summary_message(pending)
    payload = {"position_ids": [_entry_position(entry) for entry in pending]}
    try:
        (notifier or _default_notifier)(message=message, source_id=source_id, payload=payload)
    except Exception as exc:
        # Kept pending: the next flush tries again with the same source id, so
        # a message that did reach the database is not duplicated.
        return {"status": "failed", "count": len(pending), "error": type(exc).__name__}
    state = _read_state(path)
    sent_now = set(keys)
    state["pending"] = [entry for entry in state["pending"] if entry.get("key") not in sent_now]
    state["sent"] = (list(state["sent"]) + keys)[-KEEP_SENT:]
    _write_state(path, state)
    return {"status": "sent", "count": len(pending), "source_id": source_id}


# ── the positions that WAIT: a state, not an event ──────────────────────────
#
# Why this exists beside `flush()` (MASTER, 24/09). On the operator's box 16 of
# 21 authorised positions have been sitting in a `blocked_human` checkpoint for
# twenty-six days — the sites' own doing: an ATS nobody supports, an anti-bot
# wall, a captcha, an ambiguous form. The gate holds them, correctly, and the
# person was told once, the evening they stopped: `notices.json` says
# `pending 0, sent 27`. Nothing was lost and nothing is broken — and nobody has
# asked her for the hand those sixteen are waiting for since.
#
# An EVENT is told once; a STATE can be told for as long as it lasts. So the
# source here is not the stops as they happen, it is the queue's `held` list —
# what is true NOW. And the executor is not the CLOSER: it does not exist when
# the queue is closed (C-27), which is exactly when the list is longest. It is
# whoever runs anyway and reads the gate.
#
# The message must not become daily noise, so it goes out only when the LIST
# CHANGES: the fingerprint is the SET of held positions and their reasons, never
# the days — those move every night, and a notice that repeats every night is
# one nobody reads. And it says how long, because "four for twenty-six days"
# moves a person and `ats_unsupported` does not.

WAITING_SOURCE_ACTION = "closer_waiting"

def _parse_utc(value: str) -> datetime | None:
    """A timestamp of the database as the instant it is: UTC, never local.

    The column holds `YYYY-MM-DD HH:MM:SS` written by SQLite's
    `CURRENT_TIMESTAMP`, which is UTC. Read as local time it would be hours off,
    and on the wrong side of a day boundary that is a whole day of waiting
    gained or lost in the sentence the person reads.
    """
    text_value = (value or "").strip()
    if not text_value:
        return None
    normalised = text_value.replace("T", " ")
    for shape in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(normalised[: len(shape) + 2].strip(), shape).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _days_waiting(authorised_at: str, now: datetime | None = None) -> int | None:
    """Whole days since the person authorised it; None when there is no date."""
    at = _parse_utc(authorised_at)
    if at is None:
        return None
    return max(0, ((now or _now()) - at).days)


def waiting_entries(queue: Mapping[str, Any], now: datetime | None = None) -> list[dict[str, Any]]:
    """The queue's held positions, each with how long it has been waiting.

    Oldest first: the sentence the person reads starts with what has waited
    longest, which is the one she is most likely to have forgotten.
    """
    entries: list[dict[str, Any]] = []
    for item in queue.get("held") or []:
        try:
            pid = int(item["position_id"])
        except (KeyError, TypeError, ValueError):
            continue
        facts = _position(pid)
        entries.append({
            "position_id": pid,
            "reason": str(item.get("reason") or ""),
            "days": _days_waiting(facts.get("apply_requested_at", ""), now),
            "label": _position_label(pid, facts),
        })
    return sorted(entries, key=lambda e: (-(e["days"] if e["days"] is not None else -1), e["position_id"]))


def _ages(entries: list[Mapping[str, Any]]) -> str:
    """`4 for 26 days, 7 for 19 days`: the counts by age, oldest first."""
    counted: dict[int, int] = {}
    for entry in entries:
        days = entry.get("days")
        if days is None:
            continue
        counted[int(days)] = counted.get(int(days), 0) + 1
    return ", ".join(text("closer.waiting.age", count=n, days=days) for days, n in sorted(counted.items(), reverse=True))


def waiting_message(entries: list[Mapping[str, Any]]) -> str:
    lines = [text("closer.waiting.header", count=len(entries), ages=_ages(entries))]
    for entry in entries[:MAX_LINES]:
        lines.append(text(
            "closer.waiting.line",
            position=entry.get("label", ""),
            days=entry.get("days") if entry.get("days") is not None else "",
            action=reason_action(str(entry.get("reason") or "")),
        ))
    if len(entries) > MAX_LINES:
        lines.append(text("closer.waiting.more", count=len(entries) - MAX_LINES))
    lines.append("")
    lines.append(text("closer.waiting.footer"))
    return "\n".join(lines)


def waiting_fingerprint(entries: list[Mapping[str, Any]]) -> str:
    """The SET being waited on: positions and reasons, never the days."""
    keys = sorted(f"{int(e['position_id'])}:{e.get('reason') or ''}" for e in entries)
    return hashlib.sha256("\n".join(keys).encode("utf-8")).hexdigest()[:24]


def waiting(
    notifier: Callable[..., Any] | None = None,
    queue: Mapping[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """One message for the positions that wait, and only when the list changed.

    Returns `{status, count}`: `sent`, `unchanged` (the same set was already
    told), `empty` (nothing is held), `unavailable` (the gate could not be
    read — never an empty list invented in its place) or `failed`.
    """
    if queue is None:
        try:
            if str(Path(__file__).resolve().parent) not in sys.path:
                sys.path.insert(0, str(Path(__file__).resolve().parent))
            import apply_gate  # noqa: PLC0415

            queue = apply_gate.application_queue()
        except Exception as exc:
            # The gate is the only source: no queue, no list. Saying "nothing is
            # waiting" because the read failed would be the worst of the two.
            return {"status": "unavailable", "count": 0, "error": type(exc).__name__}
    entries = waiting_entries(queue, now)
    if not entries:
        return {"status": "empty", "count": 0}
    fingerprint = waiting_fingerprint(entries)
    path = _state_path()
    state = _read_state(path)
    known = state.get("waiting") if isinstance(state.get("waiting"), Mapping) else {}
    if known.get("fingerprint") == fingerprint:
        return {"status": "unchanged", "count": len(entries), "fingerprint": fingerprint}
    source_id = "closer-waiting:" + fingerprint
    payload = {"position_ids": [int(e["position_id"]) for e in entries]}
    try:
        (notifier or _default_notifier)(message=waiting_message(entries), source_id=source_id, payload=payload)
    except Exception as exc:
        # Not recorded: the same list is told again next time, which is what a
        # person waiting twenty-six days needs more than a tidy state file.
        return {"status": "failed", "count": len(entries), "error": type(exc).__name__}
    state = _read_state(path)
    state["waiting"] = {"fingerprint": fingerprint, "at": _now().isoformat().replace("+00:00", "Z"), "count": len(entries)}
    _write_state(path, state)
    return {"status": "sent", "count": len(entries), "fingerprint": fingerprint}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CLOSER notices: send the round's summary")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("flush", help="send the pending site stops as one message")
    sub.add_parser("pending", help="print the pending stops as JSON")
    sub.add_parser("waiting", help="tell the user about the positions that wait, if the list changed")
    args = parser.parse_args(argv)
    if args.command == "pending":
        print(json.dumps(_read_state(_state_path())["pending"], ensure_ascii=False))
        return 0
    if args.command == "waiting":
        answer = waiting()
        print(json.dumps(answer, sort_keys=True))
        return 0 if answer["status"] in {"sent", "unchanged", "empty"} else 1
    result = flush()
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] in {"sent", "empty"} else 1


if __name__ == "__main__":
    sys.exit(main())
