"""The broker's own disk: secrets and state, never reachable from the agents.

Two named volumes, mounted only in the `jht-broker` container (uid 1002):

- `jht-secrets` at `/jht_secrets`: the portal secrets, one JSON file per name
  from a closed list;
- `jht-broker-state` at `/jht_broker_state`: the mailbox policy, the allowed
  senders, the authorisation register, the sent-mail journal, the chat drafts,
  the rotation marks and the seen Message-IDs.

Every file is opened with O_NOFOLLOW, must be a regular file of this uid, and
is written 0600 through a temporary file and a rename. Nothing here prints a
value, a length or a hash.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import json
import os
import stat
from pathlib import Path
from typing import Any, Iterator

SECRET_NAMES = ("email_monitor", "email_transport")
MAX_FILE_BYTES = 4 * 1024 * 1024


class StoreError(Exception):
    """A fixed code, never a path content or a value."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def secrets_dir() -> Path:
    return Path(os.environ.get("JHT_BROKER_SECRETS", "/jht_secrets"))


def state_dir() -> Path:
    return Path(os.environ.get("JHT_BROKER_STATE", "/jht_broker_state"))


def _check_dir(path: Path) -> None:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        raise StoreError("store_missing") from None
    if not stat.S_ISDIR(info.st_mode):
        raise StoreError("store_not_a_directory")
    if info.st_uid != os.getuid():
        raise StoreError("store_foreign_owner")
    if info.st_mode & 0o077:
        os.chmod(path, 0o700)


def read_json(directory: Path, name: str, default: Any = None) -> Any:
    """The parsed file, or `default` when it does not exist."""
    _check_dir(directory)
    path = directory / name
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return default
    except OSError as exc:
        raise StoreError("store_symlink" if exc.errno == errno.ELOOP else "store_unreadable") from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise StoreError("store_not_a_file")
        if info.st_uid != os.getuid():
            raise StoreError("store_foreign_owner")
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


def write_json(directory: Path, name: str, data: Any) -> None:
    """Atomic 0600 write of `data` as `directory/name`."""
    _check_dir(directory)
    payload = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True).encode("utf-8")
    if len(payload) > MAX_FILE_BYTES:
        raise StoreError("store_too_large")
    tmp = directory / f".{name}.{os.getpid()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            fd = -1
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, directory / name)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise
    finally:
        if fd >= 0:
            os.close(fd)


def delete(directory: Path, name: str) -> bool:
    _check_dir(directory)
    try:
        os.unlink(directory / name)
        return True
    except FileNotFoundError:
        return False


@contextlib.contextmanager
def locked(name: str = "state") -> Iterator[None]:
    """Serialise read-modify-write of the state between the server and the
    admin commands, which run as separate processes."""
    directory = state_dir()
    _check_dir(directory)
    fd = os.open(directory / f".{name}.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def read_secret(name: str) -> dict | None:
    if name not in SECRET_NAMES:
        raise StoreError("secret_unknown")
    data = read_json(secrets_dir(), f"{name}.json")
    if data is not None and not isinstance(data, dict):
        raise StoreError("store_unreadable")
    return data


def write_secret(name: str, data: dict) -> None:
    if name not in SECRET_NAMES:
        raise StoreError("secret_unknown")
    write_json(secrets_dir(), f"{name}.json", data)


def delete_secret(name: str) -> bool:
    if name not in SECRET_NAMES:
        raise StoreError("secret_unknown")
    return delete(secrets_dir(), f"{name}.json")


def read_state(name: str, default: Any) -> Any:
    value = read_json(state_dir(), f"{name}.json", default)
    return default if type(value) is not type(default) else value


def write_state(name: str, data: Any) -> None:
    write_json(state_dir(), f"{name}.json", data)
