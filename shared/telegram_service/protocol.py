"""Closed socket protocol exposed by the Telegram transport.

The agent uid may ask for ordinary chat delivery and retrieve normalized
inbound events.  Tokens, chat ids, Bot API methods, URLs and filesystem paths
are deliberately absent from the protocol.
"""

from __future__ import annotations

import json
import re
from typing import Any

BOT_ROLES = ("assistente", "capitano", "mentor")
MESSAGE_KINDS = ("notification", "question", "digest", "alert")
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_TEXT_CHARS = 12_000
MAX_PULL = 20
SOCKET_NAME = "telegram.sock"
AGENT_PREFIX = "💬 Agente:"

# The future authorization operation owns this visual namespace.  Ordinary
# agent text is always prefixed, but refusing the canonical markers as well
# prevents a copied challenge from looking genuine inside that envelope.
RESERVED_CHALLENGE_MARKERS = (
    "🔐 jht · autorizzazione candidatura",
    "[jht-auth]",
    "sì, candidati",
)
SOURCE_ID_RE = re.compile(r"[A-Za-z0-9_.:-]{1,180}\Z")
EVENT_ID_RE = re.compile(r"telegram:(?:assistente|capitano|mentor):[0-9]{1,20}\Z")


class ProtocolError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


OPERATIONS: dict[str, tuple[dict[str, type], dict[str, type]]] = {
    "telegram.status": ({}, {}),
    "telegram.send": (
        {"bot_role": str, "text": str, "source_id": str},
        {"kind": str},
    ),
    "telegram.inbox.pull": ({"bot_role": str}, {"limit": int}),
    "telegram.inbox.ack": ({"bot_role": str, "event_ids": list}, {}),
}


def _typed(value: object, expected: type) -> bool:
    if expected is int:
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, expected)


def parse_request(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("request_too_large")
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProtocolError("request_not_json") from None
    if not isinstance(request, dict):
        raise ProtocolError("request_not_object")
    if set(request) - {"op", "args", "role"}:
        raise ProtocolError("unexpected_field")
    operation = request.get("op")
    if operation not in OPERATIONS:
        raise ProtocolError("unknown_operation")
    args = request.get("args", {})
    if not isinstance(args, dict):
        raise ProtocolError("args_not_object")
    required, optional = OPERATIONS[operation]
    if set(args) - set(required) - set(optional):
        raise ProtocolError("unexpected_field")
    for name, expected in required.items():
        if name not in args:
            raise ProtocolError("missing_field")
        if not _typed(args[name], expected):
            raise ProtocolError("field_type")
    for name, expected in optional.items():
        if name in args and not _typed(args[name], expected):
            raise ProtocolError("field_type")

    role = request.get("role", "")
    if not isinstance(role, str) or not role.strip():
        raise ProtocolError("role_missing")
    if "bot_role" in args and args["bot_role"] not in BOT_ROLES:
        raise ProtocolError("bot_role_unknown")

    if operation == "telegram.send":
        text = args["text"]
        if not text.strip():
            raise ProtocolError("text_empty")
        if len(text) > MAX_TEXT_CHARS:
            raise ProtocolError("text_too_large")
        if not SOURCE_ID_RE.fullmatch(args["source_id"]):
            raise ProtocolError("source_id_invalid")
        kind = args.setdefault("kind", "notification")
        if kind not in MESSAGE_KINDS:
            raise ProtocolError("kind_unknown")
        folded = text.casefold()
        if any(marker in folded for marker in RESERVED_CHALLENGE_MARKERS):
            raise ProtocolError("challenge_format_reserved")
    elif operation == "telegram.inbox.pull":
        limit = args.setdefault("limit", 10)
        if not 1 <= limit <= MAX_PULL:
            raise ProtocolError("limit_out_of_range")
    elif operation == "telegram.inbox.ack":
        ids = args["event_ids"]
        if not ids or len(ids) > MAX_PULL or not all(
            isinstance(item, str) and EVENT_ID_RE.fullmatch(item) for item in ids
        ):
            raise ProtocolError("event_ids_invalid")
    return {"op": operation, "args": args, "role": role.strip().lower()}


def encode(value: dict[str, Any]) -> bytes:
    payload = (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")
    if len(payload) > MAX_RESPONSE_BYTES:
        payload = b'{"ok":false,"reason":"response_too_large"}\n'
    return payload
