"""Inspect and remove legacy Telegram credentials without printing secrets.

This helper runs in the agent container only for the old files. The new token
is piped by the host directly to the isolated service and never crosses here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

from .protocol import BOT_ROLES


class LegacyError(Exception):
    pass


def home() -> Path:
    return Path(os.environ.get("JHT_HOME", "/jht_home"))


def _safe_json(path: Path) -> dict:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return {}
    except OSError as exc:
        raise LegacyError("legacy_file_unsafe") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > 4 * 1024 * 1024:
            raise LegacyError("legacy_file_unsafe")
        with os.fdopen(fd, "rb") as handle:
            fd = -1
            value = json.load(handle)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LegacyError("legacy_file_invalid") from exc
    finally:
        if fd >= 0:
            os.close(fd)
    if not isinstance(value, dict):
        raise LegacyError("legacy_file_invalid")
    return value


def _config_paths() -> list[Path]:
    root = home()
    paths = [root / "jht.config.json"]
    try:
        names = sorted(
            entry.name for entry in os.scandir(root)
            if entry.name.startswith("jht.config.json.bak-model-pin-")
        )
    except FileNotFoundError:
        names = []
    paths.extend(root / name for name in names)
    return paths


def _config_tokens(config: dict, role: str) -> list[object]:
    bots = ((config.get("channels") or {}).get("telegram") or {}).get("bots") or {}
    values: list[object] = []
    if isinstance(bots, dict) and isinstance(bots.get(role), dict):
        values.append(bots[role].get("bot_token"))
    return values


def _tokens(role: str) -> list[str]:
    values: list[object] = []
    for path in _config_paths():
        values.extend(_config_tokens(_safe_json(path), role))
    if role == "assistente":
        credentials = _safe_json(home() / "credentials" / "telegram_bot.json")
        values.append(credentials.get("token"))
        # docker exec inherits the container's configured environment, not a
        # calling agent's ad-hoc environment. An installed legacy token here
        # cannot be erased safely at runtime, so it deliberately keeps the
        # cutover pending until the host removes it and recreates the service.
        values.append(os.environ.get("TELEGRAM_BOT_TOKEN"))
    return [value.strip() for value in values if isinstance(value, str) and value.strip()]


def _write_config(path: Path, value: dict) -> None:
    parent = path.parent
    raw = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    temporary = f".{path.name}.{os.getpid()}.telegram-migration"
    dfd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=dfd,
        )
        try:
            with os.fdopen(fd, "wb") as handle:
                fd = -1
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.rename(temporary, path.name, src_dir_fd=dfd, dst_dir_fd=dfd)
            os.fsync(dfd)
        finally:
            if fd >= 0:
                os.close(fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=dfd)
        except (FileNotFoundError, OSError):
            pass
        os.close(dfd)


def remove(role: str) -> None:
    for path in _config_paths():
        config = _safe_json(path)
        channels = config.get("channels")
        telegram = channels.get("telegram") if isinstance(channels, dict) else None
        bots = telegram.get("bots") if isinstance(telegram, dict) else None
        if isinstance(bots, dict) and role in bots:
            bots.pop(role, None)
            _write_config(path, config)
    if role == "assistente":
        credentials = home() / "credentials" / "telegram_bot.json"
        try:
            info = os.lstat(credentials)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                raise LegacyError("legacy_file_unsafe")
            os.unlink(credentials)
        except FileNotFoundError:
            pass


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="telegram-legacy")
    parser.add_argument("command", choices=("inventory", "remove", "remaining"))
    parser.add_argument("role", choices=BOT_ROLES, nargs="?")
    args = parser.parse_args(argv)
    try:
        if args.command in {"inventory", "remove"} and not args.role:
            raise LegacyError("role_required")
        if args.command == "inventory":
            for token in _tokens(args.role):
                print(hashlib.sha256(token.encode("utf-8")).hexdigest())
        elif args.command == "remove":
            remove(args.role)
        else:
            remaining = [role for role in BOT_ROLES if _tokens(role)]
            print(" ".join(remaining))
            return 1 if remaining else 0
    except LegacyError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
