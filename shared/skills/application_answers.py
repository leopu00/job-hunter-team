#!/usr/bin/env python3
"""application_answers.py — the user's application answers, asked once and remembered. [JHT-CLOSER-ANSWERS]

The CLOSER never invents an answer. When a form or a vacancy asks something
the profile does not say, the user is asked — on Telegram first, through
`jht-notify-user` — and the answer is kept in `jobs.db`
(`application_answers`), so a restarted session with an empty context never
asks the same thing again.

Three doors lead to the same table:

1. **A form question** (`apply_flow.py`): the recipe stops with an answer
   request, the user replies on the dashboard or on Telegram, the flow resumes
   from its checkpoint and reads the answer from here.
2. **An essential fact** (`essentials`): before the first application, the
   facts almost every form asks for — start date, notice period, work
   authorisation, sponsorship, salary expectation, relocation, phone. One
   question per missing fact, never repeated.
3. **The profile YAML**: `application_answers` already written there is
   imported once, and the database wins from then on.

A reply on Telegram resolves an open request when it answers THAT request:
a Telegram reply to the question message, a message carrying the request's
short code, or — only when exactly one request is open and it was delivered
on Telegram — the next message. Two open requests and no code resolve
nothing. The reply is validated by the same rule as the dashboard
(`validate_reply`, pinned against `web/lib/application-answer-request.ts` by
`shared/cloud/application-answer-cases.json`), and a valid one renews the
position's authorisation as `user_telegram`.

Commands (one JSON line on stdout)::

    application_answers.py essentials --position-id ID --json          # read only
    application_answers.py essentials --position-id ID --ask --json    # asks what is missing
    application_answers.py list --json

`essentials` without `--ask` only reports: it writes nothing, not even a
question. The questions are created by `apply_flow.py` before the first run of
a position, or by an explicit `--ask`.

Exit codes: 0 complete / listed · 3 missing (waiting for the user) · 2 error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apply_gate  # noqa: E402

SOURCE_ACTION = "closer_application_answer"
TELEGRAM_ORIGIN = "user_telegram"
TEXT_FIELD_TYPES = frozenset({"textarea", "text", "email", "tel", "url", "number", "date"})
MAX_ANSWER_CHARS = 4000

_CODE = re.compile(r"(?<![A-Za-z0-9])(Q[0-9A-F]{4})(?![A-Za-z0-9])", re.I)


def normalise_label(value: str) -> str:
    """The key a question is saved under; the recipes normalise labels this way."""
    value = str(value).replace("\u00a0", " ").strip().casefold()
    value = re.sub(r"[\s\W_]+", " ", value, flags=re.UNICODE)
    return value.strip()


def _utc_now() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# ── The rule shared with the dashboard ───────────────────────────────────────


class AnswerRejected(ValueError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def payload_shape(payload: Any) -> tuple[str, list[str]]:
    """Field type and options of a request payload; the dashboard checks the same."""
    if not isinstance(payload, Mapping):
        raise AnswerRejected("closer_answer_payload_invalid")
    field_type = payload.get("field_type")
    options = payload.get("options")
    if (
        payload.get("version") != 1
        or not isinstance(payload.get("key"), str)
        or not payload.get("key")
        or not isinstance(payload.get("label"), str)
        or not payload.get("label")
        or not isinstance(field_type, str)
        or not isinstance(options, list)
        or any(not isinstance(option, str) or not option for option in options)
        or len(set(options)) != len(options)
    ):
        raise AnswerRejected("closer_answer_payload_invalid")
    return field_type, list(options)


def validate_reply(field_type: str, options: Sequence[str], reply: str) -> None:
    """Exactly `assertAnswerShape` in `web/lib/application-answer-request.ts`."""
    if field_type in {"radio", "select"}:
        if reply not in options:
            raise AnswerRejected("closer_answer_not_exact_option")
        return
    if field_type == "checkbox":
        if reply not in {"Yes", "No"}:
            raise AnswerRejected("closer_answer_not_exact_option")
        return
    if field_type == "checkboxes":
        try:
            selected = json.loads(reply)
        except (TypeError, ValueError):
            raise AnswerRejected("closer_answer_not_exact_option") from None
        if (
            not isinstance(selected, list)
            or not selected
            or any(not isinstance(option, str) or option not in options for option in selected)
            or len(set(selected)) != len(selected)
        ):
            raise AnswerRejected("closer_answer_not_exact_option")
        return
    if field_type in TEXT_FIELD_TYPES and not options:
        return
    raise AnswerRejected("closer_answer_payload_invalid")


def decode_reply(field_type: str, reply: str) -> Any:
    """The typed answer a recipe fills in, from a reply `validate_reply` accepted."""
    if field_type == "checkbox":
        return reply == "Yes"
    if field_type == "checkboxes":
        return json.loads(reply)
    return reply


def telegram_reply_text(field_type: str, text: str) -> str:
    """What a Telegram message means as a dashboard reply.

    A chat has no multi-select: for `checkboxes` one option per line becomes
    the JSON list the dashboard sends. Nothing else is reinterpreted — "yes"
    is not "Yes", because the form option is what the recruiter reads.
    """
    clean = text.strip()
    if field_type == "checkboxes" and not clean.startswith("["):
        lines = [line.strip() for line in clean.splitlines() if line.strip()]
        return json.dumps(lines, ensure_ascii=False)
    return clean


# ── The table ────────────────────────────────────────────────────────────────


def ensure_table(conn: sqlite3.Connection) -> None:
    import _db

    _db._migrate_application_answers(conn)


def load_answers(conn: sqlite3.Connection) -> dict[str, Any]:
    ensure_table(conn)
    rows = conn.execute("SELECT key, answer_json FROM application_answers").fetchall()
    answers: dict[str, Any] = {}
    for key, answer_json in rows:
        try:
            answers[str(key)] = json.loads(answer_json)
        except (TypeError, ValueError):
            continue
    return answers


def save_answer(
    conn: sqlite3.Connection,
    *,
    key: str,
    label: str,
    answer: Any,
    field_type: str,
    options: Sequence[str] = (),
    channel: str,
    message_id: int | None = None,
) -> None:
    if not key or key != normalise_label(key):
        raise ValueError("answer key is not canonical")
    ensure_table(conn)
    conn.execute(
        "INSERT INTO application_answers "
        "(key, label, answer_json, field_type, options_json, channel, source_message_id, answered_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET label = excluded.label, answer_json = excluded.answer_json, "
        "field_type = excluded.field_type, options_json = excluded.options_json, "
        "channel = excluded.channel, source_message_id = excluded.source_message_id, "
        "answered_at = excluded.answered_at",
        (
            key,
            label,
            json.dumps(answer, ensure_ascii=False),
            field_type,
            json.dumps(list(options), ensure_ascii=False),
            channel,
            message_id,
            _utc_now(),
        ),
    )


def import_profile_answers(conn: sqlite3.Connection, profile: Mapping[str, Any]) -> int:
    """Copy the YAML `application_answers` in once; an answer already in the DB wins."""
    raw = profile.get("application_answers") if isinstance(profile, Mapping) else None
    pairs: list[tuple[str, Any]] = []
    if isinstance(raw, Mapping):
        pairs = [(str(k), v) for k, v in raw.items()]
    elif isinstance(raw, list):
        pairs = [(str(i["question"]), i.get("answer")) for i in raw if isinstance(i, Mapping) and i.get("question")]
    ensure_table(conn)
    imported = 0
    for label, answer in pairs:
        key = normalise_label(label)
        if not key or answer is None:
            continue
        imported += conn.execute(
            "INSERT OR IGNORE INTO application_answers "
            "(key, label, answer_json, field_type, options_json, channel, answered_at) "
            "VALUES (?, ?, ?, 'profile', '[]', 'profile_yaml', ?)",
            (key, label, json.dumps(answer, ensure_ascii=False), _utc_now()),
        ).rowcount
    return imported


def answers_with_profile(conn: sqlite3.Connection, profile: Mapping[str, Any]) -> dict[str, Any]:
    """YAML answers imported, then every answer keyed by its normalised label."""
    import_profile_answers(conn, profile)
    conn.commit()
    return load_answers(conn)


# ── Answers arriving on the question rows ────────────────────────────────────


def harvest_replies(conn: sqlite3.Connection) -> int:
    """Save every validated reply to a CLOSER question, whatever channel wrote it.

    The dashboard writes only the reply on the question row; this is what
    turns it into a remembered answer without waiting for a checkpoint resume.
    """
    ensure_table(conn)
    rows = conn.execute(
        "SELECT id, source_payload, user_reply, delivered_via FROM pending_user_messages "
        "WHERE agent = 'closer' AND kind = 'question' AND source_action = ? "
        "AND user_reply IS NOT NULL AND user_reply_at IS NOT NULL",
        (SOURCE_ACTION,),
    ).fetchall()
    saved = 0
    for message_id, payload_text, reply, _via in rows:
        try:
            payload = json.loads(payload_text or "")
            field_type, options = payload_shape(payload)
            validate_reply(field_type, options, reply)
        except (ValueError, AnswerRejected):
            continue
        key = normalise_label(payload["key"])
        existing = conn.execute(
            "SELECT source_message_id FROM application_answers WHERE key = ?", (key,)
        ).fetchone()
        if existing and existing[0] is not None and int(existing[0]) >= int(message_id):
            continue
        save_answer(
            conn,
            key=key,
            label=payload["label"],
            answer=decode_reply(field_type, reply),
            field_type=field_type,
            options=options,
            channel="reply",
            message_id=int(message_id),
        )
        saved += 1
    return saved


def answer_code(source_id: str) -> str:
    """The short code a user can repeat when several questions are open."""
    return "Q" + hashlib.sha256(str(source_id).encode("utf-8")).hexdigest()[:4].upper()


def telegram_hint(source_id: str) -> str:
    return (
        f"On Telegram, reply to this message or start your answer with {answer_code(source_id)}. "
        "Choices must be written exactly as listed."
    )


@dataclass(frozen=True)
class Resolution:
    status: str  # not_an_answer · ambiguous · rejected · resolved
    reason: str = ""
    message_id: int | None = None
    position_id: int | None = None
    question: str = ""


def _open_requests(conn: sqlite3.Connection) -> list[tuple]:
    return conn.execute(
        "SELECT id, body, source_id, source_payload, related_position_id, delivered_via, created_at "
        "FROM pending_user_messages "
        "WHERE agent = 'closer' AND kind = 'question' AND source_action = ? "
        "AND related_position_id IS NOT NULL AND user_reply IS NULL "
        "ORDER BY id",
        (SOURCE_ACTION,),
    ).fetchall()


def _question_line(body: str) -> str:
    for line in str(body).splitlines():
        if line.startswith("Question: "):
            return line
    return ""


def _pick_target(open_rows: list[tuple], text: str, reply_to_text: str | None, *, direct: bool):
    by_code: dict[str, list[tuple]] = {}
    for row in open_rows:
        by_code.setdefault(answer_code(row[2]), []).append(row)

    if reply_to_text:
        codes = {c.upper() for c in _CODE.findall(reply_to_text)}
        matched = [r for c in codes for r in by_code.get(c, [])]
        if not matched:
            # A question sent before codes existed: its Question line identifies it.
            matched = [r for r in open_rows if _question_line(r[1]) and _question_line(r[1]) in reply_to_text]
        if len(matched) == 1:
            return matched[0], text, ""
        return None, text, "ambiguous" if matched or codes else "not_an_answer"

    found = _CODE.search(text)
    if found:
        matched = by_code.get(found.group(1).upper(), [])
        if len(matched) == 1:
            remainder = (text[: found.start()] + text[found.end():]).strip(" \t:-—\n")
            return matched[0], remainder, ""
        return None, text, "ambiguous"

    if direct and len(open_rows) == 1 and open_rows[0][5] == "telegram":
        return open_rows[0], text, ""
    return None, text, "ambiguous" if len(open_rows) > 1 else "not_an_answer"


def resolve_telegram_reply(
    conn: sqlite3.Connection,
    *,
    text: str,
    reply_to_text: str | None = None,
    direct: bool = True,
) -> Resolution:
    """Resolve at most ONE open CLOSER request with a Telegram message.

    The caller holds the transaction. `direct` is true only on the bot the
    CLOSER's questions leave from: an unqualified message to another bot is
    never taken as an answer.
    """
    if not isinstance(text, str) or not text.strip():
        return Resolution("not_an_answer")
    open_rows = _open_requests(conn)
    if not open_rows:
        return Resolution("not_an_answer")
    row, answer_text, why = _pick_target(open_rows, text, reply_to_text, direct=direct)
    if row is None:
        return Resolution(why)
    message_id, body, source_id, payload_text, position_id = row[0], row[1], row[2], row[3], int(row[4])
    try:
        payload = json.loads(payload_text or "")
        field_type, options = payload_shape(payload)
        if str(payload.get("position_id")) != str(position_id):
            raise AnswerRejected("closer_answer_payload_invalid")
        reply = telegram_reply_text(field_type, answer_text)
        if not reply or len(reply) > MAX_ANSWER_CHARS:
            raise AnswerRejected("closer_answer_not_exact_option" if options else "closer_answer_empty")
        validate_reply(field_type, options, reply)
    except AnswerRejected as exc:
        return Resolution("rejected", exc.reason, message_id, position_id, body)
    except ValueError:
        return Resolution("rejected", "closer_answer_payload_invalid", message_id, position_id, body)

    import apply_request

    verdict = apply_gate.toggle_verdict(position_id, True, conn)
    essential = str(source_id).startswith("closer-essential:")
    if not verdict.allowed and not essential:
        # Same as the dashboard: a form answer never re-authorises an
        # application that has gone out or is not ready. An essential fact
        # belongs to no single application, so it is kept without renewing.
        return Resolution("rejected", f"closer_answer_{verdict.reason}", message_id, position_id, body)

    at = _utc_now()
    changed = conn.execute(
        "UPDATE pending_user_messages SET user_reply = ?, user_reply_at = ?, "
        "acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ? AND user_reply IS NULL",
        (reply, at, at, message_id),
    ).rowcount
    if changed != 1:
        return Resolution("not_an_answer")
    if verdict.allowed:
        apply_request.write_authorisation(conn, position_id, True, TELEGRAM_ORIGIN)
    save_answer(
        conn,
        key=normalise_label(payload["key"]),
        label=payload["label"],
        answer=decode_reply(field_type, reply),
        field_type=field_type,
        options=options,
        channel="telegram",
        message_id=message_id,
    )
    return Resolution("resolved", "", message_id, position_id, body)


# ── Essential facts ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EssentialFact:
    key: str
    label: str
    field_type: str
    options: tuple[str, ...]
    profile_paths: tuple[tuple[str, ...], ...]


ESSENTIAL_FACTS: tuple[EssentialFact, ...] = (
    EssentialFact("availability", "When can you start a new job (earliest start date)?", "text", (),
                  (("availability",), ("start_date",))),
    EssentialFact("notice period", "What is your notice period at your current job?", "text", (),
                  (("notice_period",),)),
    EssentialFact("work authorization", "In which countries are you authorised to work without a visa?",
                  "textarea", (), (("work_authorization",), ("work_authorisation",))),
    EssentialFact("sponsorship", "Do you need visa sponsorship to work in the countries you apply to?",
                  "radio", ("Yes", "No"), (("sponsorship",), ("needs_sponsorship",))),
    EssentialFact("salary expectations", "What is your gross yearly salary expectation (amount and currency)?",
                  "text", (), (("salary_expectations",), ("salary_expectation",))),
    EssentialFact("relocation", "Are you willing to relocate for a job?", "radio", ("Yes", "No"),
                  (("relocation",), ("willing_to_relocate",))),
    EssentialFact("phone", "Which phone number should recruiters use?", "tel", (),
                  (("contacts", "phone"), ("phone",))),
)


def _present(value: Any) -> bool:
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return bool(value)
    return False


def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = profile
    for part in path:
        if not isinstance(current, Mapping):
            return None
        current = current.get(part)
    return current


def missing_essentials(answers: Mapping[str, Any], profile: Mapping[str, Any]) -> list[EssentialFact]:
    missing = []
    for fact in ESSENTIAL_FACTS:
        if _present(answers.get(fact.key)):
            continue
        if any(_present(_profile_value(profile, path)) for path in fact.profile_paths):
            continue
        missing.append(fact)
    return missing


def essential_source_id(fact: EssentialFact) -> str:
    return "closer-essential:" + fact.key.replace(" ", "_")


def essential_message(fact: EssentialFact) -> str:
    """Same structured head as a form request, so the dashboard can answer it too."""
    options = "".join(f"\n- {value}" for value in fact.options)
    options_text = f"\nOptions:{options}" if options else ""
    return (
        "CLOSER needs one required application answer before it can continue.\n"
        f"Question: {fact.label}\n"
        f"Field type: {fact.field_type}"
        f"{options_text}\n\n"
        "This is an essential fact almost every application form asks for. It is saved once "
        "and never asked again.\n"
        f"{telegram_hint(essential_source_id(fact))}"
    )


def _default_notifier(*, position_id: int, message: str, source_id: str, payload: Mapping[str, Any]) -> str:
    candidates = [
        os.environ.get("JHT_NOTIFY_USER_BIN"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    command = [
        executable, "--agent", "closer", "--kind", "question", "--position-id", str(position_id),
        "--source-id", source_id, "--source-action", SOURCE_ACTION,
        "--source-payload", json.dumps(payload, ensure_ascii=False, sort_keys=True),
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    command.append(message)
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=45)
    if result.returncode != 0:
        raise RuntimeError(f"jht-notify-user failed with exit {result.returncode}")
    return result.stdout.strip().split(maxsplit=1)[0] if result.stdout.strip() else ""


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone() is not None


def check_essentials(conn: sqlite3.Connection, profile: Mapping[str, Any]) -> dict[str, Any]:
    """What `ensure_essentials` would ask, without writing anything.

    Reads the saved answers, the profile (YAML answers included) and any valid
    reply already written on a question row, all in memory.
    """
    answers: dict[str, Any] = {}
    raw = profile.get("application_answers") if isinstance(profile, Mapping) else None
    if isinstance(raw, Mapping):
        answers.update({normalise_label(str(k)): v for k, v in raw.items()})
    elif isinstance(raw, list):
        answers.update({
            normalise_label(str(i["question"])): i.get("answer")
            for i in raw if isinstance(i, Mapping) and i.get("question")
        })
    if _table_exists(conn, "application_answers"):
        for key, answer_json in conn.execute("SELECT key, answer_json FROM application_answers"):
            try:
                answers[str(key)] = json.loads(answer_json)
            except (TypeError, ValueError):
                continue
    asked: set[str] = set()
    if _table_exists(conn, "pending_user_messages"):
        for source_id, payload_text, reply in conn.execute(
            "SELECT source_id, source_payload, user_reply FROM pending_user_messages "
            "WHERE source_id LIKE 'closer-essential:%'"
        ):
            asked.add(str(source_id))
            if reply is None:
                continue
            try:
                payload = json.loads(payload_text or "")
                field_type, options = payload_shape(payload)
                validate_reply(field_type, options, reply)
            except (ValueError, AnswerRejected):
                continue
            answers.setdefault(normalise_label(payload["key"]), decode_reply(field_type, reply))
    missing = missing_essentials(answers, profile)
    return {
        "status": "complete" if not missing else "missing",
        "missing": [fact.key for fact in missing],
        "already_asked": [fact.key for fact in missing if essential_source_id(fact) in asked],
    }


def ensure_essentials(
    conn: sqlite3.Connection,
    profile: Mapping[str, Any],
    position_id: int,
    *,
    notifier: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Ask each missing essential fact once; report what is still missing."""
    harvest_replies(conn)
    answers = answers_with_profile(conn, profile)
    missing = missing_essentials(answers, profile)
    asked: list[str] = []
    waiting: list[str] = []
    for fact in missing:
        source_id = essential_source_id(fact)
        existing = conn.execute(
            "SELECT id FROM pending_user_messages WHERE source_id = ?", (source_id,)
        ).fetchone()
        if existing:
            waiting.append(fact.key)
            continue
        payload = {
            "version": 1,
            "position_id": int(position_id),
            "key": fact.key,
            "label": fact.label,
            "field_type": fact.field_type,
            "options": list(fact.options),
        }
        (notifier or _default_notifier)(
            position_id=int(position_id),
            message=essential_message(fact),
            source_id=source_id,
            payload=payload,
        )
        asked.append(fact.key)
    conn.commit()
    return {
        "status": "complete" if not missing else "waiting",
        "missing": [fact.key for fact in missing],
        "asked": asked,
        "already_asked": waiting,
    }


