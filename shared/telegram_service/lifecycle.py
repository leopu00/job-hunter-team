"""Host lifecycle decisions, executed in the isolated runtime, never on the host.

Output is a closed list of transport operations, not shell code. The private
store remains accessible only to the Telegram uid; no token leaves this process.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shared.telegram_service import lifecycle_state, store
from shared.telegram_service.protocol import BOT_ROLES


ACTIONS = ("resume", "pair", "setup", "remove", "chat-id", "status")
OPERATIONS = frozenset(("start", "stop", "pair", "remove", "chat-id", "status", "not-configured"))


def plan(phase: str, action: str, role: str, configured: tuple[str, ...]) -> tuple[str, ...]:
    if phase not in ("prepare", "complete") or action not in ACTIONS:
        raise ValueError("telegram_lifecycle_request_invalid")
    if action in ("pair", "setup", "remove", "chat-id"):
        if role not in BOT_ROLES and not (action == "pair" and role == "--all"):
            raise ValueError("bot_role_unknown")
    elif role:
        raise ValueError("telegram_lifecycle_request_invalid")
    if phase == "complete":
        return ("stop",) if action in ("pair", "setup", "remove") and not configured else ()
    if action == "resume":
        return ("start",) if configured else ("stop",)
    if action in ("pair", "setup"):
        return ("start", "pair")
    if action == "status":
        return ("status",) if configured else ("not-configured",)
    if action == "chat-id" and role not in configured:
        raise ValueError("bot_not_configured")
    if action == "remove" and not configured:
        return ("not-configured",)
    return ("start", action)


def verify_state(operation: str, result: str) -> bool:
    code, separator, message = result.partition("\n")
    if not separator or len(result) > 65536 or operation not in ("start", "stop"):
        return False
    value = message.strip()
    if code == "0":
        return value == ("true" if operation == "start" else "false")
    # An engine that has no such container answers `inspect` with exit 1 (Docker) or 125 (Podman 5).
    if code not in ("1", "125") or operation != "stop":
        return False
    return bool(re.fullmatch(
        r'(?:Error response from daemon: )?No such (?:container|object): jht-telegram'
        r'|Error: no container with name or ID "jht-telegram" found: no such container'
        r'|Error: no such (?:container "|object: ")jht-telegram"', value,
    ))


def verify_command(argv: list[str]) -> int:
    if len(argv) != 2 or not verify_state(argv[1], sys.stdin.read(65537)):
        print("telegram_lifecycle_state_unconfirmed", file=sys.stderr)
        return 1
    return 0


def boot_command() -> int:
    try:
        configured = lifecycle_state.boot_operation() == "start"
        observed = sys.stdin.read(65537)
        if verify_state("start", observed):
            print("noop" if configured else "stop")
        elif verify_state("stop", observed):
            print("start" if configured else "noop")
        else:
            raise ValueError("telegram_lifecycle_state_unconfirmed")
        return 0
    except (lifecycle_state.StateError, OSError, ValueError):
        print("telegram_lifecycle_state_unreadable", file=sys.stderr)
        return 1


def main(argv: list[str]) -> int:
    if argv and argv[0] == "verify":
        return verify_command(argv)
    if argv == ["boot"]:
        return boot_command()
    if argv == ["expected-services"]:
        try:
            configured = lifecycle_state.boot_operation() == "start"
        except (lifecycle_state.StateError, OSError, ValueError):
            print("telegram_lifecycle_state_unreadable", file=sys.stderr)
            return 1
        print("jht" + ("\njht-telegram" if configured else ""))  # the broker is made at its first use: the host adds it when it is there
        return 0
    parser = argparse.ArgumentParser(prog="telegram-lifecycle")
    parser.add_argument("phase", choices=("prepare", "complete"))
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("role", nargs="?", default="")
    args = parser.parse_args(argv)
    try:
        configured = tuple(role for role in BOT_ROLES if store.read_bot(role))
        operations = plan(args.phase, args.action, args.role, configured)
        lifecycle_state.publish(bool(configured))
    except (store.StoreError, lifecycle_state.StateError, OSError, ValueError) as exc:
        reason = str(exc) if isinstance(exc, (ValueError, lifecycle_state.StateError)) else getattr(exc, "code", "telegram_lifecycle_state_unreadable")
        print(reason, file=sys.stderr)
        return 1
    for operation in operations:
        print(operation)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
