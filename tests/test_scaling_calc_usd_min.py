"""JHT-T349 (F-04): the Captain set aside scaling_calc because it worked in units per hour, and projected with a
cost per worker he made up (0.011 $/min) when the team spent 0.15 $/min. scaling_calc now takes and gives USD per minute, and can
read the measured rate of the workers from the brake. Synthetic pi sessions in a private JHT_HOME."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CALC = ROOT / "agents" / "_skills" / "scaling-calc" / "scaling_calc.py"


def calc(*args, home=None):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONDONTWRITEBYTECODE": "1"}
    if home is not None:
        env["JHT_HOME"] = str(home)
    done = subprocess.run([sys.executable, str(CALC), *args], capture_output=True, text=True, env=env, timeout=30)
    return done


def session(home: Path, agent: str, calls):
    folder = home / ".pi" / "agent" / "sessions" / f"--jht_home-agents-{agent}--"
    folder.mkdir(parents=True, exist_ok=True)
    rows = [{"type": "session", "version": 3, "id": agent, "cwd": f"/jht_home/agents/{agent}"}]
    for ts, cost in calls:
        rows.append({"type": "message", "timestamp": datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                     "message": {"role": "assistant", "usage": {"input": 0, "output": 10, "cacheRead": 0, "cacheWrite": 0,
                                                                 "reasoning": 0, "cost": {"total": cost}}}})
    (folder / "s.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def test_usd_per_minute_in_and_out():
    done = calc("--unit", "usd-min", "--target", "0.05", "--measured", "0.15")
    assert done.returncode == 0, done.stderr
    assert "0.05 USD/min" in done.stdout and "0.15 USD/min" in done.stdout and "/h" not in done.stdout
    data = json.loads(calc("--unit", "usd-min", "--target", "0.05", "--measured", "0.15", "--json").stdout)
    assert data["unit"] == "usd-min" and data["workers"] == 1 and data["burn_expected"] <= 0.06


def test_the_measured_rate_comes_from_the_real_spending_of_the_workers(tmp_path):
    now = time.time()
    session(tmp_path, "scout-1", [(now - 300, 0.75), (now - 120, 0.75)])
    session(tmp_path, "scorer-1", [(now - 200, 1.5)])
    session(tmp_path, "capitano", [(now - 100, 5.0)])          # not a worker: not in the worker rate
    data = json.loads(calc("--target", "0.1", "--measured-from-spend", "--json", home=tmp_path).stdout)
    assert data["unit"] == "usd-min" and data["measured_per_worker"] == 0.15


def test_the_old_units_are_unchanged():
    assert calc("--self-test").returncode == 0
    assert "/h" in calc("--target", "0.7", "--measured", "1.4").stdout
