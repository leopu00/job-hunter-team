"""The order «no Scout is active: spawn one» does not wait for the full hour (retest 25395266b: queues empty at 20:17, the order at 21:00)."""
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
T0 = datetime(2026, 11, 19, 20, 20, tzinfo=timezone.utc)


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_DB", raising=False)
    (tmp_path / "logs").mkdir(parents=True)
    spec = importlib.util.spec_from_file_location("heartbeat_fast_look", ROOT / ".launcher" / "heartbeat-bridge.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.sent = []
    mod.sessions = ["CAPITANO", "ANALISTA-4"]
    mod.state = {"weekly": 40, "usage5h": 10, "status": "steady", "work_phase": "ON", "q_analista": 0, "q_scorer": 0,
                 "tickets_open": 0, "top": None}
    mod.gather_state = lambda: dict(mod.state)
    mod._live_sessions = lambda: list(mod.sessions)
    mod._send = lambda msg: mod.sent.append(msg) or True
    mod._standby_active = lambda: False
    mod._burn_intent_active = lambda: False
    mod._work_phase = lambda: "ON"
    mod._mode_section = lambda: ("", [], False)
    mod._scout_exhausted_recently = lambda now: False
    mod.home = tmp_path
    return mod


def looks(mod, start, count):
    for i in range(count):
        mod.fast_tick(start + timedelta(minutes=10 * i), send=True)


def test_two_looks_without_a_scout_send_the_order_and_it_repeats_no_sooner_than_half_an_hour(bridge):
    looks(bridge, T0, 1)
    assert bridge.sent == [], "the first look only notes it"
    looks(bridge, T0 + timedelta(minutes=10), 1)
    assert len(bridge.sent) == 1 and "No Scout is active" in bridge.sent[0] and "ORDER (C-05)" in bridge.sent[0]
    looks(bridge, T0 + timedelta(minutes=20), 2)
    assert len(bridge.sent) == 1, "not again before 30 minutes"
    looks(bridge, T0 + timedelta(minutes=40), 1)
    assert len(bridge.sent) == 2, "30 minutes after the first order"


def test_a_scout_alive_at_a_look_resets_the_wait(bridge):
    looks(bridge, T0, 1)
    bridge.sessions.append("SCOUT-6")
    looks(bridge, T0 + timedelta(minutes=10), 1)
    bridge.sessions.remove("SCOUT-6")
    looks(bridge, T0 + timedelta(minutes=20), 1)
    assert bridge.sent == [], "the count starts again"
    looks(bridge, T0 + timedelta(minutes=30), 1)
    assert len(bridge.sent) == 1


@pytest.mark.parametrize("gate", ["standby", "halt", "off_hours", "stop_search", "quiet", "deep_backlog"])
def test_the_gates_of_the_beat_hold_the_look_too(bridge, gate):
    if gate == "standby":
        bridge._standby_active = lambda: True
    elif gate == "halt":
        (bridge.home / "logs" / "daily-halt.flag").write_text("x", encoding="utf-8")
        bridge.DAILY_HALT_FLAG = bridge.home / "logs" / "daily-halt.flag"
    elif gate == "off_hours":
        bridge._work_phase = lambda: "OFF"
    elif gate == "stop_search":
        bridge._mode_section = lambda: ("", [], True)
    elif gate == "quiet":
        bridge._scout_exhausted_recently = lambda now: True
    else:
        bridge.state["q_analista"] = 20
    looks(bridge, T0, 4)
    assert bridge.sent == []


def test_the_look_sends_nothing_but_that_order(bridge):
    bridge.state["tickets_open"] = 2
    bridge.sessions.append("SCOUT-1")
    looks(bridge, T0, 4)
    assert bridge.sent == [], "a ticket or a deep queue is the beat's, not the look's"


def test_the_beat_that_sent_the_order_counts_for_the_repeat(bridge):
    bridge.tick(T0.replace(minute=0), send=True)
    assert len(bridge.sent) == 1 and "No Scout is active" in bridge.sent[0]
    looks(bridge, T0.replace(minute=10), 2)
    assert len(bridge.sent) == 1, "20 minutes after the beat's own order: not yet"
    state = json.loads((bridge.home / "logs" / "heartbeat-bridge-state.json").read_text())
    assert "fermo_sent" in state
