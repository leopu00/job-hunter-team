"""The launcher daemons must retain their flock after acquire returns."""

from __future__ import annotations

import gc
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

try:
    import resource
except ImportError:  # pragma: no cover - Windows
    resource = None  # type: ignore[assignment]


ROOT = Path(__file__).resolve().parents[1]
SINGLETON = ROOT / "shared" / "skills" / "singleton_lock.py"
PROCESS_HELD_ATTR = "_jht_singleton_lock_handles"

DAEMONS = (
    ("sentinel-bridge", ROOT / ".launcher" / "sentinel-bridge.py", "acquire_singleton_lock"),
    ("pacing-bridge", ROOT / ".launcher" / "pacing-bridge.py", "acquire_singleton_lock"),
    ("heartbeat-bridge", ROOT / ".launcher" / "heartbeat-bridge.py", "_acquire_singleton"),
    ("token-meter", ROOT / "shared" / "skills" / "token-meter.py", "acquire_singleton_lock"),
    ("agent-vitals", ROOT / "shared" / "skills" / "agent_vitals.py", "_acquire_singleton"),
    (
        "window-ratio-meter",
        ROOT / "shared" / "skills" / "window_ratio_meter.py",
        "_acquire_singleton",
    ),
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(f"singleton_test_{name.replace('-', '_')}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _matching_fds(path: Path) -> list[int]:
    assert resource is not None
    target = path.stat()
    soft_limit, _hard_limit = resource.getrlimit(resource.RLIMIT_NOFILE)
    limit = 4096 if soft_limit == resource.RLIM_INFINITY else min(int(soft_limit), 4096)
    matches = []
    for fd in range(limit):
        try:
            opened = os.fstat(fd)
        except OSError:
            continue
        if (opened.st_dev, opened.st_ino) == (target.st_dev, target.st_ino):
            matches.append(fd)
    return matches


def _release_test_lock(path: Path) -> None:
    try:
        target = path.stat()
    except FileNotFoundError:
        return
    held = getattr(sys, PROCESS_HELD_ATTR, [])
    kept = []
    for handle in held:
        try:
            opened = os.fstat(handle.fileno())
        except (OSError, ValueError):
            continue
        if (opened.st_dev, opened.st_ino) == (target.st_dev, target.st_ino):
            handle.close()
        else:
            kept.append(handle)
    held[:] = kept


def _probe_second_process(lock_file: Path) -> subprocess.CompletedProcess[str]:
    script = """
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("singleton_probe", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
acquired = module.acquire_singleton(sys.argv[2], label="probe", exit_on_busy=False)
print("acquired" if acquired else "busy")
raise SystemExit(9 if acquired else 0)
"""
    return subprocess.run(
        [sys.executable, "-c", script, str(SINGLETON), str(lock_file)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )


@pytest.mark.skipif(
    os.name != "posix" or resource is None,
    reason="flock lifetime is a POSIX contract",
)
@pytest.mark.parametrize(("label", "path", "acquire_name"), DAEMONS, ids=[row[0] for row in DAEMONS])
def test_daemon_keeps_singleton_fd_and_rejects_second_process(
    label: str,
    path: Path,
    acquire_name: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / label
    logs = home / "logs"
    logs.mkdir(parents=True)
    lock_file = logs / f"{label}.lock"
    pid_file = logs / f"{label}.pid"
    monkeypatch.setenv("JHT_HOME", str(home))

    # Normal imports also work, but each case starts clean so the two path
    # loaders exercise the exact lifetime that used to drop their module.
    sys.modules.pop("singleton_lock", None)
    daemon = _load(label, path)
    monkeypatch.setattr(daemon, "LOGS_DIR", logs, raising=False)
    monkeypatch.setattr(daemon, "LOCK_FILE", lock_file)
    monkeypatch.setattr(daemon, "PID_FILE", pid_file, raising=False)

    try:
        getattr(daemon, acquire_name)()
        gc.collect()

        assert len(_matching_fds(lock_file)) == 1
        contender = _probe_second_process(lock_file)
        assert contender.returncode == 0, contender.stdout + contender.stderr
        assert contender.stdout.rstrip().endswith("busy")
    finally:
        _release_test_lock(lock_file)
