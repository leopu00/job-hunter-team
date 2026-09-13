"""A timed-out spawn identifies the process which owns its flock."""

import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = ROOT / ".launcher" / "start-agent.sh"


def test_lock_timeout_names_holder_pid_process_and_age(tmp_path):
    home = tmp_path / "home"
    lock = home / "locks" / "start-ASSISTENTE.lock"

    proc_root = tmp_path / "proc"
    holder = proc_root / "4242"
    (holder / "fd").mkdir(parents=True)
    (holder / "comm").write_text("held-spawn\n", encoding="utf-8")
    (holder / "fd" / "7").symlink_to(lock)
    os.utime(holder, (time.time() - 37, time.time() - 37))

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    flock = fake_bin / "flock"
    flock.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    flock.chmod(0o755)

    result = subprocess.run(
        ["bash", str(LAUNCHER), "assistente"],
        cwd=ROOT,
        env={
            **os.environ,
            "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}",
            "JHT_HOME": str(home),
            "JHT_SPAWN_PROC_ROOT": str(proc_root),
            "JHT_SPAWN_LOCK_WAIT_SEC": "1",
        },
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 1
    match = re.search(
        r"lock holder: pid=4242 process=held-spawn age=(\d+)s",
        result.stderr,
    )
    assert match, result.stderr
    assert 30 <= int(match.group(1)) <= 90
