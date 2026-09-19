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
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apply_gate  # noqa: E402

SOURCE_ACTION = "closer_application_answer"
TELEGRAM_ORIGIN = "user_telegram"
INFERRED_CHANNEL = "agent_inferred"
INFERENCE_BASES = ("profile", "cv", "vacancy", "judgement")
# What the CLOSER works out per company: a motivation is written for one
# company, a salary expectation is judged against one position.
COMPANY_SCOPED_KEYS = frozenset({"salary expectations"})
# The Message of a company contact form the vacancy's Apply led to: a letter
# that names THIS vacancy, so it belongs to the position, never the company.
CONTACT_LETTER_PURPOSE = "contact_form_application"
TEXT_FIELD_TYPES = frozenset({"textarea", "text", "email", "tel", "url", "number", "date"})
# Only these may be answered by a bare message: the exact-option rule filters
# out ordinary chat. A free-text question needs a reply or its code.
CHOICE_FIELD_TYPES = frozenset({"radio", "select", "checkbox", "checkboxes"})
# A normalised label never contains "@": a scoped key cannot collide with a global one.
_SCOPE_SEP = " @ "
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


def position_company(conn: sqlite3.Connection, position_id: int | None) -> str:
    """The scope of a company-specific answer: the normalised company name."""
    if position_id is None:
        return ""
    try:
        found = conn.execute("SELECT company FROM positions WHERE id = ?", (int(position_id),)).fetchone()
    except (sqlite3.Error, TypeError, ValueError):
        found = None
    company = normalise_label(found[0]) if found and found[0] else ""
    return company or normalise_label(f"position {position_id}")


def position_scope(position_id: int) -> str:
    """The scope of an answer that belongs to one position only."""
    return normalise_label(f"jht position {int(position_id)}")


def answer_scope(
    conn: sqlite3.Connection,
    field_type: str,
    position_id: int | None,
    *,
    essential: bool = False,
    purpose: str = "",
) -> str:
    """Facts are global; a textarea (motivation, "why us", cover) belongs to one company.

    A motivation written for one company must never be pasted into another
    company's form: there the question is asked again. A contact-form letter
    (`purpose` contact_form_application) names its vacancy: it belongs to the
    position, so a second vacancy of the same company gets its own.
    """
    if purpose == CONTACT_LETTER_PURPOSE and position_id is not None and not essential:
        return position_scope(position_id)
    if field_type != "textarea" or essential:
        return ""
    return position_company(conn, position_id)


def _read_entries(conn: sqlite3.Connection, position_id: int | None) -> dict[str, tuple[Any, str]]:
    """{key: (value, channel)} as a form of `position_id` sees them.

    A company answer wins over a global one, except that something the CLOSER
    worked out never wins over what the user said.
    """
    if not _table_exists(conn, "application_answers"):
        return {}
    company = position_company(conn, position_id) if position_id is not None else ""
    own = position_scope(position_id) if position_id is not None else ""
    entries: dict[str, tuple[Any, str]] = {}
    scoped: dict[str, tuple[Any, str]] = {}
    positioned: dict[str, tuple[Any, str]] = {}
    essential_keys = {fact.key for fact in ESSENTIAL_FACTS}
    for key, answer_json, field_type, channel in conn.execute(
        "SELECT key, answer_json, field_type, channel FROM application_answers"
    ).fetchall():
        try:
            value = json.loads(answer_json)
        except (TypeError, ValueError):
            continue
        base, sep, scope = str(key).partition(_SCOPE_SEP)
        if not sep:
            if field_type == "textarea" and channel != "profile_yaml" and base not in essential_keys:
                # Saved before answers were kept per company: whose company it
                # was is unknown, so it is never pasted into anyone's form.
                continue
            entries[base] = (value, str(channel))
        elif own and scope == own:
            positioned[base] = (value, str(channel))
        elif company and scope == company:
            scoped[base] = (value, str(channel))
    for layer in (scoped, positioned):  # the position's own answer wins last
        for base, entry in layer.items():
            current = entries.get(base)
            if current and entry[1] == INFERRED_CHANNEL and current[1] != INFERRED_CHANNEL:
                continue
            entries[base] = entry
    return entries


def _read_answers(conn: sqlite3.Connection, position_id: int | None) -> dict[str, Any]:
    return {key: value for key, (value, _channel) in _read_entries(conn, position_id).items()}


def answer_origins(conn: sqlite3.Connection, position_id: int | None = None) -> dict[str, str]:
    """{key: user · profile · agent_inferred} for the answers `load_answers` returns. Never values."""
    origin = {INFERRED_CHANNEL: "agent_inferred", "profile_yaml": "profile"}
    return {key: origin.get(channel, "user") for key, (_value, channel) in _read_entries(conn, position_id).items()}


def load_answers(conn: sqlite3.Connection, position_id: int | None = None) -> dict[str, Any]:
    """Every global answer, plus the company answers of `position_id`'s company."""
    ensure_table(conn)
    return _read_answers(conn, position_id)


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
    scope: str = "",
    basis: str = "",
) -> bool:
    """Save one answer; False when an answer the CLOSER worked out met the user's own."""
    if not key or key != normalise_label(key):
        raise ValueError("answer key is not canonical")
    if scope != normalise_label(scope):
        raise ValueError("answer scope is not canonical")
    key = f"{key}{_SCOPE_SEP}{scope}" if scope else key
    ensure_table(conn)
    # The user's answer always replaces one the CLOSER worked out; the reverse never happens.
    return conn.execute(
        "INSERT INTO application_answers "
        "(key, label, answer_json, field_type, options_json, channel, source_message_id, answered_at, basis) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET label = excluded.label, answer_json = excluded.answer_json, "
        "field_type = excluded.field_type, options_json = excluded.options_json, "
        "channel = excluded.channel, source_message_id = excluded.source_message_id, "
        "answered_at = excluded.answered_at, basis = excluded.basis "
        "WHERE excluded.channel != ? OR application_answers.channel = ?",
        (
            key,
            label,
            json.dumps(answer, ensure_ascii=False),
            field_type,
            json.dumps(list(options), ensure_ascii=False),
            channel,
            message_id,
            _utc_now(),
            basis,
            INFERRED_CHANNEL,
            INFERRED_CHANNEL,
        ),
    ).rowcount == 1


