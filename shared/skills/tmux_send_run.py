#!/usr/bin/env python3
"""Run `jht-tmux-send` for a program that cannot wait for it, without killing it.

A bridge, a watchdog or a skill calls the transport with `subprocess.run(..., timeout=N)`. At the deadline
`subprocess.run` KILLS the transport. The transport has deadlines of its own (up to 100 s for a pane that is not
at its prompt), and between its paste and its Enter there is a window: a kill there leaves the paste in the
composer with no Enter, and the agent is deaf to every later message until a person presses Enter (TEST 5,
27/10, the Capitano).

`run()` is the drop-in: the same arguments that matter, the same result (a `CompletedProcess`), the same
`TimeoutExpired` at the deadline, so the caller's tick goes on exactly as before. What changes:

  - at the deadline the transport is NOT killed: it finishes by itself (a thread collects it);
  - a second delivery to a session whose transport still runs is not stacked on it: it answers rc=8 («the
    session is busy with a delivery of ours»), which every caller already treats as «not delivered, try later»;
  - the call after an overrun first asks the transport to free the composer (`--flush-ours`: Enter only on a
    text it can prove is its own), once, then delivers.

State is per process. A module that cannot be loaded leaves the caller on its old `subprocess.run`.
"""
from __future__ import annotations

import subprocess
import threading

BUSY_RC = 8
FLUSH_WAIT_S = 60.0

_lock = threading.Lock()
_running: dict[str, subprocess.Popen] = {}
_overran: set[str] = set()


def _spawn(args, text: bool):
    return subprocess.Popen(list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=text,
                            start_new_session=True)


def _wait(args, timeout: float, text: bool, session: str | None) -> subprocess.CompletedProcess:
    proc = _spawn(args, text)
    if session is not None:
        with _lock:
            _running[session] = proc
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        threading.Thread(target=proc.communicate, daemon=True).start()
        raise
    return subprocess.CompletedProcess(list(args), proc.returncode, out, err)


def _session_of(args) -> str | None:
    """The session a delivery is for: `[binary, session, message]`; `--flush-ours` and other flags have none."""
    if len(args) < 3 or str(args[1]).startswith("-"):
        return None
    return str(args[1])


def run(args, timeout: float, *, text: bool = False) -> subprocess.CompletedProcess:
    """`subprocess.run(args, capture_output=True, text=text, timeout=timeout)` that does not kill at the deadline."""
    session = _session_of(args)
    if session is not None:
        with _lock:
            previous = _running.get(session)
            if previous is not None and previous.poll() is None:
                empty = "" if text else b""
                note = f"jht-tmux-send: a delivery to {session} is still running: not stacking another (rc=8)\n"
                return subprocess.CompletedProcess(list(args), BUSY_RC, empty, note if text else note.encode())
            overran = session in _overran
            _overran.discard(session)
        if overran:
            try:
                _wait([args[0], "--flush-ours", session], FLUSH_WAIT_S, text, None)
            except (subprocess.TimeoutExpired, OSError):
                with _lock:
                    _overran.add(session)
    try:
        return _wait(args, timeout, text, session)
    except subprocess.TimeoutExpired:
        if session is not None:
            with _lock:
                _overran.add(session)
        raise


def reset() -> None:
    """For tests."""
    with _lock:
        _running.clear()
        _overran.clear()
