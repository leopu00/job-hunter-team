#!/usr/bin/env python3
"""The API key of a run, read from a file on tmpfs and handed to the agent's process through its environment only.

Why. start-agent.sh used to read `providers.<p>.api_key` from jht.config.json and type `OPENAI_API_KEY='<key>' codex ...`
into the tmux pane: the key sat in a file in clear, in the command line of the pane, in the scrollback and in the shell
history of the agent. For a run that spends real money (the 30-minute run of the benchmark kit) the key must exist only
where it is used. The person (or the kit) writes it to a file on tmpfs, `JHT_API_KEY_FILE=<path>`, and the launcher wraps
the harness in this script:

    <ENV assignments> python3 /app/shared/skills/api_key_file.py exec --env OPENAI_API_KEY -- codex <args>

`exec` reads the file, checks it, puts the key in the environment of the command and replaces itself with it
(`execve`): the key is never in an argument, in the text typed into the pane or in a file the agent writes, and when
anything is wrong NOTHING is started (the harness is not launched without a key, and not with a half-checked one).

What is checked before a byte of the file is read (every refusal says what, never the key):
  * `JHT_API_KEY_FILE` is an absolute path without `..`;
  * the file is a regular file opened without following links (`O_NOFOLLOW`), the one that was looked at (same device
    and inode), with ONE link (no hard link planted elsewhere), owned by the user that runs this, mode with no bit for
    group or others (0600 or 0400), between 1 and 4096 bytes;
  * its folder belongs to this user or to root and nobody else can write in it (or it is sticky, like /dev/shm);
  * it lives on tmpfs or ramfs (`/proc/mounts`, the longest mount point above the real path): on a disk the key would
    outlive the run. Without `/proc/mounts` (not Linux) it is refused: the launcher runs in the container;
    ONE other place is accepted, the key store of the setup (KEY_STORE, `jht setup --api-key-file|--api-key-stdin` for glm
    and kimi): a folder of the container's own volume, the user's, mode 0700 (a key a person gave the setup must outlive
    the container; on the bind mount of ~/.jht, which shows every file as 0777 on Windows, it never could);
  * the content is one line of 16 to 512 printable ASCII characters, no spaces (a trailing newline is dropped).

The agent runs as the same user and can read the file too: this keeps the key out of argv, config and logs, it does not
hide it from the agent's own account. The file is for the run and is removed by whoever created it when the run ends.

    api_key_file.py check [--from-env VAR]         # exit 0 and «ok», or 78 and the reason
    api_key_file.py exec --env NAME [--from-env VAR] -- CMD [ARG..]   # NAME in OPENAI_API_KEY ANTHROPIC_API_KEY MOONSHOT_API_KEY ZAI_API_KEY
"""

from __future__ import annotations

import argparse
import os
import re
import stat
import sys
from pathlib import Path

FILE_ENV = "JHT_API_KEY_FILE"
KEY_ENV_NAMES = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY", "ZAI_API_KEY")
MAX_BYTES = 4096
TMPFS_TYPES = ("tmpfs", "ramfs")
_KEY = re.compile(r"[!-~]{16,512}")
EXIT_REFUSED = 78  # EX_CONFIG
# The folder of the setup's keys: on the volume of the container (not the bind mount of the host's ~/.jht), made 0700 by
# `jht setup` (cli/wizard/key-store.js writes there; keep the two paths together).
KEY_STORE = Path("/opt/jht-deps/keys")


class KeyFileError(Exception):
    """A refusal. The message never holds the key."""


def _tmpfs(path: Path, mounts: Path) -> None:
    try:
        lines = mounts.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        raise KeyFileError("cannot tell the file system of the key file (no %s): refused" % mounts) from error
    best = None
    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        point = parts[1].replace("\\040", " ")
        if (str(path) == point or str(path).startswith(point.rstrip("/") + "/") or point == "/") and (
                best is None or len(point) >= len(best[0])):
            best = (point, parts[2])
    if best is None or best[1] not in TMPFS_TYPES:
        raise KeyFileError("the key file is not on tmpfs (it is on %s): it would outlive the run"
                           % (best[1] if best else "an unknown file system"))


def _folder(path: Path, uid: int) -> None:
    info = os.lstat(path.parent)
    if not stat.S_ISDIR(info.st_mode):
        raise KeyFileError("the folder of the key file is not a folder")
    if info.st_uid not in (uid, 0):
        raise KeyFileError("the folder of the key file belongs to another user")
    if info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX:
        raise KeyFileError("the folder of the key file is writable by others and not sticky")


def _store(path: Path, uid: int, store: Path) -> bool:
    """True when `path` is a file straight inside the key store; raises when the store is there but not safe.

    The folder named in the path is compared as written (no «..», no link in the file itself: checked by the caller);
    the store itself must be a real folder of this user that nobody else can enter."""
    if str(path.parent) != str(store):
        return False
    try:
        info = os.lstat(store)
    except OSError as error:
        raise KeyFileError("the key store cannot be read: %s" % error.strerror) from error
    if not stat.S_ISDIR(info.st_mode):
        raise KeyFileError("the key store is not a folder")
    if info.st_uid != uid:
        raise KeyFileError("the key store belongs to another user")
    if info.st_mode & 0o077:
        raise KeyFileError("the key store has permissions for group or others (%s): it must be 0700" % oct(info.st_mode & 0o777))
    return True


