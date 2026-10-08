"""Agent-side client: data only, with no secret fallback."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import uuid
from pathlib import Path

from .protocol import BOT_ROLES, MAX_RESPONSE_BYTES, MESSAGE_KINDS, SOCKET_NAME

TIMEOUT = 35


def socket_path() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_SOCKET_DIR", "/run/jht-telegram")) / SOCKET_NAME


def call(operation: str, args: dict | None = None, *, role: str | None = None) -> dict:
    request = {
        "op": operation,
        "args": args or {},
        "role": role or os.environ.get("JHT_AGENT_NAME") or os.environ.get("JHT_NOTIFY_AGENT") or "relay",
    }
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(TIMEOUT)
            conn.connect(str(socket_path()))
            conn.sendall((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
            raw = b""
            while b"\n" not in raw and len(raw) <= MAX_RESPONSE_BYTES:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                raw += chunk
    except (FileNotFoundError, ConnectionRefusedError):
        return {"ok": False, "reason": "telegram_unavailable"}
    except (socket.timeout, OSError):
        return {"ok": False, "reason": "telegram_unreachable"}
    try:
        response = json.loads(raw.split(b"\n", 1)[0].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "reason": "telegram_bad_answer"}
    return response if isinstance(response, dict) else {"ok": False, "reason": "telegram_bad_answer"}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="jht-telegram-client")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    send = sub.add_parser("send")
    send.add_argument("--bot-role", choices=BOT_ROLES, required=True)
    send.add_argument("--kind", choices=MESSAGE_KINDS, default="notification")
    send.add_argument("--source-id", default="")
    send.add_argument("text")
    pull = sub.add_parser("pull")
    pull.add_argument("--bot-role", choices=BOT_ROLES, required=True)
    pull.add_argument("--limit", type=int, default=10)
    ack = sub.add_parser("ack")
    ack.add_argument("--bot-role", choices=BOT_ROLES, required=True)
    ack.add_argument("event_ids", nargs="+")
    args = parser.parse_args(argv)

    if args.command == "status":
        response = call("telegram.status")
    elif args.command == "send":
        source_id = args.source_id or f"direct:{uuid.uuid4().hex}"
        response = call(
            "telegram.send",
            {"bot_role": args.bot_role, "text": args.text, "source_id": source_id, "kind": args.kind},
        )
    elif args.command == "pull":
        response = call("telegram.inbox.pull", {"bot_role": args.bot_role, "limit": args.limit})
    else:
        response = call("telegram.inbox.ack", {"bot_role": args.bot_role, "event_ids": args.event_ids})
    print(json.dumps(response, ensure_ascii=False))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
