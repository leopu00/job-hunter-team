"""Empty workers wait for work; only the engine polls. No model or tmux is used."""
import json
import sqlite3
import subprocess
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from test_throttle_engine import (  # noqa: F401
    REPO_ROOT, SENT, T0, _jobs_db, eng, home,
)


@pytest.mark.parametrize("agent", ["analista-1", "scorer-1"])
def test_ten_idle_minutes_have_no_model_wakes(home, monkeypatch, agent):
    _jobs_db(home, monkeypatch)
    # The observed short timer, independent of the configured pacing ladder.
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register(agent, now=T0)
    for minute in range(1, 11):
        now = T0 + minute * 60
        eng.tick(now=now)
        if eng.get_flag(agent).get("state") == eng.NOTIFIED:
            eng.ack(agent, now=now)
            eng.register(agent, now=now)
    calls_per_minute = Decimal(len(SENT)) / 10
    # A replay estimate at the observed price per empty turn, without API usage.
    estimated_usd_per_minute = calls_per_minute * Decimal("0.044")
    print(json.dumps({"agent": agent, "minutes": 10, "model_wakes": len(SENT),
                      "estimated_usd_per_minute": str(estimated_usd_per_minute)}))
    assert len(SENT) == 0
    assert estimated_usd_per_minute == 0


@pytest.mark.parametrize("agent,status", [("analista-1", "new"), ("scorer-1", "checked")])
def test_new_work_releases_the_wait(home, monkeypatch, agent, status):
    db = _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register(agent, now=T0)
    eng.tick(now=T0 + 60)
    assert not SENT
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE positions SET status = ?", (status,))
    eng.tick(now=T0 + 120)
    assert len(SENT) == 1 and SENT[0]["agent"] == agent
    eng.tick(now=T0 + 180)
    assert len(SENT) == 1


@pytest.mark.parametrize("reading", [None, "locked", "unreadable"])
def test_an_uncertain_queue_keeps_the_existing_wake(home, monkeypatch, reading):
    db = _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register("analista-1", now=T0)
    if reading == "unreadable":
        db.write_bytes(b"not a database")
    else:
        demand = eng._load_shared("queue_demand", "queue_demand.py")
        if reading == "locked":
            def locked(role):
                raise sqlite3.OperationalError("database is locked")
            monkeypatch.setattr(demand, "queue_count", locked)
        else:
            monkeypatch.setattr(demand, "queue_count", lambda role: None)
    eng.tick(now=T0 + 60)
    assert len(SENT) == 1


def test_user_requests_are_work_even_with_no_new_positions(home, monkeypatch):
    _jobs_db(home, monkeypatch, geocode_requested=1)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register("analista-1", now=T0)
    eng.tick(now=T0 + 60)
    assert len(SENT) == 1


def test_a_zero_pause_on_an_empty_queue_still_ends_the_turn(home, monkeypatch, capsys):
    _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 0)
    result = eng.register("analista-1", now=T0)
    eng._print_register(result, "line")
    assert result["armed"] and "WAITING_FOR_WORK" in capsys.readouterr().out
    for minute in range(1, 11):
        eng.tick(now=T0 + minute * 60)
    assert not SENT


def test_the_first_pass_ceiling_is_checked_by_code_until_reopened(home, monkeypatch):
    db = _jobs_db(home, monkeypatch)
    began = datetime.now(timezone.utc) - timedelta(minutes=1)
    state = {"phase": "burst", "burst_started_at": began.isoformat(),
             "scout_cap_first_pass": 1}
    state_path = home / "state" / "first-run.json"
    state_path.parent.mkdir(exist_ok=True)
    state_path.write_text(json.dumps(state))
    with sqlite3.connect(db) as conn:
        conn.execute("INSERT INTO position_state_transitions "
                     "(position_id, from_state, to_state, by_agent) VALUES (1, NULL, 'new', 'scout-1')")
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    result = eng.register("scout-1", now=T0)
    for second in range(eng.FIRST_PASS_HOLD_SEC, eng.FIRST_PASS_HOLD_SEC + 600, 60):
        eng.tick(now=T0 + second)
    assert result["idle_wait"] == "first-pass-cap" and not SENT
    state["phase"] = "steady"
    state_path.write_text(json.dumps(state))
    eng.tick(now=T0 + eng.FIRST_PASS_HOLD_SEC + 600)
    assert len(SENT) == 1


def test_a_scout_with_an_uncertain_ceiling_is_woken(home, monkeypatch):
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    monkeypatch.setattr(eng, "_burst", lambda *args: None)
    eng.register("scout-1", now=T0)
    eng.tick(now=T0 + 60)
    assert len(SENT) == 1


def test_an_insert_event_brings_the_idle_timer_forward(home, monkeypatch):
    import event_wake
    db = _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register("analista-1", now=T0)
    eng.tick(now=T0 + 60)
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE positions SET status = 'new'")
    assert event_wake.pull_forward("analista-1", T0 + 61, engine=eng)["pulled"]
    eng.tick(now=T0 + 61)
    eng.tick(now=T0 + 120)
    assert len(SENT) == 1


def test_a_direct_order_can_ack_the_idle_wait_but_cannot_lift_a_daily_halt(home, monkeypatch):
    _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register("analista-1", now=T0)
    assert eng.ack("analista-1", now=T0 + 1)["ok"]
    eng.register("analista-1", now=T0 + 2)
    halt = home / "logs" / "daily-halt.flag"
    halt.parent.mkdir(exist_ok=True)
    halt.write_text("{}")
    assert not eng.ack("analista-1", now=T0 + 3)["ok"]


@pytest.mark.parametrize("gate", ["pace-queue", "team-halted", "agent-paused"])
def test_new_work_still_respects_the_existing_gates(home, monkeypatch, gate):
    db = _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    monkeypatch.setattr(eng, "wake_gate", lambda *args: gate)
    eng.register("analista-1", now=T0)
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE positions SET status = 'new'")
    eng.tick(now=T0 + 60)
    assert not SENT
    monkeypatch.setattr(eng, "wake_gate", lambda *args: None)
    eng.tick(now=T0 + 60 + eng.GATE_RETRY_SEC)
    assert len(SENT) == 1


@pytest.mark.parametrize("command,args", [("jht-throttle", ["--agent", "scorer-1"]),
                                         ("jht-throttle-wait", ["scorer-1"])])
def test_legacy_pause_commands_return_an_end_turn_instruction_without_sleeping(home, monkeypatch, command, args):
    _jobs_db(home, monkeypatch)
    monkeypatch.setattr(eng, "effective_seconds", lambda *args: 60)
    eng.register("scorer-1", now=T0)
    result = subprocess.run([str(REPO_ROOT / "agents" / "_tools" / command), *args],
                            capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert "WAITING_FOR_WORK" in result.stdout and "END YOUR TURN" in result.stdout
    assert eng.get_flag("scorer-1")["state"] == eng.IN_THROTTLE