def read_key(path=None, *, uid=None, mounts=Path("/proc/mounts"), store=KEY_STORE) -> str:
    """The key of the file named by JHT_API_KEY_FILE (or `path`), after every check. Raises KeyFileError."""
    raw = path if path is not None else os.environ.get(FILE_ENV, "")
    if not raw:
        raise KeyFileError("%s is not set" % FILE_ENV)
    if "\0" in raw or not os.path.isabs(raw) or ".." in Path(raw).parts:
        raise KeyFileError("%s must be an absolute path without «..»" % FILE_ENV)
    target = Path(raw)
    uid = os.geteuid() if uid is None else uid
    try:
        before = os.lstat(target)
    except OSError as error:
        raise KeyFileError("the key file cannot be read: %s" % error.strerror) from error
    if stat.S_ISLNK(before.st_mode):
        raise KeyFileError("the key file is a link: refused")
    if not stat.S_ISREG(before.st_mode):
        raise KeyFileError("the key file is not a regular file")
    if before.st_nlink != 1:
        raise KeyFileError("the key file has more than one link: refused")
    if before.st_uid != uid:
        raise KeyFileError("the key file belongs to another user")
    if before.st_mode & 0o077:
        raise KeyFileError("the key file has permissions for group or others (%s): it must be 0600" % oct(before.st_mode & 0o777))
    if not before.st_mode & 0o400:
        raise KeyFileError("the key file is not readable by its owner")
    if not 1 <= before.st_size <= MAX_BYTES:
        raise KeyFileError("the key file is empty or too big (1 to %d bytes)" % MAX_BYTES)
    try:
        _folder(target, uid)
        if not _store(target, uid, Path(store)):
            _tmpfs(target.resolve(strict=True), Path(mounts))
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise KeyFileError("the key file cannot be opened: %s" % error.strerror) from error
    try:
        after = os.fstat(fd)
        if (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino):
            raise KeyFileError("the key file changed while it was being checked")
        data = os.read(fd, MAX_BYTES + 1)
    finally:
        os.close(fd)
    text = data.decode("ascii", errors="replace")
    key = text[:-2] if text.endswith("\r\n") else text[:-1] if text.endswith("\n") else text
    if not _KEY.fullmatch(key):
        raise KeyFileError("the content of the key file is not one line of 16 to 512 printable characters without spaces")
    return key


_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")
# The config names the variable, and whoever writes the config must not be able to hand an agent another secret of the
# container: the name has to be an API key variable (…_API_KEY), outside the variables of the launcher and the services, and
# never the key variable of ANOTHER provider.
_DENIED_PREFIXES = ("JHT_", "FLEET", "SUPABASE", "TELEGRAM", "NEXT_", "LD_", "PYTHON", "NODE_")


def check_env_name(name: str, target: str | None = None) -> None:
    """Raises KeyFileError unless `name` may be the source of a key (for the variable `target` of the provider)."""
    if not _ENV_NAME.fullmatch(name or ""):
        raise KeyFileError("the name of the environment variable is not valid")
    upper = name.upper()
    if not upper.endswith("_API_KEY"):
        raise KeyFileError("the name of the environment variable must end in _API_KEY")
    if upper.startswith(_DENIED_PREFIXES):
        raise KeyFileError("the environment variable %s is not one a key may be read from" % name)
    if name in KEY_ENV_NAMES and target is not None and name != target:
        raise KeyFileError("%s is the key variable of another provider: refused" % name)


def read_key_env(name: str, target: str | None = None) -> str:
    """The key held by the environment variable `name` of this process (the container's), checked like a file's content.

    For `api_key_ref` of source env in the config: the variable is in the environment of the container, so every launch
    (team start, the watchdog's restart) sees it. Raises KeyFileError; the message never holds the value."""
    check_env_name(name, target)
    value = os.environ.get(name, "")
    if not value:
        raise KeyFileError("the environment variable %s is not set" % name)
    if not _KEY.fullmatch(value):
        raise KeyFileError("the value of %s is not one line of 16 to 512 printable characters without spaces" % name)
    return value


def _refuse(error: KeyFileError) -> int:
    print("api_key_file: %s" % error, file=sys.stderr)
    return EXIT_REFUSED


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="check the key file, print ok")
    check.add_argument("--from-env", metavar="VAR", help="take the key from this environment variable, not from the file")
    check.add_argument("--env", choices=KEY_ENV_NAMES, help="the variable of the provider the key is for (with --from-env)")
    run = sub.add_parser("exec", help="start CMD with the key in the environment NAME")
    run.add_argument("--env", required=True, choices=KEY_ENV_NAMES)
    run.add_argument("--from-env", metavar="VAR", help="take the key from this environment variable, not from the file")
    run.add_argument("cmd", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    try:
        key = read_key_env(args.from_env, args.env) if args.from_env else read_key()
    except KeyFileError as error:
        return _refuse(error)
    if args.command == "check":
        print("ok")
        return 0
    cmd = args.cmd[1:] if args.cmd[:1] == ["--"] else args.cmd
    if not cmd:
        return _refuse(KeyFileError("no command to start"))
    env = {name: value for name, value in os.environ.items() if name != FILE_ENV and name != args.from_env}
    env[args.env] = key
    try:
        os.execvpe(cmd[0], cmd, env)
    except OSError as error:
        print("api_key_file: cannot start %s: %s" % (cmd[0], error.strerror), file=sys.stderr)
        return 127
    return 0  # not reached


if __name__ == "__main__":
    sys.exit(main())
