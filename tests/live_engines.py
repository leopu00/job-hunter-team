"""Which container engines a live test may use, and how to call them.

Podman without --connection acts on its DEFAULT connection. On a Mac or on
Windows that is a machine: the user's own, another product's, or JHT's, and a
live test would start it up and run containers on it. So a live test calls
Podman only:

- on Linux, where Podman runs locally (CI): plain `podman`, as before;
- anywhere, on the connection named by JHT_PODMAN_TEST_CONNECTION
  (`podman system connection list` shows the names).

Elsewhere, without the variable, the Podman case is skipped and the reason
says how to enable it. Docker is used as it is found.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

import pytest

CONNECTION_ENV = "JHT_PODMAN_TEST_CONNECTION"

PODMAN_SKIP = (
    f"Podman on {sys.platform} runs in a machine and this test never uses the "
    f"default connection: set {CONNECTION_ENV}=<connection> "
    "(podman system connection list) to run it on that machine"
)


def connection() -> str:
    return os.environ.get(CONNECTION_ENV, "").strip()


def engine_argv(engine: str) -> list[str] | None:
    """The command that reaches the engine, or None when it may not be used."""
    if engine != "podman":
        return [engine]
    if connection():
        return ["podman", "--connection", connection()]
    if sys.platform.startswith("linux"):
        return ["podman"]
    return None


def engine_env(engine: str) -> dict[str, str]:
    """Environment for a child process that calls the engine by itself."""
    if engine == "podman" and connection():
        return {"CONTAINER_CONNECTION": connection()}
    return {}


def _engine_ok(argv: list[str]) -> bool:
    if shutil.which(argv[0]) is None:
        return False
    try:
        return subprocess.run([*argv, "info"], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def live_engines() -> list:
    """Parameters for the live tests: one per usable engine.

    Podman found but not allowed (no connection outside Linux) is a skipped
    parameter with PODMAN_SKIP, so the run says why it did not happen.
    """
    params: list = []
    for engine in ("docker", "podman"):
        argv = engine_argv(engine)
        if argv is None:
            if shutil.which(engine) is not None:
                params.append(pytest.param(engine, marks=pytest.mark.skip(reason=PODMAN_SKIP)))
        elif _engine_ok(argv):
            params.append(engine)
    return params
