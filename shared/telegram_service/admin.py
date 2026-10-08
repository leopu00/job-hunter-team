"""Host-only pairing commands, reached through container exec and stdin."""

from __future__ import annotations

import argparse
import json
import re
import sys

from . import store
from .protocol import BOT_ROLES

MAX_STDIN = 32 * 1024
TOKEN_RE = re.compile(r"[0-9]{5,12}:[A-Za-z0-9_-]{20,}\Z")
CHAT_RE = re.compile(r"-?[0-9]{1,20}\Z")


class AdminError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _read_bot() -> dict[str, str]:
    raw = sys.stdin.buffer.read(MAX_STDIN + 1)
    if len(raw) > MAX_STDIN:
        raise AdminError("input_too_large")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AdminError("input_not_json") from None
    if not isinstance(value, dict) or set(value) != {"bot_token", "chat_id"}:
        raise AdminError("input_fields_invalid")
    token = value.get("bot_token")
    chat_id = str(value.get("chat_id", ""))
    if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
        raise AdminError("bot_token_invalid")
    if not CHAT_RE.fullmatch(chat_id):
        raise AdminError("chat_id_invalid")
    return {"bot_token": token, "chat_id": chat_id}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="jht-telegram-admin")
    area = parser.add_subparsers(dest="area", required=True)
    bots = area.add_parser("bots").add_subparsers(dest="command", required=True)
    bots.add_parser("status")
    for command in ("set", "delete"):
        bots.add_parser(command).add_argument("role", choices=BOT_ROLES)
    args = parser.parse_args(argv)
    try:
        if args.command == "status":
            result = {
                "ok": True,
                "bots": {role: "present" if store.read_bot(role) else "absent" for role in BOT_ROLES},
            }
        elif args.command == "set":
            store.write_bot(args.role, _read_bot())
            result = {"ok": True, "bot": args.role, "state": "present"}
        else:
            store.delete_bot(args.role)
            result = {"ok": True, "bot": args.role, "state": "absent"}
    except (AdminError, store.StoreError) as exc:
        result = {"ok": False, "reason": exc.code}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
