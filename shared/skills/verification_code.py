#!/usr/bin/env python3
"""verification_code.py — the one-time code a site asks for to finish an application. [JHT-CLOSER-CODE]

Seen live (1967, 14/09): after Submit, Greenhouse showed "A verification code
was sent to <the candidate's email>. To submit your application, enter the
8-character code". The application had not gone out; the flow saw no
confirmation and stopped as receipt_missing.

The code is fetched, never stored:

1. from the user's mailbox, when the box's email monitor is configured
   (`$JHT_HOME/credentials/email_monitor.json`, the same IMAP login
   `email_monitor.py` uses): a message from the site, received after the
   submit started, whose text holds exactly one code of the expected shape;
2. otherwise on Telegram, through the closer_login_code channel the LinkedIn
   sign-in uses (`application_answers.login_code_path`: the bridge writes the
   code to a 0600 file, the row says [received], this module reads the file,
   deletes it and marks the row [used]).

The code is returned to the caller and nowhere else: not in a log, a
checkpoint, a receipt or a notice.
"""
from __future__ import annotations

import contextlib
import email
import email.policy
import json
import os
import re
import sqlite3
import stat
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))

LOGIN_CODE_SOURCE_ACTION = "closer_login_code"
CODE_SHAPES = {"alnum8": re.compile(r"[A-Za-z0-9]{8}")}
_TAG = re.compile(r"<[^>]+>")


class CodeUnavailable(RuntimeError):
    """No code: none arrived in time, the request did not reach the user, or it was not valid."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


# ── from the mailbox ────────────────────────────────────────────────────────


def _looks_like_a_code(token: str) -> bool:
    """A generated code, not an eight-letter word ("received", "Security"):
    it has a digit, is all capitals, or mixes case after its first letter."""
    return (
        any(ch.isdigit() for ch in token)
        or token.isupper()
        or (any(ch.isupper() for ch in token[1:]) and any(ch.islower() for ch in token))
    )


def code_in_text(text: str, shape: str = "alnum8") -> str | None:
    """The one code of `shape` a verification email names, or None when there is none or more than one."""
    pattern = CODE_SHAPES[shape]
    plain = " ".join(_TAG.sub(" ", str(text or "")).split())
    found = set()
    for match in re.finditer(r"\bcode\b", plain, re.I):
        window = plain[match.end(): match.end() + 120]
        for token in re.findall(r"(?<![A-Za-z0-9])[A-Za-z0-9]+(?![A-Za-z0-9])", window):
            if pattern.fullmatch(token) and _looks_like_a_code(token):
                found.add(token)
    return found.pop() if len(found) == 1 else None


def mailbox_configured() -> bool:
    try:
        import email_monitor
    except ImportError:
        return False
    creds = email_monitor._load_creds()
    return bool(creds.get("user") and creds.get("password"))


def _default_mailbox_messages(since: datetime) -> list[tuple[str, datetime | None, str]]:
    """(sender, received, text) of the messages since `since`, read with email_monitor's own login."""
    import email_monitor

    creds = email_monitor._load_creds()
    conn = email_monitor._imap_connect(creds)
    try:
        conn.select(creds.get("folder", "INBOX"), readonly=True)
        since_imap = (since - timedelta(days=1)).strftime("%d-%b-%Y")
        typ, data = conn.search(None, "(SINCE", since_imap + ")")
        uids = data[0].split() if typ == "OK" and data and data[0] else []
        messages = []
        for uid in uids[-50:]:
            typ, raw = conn.fetch(uid, "(RFC822)")
            if typ != "OK" or not raw or not isinstance(raw[0], tuple):
                continue
            msg = email.message_from_bytes(raw[0][1], policy=email.policy.default)
            try:
                received = parsedate_to_datetime(msg.get("Date"))
            except (TypeError, ValueError):
                received = None
            messages.append((str(msg.get("From") or ""), received, email_monitor._extract_email_body(msg)))
        return messages
    finally:
        with contextlib.suppress(Exception):
            conn.logout()


def code_from_mailbox(
    *,
    sender_domain: str | tuple[str, ...],
    since: datetime,
    timeout_s: float,
    poll_s: float = 10.0,
    shape: str = "alnum8",
    reader: Callable[[datetime], list[tuple[str, datetime | None, str]]] | None = None,
) -> str:
    """Wait for the site's email and return its code; CodeUnavailable when none arrives in time."""
    read = reader or _default_mailbox_messages
    deadline = time.monotonic() + timeout_s
    while True:
        codes = set()
        for sender, received, text in read(since):
            address = parseaddr(sender)[1].casefold()
            domain = address.rsplit("@", 1)[-1] if "@" in address else ""
            domains = (sender_domain,) if isinstance(sender_domain, str) else tuple(sender_domain)
            if not any(domain == known or domain.endswith("." + known) for known in domains):
                continue
            if received is None or received.astimezone(timezone.utc) < since - timedelta(seconds=30):
                continue  # a code sent before this submit belongs to another try
            code = code_in_text(text, shape)
            if code:
                codes.add(code)
        if len(codes) == 1:
            return codes.pop()
        if len(codes) > 1:
            raise CodeUnavailable("code_ambiguous", "More than one verification email arrived after the submit")
        if time.monotonic() >= deadline:
            raise CodeUnavailable("code_missing", "No verification email arrived in time")
        time.sleep(poll_s)


