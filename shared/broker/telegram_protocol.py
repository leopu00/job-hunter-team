"""The one operation accepted on the broker socket owned by Telegram.

This is deliberately separate from :mod:`broker.protocol`: the agents never
mount this socket, and this parser deliberately exposes no agent operations.
"""

from __future__ import annotations

import json
from typing import Any

from .protocol import MAX_REQUEST_BYTES


class TelegramProtocolError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def parse_request(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_REQUEST_BYTES:
        raise TelegramProtocolError("request_too_large")
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise TelegramProtocolError("request_not_json") from None
    if not isinstance(request, dict):
        raise TelegramProtocolError("request_not_object")
    if set(request) != {"op", "args"}:
        raise TelegramProtocolError("unexpected_field")
    if request.get("op") != "apply.record":
        raise TelegramProtocolError("unknown_operation")
    args = request.get("args")
    if not isinstance(args, dict):
        raise TelegramProtocolError("args_not_object")
    if set(args) != {"position_id", "instant", "destination"}:
        raise TelegramProtocolError("unexpected_field")
    if isinstance(args["position_id"], bool) or not isinstance(args["position_id"], int):
        raise TelegramProtocolError("field_type")
    if not isinstance(args["instant"], str) or not isinstance(args["destination"], str):
        raise TelegramProtocolError("field_type")
    return {"op": "apply.record", "args": args}
