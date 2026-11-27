"""What `jht budget set` writes is what the brake reads (JHT-T345).

`jht budget` changes the budget after the setup through the same fields: team.budget (dollars and a period), the ceiling per
day as no_quota_cap.usd, team.working_hours. The brake (pi_spend_cap.py) reads them with team_budget.py at every tick. Here
the real command writes a synthetic config in a temporary JHT_HOME and team_budget reads it: the amount, the period, the
ceiling per day and the working time the brake will apply.
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import team_budget  # noqa: E402

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None or not (ROOT / "cli" / "node_modules").is_dir(),
                                reason="needs node and the CLI's dependencies")


def _jht(home, *args):
    env = {"PATH": os.environ["PATH"], "HOME": str(home.parent), "JHT_HOME": str(home), "JHT_LANG": "en", "TZ": "UTC"}
    done = subprocess.run([NODE, str(ROOT / "cli" / "bin" / "jht.js"), "budget", *args], env=env,
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    return json.loads((home / "jht.config.json").read_text(encoding="utf-8"))


@pytest.fixture
def home(tmp_path):
    home = tmp_path / ".jht"
    home.mkdir()
    (home / "jht.config.json").write_text(json.dumps({
        "version": 1, "active_provider": "glm", "providers": {"glm": {"auth_method": "api_key"}},
        "no_quota_cap": {"eur": 10, "tokens_per_hour": 500000},
    }), encoding="utf-8")
    return home


def test_three_dollars_for_fifteen_minutes_and_a_ceiling_per_day_are_what_the_brake_reads(home):
    config = _jht(home, "set", "--usd", "3", "--minutes", "15", "--daily-usd", "2")
    budget = team_budget.read(config, home)
    assert budget["usd"] == 3.0 and budget["duration"] == 15 * 60
    assert budget["starts"] is None, "the period starts at the first work of a worker, as after the setup"
    assert team_budget.no_quota_cap_usd(config) == {"usd": 2.0, "declared": 2.0, "currency": "USD", "rate": 1.0}
    assert config["no_quota_cap"]["tokens_per_hour"] == 500000, "the other keys of the ceiling stay"


def test_until_a_time_of_the_day_and_working_hours_give_the_brake_its_period_and_its_working_time(home):
    config = _jht(home, "set", "--usd", "10", "--until", "18:30", "--work-days", "mon-fri", "--work-time", "09:00-18:00")
    budget = team_budget.read(config, home)
    assert budget["usd"] == 10.0 and budget["ends"] > budget["starts"]
    ends = datetime.fromtimestamp(budget["ends"], timezone.utc)
    assert (ends.hour, ends.minute) == (18, 30)
    worked = team_budget.worked_intervals(config, budget["starts"], budget["starts"] + 7 * 86400)
    assert worked and all(datetime.fromtimestamp(lo, timezone.utc).weekday() < 5 for lo, _ in worked)


def test_clear_leaves_the_brake_nothing_to_apply(home):
    _jht(home, "set", "--usd", "3", "--hours", "1", "--daily-usd", "2")
    config = _jht(home, "clear")
    assert team_budget.read(config, home) is None
    assert team_budget.no_quota_cap_usd(config) is None
