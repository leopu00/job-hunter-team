"""Prove which Telegram chat belongs to the person at the host.

The host never types a chat id.  It shows a one-time code; the person sends
it to the new bot from their own Telegram; the service reads the chat id from
that message.  A chat id planted in an agent-writable file is never used, and
a code relayed from a group chat or by a different sender is refused: the
message must come from a private chat whose sender is the chat itself.
"""

from __future__ import annotations

import hmac
import secrets
import time
from typing import Callable

from .api import BotAPI, TelegramError

# No 0/O or 1/I/L: the person reads the code off a terminal and types it.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10
CODE_TTL_SECONDS = 300
MAX_WRONG_ATTEMPTS = 5
# Telegram stamps messages with whole seconds; allow a little clock skew.
CLOCK_SKEW_SECONDS = 5


class VerificationError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def _candidate(text: str) -> str:
    text = text.strip()
    if text == "/start" or text.startswith("/start "):
        text = text[len("/start"):]
    elif text.startswith("/start@"):
        # "/start@BotName CODE" in clients that append the bot name.
        text = text.partition(" ")[2]
    return text.strip().upper()


def wait_for_code(
    api: BotAPI,
    code: str,
    issued_at: float,
    *,
    offset: int = 0,
    ttl: int = CODE_TTL_SECONDS,
    clock: Callable[[], float] = time.time,
    pause: Callable[[float], None] = time.sleep,
) -> tuple[str, int]:
    """Return (chat id, next update offset) once the code arrives correctly."""
    deadline = issued_at + ttl
    wrong = 0
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            raise VerificationError("verification_timeout")
        try:
            updates = api.get_updates(offset, timeout=max(1, min(25, int(remaining))))
        except TelegramError as exc:
            if exc.code in {"telegram_conflict", "telegram_unreachable"}:
                # The service poller may still hold its last long poll.
                pause(2)
                continue
            raise VerificationError(exc.code) from None
        for update in updates:
            update_id = update.get("update_id")
            if not isinstance(update_id, int) or isinstance(update_id, bool):
                continue
            offset = max(offset, update_id + 1)
            message = update.get("message")
            if not isinstance(message, dict):
                continue
            date = message.get("date")
            if not isinstance(date, int) or date < issued_at - CLOCK_SKEW_SECONDS:
                continue
            candidate = _candidate(str(message.get("text") or ""))
            if not candidate:
                continue
            chat = message.get("chat")
            sender = message.get("from")
            private = (
                isinstance(chat, dict)
                and chat.get("type") == "private"
                and isinstance(chat.get("id"), int)
                and not isinstance(chat.get("id"), bool)
                and isinstance(sender, dict)
                and sender.get("is_bot") is not True
                and sender.get("id") == chat.get("id")
            )
            if private and hmac.compare_digest(candidate.encode(), code.encode()):
                return str(chat["id"]), offset
            wrong += 1
            if wrong >= MAX_WRONG_ATTEMPTS:
                raise VerificationError("verification_failed")
