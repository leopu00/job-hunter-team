"""Owner-written public lifecycle hint: one boolean, never Telegram secrets."""

from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import stat


class StateError(Exception):
    pass


def directory() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_SOCKET_DIR", "/run/jht-telegram"))


def _check_owner(path: Path, expected: int, *, folder: bool = False) -> None:
    info = path.lstat()
    correct_type = stat.S_ISDIR(info.st_mode) if folder else stat.S_ISREG(info.st_mode)
    if not correct_type or info.st_uid != expected or info.st_mode & (0o022 if folder else 0o222):
        raise StateError("telegram_lifecycle_state_unsafe")


def publish(configured: bool) -> None:
    root = directory()
    _check_owner(root, os.getuid(), folder=True)
    target = root / "lifecycle.json"
    if target.exists() or target.is_symlink():
        _check_owner(target, os.getuid())
    temporary = root / (".lifecycle-" + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(json.dumps({"version": 1, "configured": configured}).encode("ascii"))
            stream.flush()
            os.fchmod(stream.fileno(), 0o444)
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        folder = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        if temporary.exists():
            temporary.unlink()


def boot_operation() -> str:
    owner = int(os.environ.get("JHT_TELEGRAM_SERVICE_UID", "1003"))
    root = directory()
    _check_owner(root, owner, folder=True)
    fd = os.open(root / "lifecycle.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_mode & 0o222 or info.st_size > 128:
            raise StateError("telegram_lifecycle_state_unsafe")
        value = json.loads(stream.read(129))
    if not isinstance(value, dict) or set(value) != {"version", "configured"} or type(value["version"]) is not int or value["version"] != 1 or type(value["configured"]) is not bool:
        raise StateError("telegram_lifecycle_state_invalid")
    return "start" if value["configured"] else "noop"
