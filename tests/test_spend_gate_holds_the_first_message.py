"""A message sent while the spending brake holds the team is dropped by the gate: the kickoff of a worker waits (banco build9).

The pi spend gate handles every input during the pause and sends nothing to the model, and the sender cannot tell: four Scouts
started at 19:39 stood «unbriefed am leeren Prompt» when the pause lifted a quarter of an hour later.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import spend_gate_state as gate  # noqa: E402


def _flag(home, reason="pi_spend_cap"):
    (home / "logs").mkdir(parents=True, exist_ok=True)
    (home / "logs" / "daily-halt.flag").write_text(json.dumps({"reason": reason, "at": "x"}), encoding="utf-8")


def test_the_pause_is_the_flag_of_the_brake_and_nothing_else(tmp_path):
    assert not gate.paused(tmp_path)
    _flag(tmp_path)
    assert gate.paused(tmp_path)
    _flag(tmp_path, "daily_cap")
    assert not gate.paused(tmp_path), "another halt is not the gate's pause"
    (tmp_path / "logs" / "daily-halt.flag").write_text("not json", encoding="utf-8")
    assert not gate.paused(tmp_path)
    (tmp_path / "logs" / "daily-halt.flag").write_text("", encoding="utf-8")
    assert not gate.paused(tmp_path)
    (tmp_path / "logs" / "daily-halt.flag").write_text(json.dumps({"reason": "pi_spend_cap", "pad": "x" * 70000}), encoding="utf-8")
    assert not gate.paused(tmp_path), "a file over 64 KiB is not ours, as the gate reads it"
    (tmp_path / "logs" / "daily-halt.flag").unlink()
    (tmp_path / "logs" / "other.flag").write_text(json.dumps({"reason": "pi_spend_cap"}), encoding="utf-8")
    (tmp_path / "logs" / "daily-halt.flag").symlink_to(tmp_path / "logs" / "other.flag")
    assert not gate.paused(tmp_path), "a link is not a plain file of ours"


def test_waiting_ends_when_the_pause_lifts_and_gives_up_at_the_limit(tmp_path):
    _flag(tmp_path)
    polls = []

    def lift_after_three(delay):
        polls.append(delay)
        if len(polls) == 3:
            (tmp_path / "logs" / "daily-halt.flag").unlink()

    assert gate.wait_until_lifted(3600, home=tmp_path, sleeper=lift_after_three) is True and len(polls) == 3
    _flag(tmp_path)
    now = [0.0]

    def tick(delay):
        now[0] += delay

    assert gate.wait_until_lifted(40, home=tmp_path, sleeper=tick, clock=lambda: now[0]) is False
    assert gate.wait_until_lifted(0, home=tmp_path / "nowhere") is True, "no pause: nothing to wait for"


def test_the_command_says_paused_with_its_exit_code(tmp_path):
    env = {**os.environ, "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    run = lambda *args: subprocess.run([sys.executable, str(SKILLS / "spend_gate_state.py"), *args], env=env, capture_output=True, timeout=60).returncode
    assert run("paused") == 1 and run("wait", "--max", "1") == 0
    _flag(tmp_path)
    assert run("paused") == 0 and run("wait", "--max", "1") == 1
    assert run("bogus") == 2 and run("wait", "--max", "x") == 2


def test_the_recovery_message_of_the_watchdog_waits_for_the_pause_to_lift(tmp_path, monkeypatch):
    from watchdog_delivery import kickoff
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    _flag(tmp_path)
    sent, steps = [], []

    def sleeper(delay):
        steps.append(delay)
        if delay != 12 and len(steps) >= 3:
            (tmp_path / "logs" / "daily-halt.flag").unlink(missing_ok=True)

    assert kickoff("SCOUT-1", "scout", sender=lambda s, text: sent.append(text) or True, sleeper=sleeper)
    assert len(sent) == 1 and len(steps) >= 3, "nothing was sent while the brake held the team"


def test_a_pause_that_does_not_lift_loses_no_message_to_the_gate_and_sends_nothing(tmp_path, monkeypatch):
    import watchdog_delivery
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(watchdog_delivery, "KICKOFF_PAUSE_MAX_S", 0.0)
    _flag(tmp_path)
    sent = []
    assert not watchdog_delivery.kickoff("SCOUT-1", "scout", sender=lambda s, text: sent.append(text) or True, sleeper=lambda d: None)
    assert sent == []


def test_the_kickoff_of_the_launcher_waits_before_it_sends_and_the_assistente_does_not():
    source = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    body = source[source.index("_kickoff() {"): source.index("_welcome_kickoff() {")]
    assert body.index("spend_gate_state.py paused") < body.index("tui_send_verified")
    assert "ASSISTENTE*) ;;" in body, "the Assistente is the one the gate leaves out"
    assert "JHT_KICKOFF_PAUSE_MAX_S" in body