# ── Waking the CLOSER once the user has answered ─────────────────────────────


CLOSER_SESSION_PREFIX = "CLOSER-"


@dataclass(frozen=True)
class Wake:
    key: str
    position_id: int | None
    reason: str  # answers_complete · essentials_complete


def pending_wakes(conn: sqlite3.Connection, profile: Mapping[str, Any]) -> list[Wake]:
    """What the user's answers have unblocked since the last wake-up.

    - a position whose CLOSER form questions are all answered (none open);
    - the essential facts, once every one that was asked is known.

    The key names the last answered question, so several answers arriving
    together make one wake-up, and a later question answered later makes a
    new one. Channel-blind: a dashboard reply and a Telegram reply land on the
    same question rows, so there is one path for both.
    """
    if not _table_exists(conn, "pending_user_messages"):
        return []
    wakes: list[Wake] = []
    rows = conn.execute(
        "SELECT related_position_id, "
        "SUM(CASE WHEN user_reply IS NULL THEN 1 ELSE 0 END), "
        "MAX(CASE WHEN user_reply IS NOT NULL THEN id END) "
        "FROM pending_user_messages "
        "WHERE agent = 'closer' AND kind = 'question' AND source_action = ? "
        "AND related_position_id IS NOT NULL AND source_id NOT LIKE 'closer-essential:%' "
        "GROUP BY related_position_id",
        (SOURCE_ACTION,),
    ).fetchall()
    for position_id, still_open, last_answered in rows:
        if still_open == 0 and last_answered is not None:
            wakes.append(Wake(f"answers:{int(position_id)}:{int(last_answered)}", int(position_id), "answers_complete"))
    essential = conn.execute(
        "SELECT MAX(CASE WHEN user_reply IS NOT NULL THEN id END), COUNT(*) FROM pending_user_messages "
        "WHERE source_id LIKE 'closer-essential:%'"
    ).fetchone()
    if essential and essential[1] and essential[0] is not None:
        if check_essentials(conn, profile)["status"] == "complete":
            wakes.append(Wake(f"essentials:{int(essential[0])}", None, "essentials_complete"))
    if not wakes or not _table_exists(conn, "closer_wakes"):
        return wakes
    done = {row[0] for row in conn.execute("SELECT wake_key FROM closer_wakes")}
    return [wake for wake in wakes if wake.key not in done]


