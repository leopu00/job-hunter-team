"""The agents' side of the broker: a closed set of operations, data only.

One JSON object per connection, one line, at most MAX_REQUEST_BYTES. Every
operation lists its fields; an unknown operation or an extra field is refused
before anything runs. There is no field for a script, a selector, a URL or a
path: the broker decides where to go from its own state (the authorisation
register), never from the request.

The admin operations (secrets, authorise, approve, allow, admission) are not
here at all: they exist only in `jht-broker-admin`, which the host reaches by
`exec` into the broker container.
"""

from __future__ import annotations

import json
from typing import Any

MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
SOCKET_NAME = "broker.sock"

# op -> (required fields, optional fields, roles that may call it)
# Roles are a reinforcement, not a boundary: every agent has the same uid, so
# the declared role can be forged (design §4.7).
OPERATIONS: dict[str, tuple[dict[str, type], dict[str, type], tuple[str, ...]]] = {
    "mail.status": ({}, {}, ("scout", "capitano", "assistente", "mentor", "closer")),
    "mail.count": ({}, {"since_days": int}, ("scout", "capitano")),
    "mail.poll": ({}, {"since_days": int}, ("scout", "capitano")),
    "mail.send": (
        {"kind": str, "subject": str, "body": str},
        {"to": list, "position_id": int},
        ("closer", "capitano", "assistente", "mentor"),
    ),
}
SEND_KINDS = {"application": ("closer",), "chat": ("capitano", "assistente", "mentor")}
MAX_SUBJECT = 300
MAX_BODY_BYTES = 200_000
MAX_SINCE_DAYS = 30


class ProtocolError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def role_of(agent_name: str) -> str:
    """`scout-2` -> `scout`; empty when unknown."""
    base = (agent_name or "").strip().lower()
    for sep in ("-", "_"):
        base = base.split(sep, 1)[0]
    return base


def parse_request(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("request_too_large")
    try:
        req = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProtocolError("request_not_json") from None
    if not isinstance(req, dict):
        raise ProtocolError("request_not_object")
    op = req.get("op")
    if op not in OPERATIONS:
        raise ProtocolError("unknown_operation")
    required, optional, roles = OPERATIONS[op]
    args = req.get("args", {})
    if not isinstance(args, dict):
        raise ProtocolError("args_not_object")
    extra = set(req) - {"op", "args", "role"}
    if extra:
        raise ProtocolError("unexpected_field")
    for name in args:
        if name not in required and name not in optional:
            raise ProtocolError("unexpected_field")
    for name, kind in {**required, **optional}.items():
        if name not in args:
            if name in required:
                raise ProtocolError("missing_field")
            continue
        value = args[name]
        if kind is int and (isinstance(value, bool) or not isinstance(value, int)):
            raise ProtocolError("field_type")
        if kind is not int and not isinstance(value, kind):
            raise ProtocolError("field_type")
    role = role_of(req.get("role", "")) if isinstance(req.get("role", ""), str) else ""
    if role not in roles:
        raise ProtocolError("role_not_allowed")
    if op in ("mail.count", "mail.poll"):
        days = args.get("since_days", 3 if op == "mail.poll" else 1)
        if not 1 <= days <= MAX_SINCE_DAYS:
            raise ProtocolError("since_days_out_of_range")
        args["since_days"] = days
    if op == "mail.send":
        kind = args["kind"]
        if kind not in SEND_KINDS:
            raise ProtocolError("send_kind_unknown")
        if role not in SEND_KINDS[kind]:
            raise ProtocolError("role_not_allowed")
        if kind == "application" and "position_id" not in args:
            raise ProtocolError("missing_field")
        if kind == "chat" and "position_id" in args:
            raise ProtocolError("unexpected_field")
        to = args.get("to")
        if not to or not all(isinstance(a, str) for a in to):
            raise ProtocolError("missing_field" if not to else "field_type")
        # An application goes to ONE address, and the broker checks that it
        # appears on the offer page it fetches itself from the registered URL.
        if kind == "application" and len(to) != 1:
            raise ProtocolError("one_recipient_per_application")
        if len(args["subject"]) > MAX_SUBJECT or len(args["body"].encode("utf-8")) > MAX_BODY_BYTES:
            raise ProtocolError("message_too_large")
    return {"op": op, "args": args, "role": role}


def encode(obj: dict[str, Any]) -> bytes:
    data = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
    if len(data) > MAX_RESPONSE_BYTES:
        data = (json.dumps({"ok": False, "reason": "response_too_large"}) + "\n").encode("utf-8")
    return data