class InferenceRejected(ValueError):
    pass


def save_inferred(
    conn: sqlite3.Connection,
    *,
    key: str,
    value: str,
    field_type: str,
    options: Sequence[str] = (),
    basis: str,
    position_id: int | None = None,
    label: str = "",
    purpose: str = "",
) -> dict[str, Any]:
    """An answer the CLOSER worked out from profile, CV or vacancy, checked like a user's reply.

    `purpose` comes from the flow's `pending_question`; when not given, the
    position's checkpoint question with the same key supplies it, so a
    contact-form letter is kept per position even if the flag is forgotten.
    """
    canonical = normalise_label(key)
    if not canonical:
        raise InferenceRejected("key_empty")
    if basis not in INFERENCE_BASES:
        raise InferenceRejected("basis_invalid")
    options = list(options)
    try:
        payload_shape({"version": 1, "key": canonical, "label": label or key,
                       "field_type": field_type, "options": options})
        reply = telegram_reply_text(field_type, str(value))
        if not reply or len(reply) > MAX_ANSWER_CHARS:
            raise AnswerRejected("closer_answer_empty")
        validate_reply(field_type, options, reply)
    except AnswerRejected as exc:
        raise InferenceRejected(exc.reason) from None
    essential = canonical in {fact.key for fact in ESSENTIAL_FACTS}
    if not purpose and position_id is not None:
        purpose = _checkpoint_purpose(position_id, canonical)
    position_scoped = purpose == CONTACT_LETTER_PURPOSE and not essential
    company_scoped = canonical in COMPANY_SCOPED_KEYS or (field_type == "textarea" and not essential)
    if (company_scoped or position_scoped) and position_id is None:
        raise InferenceRejected("position_id_required")
    if position_scoped:
        scope = position_scope(position_id)
    else:
        scope = position_company(conn, position_id) if company_scoped else ""
    ensure_table(conn)
    saved = save_answer(
        conn,
        key=canonical,
        label=label or key,
        answer=decode_reply(field_type, reply),
        field_type=field_type,
        options=options,
        channel=INFERRED_CHANNEL,
        scope=scope,
        basis=basis,
    )
    conn.commit()
    return {"status": "saved" if saved else "user_answer_kept", "key": canonical,
            "scope": "position" if position_scoped else ("company" if scope else "global"), "basis": basis}


