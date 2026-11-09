"""captain_boot.py: the facts the Capitano reads at boot, gathered before it wakes (and the first run opened there)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "shared" / "skills" / "captain_boot.py"
START_AGENT = Path(__file__).resolve().parents[1] / ".launcher" / "start-agent.sh"
PLAN = {"active_provider": "openai", "providers": {"openai": {"plan": "pro-max"}}}


def _boot(tmp_path: Path, *, ready: bool = True, plan: bool = True, phase: str | None = None,
          diary: str | None = None, config: dict | None = None) -> tuple[int, str, dict]:
    home = tmp_path / "jht"
    for sub in ("profile", "state", "logs"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    if ready:
        (home / "profile" / "ready.flag").write_text("x", encoding="utf-8")
    if plan or config:
        (home / "jht.config.json").write_text(json.dumps(config or PLAN), encoding="utf-8")
    if phase:
        (home / "state" / "first-run.json").write_text(json.dumps({
            "phase": phase, "created_at": "2026-10-27T07:00:00+00:00", "burst_started_at": None,
            "completed_at": None, "completed_reason": None, "scored_at_start": 0}), encoding="utf-8")
    if diary:
        day = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        (home / "logs" / f"captain-diary-{day}.md").write_text(diary, encoding="utf-8")
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_DB": str(home / "no.db"),
           "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, timeout=120, env=env, check=False)
    state_file = home / "state" / "first-run.json"
    state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
    return done.returncode, done.stdout, state


def test_a_ready_profile_with_a_plan_opens_the_first_run_here(tmp_path: Path):
    code, out, state = _boot(tmp_path)
    assert code == 0 and state["phase"] == "burst"
    assert "onboarding: ready_flag" in out and "opened now by the system with begin-burst" in out
    assert "do NOT run these commands again" in out and "Still yours:" in out


def test_without_a_declared_plan_the_run_stays_closed_and_the_block_says_how_to_ask(tmp_path: Path):
    code, out, state = _boot(tmp_path, plan=False)
    assert code == 0 and state["phase"] == "awaiting_profile"
    assert "NOT opened" in out and "ask-plan" in out


def test_a_subscription_nobody_named_opens_on_the_default_and_the_block_says_so(tmp_path: Path):
    code, out, state = _boot(tmp_path, plan=False, config={"active_provider": "codex"})
    assert code == 0 and state["phase"] == "burst" and state["plan"]["assumed"]
    assert "PLAN ASSUMED, already in your diary" in out and "opened now by the system" in out


def test_an_onboarding_that_is_not_closed_opens_nothing(tmp_path: Path):
    code, out, state = _boot(tmp_path, ready=False)
    assert code == 0 and state.get("phase", "awaiting_profile") == "awaiting_profile"
    assert "opened now" not in out and "onboarding: onboarding_open" in out


def test_a_run_that_is_already_open_is_reported_not_reopened(tmp_path: Path):
    _, out, state = _boot(tmp_path, phase="burst")
    assert state["phase"] == "burst" and state["burst_started_at"] is None
    assert "phase burst" in out and "opened now" not in out


def test_yesterdays_diary_and_the_standing_orders_are_in_the_block(tmp_path: Path):
    _, out, _ = _boot(tmp_path, diary="- 20:05 one Scout at a time, then observe.\n")
    assert "one Scout at a time" in out and "standing orders" in out


def test_a_long_diary_is_cut_with_a_pointer_to_the_rest(tmp_path: Path):
    _, out, _ = _boot(tmp_path, diary="- " + "word " * 1200 + "\n")
    assert "read the rest yourself" in out and len(out) < 6000


def test_nothing_is_drained_by_the_briefing(tmp_path: Path):
    """Mail and replies are the Capitano's to read: the block names no mailbox and touches none."""
    _, out, _ = _boot(tmp_path)
    assert "drain" not in out.lower() and not (tmp_path / "jht" / "bridge-mailbox.jsonl").exists()


def test_the_capitano_welcome_message_carries_the_block():
    """start-agent.sh appends captain_boot.py's block to the Capitano's welcome message, and only to that one."""
    source = START_AGENT.read_text(encoding="utf-8")
    lines = [l for l in source.splitlines() if "python3 /app/shared/skills/captain_boot.py" in l]
    assert len(lines) == 1 and "timeout" in lines[0] and "|| true" in lines[0], lines
    assert 'if [ "$role" = "capitano" ]' in source.splitlines()[source.splitlines().index(lines[0]) - 1]