def _closer_sessions() -> list[str]:
    try:
        result = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=5, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return [name for name in result.stdout.split() if name.startswith(CLOSER_SESSION_PREFIX)]


def _tmux_send(session: str, text: str) -> bool:
    try:
        return subprocess.run(
            ["jht-tmux-send", session, text], capture_output=True, text=True, timeout=20, check=False
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def wake_message(wake: Wake) -> str:
    if wake.reason == "essentials_complete":
        what = "the user answered the essential application facts"
    else:
        what = f"the user answered the CLOSER questions for position #{wake.position_id}"
    return (
        f"[BRIDGE INFO] {what}; the answers are saved in jobs.db. "
        "Re-read the queue (apply_gate.py queue) and continue: what was waiting for these answers can run now."
    )


def wake_closer(
    conn: sqlite3.Connection,
    profile: Mapping[str, Any],
    *,
    sessions: Callable[[], list[str]] | None = None,
    sender: Callable[[str, str], bool] | None = None,
    queue: Callable[[sqlite3.Connection], Mapping[str, Any]] | None = None,
) -> list[Wake]:
    """Wake a live CLOSER once per unblocked position; claim the key first.

    The key is committed BEFORE the message: two bridges, or a replay, cannot
    both send it. If no CLOSER is alive nothing is sent — the queue already
    shows the position ready, which is what the Capitano's spawn rule reads.
    """
    import _db

    _db._migrate_closer_wakes(conn)
    sent: list[Wake] = []
    wakes = pending_wakes(conn, profile)
    ready: set[int] = set()
    if wakes:
        # Only what can actually run now is announced: answers to a position
        # that has since been sent or withdrawn claim their key in silence.
        current = (queue or (lambda c: apply_gate.application_queue(conn=c)))(conn)
        if current.get("ready"):
            ready = {int(item["position_id"]) for item in current.get("positions") or []}
    for wake in wakes:
        claimed = conn.execute(
            "INSERT OR IGNORE INTO closer_wakes (wake_key, position_id) VALUES (?, ?)",
            (wake.key, wake.position_id),
        ).rowcount
        conn.commit()
        if claimed != 1:
            continue
        if not ready or (wake.position_id is not None and wake.position_id not in ready):
            continue
        live = (sessions or _closer_sessions)()
        delivered = False
        for session in live:
            delivered = (sender or _tmux_send)(session, wake_message(wake)) or delivered
        if delivered:
            conn.execute("UPDATE closer_wakes SET delivered = 1 WHERE wake_key = ?", (wake.key,))
            conn.commit()
            sent.append(wake)
    return sent


# ── CLI ──────────────────────────────────────────────────────────────────────


def _connect(db: str | None) -> sqlite3.Connection:
    import _db

    path = db or os.environ.get("JHT_DB") or str(Path(os.environ.get("JHT_HOME") or Path.home() / ".jht") / "jobs.db")
    if not Path(path).is_file():
        raise FileNotFoundError("jobs.db not found")
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    return conn


def _connect_read_only(db: str | None) -> sqlite3.Connection:
    path = db or os.environ.get("JHT_DB") or str(Path(os.environ.get("JHT_HOME") or Path.home() / ".jht") / "jobs.db")
    if not Path(path).is_file():
        raise FileNotFoundError("jobs.db not found")
    # mode=ro: a check cannot write, even by mistake (no migration, no question).
    return sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, timeout=10)


