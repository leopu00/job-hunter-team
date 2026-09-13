"""Every operational launcher caller identifies itself in the spawn trace."""

import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
START_AGENT = ROOT / ".launcher" / "start-agent.sh"


def _source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_an_agent_shell_falls_back_to_its_runtime_identity(tmp_path):
    result = subprocess.run(
        ["bash", str(START_AGENT), "not-a-role"],
        cwd=ROOT,
        env={
            **os.environ,
            "JHT_HOME": str(tmp_path),
            "JHT_AGENT_NAME": "capitano",
        },
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 1
    row = json.loads(
        (tmp_path / "logs" / "spawn-attempts.jsonl").read_text(encoding="utf-8")
    )
    assert row["source"] == "capitano"


def test_cli_and_watchdog_forward_their_source_across_process_boundaries():
    cli = _source("cli/src/commands/team/start.js")
    assert re.search(
        r"JHT_SPAWN_SRC:\s*process\.env\.JHT_SPAWN_SRC\s*\|\|\s*['\"]cli-team-start['\"]",
        cli,
    )

    watchdog = _source(".launcher/agent-watchdog.sh")
    spawn_lines = [
        line
        for line in watchdog.splitlines()
        if ("team start" in line and '"$NODE_BIN"' in line)
        or ('bash "$START_AGENT"' in line)
    ]
    assert len(spawn_lines) == 4, spawn_lines
    assert all("JHT_SPAWN_SRC=agent-watchdog" in line for line in spawn_lines)


def test_worker_fallbacks_and_pid1_launches_declare_their_source():
    sentinel = _source(".launcher/sentinel-bridge.py")
    check_usage = _source("shared/skills/check_usage.py")
    assert '"JHT_SPAWN_SRC": "sentinel-bridge"' in sentinel
    assert '"JHT_SPAWN_SRC": "check-usage"' in check_usage

    pid1 = _source("cli/src/commands/pid1.js")
    # Two direct bridge launches plus the per-role CLI autostart.
    assert pid1.count("JHT_SPAWN_SRC: 'pid1'") == 2
    assert pid1.count("JHT_SPAWN_SRC: 'pid1-autostart'") == 1


def test_desktop_assistant_recovery_names_the_desktop_as_source():
    backend = _source("game/scripts/backend/vps_backend.gd")
    assert "JHT_SPAWN_SRC=desktop-assistant-recovery" in backend
