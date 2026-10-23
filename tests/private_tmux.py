"""Private tmux servers for the tests that start a real one (T74).

A tmux server the suite starts and forgets keeps its pseudo-terminals: on a
shared machine they run out (511 on macOS), and then no terminal or agent
opens. So every test with a real tmux takes its folder from here:

- `private_dir()` makes a short folder under /tmp (a socket path is limited to
  about 100 characters), named after this process, and remembers it;
- `close_dir()` is the test's own cleanup: it kills every server answering
  under the folder, then removes it. A test never removes the folder itself,
  or a server it failed to kill would go on with no socket left to find it;
- `leftovers()` kills any server still answering on a socket under the
  folders made here, and says which: conftest calls it when the session ends
  and fails the session if there were any;
- `sweep_stale()` does the same for folders whose process is gone, which is
  what a killed run leaves: conftest calls it when a session starts.

Only sockets under these folders are touched, by their own path (-S): never
the default server, never another program's.
"""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path

PREFIX = "jht-tmux-"
_made: list[Path] = []


def _base() -> Path:
    return Path("/tmp") if os.path.isdir("/tmp") else Path(tempfile.gettempdir())


def private_dir(kind: str) -> Path:
    """A new folder for one private tmux server, kept for the end-of-session check."""
    folder = Path(tempfile.mkdtemp(prefix=f"{PREFIX}{os.getpid()}-{kind}-", dir=_base()))
    _made.append(folder)
    return folder


def made_dirs() -> list[Path]:
    return list(_made)


def _real_tmux() -> str | None:
    """The tmux binary, never a `tmux` script in front of it (a guard or a test's
    wrapper): the first one on PATH that is not a script."""
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(entry or ".") / "tmux"
        try:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                with candidate.open("rb") as handle:
                    if handle.read(2) != b"#!":
                        return str(candidate)
        except OSError:
            continue
    return None


def _env() -> dict[str, str]:
    # Inside a tmux pane TMUX would point a command at that pane's server.
    return {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE")}


def _sockets(folder: Path) -> list[Path]:
    found = []
    for root, dirs, files in os.walk(folder):
        for name in dirs + files:
            path = Path(root) / name
            try:
                if stat.S_ISSOCK(os.lstat(path).st_mode):
                    found.append(path)
            except OSError:
                continue
    return found


def _answers(tmux: str, socket: Path) -> bool:
    try:
        done = subprocess.run([tmux, "-S", str(socket), "list-sessions"], env=_env(),
                              capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


def _kill(tmux: str, socket: Path) -> None:
    try:
        subprocess.run([tmux, "-S", str(socket), "kill-server"], env=_env(),
                       capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass


def close_dir(folder: Path) -> None:
    """The test's cleanup: kill the servers under `folder`, then remove it."""
    leftovers([folder])


def leftovers(folders: list[Path]) -> list[str]:
    """Kill every server still answering under `folders`, remove the folders, and name the sockets."""
    tmux = _real_tmux()
    killed = []
    for folder in folders:
        if not folder.exists():
            continue
        if tmux:
            for socket in _sockets(folder):
                if _answers(tmux, socket):
                    _kill(tmux, socket)
                    killed.append(str(socket))
        shutil.rmtree(folder, ignore_errors=True)
    return killed


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def sweep_stale() -> list[str]:
    """The servers of runs that were killed: folders of ours whose process is gone."""
    if os.name == "nt":
        return []
    stale = []
    for folder in _base().glob(f"{PREFIX}*"):
        pid_text = folder.name[len(PREFIX):].split("-", 1)[0]
        try:
            if not pid_text.isdigit() or folder.stat().st_uid != os.getuid():
                continue
        except OSError:
            continue
        if not _process_alive(int(pid_text)):
            stale.append(folder)
    return leftovers(stale)
