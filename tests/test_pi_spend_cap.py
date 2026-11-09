"""The agents on the pi harness have a spending brake: pi's measured cost against the `no_quota_cap` of the config.

Under the ceiling nothing; at it a declared pause (the daily-halt flag, ESC, the Captain and the person told); no ceiling
declared in the NO-QUOTA mode is a declared warning. Synthetic sessions in the shape pi writes, made-up round numbers,
no model, no tmux: the bridge is replaced by a few functions that write the same flag.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "tests"))
import fake_sentinel_loop  # noqa: E402
import pi_spend_cap as cap  # noqa: E402
import sentinel_loop as loop  # noqa: E402

NOON = datetime(2026, 11, 9, 12, 0, 0, tzinfo=timezone.utc).timestamp()
EUR = {"eur": 10}
NO_QUOTA = {"reason": "api_key"}


@pytest.fixture(autouse=True)
def utc_day(monkeypatch):
    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def stamp(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def pi_calls(home: Path, calls: list[tuple[float, float, int]], name="s.jsonl", agent="scout-1"):
    """calls: (epoch second, cost, output tokens)."""
    folder = home / ".pi" / "agent" / "sessions" / f"--jht_home-agents-{agent}--"
    folder.mkdir(parents=True, exist_ok=True)
    rows = [{"type": "session", "version": 3, "id": name, "cwd": f"/jht_home/agents/{agent}"}]
    for ts, cost, out in calls:
        rows.append({"type": "message", "timestamp": stamp(ts), "message": {"role": "assistant", "usage": {
            "input": 0, "output": out, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0,
            "cost": {"total": cost, "totalFromProvider": False}}}})
    path = folder / name
    path.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows), encoding="utf-8")
    os.utime(path, (NOON - 5, NOON - 5))


class Bridge:
    """The few things of the bridge the brake touches, writing the same daily-halt flag."""

    def __init__(self, tmp_path: Path, config: dict):
        self.home, self.config, self.sent, self.users, self.esc = tmp_path, config, [], [], 0
        self.clock = {"now": NOON}
        self.flag = tmp_path / "logs" / "daily-halt.flag"
        self.api = SimpleNamespace(
            time=SimpleNamespace(time=lambda: self.clock["now"]), session_exists=lambda s: True,
            jht_tmux_send=lambda session, text: self.sent.append((session, text)) or True,
            CAPITANO_SESSION="CAPITANO", SENTINELLA_SESSION="SENTINELLA",
            _read_config_json=lambda: self.config,
            _path=lambda name: self.flag if name == "DAILY_HALT_FLAG" else self.home,
            _daily_halt_active=lambda: self.flag.exists(),
            _activate_daily_halt=self.activate, _write_daily_halt_payload=self.write)

    def write(self, payload):
        self.flag.parent.mkdir(parents=True, exist_ok=True)
        self.flag.write_text(json.dumps(payload), encoding="utf-8")
        return True

    def activate(self, consumed, cap_pct, budget):
        self.esc += 1
        self.write({"consumed_pct": consumed, "cap_pct": cap_pct, "budget_pct": budget, "sessions": []})
        return ["scout-1"]

    def tick(self, no_quota=True, burn_intent=False, state=None):
        run = SimpleNamespace(state=state if state is not None else {}, now_h="12:00:00", _bi_on=burn_intent)
        if no_quota:
            run.state.setdefault("no_quota_declared", dict(NO_QUOTA))
        cap.step(self.api, run, notify_user=lambda text, reason: self.users.append((text, reason)))
        return run

    def texts(self):
        return [text for _, text in self.sent]


# --- the ceiling -----------------------------------------------------------------------------------------------

def test_under_the_ceiling_nothing_happens(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 3.0, 100), (NOON - 300, 4.5, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert bridge.sent == [] and bridge.users == [] and bridge.esc == 0 and not bridge.flag.exists()


def test_at_the_ceiling_the_team_is_paused_and_both_are_told(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 4.0, 100), (NOON - 300, 6.0, 100)])  # exactly 10: AT the ceiling
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert bridge.esc == 1 and bridge.flag.exists()
    payload = json.loads(bridge.flag.read_text(encoding="utf-8"))
    assert payload["reason"] == "pi_spend_cap" and payload["pi_spend_cap"] == {"why": "eur", "spent": 10.0, "ceiling": 10.0}
    assert payload["consumed_pct"] == 100.0
    assert sorted(s for s, _ in bridge.sent) == ["CAPITANO", "SENTINELLA"]
    assert all("SPENDING CEILING REACHED" in t and "not FATAL" in t and "10 USD" in t and "10 EUR" in t
               for t in bridge.texts())
    assert [r for _, r in bridge.users] == ["pi_spend_cap"] and "10 USD" in bridge.users[0][0]


def test_over_the_ceiling_is_the_same_pause_and_it_is_not_repeated_every_tick(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    state: dict = {}
    for _ in range(4):
        bridge.tick(state=state)
        bridge.clock["now"] += 300
    assert bridge.esc == 1 and len(bridge.sent) == 2 and len(bridge.users) == 1


def test_the_tokens_per_hour_ceiling_counts_the_last_hour_only(tmp_path):
    pi_calls(tmp_path, [(NOON - 7200, 0.1, 900_000), (NOON - 600, 0.1, 400_000)])
    bridge = Bridge(tmp_path, {"no_quota_cap": {"tokens_per_hour": 500_000}})
    bridge.tick()
    assert bridge.esc == 0, "the 900k tokens of two hours ago are not in the last hour"
    pi_calls(tmp_path, [(NOON - 7200, 0.1, 900_000), (NOON - 600, 0.1, 400_000), (NOON - 60, 0.1, 100_000)])
    bridge.tick()
    assert bridge.esc == 1 and "500000 per hour" in bridge.texts()[0]
    assert json.loads(bridge.flag.read_text(encoding="utf-8"))["pi_spend_cap"]["why"] == "tokens"


def test_yesterdays_spending_does_not_count_against_todays_ceiling(tmp_path):
    pi_calls(tmp_path, [(NOON - 13 * 3600, 50.0, 100), (NOON - 600, 1.0, 100)])  # 23:00 yesterday, 11:50 today
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert bridge.esc == 0


@pytest.mark.parametrize("bad", [{"eur": True}, {"eur": -3}, {"eur": 0}, {"eur": "10"}, {"eur": float("nan")}, "ten", 7])
def test_a_ceiling_that_is_not_a_positive_number_is_no_ceiling(tmp_path, bad):
    pi_calls(tmp_path, [(NOON - 600, 99.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": bad})
    bridge.tick()
    assert bridge.esc == 0 and "no spending ceiling is declared" in bridge.texts()[0]


# --- no ceiling declared -----------------------------------------------------------------------------------------

def test_no_ceiling_in_the_no_quota_mode_is_a_declared_warning_not_a_pause(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 2.5, 100)])
    bridge = Bridge(tmp_path, {})
    bridge.tick()
    assert bridge.esc == 0 and not bridge.flag.exists()
    assert "2.5 USD" in bridge.texts()[0] and "nothing else stops the spending" in bridge.texts()[0]
    assert "2.5 USD" in bridge.users[0][0], "the person reads it too, in their language"


def test_the_warning_is_once_a_day_not_once_a_tick(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 2.5, 100)])
    bridge = Bridge(tmp_path, {})
    state: dict = {}
    for _ in range(5):
        bridge.tick(state=state)
        bridge.clock["now"] += 300
    assert len(bridge.users) == 1 and len(bridge.sent) == 2


def test_no_spending_by_pi_means_nothing_to_warn_about(tmp_path):
    bridge = Bridge(tmp_path, {})
    bridge.tick()
    assert bridge.sent == [] and bridge.users == []


def test_with_quota_data_the_brake_is_not_this_ones_business(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 99.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick(no_quota=False)
    assert bridge.sent == [] and bridge.esc == 0


# --- lifting it -----------------------------------------------------------------------------------------------

def test_the_pause_lifts_when_the_spending_is_back_under_the_ceiling(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.flag.exists()
    bridge.config = {"no_quota_cap": {"eur": 100}}  # the person raised it
    bridge.sent.clear()
    bridge.tick(state=state)
    assert not bridge.flag.exists()
    assert any("allows work again" in t for t in bridge.texts()) and len(bridge.users) == 2


def test_it_lifts_on_the_next_day(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    state: dict = {}
    bridge.tick(state=state)
    bridge.clock["now"] += 13 * 3600  # 01:00 the day after: today's spending is zero
    bridge.tick(state=state)
    assert not bridge.flag.exists()


def test_a_pause_of_another_owner_is_never_lifted_or_overwritten(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 1.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.write({"consumed_pct": 120, "cap_pct": 100, "budget_pct": 90, "sessions": ["x"]})  # the daily cap's
    bridge.tick()
    assert bridge.flag.exists() and "reason" not in json.loads(bridge.flag.read_text(encoding="utf-8"))
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge.tick()
    assert bridge.esc == 0, "the team is already paused by someone else: no second ESC"


def test_a_burn_intent_in_force_overrides_the_ceiling(tmp_path, capsys):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick(burn_intent=True)
    assert bridge.esc == 0 and not bridge.flag.exists() and bridge.sent == []
    assert "user override" in capsys.readouterr().out


# --- it never stops the tick, and it is on the tick ---------------------------------------------------------------

def test_an_unreadable_config_or_home_is_a_warning_and_the_tick_goes_on(tmp_path, capsys):
    bridge = Bridge(tmp_path, {})
    bridge.api._read_config_json = lambda: (_ for _ in ()).throw(OSError("unreadable"))
    bridge.tick()
    assert "WARN pi spend cap" in capsys.readouterr().out and bridge.esc == 0


def test_a_notice_that_does_not_go_is_retried_on_the_next_tick(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 2.5, 100)])
    bridge = Bridge(tmp_path, {})
    state: dict = {}
    failing = {"on": True}

    def user(text, reason):
        if failing["on"]:
            raise RuntimeError("notifier down")
        bridge.users.append((text, reason))

    run = SimpleNamespace(state=state, now_h="12:00:00", _bi_on=False)
    state["no_quota_declared"] = dict(NO_QUOTA)
    cap.step(bridge.api, run, notify_user=user)
    failing["on"] = False
    bridge.clock["now"] += 300
    cap.step(bridge.api, run, notify_user=user)
    assert len(bridge.users) == 1


def test_the_sentinella_tick_runs_the_brake_before_it_enforces_the_halt(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    api, run, events = fake_sentinel_loop.context()
    for name in ("time", "session_exists", "jht_tmux_send", "CAPITANO_SESSION", "SENTINELLA_SESSION", "_read_config_json",
                 "_path", "_daily_halt_active", "_activate_daily_halt", "_write_daily_halt_payload"):
        setattr(api, name, getattr(bridge.api, name))
    api._enforce_daily_halt = lambda: events.append(("enforce", bridge.flag.exists()))
    run.state["no_quota_declared"] = dict(NO_QUOTA)
    import quota_data
    original = quota_data._notify_user
    quota_data._notify_user = lambda text, reason: bridge.users.append((text, reason))
    try:
        loop._before_tick(api, run)
    finally:
        quota_data._notify_user = original
    assert ("enforce", True) in events, "the flag is already raised when the guard looks at it"
    assert bridge.esc == 1


def test_the_fee_of_the_web_searches_counts_against_the_ceiling(tmp_path):
    """9.60 of model calls + 40 searches at 0.01 = 10.00: AT the ceiling, which pi's own cost alone would miss."""
    pi_calls(tmp_path, [(NOON - 600, 9.6, 100)])
    path = next((tmp_path / ".pi").rglob("*.jsonl"))
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"type": "custom", "customType": "jht-web-search", "timestamp": stamp(NOON - 300),
                                 "data": {"searches": 40}}) + "\n")
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert bridge.esc == 1
    assert json.loads(bridge.flag.read_text(encoding="utf-8"))["pi_spend_cap"]["spent"] == 10.0


