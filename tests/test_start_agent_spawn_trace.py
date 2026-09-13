"""Every launcher invocation leaves one structured spawn result.

The trace is intentionally exercised through the real ``start-agent.sh``
entry point.  A rejected role proves that the EXIT trap records paths which
fail before tmux is touched; an already-active fake session proves the clean
exit without starting a real agent.
"""

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = ROOT / ".launcher" / "start-agent.sh"


def _run(tmp_path: Path, *args: str, source: str, fake_tmux: bool = False):
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_SPAWN_SRC": source}
    if fake_tmux:
        fake_bin = tmp_path / "bin"
        fake_bin.mkdir()
        tmux = fake_bin / "tmux"
        tmux.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        tmux.chmod(0o755)
        env["PATH"] = f"{fake_bin}{os.pathsep}{env.get('PATH', '')}"
    result = subprocess.run(
        ["bash", str(LAUNCHER), *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    trace = tmp_path / "logs" / "spawn-attempts.jsonl"
    rows = [json.loads(line) for line in trace.read_text(encoding="utf-8").splitlines()]
    return result, rows


def _assert_common_shape(row: dict):
    assert set(row) == {
        "timestamp",
        "session",
        "role",
        "source",
        "flock_wait_s",
        "stage",
        "rc",
        "duration_s",
    }
    assert datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
    assert isinstance(row["flock_wait_s"], int) and row["flock_wait_s"] >= 0
    assert isinstance(row["duration_s"], int) and row["duration_s"] >= 0


def test_error_exit_writes_exactly_one_valid_json_row(tmp_path):
    source = 'test harness "quoted"\x01\nnext line'
    result, rows = _run(tmp_path, "not-a-role", source=source)

    assert result.returncode == 1
    assert len(rows) == 1
    row = rows[0]
    _assert_common_shape(row)
    assert row["role"] == "not-a-role"
    assert row["session"] == "not-a-role"
    assert row["source"] == 'test harness "quoted"next line'
    assert row["stage"] == "role_validation"
    assert row["rc"] == 1


def test_clean_already_active_exit_is_one_completed_attempt(tmp_path):
    result, rows = _run(
        tmp_path,
        "assistente",
        source="cli-team-start",
        fake_tmux=True,
    )

    assert result.returncode == 0, result.stderr
    assert len(rows) == 1
    row = rows[0]
    _assert_common_shape(row)
    assert row["session"] == "ASSISTENTE"
    assert row["role"] == "assistente"
    assert row["source"] == "cli-team-start"
    assert row["stage"] == "already_active"
    assert row["rc"] == 0


def test_lock_timeout_records_the_time_actually_spent_waiting(tmp_path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    flock = fake_bin / "flock"
    flock.write_text("#!/bin/sh\nsleep 2\nexit 1\n", encoding="utf-8")
    flock.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}",
        "JHT_HOME": str(tmp_path),
        "JHT_SPAWN_SRC": "wait-test",
        "JHT_SPAWN_LOCK_WAIT_SEC": "1",
    }

    result = subprocess.run(
        ["bash", str(LAUNCHER), "assistente"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 1
    row = json.loads(
        (tmp_path / "logs" / "spawn-attempts.jsonl").read_text(encoding="utf-8")
    )
    assert row["stage"] == "lock_timeout"
    assert row["flock_wait_s"] >= 2


def test_launcher_declares_only_one_exit_trap():
    source = LAUNCHER.read_text(encoding="utf-8")
    exit_traps = [
        line.strip()
        for line in source.splitlines()
        if re.match(r"^\s*trap\s+(?!-)\S+\s+EXIT\s*$", line)
    ]
    assert exit_traps == ["trap _spawn_on_exit EXIT"]
