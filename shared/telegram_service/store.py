"""Private secrets/state and the read-only agent attachment handoff."""

from __future__ import annotations

import contextlib
import errno
import fcntl
import json
import os
import secrets
import stat
from pathlib import Path
from typing import Any, Iterator

from .protocol import BOT_ROLES

MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
CUTOVER_STATE = "cutover"
TOKEN_HISTORY_STATE = "token-history"


class StoreError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def secrets_dir() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_SECRETS", "/jht_telegram_secrets"))


def state_dir() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_STATE", "/jht_telegram_state"))


def inbox_dir() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_INBOX", "/jht_telegram_inbox"))


def _check_dir(path: Path, *, private: bool = True) -> None:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        raise StoreError("store_missing") from None
    if not stat.S_ISDIR(info.st_mode):
        raise StoreError("store_not_a_directory")
    if info.st_uid != os.getuid():
        raise StoreError("store_foreign_owner")
    forbidden = 0o077 if private else 0o027
    if info.st_mode & forbidden:
        raise StoreError("store_permissions")


def _read_json(path: Path, default: Any = None) -> Any:
    _check_dir(path.parent)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return default
    except OSError as exc:
        raise StoreError("store_symlink" if exc.errno == errno.ELOOP else "store_unreadable") from None
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077
        ):
            raise StoreError("store_unsafe_file")
        if info.st_size > MAX_FILE_BYTES:
            raise StoreError("store_too_large")
        with os.fdopen(fd, "rb") as handle:
            fd = -1
            raw = handle.read(MAX_FILE_BYTES + 1)
    finally:
        if fd >= 0:
            os.close(fd)
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise StoreError("store_unreadable") from None


def _write_json(directory: Path, name: str, value: Any) -> None:
    _check_dir(directory)
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    if len(raw) > MAX_FILE_BYTES:
        raise StoreError("store_too_large")
    temporary = f".{name}.{os.getpid()}.{secrets.token_hex(6)}.tmp"
    dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
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
            os.rename(temporary, name, src_dir_fd=dfd, dst_dir_fd=dfd)
            os.fsync(dfd)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temporary, dir_fd=dfd)
            raise
        finally:
            if fd >= 0:
                os.close(fd)
    finally:
        os.close(dfd)


def read_bot(role: str) -> dict[str, str] | None:
    if role not in BOT_ROLES:
        raise StoreError("bot_role_unknown")
    directory = secrets_dir() / "bots"
    value = _read_json(directory / f"{role}.json")
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"bot_token", "chat_id"}:
        raise StoreError("store_unreadable")
    if not all(isinstance(item, str) and item for item in value.values()):
        raise StoreError("store_unreadable")
    return value


def write_bot(role: str, value: dict[str, str]) -> None:
    if role not in BOT_ROLES:
        raise StoreError("bot_role_unknown")
    _write_json(secrets_dir() / "bots", f"{role}.json", value)


def delete_bot(role: str) -> bool:
    if role not in BOT_ROLES:
        raise StoreError("bot_role_unknown")
    directory = secrets_dir() / "bots"
    _check_dir(directory)
    try:
        os.unlink(directory / f"{role}.json")
        return True
    except FileNotFoundError:
        return False


def remember_token_digests(role: str, digests: list[str], *, inventory_complete: bool = False) -> None:
    """Keep every exposed/used token fingerprint for the lifetime of the volume.

    Deleting a bot must never make its token acceptable again.  The inventory
    bit is separate because an empty host inventory is still meaningful: it
    proves that the trusted host-side scan ran before pairing.
    """
    if role not in BOT_ROLES:
        raise StoreError("bot_role_unknown")
    if any(
        not isinstance(digest, str)
        or len(digest) != 64
        or any(char not in "0123456789abcdef" for char in digest)
        for digest in digests
    ):
        raise StoreError("token_digest_invalid")
    with locked(TOKEN_HISTORY_STATE):
        state = read_state(TOKEN_HISTORY_STATE, {})
        roles = state.setdefault("roles", {})
        entry = roles.setdefault(role, {})
        known = entry.get("digests") if isinstance(entry.get("digests"), list) else []
        entry["digests"] = sorted(set(known) | set(digests))
        if inventory_complete:
            entry["inventory_complete"] = True
        state["version"] = 1
        write_state(TOKEN_HISTORY_STATE, state)


