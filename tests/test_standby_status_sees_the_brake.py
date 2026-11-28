"""JHT-T354: with the team paused by the spending brake (logs/daily-halt.flag, reason pi_spend_cap)
`standby.py status` said «STANDBY off — the team is operating normally», and the Assistente told the person the team was
working. The status now says the brake's pause, in the text and in the JSON. Synthetic figures, a private JHT_HOME.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SKILL = Path(__file__).resolve().parents[1] / "shared" / "skills" / "standby.py"

BUDGET = {"halted_at": "2026-11-26T23:56:23+00:00", "reason": "pi_spend_cap",
          "pi_spend_cap": {"why": "budget", "spent": 2.87, "ceiling": 3.0, "budget_usd": 3.0}}
PACE = {"halted_at": "2026-11-26T23:56:23+00:00", "reason": "pi_spend_cap",
        "pi_spend_cap": {"why": "pace", "spent": 1.2, "ceiling": 1.0, "budget_usd": 3.0,
                         "resumes_at": "2026-11-27T01:10:00+01:00"}}


def status(home: Path, *extra: str):
    env = {"JHT_HOME": str(home), "PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, str(SKILL), "status", *extra], capture_output=True, text=True, env=env,
                          timeout=30)
    assert done.returncode == 0, done.stderr
    return done.stdout


def flag(home: Path, payload) -> None:
    (home / "logs").mkdir(parents=True, exist_ok=True)
    (home / "logs" / "daily-halt.flag").write_text(payload if isinstance(payload, str) else json.dumps(payload),
                                                   encoding="utf-8")


def test_a_team_held_by_its_budget_is_never_operating_normally(tmp_path):
    flag(tmp_path, BUDGET)
    out = status(tmp_path)
    assert "operating normally" not in out
    assert "PAUSED by the spending brake" in out and "2.87 USD of 3.00 USD" in out


def test_the_pace_says_when_it_resumes(tmp_path):
    flag(tmp_path, PACE)
    out = status(tmp_path)
    assert "ahead of the budget pace" in out and "2026-11-27T01:10:00+01:00" in out


def test_the_json_carries_the_brake(tmp_path):
    flag(tmp_path, BUDGET)
    data = json.loads(status(tmp_path, "--json"))
    assert data["state"] == "off" and data["brake"]["why"] == "budget" and data["brake"]["spent"] == 2.87


def test_without_a_pause_nothing_changes(tmp_path):
    assert status(tmp_path).strip() == "STANDBY off — the team is operating normally."
    assert json.loads(status(tmp_path, "--json"))["brake"] is None


@pytest.mark.parametrize("payload", [{"halted_at": "2026-11-26T23:56:23+00:00", "consumed_pct": 120}, "{broken", "[]"])
def test_a_flag_of_another_owner_or_broken_is_not_the_brake(tmp_path, payload):
    flag(tmp_path, payload)
    assert "operating normally" in status(tmp_path)