# --- the first burst that stops on the ceiling (JHT-T313) -------------------------------------------------------

def first_burst(home: Path, phase="burst", target=20, scored=3, at_start=0):
    import sqlite3

    (home / "state").mkdir(exist_ok=True)
    (home / "state" / "first-run.json").write_text(json.dumps(
        {"phase": phase, "target_scored": target, "scored_at_start": at_start}), encoding="utf-8")
    conn = sqlite3.connect(str(home / "jobs.db"))
    conn.execute("CREATE TABLE IF NOT EXISTS scores (position_id INTEGER, score REAL)")
    conn.executemany("INSERT INTO scores VALUES (?, 7.0)", [(i,) for i in range(scored)])
    conn.commit()
    conn.close()


def test_a_first_burst_stopped_by_the_ceiling_tells_the_capitano_how_far_it_got(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 4.0, 100), (NOON - 300, 6.0, 100)])
    first_burst(tmp_path, scored=7, at_start=2)
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    captain = [text for session, text in bridge.sent if session == "CAPITANO"][0]
    assert "FIRST BURST" in captain and "5 of 20 scored positions" in captain and "no_quota_cap" in captain and "say so in the chat" in captain
    assert "FIRST BURST" in [text for session, text in bridge.sent if session == "SENTINELLA"][0]


@pytest.mark.parametrize("state", [dict(phase="steady"), dict(phase="awaiting_profile"), dict(scored=20), dict(scored=25), dict(target=0), dict(target=True)])
def test_without_an_open_first_burst_short_of_its_target_the_alert_says_nothing_about_it(tmp_path, state):
    pi_calls(tmp_path, [(NOON - 600, 4.0, 100), (NOON - 300, 6.0, 100)])
    first_burst(tmp_path, **state)
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert bridge.esc == 1 and all("FIRST BURST" not in text for text in bridge.texts())


def test_a_missing_or_broken_burst_state_does_not_stop_the_alert(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 4.0, 100), (NOON - 300, 6.0, 100)])
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "first-run.json").write_text("{broken", encoding="utf-8")
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert bridge.esc == 1 and sorted(s for s, _ in bridge.sent) == ["CAPITANO", "SENTINELLA"]
