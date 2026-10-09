"""Host-only pairing commands, reached through container exec and stdin."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time

from . import store, verify
from .api import BotAPI, TelegramError
from .protocol import BOT_ROLES

MAX_STDIN = 32 * 1024
TOKEN_RE = re.compile(r"[0-9]{5,12}:[A-Za-z0-9_-]{20,}\Z")
# Replaced in tests; production always talks to the Bot API.
API_FACTORY = BotAPI


class AdminError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _read_stdin() -> bytes:
    raw = sys.stdin.buffer.read(MAX_STDIN + 1)
    if len(raw) > MAX_STDIN:
        raise AdminError("input_too_large")
    return raw


def _read_token() -> tuple[str, str]:
    """The new token, from stdin only.  The chat id is no longer accepted:
    it comes from the message that carries the code (verify.py)."""
    raw = _read_stdin()
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AdminError("input_not_json") from None
    if not isinstance(value, dict) or set(value) != {"bot_token"}:
        raise AdminError("input_fields_invalid")
    token = value.get("bot_token")
    if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
        raise AdminError("bot_token_invalid")
    return token, hashlib.sha256(token.encode("utf-8")).hexdigest()


def _verified_chat(role: str, api: BotAPI) -> str:
    """Show a one-time code on the host and wait for it from the person's
    private chat with the bot.  The role's service poller pauses meanwhile."""
    try:
        username = api.get_me()
    except TelegramError as exc:
        raise AdminError(exc.code) from None
    code = verify.new_code()
    issued_at = time.time()
    offset = int(store.read_state("offsets", {}).get(role, 0) or 0)
    minutes = verify.CODE_TTL_SECONDS // 60
    print(
        f"From your own Telegram, send this message to the bot @{username}: /start {code}\n"
        f"or open https://t.me/{username}?start={code}\n"
        f"The code is valid for {minutes} minutes. Do not type a chat id: the bot takes it from your message.",
        file=sys.stderr,
        flush=True,
    )
    store.begin_pairing(role, issued_at + verify.CODE_TTL_SECONDS + 30)
    try:
        chat_id, next_offset = verify.wait_for_code(api, code, issued_at, offset=offset)
    except verify.VerificationError as exc:
        raise AdminError(exc.code) from None
    finally:
        store.end_pairing(role)
    store.set_offset(role, next_offset)
    return chat_id


def _confirm(api: BotAPI, chat_id: str, text: str) -> None:
    try:
        api.send_message(chat_id, text)
    except TelegramError:
        pass


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
    bots.add_parser("chat-id").add_argument("role", choices=BOT_ROLES)
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
                # Last state change of each poller (ok / idle / error + code),
                # so a refused token is not mistaken for a quiet chat.
                "pollers": store.poller_states(),
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
            token, digest = _read_token()
            if digest in store.known_token_digests():
                raise AdminError("rotation_required")
            rotation = "rotated" if history else "fresh"
            # Record before using or publishing the secret.  A crash or a
            # failed verification may force another rotation, but can never
            # make a token observed here reusable.
            store.remember_token_digests(args.role, [digest])
            api = API_FACTORY(token)
            chat_id = _verified_chat(args.role, api)
            store.write_bot(args.role, {"bot_token": token, "chat_id": chat_id})
            store.record_pairing(args.role, rotation)
            _confirm(api, chat_id, f"JHT: il bot {args.role} è abbinato a questa chat.")
            result = {"ok": True, "bot": args.role, "state": "present", "rotation": rotation}
        elif args.area == "bots" and args.command == "chat-id":
            existing = store.read_bot(args.role)
            if not existing:
                raise AdminError("bot_not_configured")
            api = API_FACTORY(existing["bot_token"])
            chat_id = _verified_chat(args.role, api)
            store.write_bot(args.role, {"bot_token": existing["bot_token"], "chat_id": chat_id})
            if chat_id != existing["chat_id"]:
                _confirm(api, existing["chat_id"], f"JHT: il bot {args.role} ora parla con un'altra chat.")
            _confirm(api, chat_id, f"JHT: il bot {args.role} è abbinato a questa chat.")
            result = {"ok": True, "bot": args.role, "state": "present", "chat": "verified"}
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
