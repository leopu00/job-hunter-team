"""A `jht setup` that is open (`$JHT_HOME/.setup-open.flag`): the agent watchdog and the Dottore's watchdog respawn nothing
while the service is being chosen (a trial of the ChatGPT subscription on Pi: the team started on the old key and spent)."""

from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / ".launcher" / "agent-watchdog.sh"
DOCTOR = ROOT / ".launcher" / "doctor-watchdog.sh"


def _function(script: Path) -> str:
    text = script.read_text(encoding="utf-8")
    flag = re.search(r'^SETUP_OPEN_FLAG=.*$', text, re.M).group(0)
    fn = re.search(r'^setup_open\(\) \{.*\}$', text, re.M).group(0)
    return flag + "\n" + fn + "\n"


def _open(script: Path, home: Path) -> bool:
    code = 'JHT_HOME="%s"\n%s\nsetup_open && echo yes || echo no\n' % (home, _function(script))
    out = subprocess.run(["bash", "-c", code], capture_output=True, text=True, timeout=30, check=True).stdout.strip()
    return out == "yes"


@pytest.mark.parametrize("script", [AGENT, DOCTOR], ids=["agent-watchdog", "doctor-watchdog"])
def test_the_gate_sees_a_fresh_flag_and_not_an_old_one(tmp_path: Path, script: Path):
    assert _open(script, tmp_path) is False
    flag = tmp_path / ".setup-open.flag"
    flag.write_text("now\n", encoding="utf-8")
    assert _open(script, tmp_path) is True
    old = time.time() - 3 * 3600
    os.utime(flag, (old, old))
    assert _open(script, tmp_path) is False  # a killed setup does not hold the team for ever


def test_the_respawn_loops_skip_while_the_setup_is_open():
    agent = AGENT.read_text(encoding="utf-8")
    assert re.search(r'\|\| setup_open; then\n\s+if \[ \$\(\(halt_log_tick % 20\)\)', agent), "the agent watchdog loop must stop on the flag"
    doctor = DOCTOR.read_text(encoding="utf-8")
    assert "|| setup_open || standby_active; then" in doctor, "the Dottore's loop must stop on the flag"
