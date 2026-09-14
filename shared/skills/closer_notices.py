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
2. `defer(position_id, reason, url)` — for the stops that are a property of
   the site rather than of the application (DIGEST_REASONS): nothing is sent
   now, the stop joins the pending list. `flush()` sends ONE message for all
   of them; the CLOSER runs `closer_notices.py flush` when it ends its round.
   If a stop waits longer than FLUSH_AFTER (the CLOSER died before the end of
   its round), the next `defer` flushes by itself.
3. The prose of the form questions (`question_dashboard_hint`,
   `question_essential_note`, `question_telegram_hint`, `email_stop_message`).
   NOT the head of a question: "CLOSER needs one required application answer
   before it can continue.\\nQuestion: …\\nField type: …\\nOptions:" up to the
   first blank line is read by web/lib/application-answer-request.ts and by
   the Telegram reply matcher. Only what follows the blank line is localized.

State: $JHT_HOME/.cache/apply-flow/notices.json, written atomically. One entry
per position + reason + authorisation instant: a rerun of the same stop is not
a second line, a stop after the user authorised the position again is.
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

DIGEST_REASONS = frozenset({
    "ats_unsupported", "ats_conflict", "linkedin_easy_apply", "application_form_embedded",
    # page_failure: a gone page, an anti-bot wall, a page down three times in a day.
    # A temporary failure below that is never a stop, so it never reaches here.
    "page_not_found", "bot_protection", "page_temporarily_unavailable",
})
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
)
FLUSH_AFTER = timedelta(hours=6)
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
        found[name] = " ".join(str(value or "").split())
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
            detail=" ".join(str(detail or "").split())[:300],
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


def defer(position_id: int, reason: str, url: str) -> None:
    """Queue a site stop for the round's summary instead of notifying now."""
    path = _state_path()
    state = _read_state(path)
    facts = _position(position_id)
    key = _entry_key(position_id, reason, facts["apply_requested_at"])
    known = {entry.get("key") for entry in state["pending"]} | set(state["sent"])
    if key not in known:
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
            host=entry.get("host", ""),
        ))
    if len(pending) > MAX_LINES:
        lines.append(text("closer.digest.more", count=len(pending) - MAX_LINES))
    lines.append("")
    lines.append(text("closer.digest.footer"))
    return "\n".join(lines)


def _default_notifier(*, message: str, source_id: str) -> str:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    command = [executable, "--agent", "closer", "--kind", "digest", "--source-id", source_id]
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
    pending = list(state["pending"])
    if not pending:
        return {"status": "empty", "count": 0}
    keys = [str(entry.get("key")) for entry in pending]
    source_id = "closer-digest:" + hashlib.sha256("\n".join(keys).encode("utf-8")).hexdigest()[:24]
    message = summary_message(pending)
    try:
        (notifier or _default_notifier)(message=message, source_id=source_id)
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CLOSER notices: send the round's summary")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("flush", help="send the pending site stops as one message")
    sub.add_parser("pending", help="print the pending stops as JSON")
    args = parser.parse_args(argv)
    if args.command == "pending":
        print(json.dumps(_read_state(_state_path())["pending"], ensure_ascii=False))
        return 0
    result = flush()
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] in {"sent", "empty"} else 1


if __name__ == "__main__":
    sys.exit(main())