# ── on Telegram ──────────────────────────────────────────────────────────────


def _private_file(path: Path) -> bool:
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077 and info.st_uid == os.getuid()


def _default_notifier(*, position_id: int, message: str, source_id: str, payload: Mapping[str, Any]) -> str:
    import shutil

    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    result = subprocess.run(
        [
            executable, "--agent", "closer", "--kind", "alert", "--position-id", str(position_id),
            "--source-id", source_id, "--source-action", LOGIN_CODE_SOURCE_ACTION,
            "--source-payload", json.dumps(dict(payload), sort_keys=True), message,
        ],
        check=False, capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"jht-notify-user failed with exit {result.returncode}")
    return "telegram" if "via=telegram" in result.stdout else "web"


def code_from_telegram(
    *,
    service: str,
    site: str,
    position_id: int,
    db_path: Path,
    jht_home: Path,
    timeout_s: float,
    shape: str = "alnum8",
    notifier: Callable[..., str] | None = None,
    poll_s: float = 2.0,
) -> str:
    """Ask the user for the code on Telegram and wait; CodeUnavailable when it does not come."""
    import application_answers

    source_id = f"closer-login-code:{service}:{time.time_ns()}"
    expires = datetime.now(timezone.utc) + timedelta(seconds=timeout_s)
    payload = {
        "version": 1,
        "service": service,
        "position_id": int(position_id),
        "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "code_format": shape,
    }

    def finish(reply: str) -> None:
        with contextlib.closing(sqlite3.connect(db_path, timeout=10)) as conn:
            if reply == "[used]":
                conn.execute(
                    "UPDATE pending_user_messages SET user_reply = '[used]', agent_seen_reply_at = CURRENT_TIMESTAMP "
                    "WHERE source_id = ?",
                    (source_id,),
                )
            else:
                conn.execute(
                    "UPDATE pending_user_messages SET user_reply = ?, user_reply_at = CURRENT_TIMESTAMP "
                    "WHERE source_id = ? AND user_reply IS NULL",
                    (reply, source_id),
                )
            conn.commit()
        with contextlib.suppress(OSError):
            application_answers.login_code_path(source_id, jht_home).unlink()

    with contextlib.closing(sqlite3.connect(db_path, timeout=10)) as conn:
        conn.execute(
            "UPDATE pending_user_messages SET user_reply = '[expired]', user_reply_at = CURRENT_TIMESTAMP "
            "WHERE agent = 'closer' AND source_action = ? AND user_reply IS NULL "
            "AND json_extract(source_payload, '$.service') = ?",
            (LOGIN_CODE_SOURCE_ACTION, service),
        )
        conn.commit()
    message = (
        f"CLOSER submitted your application on {site}, and {site} sent a verification code to your email "
        "before it accepts it. Reply to this message with that code, within "
        f"{max(1, round(timeout_s / 60))} minutes.\n"
        f"Code request: {application_answers.answer_code(source_id)}"
    )
    try:
        delivered = (notifier or _default_notifier)(
            position_id=int(position_id), message=message, source_id=source_id, payload=payload
        )
    except Exception as exc:  # noqa: BLE001
        raise CodeUnavailable("code_undelivered", f"The code request could not be sent ({type(exc).__name__})") from exc
    if delivered != "telegram":
        finish("[expired]")
        raise CodeUnavailable("code_undelivered", "The code request did not reach Telegram")
    deadline = time.monotonic() + timeout_s
    while True:
        with contextlib.closing(sqlite3.connect(db_path, timeout=10)) as conn:
            row = conn.execute("SELECT user_reply FROM pending_user_messages WHERE source_id = ?", (source_id,)).fetchone()
        if row and row[0] == "[received]":
            break
        if row is None or row[0] is not None or time.monotonic() >= deadline:
            finish("[expired]")
            raise CodeUnavailable("code_missing", "No code arrived on Telegram before it expired")
        time.sleep(poll_s)
    path = application_answers.login_code_path(source_id, jht_home)
    code = ""
    try:
        if _private_file(path):
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("source_id") == source_id:
                candidate = re.sub(r"[\s-]", "", str(data.get("code") or ""))
                code = candidate if CODE_SHAPES[shape].fullmatch(candidate) else ""
    except (OSError, ValueError):
        code = ""
    finally:
        finish("[used]")
    if not code:
        raise CodeUnavailable("code_missing", "The code from Telegram was not valid")
    return code
