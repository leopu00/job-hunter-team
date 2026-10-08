"""Host-only pairing commands, reached through container exec and stdin."""

from __future__ import annotations

import argparse
import hashlib
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


def _read_stdin() -> bytes:
    raw = sys.stdin.buffer.read(MAX_STDIN + 1)
    if len(raw) > MAX_STDIN:
        raise AdminError("input_too_large")
    return raw


def _read_bot() -> tuple[dict[str, str], str]:
    raw = _read_stdin()
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
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return {"bot_token": token, "chat_id": chat_id}, digest


def _read_digests() -> list[str]:
    try:
        lines = _read_stdin().decode("ascii").splitlines()
    except UnicodeDecodeError:
        raise AdminError("legacy_digest_invalid") from None
    digests = [line.strip() for line in lines if line.strip()]
    if any(not re.fullmatch(r"[0-9a-f]{64}", item) for item in digests):
        raise AdminError("legacy_digest_invalid")
    return digests


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="jht-telegram-admin")
    area = parser.add_subparsers(dest="area", required=True)
    bots = area.add_parser("bots").add_subparsers(dest="command", required=True)
    bots.add_parser("status")
    pair = bots.add_parser("pair")
    pair.add_argument("role", choices=BOT_ROLES)
    pair.add_argument("--legacy-digest", action="append", default=[])
    bots.add_parser("delete").add_argument("role", choices=BOT_ROLES)
    legacy = area.add_parser("legacy").add_subparsers(dest="command", required=True)
    legacy.add_parser("remember").add_argument("role", choices=BOT_ROLES)
    legacy.add_parser("complete")
    cutover = area.add_parser("cutover").add_subparsers(dest="command", required=True)
    cutover.add_parser("status")
    cutover.add_parser("enable")
    args = parser.parse_args(argv)
    try:
        if args.area == "bots" and args.command == "status":
            result = {
                "ok": True,
                "bots": {role: "present" if store.read_bot(role) else "absent" for role in BOT_ROLES},
                "cutover": store.cutover_status(),
            }
        elif args.area == "legacy" and args.command == "remember":
            store.remember_token_digests(args.role, _read_digests(), inventory_complete=True)
            result = {"ok": True, "legacy": args.role, "state": "remembered"}
        elif args.area == "legacy":
            if not store.legacy_inventory_complete():
                raise AdminError("legacy_inventory_required")
            result = {"ok": True, "legacy": "complete"}
        elif args.area == "bots" and args.command == "pair":
            if any(not re.fullmatch(r"[0-9a-f]{64}", item) for item in args.legacy_digest):
                raise AdminError("legacy_digest_invalid")
            legacy_digests = list(args.legacy_digest)
            existing = store.read_bot(args.role)
            if existing:
                legacy_digests.append(hashlib.sha256(existing["bot_token"].encode("utf-8")).hexdigest())
            if legacy_digests:
                store.remember_token_digests(args.role, legacy_digests)
            history, inventory_complete = store.token_history(args.role)
            if not inventory_complete:
                raise AdminError("legacy_inventory_required")
            secret, digest = _read_bot()
            if digest in history:
                raise AdminError("rotation_required")
            rotation = "rotated" if history else "fresh"
            # Record before publishing the secret.  A crash may force another
            # rotation, but can never make a token observed here reusable.
            store.remember_token_digests(args.role, [digest])
            store.write_bot(args.role, secret)
            store.record_pairing(args.role, rotation)
            result = {"ok": True, "bot": args.role, "state": "present", "rotation": rotation}
        elif args.area == "bots":
            existing = store.read_bot(args.role)
            if existing:
                digest = hashlib.sha256(existing["bot_token"].encode("utf-8")).hexdigest()
                store.remember_token_digests(args.role, [digest])
            store.delete_bot(args.role)
            store.forget_pairing(args.role)
            result = {"ok": True, "bot": args.role, "state": "absent"}
        elif args.command == "enable":
            store.enable_cutover()
            result = {"ok": True, "cutover": "enabled"}
        else:
            result = {"ok": True, "cutover": store.cutover_status()}
    except (AdminError, store.StoreError) as exc:
        result = {"ok": False, "reason": exc.code}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