def _load_profile(path: Path) -> Mapping[str, Any]:
    import yaml

    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return value if isinstance(value, Mapping) else {}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Essential facts and remembered application answers.")
    sub = parser.add_subparsers(dest="command", required=True)
    ess = sub.add_parser("essentials", help="ask each missing essential fact once")
    ess.add_argument("--position-id", type=int, required=True)
    ess.add_argument("--ask", action="store_true", help="send one question per missing fact")
    lst = sub.add_parser("list", help="the remembered answers (keys and channels only)")
    for p in (ess, lst):
        p.add_argument("--json", action="store_true")
        p.add_argument("--db")
        p.add_argument("--profile")
    args = parser.parse_args(argv)
    home = Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")
    profile_path = Path(args.profile) if args.profile else home / "profile" / "candidate_profile.yml"
    try:
        if args.command == "essentials" and not args.ask:
            conn = _connect_read_only(args.db)
        else:
            conn = _connect(args.db)
        try:
            profile = _load_profile(profile_path)
            if args.command == "essentials":
                if args.ask:
                    out = ensure_essentials(conn, profile, args.position_id)
                else:
                    out = check_essentials(conn, profile)
                code = 0 if out["status"] == "complete" else 3
            else:
                ensure_table(conn)
                rows = conn.execute(
                    "SELECT key, field_type, channel, answered_at FROM application_answers ORDER BY key"
                ).fetchall()
                out = {"status": "listed", "answers": [
                    {"key": r[0], "field_type": r[1], "channel": r[2], "answered_at": r[3]} for r in rows
                ]}
                code = 0
        finally:
            conn.close()
    except Exception as exc:  # one JSON line, never a traceback to the agent
        out = {"status": "error", "reason": type(exc).__name__, "detail": str(exc)[:300]}
        code = 2
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
    return code


if __name__ == "__main__":
    sys.exit(main())