def token_history(role: str) -> tuple[set[str], bool]:
    if role not in BOT_ROLES:
        raise StoreError("bot_role_unknown")
    with locked(TOKEN_HISTORY_STATE):
        state = read_state(TOKEN_HISTORY_STATE, {})
    roles = state.get("roles") if isinstance(state.get("roles"), dict) else {}
    entry = roles.get(role) if isinstance(roles.get(role), dict) else {}
    values = entry.get("digests") if isinstance(entry.get("digests"), list) else []
    digests = {
        value for value in values
        if isinstance(value, str) and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    }
    return digests, entry.get("inventory_complete") is True


def legacy_inventory_complete() -> bool:
    return all(token_history(role)[1] for role in BOT_ROLES)


def record_pairing(role: str, rotation: str) -> None:
    if role not in BOT_ROLES or rotation not in {"fresh", "rotated"}:
        raise StoreError("pairing_invalid")
    with locked(CUTOVER_STATE):
        state = read_state(CUTOVER_STATE, {})
        if state.get("enabled") is True:
            # Cutover is deliberately one-way. Pairing a replacement bot is
            # allowed, but it must not clear the boundary back to legacy.
            enabled = True
        else:
            enabled = False
        paired = state.setdefault("paired", {})
        paired[role] = rotation
        state["enabled"] = enabled
        write_state(CUTOVER_STATE, state)


def forget_pairing(role: str) -> None:
    if role not in BOT_ROLES:
        raise StoreError("bot_role_unknown")
    with locked(CUTOVER_STATE):
        state = read_state(CUTOVER_STATE, {})
        paired = state.get("paired")
        if isinstance(paired, dict):
            paired.pop(role, None)
        # Never clear enabled: removing a bot cannot restore legacy access.
        write_state(CUTOVER_STATE, state)


def enable_cutover() -> None:
    with locked(CUTOVER_STATE):
        state = read_state(CUTOVER_STATE, {})
        paired = state.get("paired")
        if not isinstance(paired, dict) or not paired:
            raise StoreError("pairing_required")
        if any(role not in BOT_ROLES or mode not in {"fresh", "rotated"} for role, mode in paired.items()):
            raise StoreError("pairing_invalid")
        for role in paired:
            if not read_bot(role):
                raise StoreError("bot_not_configured")
        state["enabled"] = True
        write_state(CUTOVER_STATE, state)


def cutover_enabled() -> bool:
    with locked(CUTOVER_STATE):
        state = read_state(CUTOVER_STATE, {})
    return state.get("enabled") is True


def cutover_status() -> dict[str, Any]:
    with locked(CUTOVER_STATE):
        state = read_state(CUTOVER_STATE, {})
    paired = state.get("paired") if isinstance(state.get("paired"), dict) else {}
    return {
        "enabled": state.get("enabled") is True,
        "paired": {role: paired[role] for role in BOT_ROLES if paired.get(role) in {"fresh", "rotated"}},
    }


def read_state(name: str, default: Any) -> Any:
    value = _read_json(state_dir() / f"{name}.json", default)
    return value if type(value) is type(default) else default


def write_state(name: str, value: Any) -> None:
    _write_json(state_dir(), f"{name}.json", value)


@contextlib.contextmanager
def locked(name: str) -> Iterator[None]:
    directory = state_dir()
    _check_dir(directory)
    fd = os.open(
        directory / f".{name}.lock",
        os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
    )
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def create_inbox_file(chunks: Iterator[bytes]) -> tuple[str, int]:
    """Create one opaque attachment; the caller never chooses its leaf name."""
    directory = inbox_dir()
    _check_dir(directory, private=False)
    opaque = secrets.token_hex(20)
    dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    written = 0
    try:
        fd = os.open(
            opaque,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o640,
            dir_fd=dfd,
        )
        try:
            os.fchmod(fd, 0o640)
            with os.fdopen(fd, "wb") as handle:
                fd = -1
                for chunk in chunks:
                    written += len(chunk)
                    if written > MAX_ATTACHMENT_BYTES:
                        raise StoreError("attachment_too_large")
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(opaque, dir_fd=dfd)
            raise
        finally:
            if fd >= 0:
                os.close(fd)
        os.fsync(dfd)
    finally:
        os.close(dfd)
    return opaque, written


def delete_inbox_file(opaque: str) -> None:
    if not re_full_opaque(opaque):
        raise StoreError("attachment_name_invalid")
    directory = inbox_dir()
    _check_dir(directory, private=False)
    dfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(opaque, dir_fd=dfd)
    finally:
        os.close(dfd)


def re_full_opaque(value: str) -> bool:
    return len(value) == 40 and all(char in "0123456789abcdef" for char in value)
