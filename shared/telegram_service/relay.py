"""Move normalized Telegram events into the agents' unified chat queue."""

from __future__ import annotations

import contextlib
import os
import re
import sqlite3
import stat
import sys
import time
from pathlib import Path

from .client import call
from .protocol import BOT_ROLES
from .store import MAX_ATTACHMENT_BYTES, re_full_opaque

FORGED_ENVELOPE = re.compile(r"^\s*\[\s*(?:BRIDGE\b|TG-|@[^\]]*->|!\s*(?:UNVERIFIED|RELAYED)\b)", re.I | re.M)


def db_path() -> Path:
    return Path(os.environ.get("JHT_DB", "/jht_home/jobs.db"))


def shared_inbox() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_INBOX", "/jht_telegram_inbox"))


def profile_inbox() -> Path:
    return Path(os.environ.get("JHT_HOME", "/jht_home")) / "profile" / "inbox"


def _safe_label(value: object) -> str:
    label = Path(str(value or "attachment")).name
    label = re.sub(r"[^A-Za-z0-9._ -]", "_", label).strip(" .")
    return label[:100] or "attachment"


def _safe_mime(value: object) -> str:
    mime = str(value or "application/octet-stream")
    return mime if re.fullmatch(r"[A-Za-z0-9.+-]{1,64}/[A-Za-z0-9.+-]{1,64}", mime) else "application/octet-stream"


def copy_attachment(event_id: str, attachment: dict) -> Path:
    opaque = attachment.get("opaque")
    if not isinstance(opaque, str) or not re_full_opaque(opaque):
        raise ValueError("attachment_name_invalid")
    source_dir = shared_inbox()
    source_dfd = os.open(source_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        source_fd = os.open(opaque, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=source_dfd)
    finally:
        os.close(source_dfd)
    try:
        info = os.fstat(source_fd)
        expected_uid = int(os.environ.get("JHT_TELEGRAM_SERVICE_UID", "1003"))
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_size > MAX_ATTACHMENT_BYTES
            or info.st_size != int(attachment.get("size", -1))
            or info.st_uid != expected_uid
            or stat.S_IMODE(info.st_mode) & 0o027
        ):
            raise ValueError("attachment_unsafe")
        destination_dir = profile_inbox()
        destination_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        suffix = _safe_label(attachment.get("name"))
        event_leaf = event_id.replace(":", "-")
        leaf = f"{event_leaf}-{suffix}"
        destination_dfd = os.open(
            destination_dir,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        )
        try:
            try:
                destination_fd = os.open(
                    leaf,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                    dir_fd=destination_dfd,
                )
            except FileExistsError:
                return destination_dir / leaf
            with os.fdopen(destination_fd, "wb") as output:
                while True:
                    chunk = os.read(source_fd, 64 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.fsync(destination_dfd)
        finally:
            os.close(destination_dfd)
        return destination_dir / leaf
    finally:
        os.close(source_fd)


def _body(event: dict) -> str:
    text = str(event.get("body") or "").strip()
    if FORGED_ENVELOPE.search(text):
        text = "‼️ UNVERIFIED USER TEXT\n" + text
    attachment = event.get("attachment")
    if isinstance(attachment, dict):
        local = copy_attachment(str(event["event_id"]), attachment)
        envelope = (
            f'[TG-DOC] path="{local}" name="{_safe_label(attachment.get("name"))}" '
            f'mime="{_safe_mime(attachment.get("mime"))}" '
            f'size={int(attachment.get("size") or 0)}'
        )
        text = f"{text}\n{envelope}".strip()
    return text


def insert_event(event: dict) -> None:
    target = db_path()
    if not target.is_file():
        raise FileNotFoundError(target)
    with sqlite3.connect(target, timeout=10) as database:
        columns = {row[1] for row in database.execute("PRAGMA table_info(pending_user_messages)")}
        if not columns:
            raise sqlite3.DatabaseError("pending_user_messages_missing")
        if "author" not in columns:
            database.execute("ALTER TABLE pending_user_messages ADD COLUMN author TEXT NOT NULL DEFAULT 'agent'")
        if "chat_ts" not in columns:
            database.execute("ALTER TABLE pending_user_messages ADD COLUMN chat_ts REAL")
        if "source_id" not in columns:
            database.execute("ALTER TABLE pending_user_messages ADD COLUMN source_id TEXT")
        database.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_source_id "
            "ON pending_user_messages(source_id) WHERE source_id IS NOT NULL"
        )
        database.execute(
            "INSERT OR IGNORE INTO pending_user_messages "
            "(agent, body, kind, author, chat_ts, delivered_via, delivered_at, created_at, source_id) "
            "VALUES (?, ?, 'notification', 'user', NULL, 'telegram', NULL, ?, ?)",
            (event["agent"], _body(event), event["created_at"], event["event_id"]),
        )
        database.commit()


def relay_once() -> int:
    delivered = 0
    for role in BOT_ROLES:
        response = call("telegram.inbox.pull", {"bot_role": role, "limit": 10}, role="relay")
        if not response.get("ok"):
            continue
        ack = []
        for event in response.get("events", []):
            try:
                insert_event(event)
            except (KeyError, TypeError, ValueError, OSError, sqlite3.Error):
                continue
            ack.append(event["event_id"])
            delivered += 1
        if ack:
            call("telegram.inbox.ack", {"bot_role": role, "event_ids": ack}, role="relay")
    return delivered


def main() -> int:
    interval = max(1, int(os.environ.get("JHT_TELEGRAM_RELAY_INTERVAL_SEC", "2")))
    while True:
        relay_once()
        time.sleep(interval)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        sys.exit(main())