def _checkpoint_purpose(position_id: int, key: str) -> str:
    """The purpose of the flow's open question with this key, or ""."""
    try:
        data = json.loads(apply_gate.checkpoint_path(int(position_id)).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return ""
    request = data.get("answer_request") if isinstance(data, dict) else None
    payload = request.get("payload") if isinstance(request, dict) else None
    if not isinstance(payload, dict) or normalise_label(str(payload.get("key") or "")) != key:
        return ""
    purpose = payload.get("purpose")
    return purpose if isinstance(purpose, str) else ""


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
        # Once in; only an answer the CLOSER worked out gives way to the profile.
        imported += conn.execute(
            "INSERT INTO application_answers "
            "(key, label, answer_json, field_type, options_json, channel, answered_at) "
            "VALUES (?, ?, ?, 'profile', '[]', 'profile_yaml', ?) "
            "ON CONFLICT(key) DO UPDATE SET label = excluded.label, answer_json = excluded.answer_json, "
            "field_type = excluded.field_type, options_json = excluded.options_json, channel = excluded.channel, "
            "source_message_id = NULL, answered_at = excluded.answered_at, basis = '' "
            "WHERE application_answers.channel = ?",
            (key, label, json.dumps(answer, ensure_ascii=False), _utc_now(), INFERRED_CHANNEL),
        ).rowcount
    return imported


def _profile_answers(profile: Mapping[str, Any]) -> dict[str, Any]:
    raw = profile.get("application_answers") if isinstance(profile, Mapping) else None
    if isinstance(raw, Mapping):
        return {normalise_label(str(k)): v for k, v in raw.items()}
    if isinstance(raw, list):
        return {
            normalise_label(str(i["question"])): i.get("answer")
            for i in raw if isinstance(i, Mapping) and i.get("question")
        }
    return {}


def answers_with_profile(
    conn: sqlite3.Connection, profile: Mapping[str, Any], position_id: int | None = None
) -> dict[str, Any]:
    """YAML answers imported, then every answer keyed by its normalised label."""
    import_profile_answers(conn, profile)
    conn.commit()
    return load_answers(conn, position_id)


def read_answers(
    conn: sqlite3.Connection, profile: Mapping[str, Any], position_id: int | None = None
) -> dict[str, Any]:
    """What `answers_with_profile` returns, without writing: for previews and checks."""
    answers = {k: v for k, v in _profile_answers(profile).items() if k and v is not None}
    answers.update(_read_answers(conn, position_id))
    return answers


# ── Answers arriving on the question rows ────────────────────────────────────


def harvest_replies(conn: sqlite3.Connection) -> int:
    """Save every validated reply to a CLOSER question, whatever channel wrote it.

    The dashboard writes only the reply on the question row; this is what
    turns it into a remembered answer without waiting for a checkpoint resume.
    """
    ensure_table(conn)
    rows = conn.execute(
        "SELECT id, source_payload, user_reply, source_id, related_position_id FROM pending_user_messages "
        "WHERE agent = 'closer' AND kind = 'question' AND source_action = ? "
        "AND user_reply IS NOT NULL AND user_reply_at IS NOT NULL",
        (SOURCE_ACTION,),
    ).fetchall()
    saved = 0
    for message_id, payload_text, reply, source_id, position_id in rows:
        try:
            payload = json.loads(payload_text or "")
            field_type, options = payload_shape(payload)
            validate_reply(field_type, options, reply)
        except (ValueError, AnswerRejected):
            continue
        key = normalise_label(payload["key"])
        scope = answer_scope(
            conn, field_type, position_id, essential=str(source_id).startswith("closer-essential:"),
            purpose=str(payload.get("purpose") or ""),
        )
        existing = conn.execute(
            "SELECT source_message_id FROM application_answers WHERE key = ?",
            (f"{key}{_SCOPE_SEP}{scope}" if scope else key,),
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
            scope=scope,
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
    status: str  # not_an_answer · ambiguous · already_answered · unknown_code · rejected · resolved
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


# ── The LinkedIn verification code (HQ-BACKEND-2's linkedin_apply) ───────────
#
# Not an answer to a form: never saved, never an authorisation. The code never
# touches jobs.db either — pending_user_messages is pushed to the cloud on every
# tick — so it goes to a local 0600 file the flow reads and deletes; the row
# only says '[received]'. The chat history and the ASSISTENTE see a mask.

LOGIN_CODE_ACTION = "closer_login_code"
LOGIN_CODE_MASK = "[verification code]"
LOGIN_CODE_RECENT = timedelta(hours=1)
_LOGIN_GROUP = re.compile(r"(?<![A-Za-z0-9])\d(?:[ -]?\d)*(?![A-Za-z0-9])")
_LOGIN_WHOLE = re.compile(r"\s*\d(?:[ -]?\d)*\s*")
# `code_format: alnum8` (Greenhouse's emailed code): exactly eight letters or
# digits, case kept, a space or dash between characters tolerated.
ALNUM8 = "alnum8"
_ALNUM8_WHOLE = re.compile(r"\s*[A-Za-z0-9](?:[ -]?[A-Za-z0-9]){7}\s*")
_ALNUM8_TOKEN = re.compile(r"[A-Za-z0-9]{8}")

@dataclass(frozen=True)
class LoginCodeOutcome:
    status: str  # received · expired · closed · ambiguous
    source_id: str = ""


def login_code_path(source_id: str, jht_home: Path | None = None) -> Path:
    home = jht_home or Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")
    digest = hashlib.sha256(str(source_id).encode("utf-8")).hexdigest()[:32]
    return home / ".cache" / "apply-flow" / "login-code" / f"{digest}.json"


def _login_digits(text: str) -> list[str]:
    groups = [re.sub(r"\D", "", group) for group in _LOGIN_GROUP.findall(str(text))]
    return [group for group in groups if 4 <= len(group) <= 8]


def _word_like(token: str) -> bool:
    """An ordinary word ("received", "Perfetto"), not a code someone typed."""
    return token.isalpha() and (token.islower() or token.istitle())


def _alnum8_codes(text: str, *, alone: bool) -> list[str]:
    """Eight-character codes in `text`. A message that is only the code is taken
    even when it reads like a word if `alone` (a reply to the request)."""
    text = str(text)
    if _ALNUM8_WHOLE.fullmatch(text):
        code = re.sub(r"[\s-]", "", text)
        return [code] if alone or not _word_like(code) else []
    tokens = (token.strip(".,;:!?()[]{}\"'").replace("-", "") for token in text.split())
    return [t for t in tokens if _ALNUM8_TOKEN.fullmatch(t) and not _word_like(t)]


def _codes_in(text: str, code_format: str, *, alone: bool) -> list[str]:
    return _alnum8_codes(text, alone=alone) if code_format == ALNUM8 else _login_digits(text)


def _whole_code(text: str, code_format: str) -> str | None:
    """The code when the message is nothing but a code of this format."""
    if code_format == ALNUM8:
        codes = _alnum8_codes(text, alone=False) if _ALNUM8_WHOLE.fullmatch(str(text)) else []
    else:
        codes = _login_digits(text) if _LOGIN_WHOLE.fullmatch(str(text)) else []
    return codes[0] if len(codes) == 1 else None


def _login_rows(conn: sqlite3.Connection, now: datetime) -> list[tuple[int, str, bool, str]]:
    """Recent login code requests: (id, source_id, open, code_format)."""
    columns = {column[1] for column in conn.execute("PRAGMA table_info(pending_user_messages)")}
    if not {"source_id", "source_action", "source_payload"} <= columns:
        return []  # a legacy table has no login request
    rows = []
    for row_id, source_id, payload_text, reply, created in conn.execute(
        "SELECT id, source_id, source_payload, user_reply, created_at FROM pending_user_messages "
        "WHERE agent = 'closer' AND source_action = ? AND source_id IS NOT NULL ORDER BY id",
        (LOGIN_CODE_ACTION,),
    ):
        try:
            payload = json.loads(payload_text or "")
            expires = apply_gate._parse_instant(payload.get("expires_at")) if isinstance(payload, dict) else None
        except ValueError:
            payload, expires = None, None
        code_format = ALNUM8 if isinstance(payload, dict) and payload.get("code_format") == ALNUM8 else "digits"
        at = apply_gate._parse_instant(created)
        if at is not None and now - at > LOGIN_CODE_RECENT and (expires is None or expires < now - LOGIN_CODE_RECENT):
            continue
        is_open = reply is None and expires is not None and now < expires
        rows.append((int(row_id), str(source_id), is_open, code_format))
    return rows


def _login_target(conn: sqlite3.Connection, text: str, reply_to_text: str | None, direct: bool, now: datetime):
    """(row or None, digits or None, named, recent): which login request this message is for.

    `recent` says the message looks like a code while a login request is about:
    such a message is masked even when it cannot be matched.
    """
    rows = _login_rows(conn, now)
    if not rows:
        return None, None, False, False
    quoted = {code.upper() for code in _CODE.findall(f"{reply_to_text or ''}\n{text}")}
    named = [row for row in rows if answer_code(row[1]) in quoted]
    if named:
        # Addressed to the request: masked whatever it holds (a code split in
        # halves, a half-typed one), taken only with exactly one code.
        row = named[-1]
        codes = _codes_in(_CODE.sub(" ", str(text)), row[3], alone=True)
        return row, (codes[0] if len(codes) == 1 else None), True, True
    if not direct:
        return None, None, False, False
    matches = [(row, code) for row in rows if (code := _whole_code(str(text), row[3]))]
    if not matches:
        return None, None, False, False
    open_matches = [match for match in matches if match[0][2]]
    if len(open_matches) == 1:
        return open_matches[0][0], open_matches[0][1], False, True
    if not open_matches:
        return matches[-1][0], matches[-1][1], False, True
    return None, open_matches[0][1], False, True


def login_code_candidate(conn: sqlite3.Connection, *, text: str, reply_to_text: str | None, direct: bool) -> bool:
    """Must this message be masked as a verification code? Read only; decided before it is journaled."""
    return _login_target(conn, text, reply_to_text, direct, datetime.now(timezone.utc))[3]


def resolve_login_code(
    conn: sqlite3.Connection,
    *,
    text: str,
    reply_to_text: str | None,
    direct: bool,
    jht_home: Path | None = None,
) -> LoginCodeOutcome:
    """Hand the code to the flow waiting for it: a 0600 file, and '[received]' on the row.

    The caller commits. A direct message is the code only when it is nothing but
    the code, one login request is open and no form question is.
    """
    now = datetime.now(timezone.utc)
    row, digits, named, _recent = _login_target(conn, text, reply_to_text, direct, now)
    if row is None or not digits:
        return LoginCodeOutcome("ambiguous")
    row_id, source_id, is_open, _format = row
    if not named and _open_requests(conn):
        return LoginCodeOutcome("ambiguous", source_id)
    if not is_open:
        reply = conn.execute("SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)).fetchone()
        return LoginCodeOutcome("closed" if reply and reply[0] is not None and reply[0] != "[expired]" else "expired", source_id)
    path = login_code_path(source_id, jht_home)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"source_id": source_id, "code": digits, "received_at": now.isoformat()}, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise
    changed = conn.execute(
        "UPDATE pending_user_messages SET user_reply = '[received]', user_reply_at = ? "
        "WHERE id = ? AND user_reply IS NULL",
        (now.strftime("%Y-%m-%d %H:%M:%S"), row_id),
    ).rowcount
    if changed != 1:
        with contextlib.suppress(OSError):
            path.unlink()
        return LoginCodeOutcome("closed", source_id)
    return LoginCodeOutcome("received", source_id)


def _question_line(body: str) -> str:
    for line in str(body).splitlines():
        if line.startswith("Question: "):
            return line
    return ""


def _closed_codes(conn: sqlite3.Connection, codes: set[str]) -> set[str]:
    """Which of `codes` belong to an answered question. Read only when a code was written."""
    if not codes:
        return set()
    return {
        code
        for (source_id,) in conn.execute(
            "SELECT source_id FROM pending_user_messages "
            "WHERE agent = 'closer' AND kind = 'question' AND source_action = ? AND user_reply IS NOT NULL",
            (SOURCE_ACTION,),
        )
        if (code := answer_code(source_id)) in codes
    }


def _code_miss(conn: sqlite3.Connection, codes: set[str]) -> str:
    return "already_answered" if _closed_codes(conn, codes) else "unknown_code"


def _field_type(payload_text: Any) -> str:
    try:
        return payload_shape(json.loads(payload_text or ""))[0]
    except (ValueError, AnswerRejected):
        return ""


def _pick_target(
    conn: sqlite3.Connection, open_rows: list[tuple], text: str, reply_to_text: str | None, *, direct: bool
):
    """(row, answer text, why not, how it was matched: reply · code · direct)."""
    by_code: dict[str, list[tuple]] = {}
    for row in open_rows:
        by_code.setdefault(answer_code(row[2]), []).append(row)

    if reply_to_text:
        codes = {c.upper() for c in _CODE.findall(reply_to_text)}
        if codes:
            # The quoted message names its question: that one or nothing. A
            # code that is no longer open never falls back to another question.
            matched = [r for c in codes for r in by_code.get(c, [])]
            if len(matched) == 1:
                return matched[0], text, "", "reply"
            return None, text, "ambiguous" if matched else _code_miss(conn, codes), "reply"
        # A question sent before codes existed: its whole Question line identifies it.
        lines = {line.strip() for line in reply_to_text.splitlines()}
        matched = [r for r in open_rows if _question_line(r[1]) and _question_line(r[1]).strip() in lines]
        if len(matched) == 1:
            return matched[0], text, "", "reply"
        return None, text, "ambiguous" if matched else "not_an_answer", "reply"

    found = _CODE.search(text)
    if found:
        code = found.group(1).upper()
        matched = by_code.get(code, [])
        if len(matched) == 1:
            remainder = (text[: found.start()] + text[found.end():]).strip(" \t:-—\n")
            return matched[0], remainder, "", "code"
        return None, text, "ambiguous" if matched else _code_miss(conn, {code}), "code"

    if (
        direct
        and len(open_rows) == 1
        and open_rows[0][5] == "telegram"
        and _field_type(open_rows[0][3]) in CHOICE_FIELD_TYPES
    ):
        return open_rows[0], text, "", "direct"
    return None, text, "ambiguous" if len(open_rows) > 1 else "not_an_answer", ""


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
    if not open_rows and not (_CODE.search(text) or (reply_to_text and _CODE.search(reply_to_text))):
        return Resolution("not_an_answer")
    row, answer_text, why, via = _pick_target(conn, open_rows, text, reply_to_text, direct=direct)
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
        if via == "direct":
            # A bare message that is not one of the options is chat, not a wrong answer.
            return Resolution("not_an_answer")
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
    # An answer renews an authorisation that is on; it never turns a withdrawn
    # one back on. The answer is still kept for the next time the user asks.
    flag = conn.execute("SELECT apply_requested FROM positions WHERE id = ?", (position_id,)).fetchone()
    withdrawn = not (flag and flag[0] == 1)
    if verdict.allowed and not withdrawn:
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
        scope=answer_scope(conn, field_type, position_id, essential=essential,
                           purpose=str(payload.get("purpose") or "")),
    )
    reason = "position_withdrawn" if withdrawn and not essential else ""
    return Resolution("resolved", reason, message_id, position_id, body)


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


# An essential question that stays unanswered stops holding the queue after a
# day, is asked once more, and after the second day the flow goes on without
# it: a form that really needs the fact asks for it on its own position.
ESSENTIAL_QUESTION_TTL = timedelta(hours=24)
ESSENTIAL_ROUNDS = 2


def essential_source_id(fact: EssentialFact, round_no: int = 1) -> str:
    base = "closer-essential:" + fact.key.replace(" ", "_")
    return base if round_no == 1 else f"{base}:{round_no}"


def _essential_state(conn: sqlite3.Connection, fact: EssentialFact, now: datetime) -> tuple[str, int]:
    """For a fact still unknown: unasked · waiting · expired · given_up, and a round.

    `expired` carries the round to ask next. A creation time that cannot be
    read counts as expired: a question must never hold the queue for ever.
    """
    if not _table_exists(conn, "pending_user_messages"):
        return "unasked", 1
    ids = [essential_source_id(fact, n) for n in range(1, ESSENTIAL_ROUNDS + 1)]
    created = dict(conn.execute(
        f"SELECT source_id, MIN(created_at) FROM pending_user_messages "
        f"WHERE source_id IN ({','.join('?' * len(ids))}) GROUP BY source_id",
        ids,
    ).fetchall())
    asked = [n for n, sid in enumerate(ids, start=1) if sid in created]
    if not asked:
        return "unasked", 1
    latest = max(asked)
    at = apply_gate._parse_instant(created[ids[latest - 1]])
    if at is not None and now - at < ESSENTIAL_QUESTION_TTL:
        return "waiting", latest
    if latest < ESSENTIAL_ROUNDS:
        return "expired", latest + 1
    return "given_up", latest


def _asked_explicitly(conn: sqlite3.Connection, fact: EssentialFact, round_no: int) -> bool:
    row = conn.execute(
        "SELECT source_payload FROM pending_user_messages WHERE source_id = ? ORDER BY id LIMIT 1",
        (essential_source_id(fact, round_no),),
    ).fetchone()
    try:
        payload = json.loads((row[0] if row else "") or "")
    except ValueError:
        return False
    return isinstance(payload, dict) and payload.get("explicit") is True


def essential_message(fact: EssentialFact, round_no: int = 1) -> str:
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
        f"{telegram_hint(essential_source_id(fact, round_no))}"
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


def check_essentials(
    conn: sqlite3.Connection, profile: Mapping[str, Any], position_id: int | None = None
) -> dict[str, Any]:
    """What `ensure_essentials` would ask, without writing anything.

    Reads the saved answers, the profile (YAML answers included) and any valid
    reply already written on a question row, all in memory.
    """
    answers = _profile_answers(profile)
    answers.update(_read_answers(conn, position_id))
    now = datetime.now(timezone.utc)
    if _table_exists(conn, "pending_user_messages"):
        for payload_text, reply in conn.execute(
            "SELECT source_payload, user_reply FROM pending_user_messages "
            "WHERE source_id LIKE 'closer-essential:%'"
        ):
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
    states = {fact.key: _essential_state(conn, fact, now) for fact in missing}
    return {
        "status": "complete" if not missing else "missing",
        "missing": [fact.key for fact in missing],
        # Asked explicitly and still inside its day: only these hold the queue.
        # A question sent before the CLOSER worked answers out by itself was not
        # its choice, and must not stop it from working the fact out.
        "already_asked": [
            fact.key for fact in missing
            if states[fact.key][0] == "waiting" and _asked_explicitly(conn, fact, states[fact.key][1])
        ],
        "expired": [key for key, (state, _) in states.items() if state == "expired"],
        "given_up": [key for key, (state, _) in states.items() if state == "given_up"],
    }


def ensure_essentials(
    conn: sqlite3.Connection,
    profile: Mapping[str, Any],
    position_id: int,
    *,
    ask: Sequence[str] = (),
    notifier: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Report the essential facts still unknown; ask the user ONLY the keys in `ask`.

    Nothing goes to the user by itself: the CLOSER first works each fact out
    from profile, CV and vacancy (`save`), and asks only what has no basis.
    `missing` is what the flow waits for: unknown and not given up. A fact
    asked twice and never answered is `given_up` and no longer blocks.
    """
    harvest_replies(conn)
    answers = answers_with_profile(conn, profile, position_id)
    wanted = {normalise_label(key) for key in ask}
    known_keys = {fact.key for fact in ESSENTIAL_FACTS}
    now = datetime.now(timezone.utc)
    asked: list[str] = []
    waiting: list[str] = []
    given_up: list[str] = []
    missing: list[str] = []
    for fact in missing_essentials(answers, profile):
        state, round_no = _essential_state(conn, fact, now)
        if state == "given_up":
            given_up.append(fact.key)
            continue
        missing.append(fact.key)
        if state == "waiting":
            waiting.append(fact.key)
            continue
        if fact.key not in wanted:
            continue
        payload = {
            "version": 1,
            "position_id": int(position_id),
            "key": fact.key,
            "label": fact.label,
            "field_type": fact.field_type,
            "options": list(fact.options),
            # Only the CLOSER's explicit ask sends it; the queue holds on this mark.
            "explicit": True,
        }
        (notifier or _default_notifier)(
            position_id=int(position_id),
            message=essential_message(fact, round_no),
            source_id=essential_source_id(fact, round_no),
            payload=payload,
        )
        asked.append(fact.key)
    conn.commit()
    return {
        "status": "complete" if not missing else "missing",
        "missing": missing,
        "asked": asked,
        "already_asked": waiting,
        "given_up": given_up,
        "not_essential": sorted(wanted - known_keys),
        "not_missing": sorted((wanted & known_keys) - set(missing) - set(given_up)),
    }


# ── Waking the CLOSER once the user has answered ─────────────────────────────


CLOSER_SESSION_PREFIX = "CLOSER-"


@dataclass(frozen=True)
class Wake:
    key: str
    position_id: int | None
    reason: str  # answers_complete · essentials_complete


def wake_candidates(conn: sqlite3.Connection) -> list[Wake]:
    """Answers not yet announced, from jobs.db alone: the cheap check of every poll.

    - a position still authorised whose CLOSER form questions are all answered;
    - the essential facts, once one of them has a new answer;
    - a position the user has just authorised (in the last
      `AUTHORISATION_WAKE_WINDOW`), keyed by its authorisation instant: the
      CLI, the web page and the cloud pull all land on the same row.

    The key names the last answered question, so several answers arriving
    together make one wake-up, and a later question answered later makes a
    new one. A withdrawn or sent position is not a candidate; if the user
    authorises it again its answers become one. Channel-blind: a dashboard
    reply and a Telegram reply land on the same question rows.
    """
    if not _table_exists(conn, "positions"):
        return []
    wakes: list[Wake] = _authorisation_candidates(conn)
    if not _table_exists(conn, "pending_user_messages"):
        return _not_yet_woken(conn, wakes)
    rows = conn.execute(
        "SELECT q.related_position_id, "
        "SUM(CASE WHEN q.user_reply IS NULL THEN 1 ELSE 0 END), "
        "MAX(CASE WHEN q.user_reply IS NOT NULL THEN q.id END) "
        "FROM pending_user_messages q JOIN positions p ON p.id = q.related_position_id "
        "WHERE q.agent = 'closer' AND q.kind = 'question' AND q.source_action = ? "
        "AND q.source_id NOT LIKE 'closer-essential:%' "
        "AND p.apply_requested = 1 AND p.status = ? "
        "GROUP BY q.related_position_id",
        (SOURCE_ACTION, apply_gate.AUTHORISABLE_STATUS),
    ).fetchall()
    for position_id, still_open, last_answered in rows:
        if still_open == 0 and last_answered is not None:
            wakes.append(Wake(f"answers:{int(position_id)}:{int(last_answered)}", int(position_id), "answers_complete"))
    essential = conn.execute(
        "SELECT MAX(id) FROM pending_user_messages "
        "WHERE source_id LIKE 'closer-essential:%' AND user_reply IS NOT NULL"
    ).fetchone()
    if essential and essential[0] is not None:
        wakes.append(Wake(f"essentials:{int(essential[0])}", None, "essentials_complete"))
    return _not_yet_woken(conn, wakes)


# A flag older than this is not "new": a position held for days (a CV to
# render again, a checkpoint stop) does not keep the poll reading the queue.
# Once its hold lifts, the ready queue is what the Capitano's rule sees.
AUTHORISATION_WAKE_WINDOW = timedelta(hours=24)


def _authorisation_candidates(conn: sqlite3.Connection) -> list[Wake]:
    now = datetime.now(timezone.utc)
    wakes = []
    for position_id, requested_at in conn.execute(
        "SELECT id, apply_requested_at FROM positions WHERE apply_requested = 1 AND status = ?",
        (apply_gate.AUTHORISABLE_STATUS,),
    ):
        at = apply_gate._parse_instant(requested_at)
        if at is None or not (timedelta(0) <= now - at < AUTHORISATION_WAKE_WINDOW):
            continue
        wakes.append(Wake(f"authorised:{int(position_id)}:{str(requested_at).strip()}", int(position_id), "position_authorised"))
    return wakes


def _not_yet_woken(conn: sqlite3.Connection, wakes: list[Wake]) -> list[Wake]:
    if not wakes or not _table_exists(conn, "closer_wakes"):
        return wakes
    done = {row[0] for row in conn.execute("SELECT wake_key FROM closer_wakes")}
    return [wake for wake in wakes if wake.key not in done]


def pending_wakes(conn: sqlite3.Connection, profile: Mapping[str, Any]) -> list[Wake]:
    """The candidates the user's answers have really unblocked.

    The essentials wake waits until no essential question is still inside its
    day: an answer to one fact while another is pending unblocks nothing.
    """
    wakes = wake_candidates(conn)
    if any(wake.position_id is None for wake in wakes) and check_essentials(conn, profile)["already_asked"]:
        wakes = [wake for wake in wakes if wake.position_id is not None]
    return wakes


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


# ── An idle CLOSER with a ready queue (seen live after 1845, 14/09) ──────────
#
# CLOSER-1 armed its throttle, wrote that the other positions "stay queued for
# the next paced iteration" and ended its turn with queue_ready 4. Every wake
# above fires on an event (an answer, an authorisation); nothing fired. This
# one fires on the state: a live CLOSER whose pane sits idle while the queue
# is ready, once per window, and never within a window of any other wake.

IDLE_WAKE_INTERVAL = timedelta(minutes=10)
IDLE_STABLE = timedelta(seconds=90)


def _capture_pane(session: str) -> str:
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-p", "-t", session], capture_output=True, text=True, timeout=5, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout if result.returncode == 0 else ""


def pane_is_idle(text: str) -> bool:
    """At the prompt with an empty composer: no turn running, nothing typed."""
    if not text.strip():
        return False
    try:
        from agent_unblock import classify_pane
    except ImportError:  # pragma: no cover - package import
        from shared.skills.agent_unblock import classify_pane
    return classify_pane(text)["state"] == "idle"


class IdleWatch:
    """Which live CLOSER panes have sat idle, unchanged, for `stable`.

    One capture per call; a pane that changed or got busy starts over. A turn
    between two tool calls shows "esc to interrupt", so a working CLOSER is
    never idle here.
    """

    def __init__(
        self,
        stable: timedelta = IDLE_STABLE,
        *,
        sessions: Callable[[], list[str]] | None = None,
        capture: Callable[[str], str] | None = None,
        clock: Callable[[], datetime] | None = None,
    ):
        self.stable = stable
        self.sessions = sessions or _closer_sessions
        self.capture = capture or _capture_pane
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.seen: dict[str, tuple[str, datetime]] = {}

    def idle_sessions(self) -> list[str]:
        now = self.clock()
        idle = []
        live = self.sessions()
        for session in live:
            text = self.capture(session)
            if not pane_is_idle(text):
                self.seen.pop(session, None)
                continue
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            previous = self.seen.get(session)
            if previous is None or previous[0] != digest:
                self.seen[session] = (digest, now)
                previous = self.seen[session]
            if now - previous[1] >= self.stable:
                idle.append(session)
        for gone in set(self.seen) - set(live):
            self.seen.pop(gone, None)
        return idle


def wake_idle_closer(
    conn: sqlite3.Connection,
    *,
    idle_sessions: Callable[[], list[str]],
    sender: Callable[[str, str], bool] | None = None,
    queue: Callable[[sqlite3.Connection], Mapping[str, Any]] | None = None,
    now: datetime | None = None,
) -> list[str]:
    """Wake a live, idle CLOSER while the queue is ready. The sessions woken.

    Cheap checks first (an idle pane, no wake of any kind in the last
    `IDLE_WAKE_INTERVAL`), the queue last. The window key is claimed before
    the message, so the bridge and the Capitano cannot both send it; a
    message no CLOSER took gives the claim back.
    """
    import _db

    now = now or datetime.now(timezone.utc)
    sessions = idle_sessions()
    if not sessions:
        return []
    _db._migrate_closer_wakes(conn)
    last = apply_gate._parse_instant(conn.execute("SELECT MAX(created_at) FROM closer_wakes").fetchone()[0])
    if last is not None and now - last < IDLE_WAKE_INTERVAL:
        return []
    current = (queue or (lambda c: apply_gate.application_queue(conn=c)))(conn)
    if not current.get("ready"):
        return []
    key = f"idle_ready:{int(now.timestamp() // IDLE_WAKE_INTERVAL.total_seconds())}"
    claimed = conn.execute(
        "INSERT OR IGNORE INTO closer_wakes (wake_key, position_id, created_at) VALUES (?, NULL, ?)",
        (key, now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"),
    ).rowcount
    conn.commit()
    if claimed != 1:
        return []
    count = len(current.get("positions") or [])
    text = (
        f"[BRIDGE INFO] queue_ready: {count} authorised position(s) can go out now and your turn has ended. "
        "Re-read the queue (apply_gate.py queue) and continue from STEP 1; end the turn only when ready=false."
    )
    woken = [session for session in sessions if (sender or _tmux_send)(session, text)]
    if woken:
        conn.execute("UPDATE closer_wakes SET delivered = 1 WHERE wake_key = ?", (key,))
    else:
        conn.execute("DELETE FROM closer_wakes WHERE wake_key = ? AND delivered = 0", (key,))
    conn.commit()
    return woken


def wake_message(wake: Wake) -> str:
    if wake.reason == "essentials_complete":
        what = "the user answered the essential application facts"
    elif wake.reason == "position_authorised":
        return (
            f"[BRIDGE INFO] the user authorised position #{wake.position_id}. "
            "Re-read the queue (apply_gate.py queue) and continue from STEP 1."
        )
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

    Only a wake that really goes out is claimed: while the queue is not ready
    (daily cap, a hold that lifts later) or no CLOSER is alive, the wake stays
    pending and the next poll tries again — with no CLOSER the ready queue is
    what the Capitano's spawn rule reads. The key is committed BEFORE the
    message: two bridges, or a replay, cannot both send it.
    """
    import _db

    _db._migrate_closer_wakes(conn)
    sent: list[Wake] = []
    wakes = pending_wakes(conn, profile)
    if not wakes:
        return sent
    current = (queue or (lambda c: apply_gate.application_queue(conn=c)))(conn)
    if not current.get("ready"):
        return sent
    ready = {int(item["position_id"]) for item in current.get("positions") or []}
    live = (sessions or _closer_sessions)()
    if not live:
        return sent
    claimed_wakes: list[Wake] = []
    for wake in wakes:
        if wake.position_id is not None and wake.position_id not in ready:
            continue
        claimed = conn.execute(
            "INSERT OR IGNORE INTO closer_wakes (wake_key, position_id) VALUES (?, ?)",
            (wake.key, wake.position_id),
        ).rowcount
        conn.commit()
        if claimed == 1:
            claimed_wakes.append(wake)
    # Several flags set together make ONE message: the CLOSER re-reads the
    # whole queue anyway, one message per flag would only queue turns.
    # A Telegram answer also re-authorises its position: that flag rides on
    # the answers message instead of waking the CLOSER a second time.
    batches = [[wake] for wake in claimed_wakes if wake.reason != "position_authorised"]
    by_position = {batch[0].position_id: batch for batch in batches if batch[0].position_id is not None}
    authorised = []
    for wake in claimed_wakes:
        if wake.reason != "position_authorised":
            continue
        if wake.position_id in by_position:
            by_position[wake.position_id].append(wake)
        else:
            authorised.append(wake)
    if authorised:
        batches.append(authorised)
    for batch in batches:
        if batch[0].reason != "position_authorised" or len(batch) == 1:
            text = wake_message(batch[0])
        else:
            text = authorisations_message(batch)
        delivered = False
        for session in live:
            delivered = (sender or _tmux_send)(session, text) or delivered
        if delivered:
            conn.executemany("UPDATE closer_wakes SET delivered = 1 WHERE wake_key = ?", [(w.key,) for w in batch])
            conn.commit()
            sent.extend(batch)
        else:
            # Not one CLOSER took the message: give the claim back, so the
            # next poll wakes it instead of the key standing for a wake that
            # never happened.
            conn.executemany(
                "DELETE FROM closer_wakes WHERE wake_key = ? AND delivered = 0", [(w.key,) for w in batch]
            )
            conn.commit()
    return sent


def authorisations_message(wakes: Sequence[Wake]) -> str:
    ids = ", ".join(f"#{wake.position_id}" for wake in wakes)
    return (
        f"[BRIDGE INFO] the user authorised positions {ids}. "
        "Re-read the queue (apply_gate.py queue) and continue from STEP 1."
    )


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


def _ask(conn: sqlite3.Connection, profile: Mapping[str, Any], position_id: int, key: str) -> tuple[dict, int]:
    """The one explicit way a question reaches the user: an essential fact or a form question."""
    canonical = normalise_label(key)
    if canonical in {fact.key for fact in ESSENTIAL_FACTS}:
        out = ensure_essentials(conn, profile, position_id, ask=[canonical])
        if canonical in out["asked"]:
            return {"status": "asked", "key": canonical, "kind": "essential"}, 0
        if canonical in out["already_asked"]:
            return {"status": "already_asked", "key": canonical, "kind": "essential"}, 3
        if canonical in out["given_up"]:
            return {"status": "given_up", "key": canonical, "kind": "essential"}, 3
        return {"status": "not_missing", "key": canonical, "kind": "essential"}, 3
    try:
        from apply_flow import ask_pending_question
    except ImportError:  # pragma: no cover - package import
        from shared.skills.apply_flow import ask_pending_question
    result = dict(ask_pending_question(position_id, canonical))
    status = str(result.get("status", ""))
    return {"status": status, "key": canonical, "kind": "form"}, 0 if status == "asked" else 3


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Essential facts and remembered application answers.")
    sub = parser.add_subparsers(dest="command", required=True)
    ess = sub.add_parser("essentials", help="which essential facts are unknown; --ask KEY asks the user that one")
    ess.add_argument("--position-id", type=int, required=True)
    ess.add_argument("--ask", action="append", default=[], metavar="KEY",
                     help="ask the user this essential fact (repeatable); only when no basis exists")
    ask = sub.add_parser("ask", help="ask the user one question the CLOSER could not work out")
    ask.add_argument("--position-id", type=int, required=True)
    ask.add_argument("--key", required=True)
    save = sub.add_parser("save", help="save an answer the CLOSER worked out (channel agent_inferred)")
    save.add_argument("--key", required=True)
    save.add_argument("--value", required=True)
    save.add_argument("--field-type", required=True)
    save.add_argument("--options", nargs="*", default=[])
    save.add_argument("--basis", required=True, choices=INFERENCE_BASES)
    save.add_argument("--position-id", type=int)
    save.add_argument("--label", default="")
    save.add_argument("--purpose", default="", help="the pending_question's purpose, when it has one")
    idle = sub.add_parser("wake-idle-closer", help="wake a live CLOSER sitting idle while the queue is ready")
    idle.add_argument("--settle", type=float, default=8.0, help="seconds the pane must stay idle and unchanged")
    lst = sub.add_parser("list", help="the remembered answers (keys, channels and bases only)")
    for p in (ess, ask, save, lst, idle):
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
                    out = ensure_essentials(conn, profile, args.position_id, ask=args.ask)
                else:
                    out = check_essentials(conn, profile, args.position_id)
                code = 0 if out["status"] == "complete" else 3
            elif args.command == "ask":
                out, code = _ask(conn, profile, args.position_id, args.key)
            elif args.command == "wake-idle-closer":
                watch = IdleWatch(timedelta(seconds=args.settle))
                watch.idle_sessions()
                time.sleep(args.settle)
                woken = wake_idle_closer(conn, idle_sessions=watch.idle_sessions)
                out = {"status": "woken" if woken else "not_needed", "sessions": woken}
                code = 0
            elif args.command == "save":
                try:
                    out = save_inferred(
                        conn, key=args.key, value=args.value, field_type=args.field_type,
                        options=args.options, basis=args.basis, position_id=args.position_id, label=args.label,
                        purpose=args.purpose,
                    )
                    code = 0 if out["status"] == "saved" else 3
                except InferenceRejected as exc:
                    out = {"status": "rejected", "reason": str(exc), "key": normalise_label(args.key)}
                    code = 1
            else:
                ensure_table(conn)
                rows = conn.execute(
                    "SELECT key, field_type, channel, basis, answered_at FROM application_answers ORDER BY key"
                ).fetchall()
                out = {"status": "listed", "answers": [
                    {"key": r[0], "field_type": r[1], "channel": r[2], "basis": r[3], "answered_at": r[4]}
                    for r in rows
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
