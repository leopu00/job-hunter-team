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


@pytest.fixture(autouse=True)
def _pace_without_the_restart_reserve(request, monkeypatch):
    """The pace mechanics are tried with no room kept for a restart; the reserve has its own tests below."""
    if "reserve" not in request.node.name:
        monkeypatch.setattr(cap, "RESTART_RESERVE_SHARE", 0.0)
    if "slack" not in request.node.name and "reserve" not in request.node.name:
        monkeypatch.setattr(cap, "PACE_SLACK", False)
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

    def activate(self, consumed, cap_pct, budget, extra=None):
        # as the bridge: the flag (with what the brake adds) is written before the ESC
        self.esc += 1
        self.write({"consumed_pct": consumed, "cap_pct": cap_pct, "budget_pct": budget, "sessions": [], **(extra or {})})
        self.gate_at_esc = json.loads(self.flag.read_text(encoding="utf-8"))
        self.told_at_esc = len(self.sent) + len(self.users)
        self.paused = ["CAPITANO", "SENTINELLA", "scout-1", "scout-2", "DOCTOR-WATCHDOG"]
        payload = json.loads(self.flag.read_text(encoding="utf-8"))
        payload["sessions"] = self.paused  # what the bridge writes after the ESC
        self.flag.write_text(json.dumps(payload), encoding="utf-8")
        return self.paused

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
    assert [r.split("-")[0] for _, r in bridge.users] == ["pi_spend_cap"] and "10 USD" in bridge.users[0][0]


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


# --- the budget of the setup: dollars over a period, spread over the working hours (JHT-T322) ------------------------

import plan_registry  # noqa: E402
import team_budget  # noqa: E402

HOUR = 3600


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")  # as the setup writes it


def budget(usd, starts, ends, hours=None, **extra):
    team = {"budget": dict({"usd": usd, "starts_at": iso(starts), "ends_at": iso(ends), "set_by": "setup"}, **extra)}
    if hours is not None:
        team["working_hours"] = hours
    return {"team": team}


ROME_8_18 = {"timezone": "Europe/Rome", "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                                                     "start": "08:00", "end": "18:00"}]}


def flag_record(bridge):
    return json.loads(bridge.flag.read_text(encoding="utf-8"))["pi_spend_cap"]


def test_a_trial_of_5_dollars_for_30_minutes_stops_just_before_the_5_dollars(tmp_path):
    config = budget(5, NOON - 900, NOON + 1200)
    pi_calls(tmp_path, [(NOON - 600, 4.89, 100)])  # older than the pace window: the margin alone
    bridge = Bridge(tmp_path, config)
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.esc == 0, "4.89 is under 5 - max(2 %, 0.10)"
    pi_calls(tmp_path, [(NOON - 600, 4.89, 100), (NOON - 540, 0.01, 100)])
    bridge.tick(state=state)
    assert bridge.esc == 1
    record = flag_record(bridge)
    assert record["why"] == "budget" and record["spent"] == 4.9 and record["ceiling"] == 5.0 and record["budget_usd"] == 5.0
    assert record["resumes_at"] is None and record["ends_at"] == "2026-11-09T12:20:00+00:00"
    assert all("BUDGET SPENT" in t and "does NOT lift by itself" in t and "jht setup" in t for t in bridge.texts())
    assert "4.9 USD" in bridge.users[0][0] and "5 USD" in bridge.users[0][0] and "jht setup" in bridge.users[0][0]


def test_the_margin_is_two_percent_of_a_larger_budget(tmp_path):
    pi_calls(tmp_path, [(NOON - 400, 9.79, 100)])
    bridge = Bridge(tmp_path, budget(10, NOON - 600, NOON + 600))
    bridge.tick()
    assert bridge.esc == 0
    pi_calls(tmp_path, [(NOON - 400, 9.80, 100)])
    bridge.tick()
    assert bridge.esc == 1 and flag_record(bridge)["why"] == "budget"


def test_the_budget_counts_from_its_start_not_from_midnight(tmp_path):
    pi_calls(tmp_path, [(NOON - 2 * HOUR, 30.0, 100), (NOON - 300, 1.0, 100)])  # the 30 are before the setup
    bridge = Bridge(tmp_path, budget(5, NOON - HOUR, NOON + 1200))
    bridge.tick()
    assert bridge.esc == 0 and bridge.sent == [], "a budget declared: no «no ceiling» warning either"


def test_a_spent_budget_does_not_lift_by_itself_and_a_new_setup_lifts_it(tmp_path):
    pi_calls(tmp_path, [(NOON - 300, 5.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON - 600, NOON + 1200))
    state: dict = {}
    bridge.tick(state=state)
    for _ in range(3):
        bridge.clock["now"] += 300
        bridge.tick(state=state)
    assert bridge.flag.exists() and bridge.esc == 1 and len(bridge.users) == 1
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)  # a new setup: a new start
    bridge.sent.clear()
    bridge.tick(state=state)
    assert not bridge.flag.exists()
    assert any("budget the person declared allows work again" in t for t in bridge.texts())
    assert "▶️" in bridge.users[-1][0] and "budget" in bridge.users[-1][0]


def test_the_period_over_pauses_the_team_and_does_not_lift_by_itself(tmp_path):
    pi_calls(tmp_path, [(NOON - 300, 1.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON - 1800, NOON))
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.esc == 1
    record = flag_record(bridge)
    assert record["why"] == "period" and record["ends_at"] == "2026-11-09T12:00:00+00:00" and record["resumes_at"] is None
    assert all("BUDGET PERIOD OVER" in t and "12:00" in t for t in bridge.texts())
    assert "12:00" in bridge.users[0][0]
    bridge.clock["now"] += 6 * HOUR
    bridge.tick(state=state)
    assert bridge.flag.exists() and bridge.esc == 1


def test_one_night_of_5_dollars_goes_at_its_pace_and_says_when_it_resumes(tmp_path):
    """24/7 from 12:00 to 22:00: 0.50 $ an hour, 1.25 $ ahead (a quarter of the budget, more than one hour). At 13:00 it
    may have spent 1.75; with 2.00 spent the pace catches up at 13:30."""
    config = budget(5, NOON, NOON + 10 * HOUR)
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, config)
    bridge.clock["now"] = NOON + HOUR
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.esc == 1
    record = flag_record(bridge)
    assert record["why"] == "pace" and record["ceiling"] == 1.75 and record["resumes_at"] == "2026-11-09T13:30:00+00:00"
    assert all("BUDGET PACE" in t and "lifts by itself at 13:30" in t for t in bridge.texts())
    assert "13:30" in bridge.users[0][0] and "⏸️" in bridge.users[0][0]
    bridge.clock["now"] = NOON + HOUR + 29 * 60
    bridge.tick(state=state)
    assert bridge.flag.exists(), "13:29: not yet"
    bridge.clock["now"] = NOON + HOUR + 31 * 60
    bridge.tick(state=state)
    assert not bridge.flag.exists() and bridge.esc == 1


def test_the_pace_follows_the_working_hours_over_three_days(tmp_path):
    """10 $ from Monday 13:00 to Thursday 13:00 (Rome), 08:00-18:00: 5 + 10 + 10 + 5 = 30 worked hours, 1/3 $ each, 2.50 $
    ahead (a quarter of the budget)."""
    config = budget(10, NOON, NOON + 3 * 24 * HOUR, ROME_8_18)
    blocks = team_budget.worked_intervals(config, NOON, NOON + 3 * 24 * HOUR)
    assert sum(hi - lo for lo, hi in blocks) == 30 * HOUR and len(blocks) == 4
    b = team_budget.read(config)
    assert round(team_budget.allowed(config, b, NOON + 4 * HOUR), 4) == round(10 * 4 / 30 + 2.5, 4)
    assert round(team_budget.allowed(config, b, NOON + 10 * HOUR), 4) == round(10 * 5 / 30 + 2.5, 4), "the evening off adds nothing"
    pi_calls(tmp_path, [(NOON + 3 * HOUR, 4.5, 100)])
    bridge = Bridge(tmp_path, config)
    bridge.clock["now"] = NOON + 4 * HOUR  # Monday 17:00 in Rome
    bridge.tick()
    record = flag_record(bridge)
    # 4.5 $ less the 2.5 ahead is 6 worked hours: 5 on Monday, 1 on Tuesday from 08:00
    assert record["why"] == "pace" and record["resumes_at"] == "2026-11-10T09:00:00+01:00"
    assert "2026-11-10 09:00" in bridge.users[0][0], "another day: the date in front"


def test_the_budget_zone_is_the_one_the_person_lives_in(tmp_path):
    config = budget(5, NOON, NOON + 10 * HOUR, timezone="Europe/Budapest")
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, config)
    bridge.clock["now"] = NOON + HOUR
    bridge.tick()
    assert flag_record(bridge)["resumes_at"] == "2026-11-09T14:30:00+01:00" and "14:30" in bridge.users[0][0]


def test_raising_the_budget_lifts_a_pause_of_the_pace(tmp_path):
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON, NOON + 10 * HOUR))
    bridge.clock["now"] = NOON + HOUR
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.flag.exists()
    bridge.config = budget(50, NOON, NOON + 10 * HOUR)  # changed in the settings: same start
    bridge.tick(state=state)
    assert not bridge.flag.exists()


def test_a_pause_of_the_pace_that_turns_into_a_spent_budget_says_so_without_a_second_esc(tmp_path):
    pi_calls(tmp_path, [(NOON + 1800, 4.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON, NOON + 4 * HOUR))
    bridge.clock["now"] = NOON + HOUR
    state: dict = {}
    bridge.tick(state=state)
    assert flag_record(bridge)["why"] == "pace"
    pi_calls(tmp_path, [(NOON + 1800, 4.0, 100), (NOON + HOUR, 0.95, 100)])  # a call that was in flight is paid
    bridge.clock["now"] += 300
    bridge.tick(state=state)
    assert flag_record(bridge)["why"] == "budget" and bridge.esc == 1
    assert len(bridge.users) == 2 and any("BUDGET SPENT" in t for t in bridge.texts())


@pytest.mark.parametrize("raw", [
    {"usd": 0, "starts_at": "2026-11-09T11:00:00Z", "ends_at": "2026-11-09T13:00:00Z"},
    {"usd": True, "starts_at": "2026-11-09T11:00:00Z", "ends_at": "2026-11-09T13:00:00Z"},
    {"usd": "5", "starts_at": "2026-11-09T11:00:00Z", "ends_at": "2026-11-09T13:00:00Z"},
    {"usd": 5, "starts_at": "2026-11-09T11:00:00", "ends_at": "2026-11-09T13:00:00"},
    {"usd": 5, "starts_at": "2026-11-09T13:00:00Z", "ends_at": "2026-11-09T11:00:00Z"},
    {"usd": 5, "starts_at": "yesterday", "ends_at": "2026-11-09T13:00:00Z"},
    "five dollars"])
def test_a_budget_that_is_not_readable_is_no_budget(tmp_path, raw):
    pi_calls(tmp_path, [(NOON - 600, 99.0, 100)])
    bridge = Bridge(tmp_path, {"team": {"budget": raw}})
    bridge.tick()
    assert bridge.esc == 0 and "no spending ceiling is declared" in bridge.texts()[0]


def test_an_older_config_with_no_quota_cap_eur_works_as_before(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 10.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert flag_record(bridge) == {"why": "eur", "spent": 10.0, "ceiling": 10.0}


def test_the_budget_holds_before_the_no_quota_mode_is_declared(tmp_path):
    """The person's dollars, as the credit: the bridge declares the mode only at the end of its first tick."""
    pi_calls(tmp_path, [(NOON - 300, 5.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON - 600, NOON + 1200))
    bridge.tick(no_quota=False)
    assert bridge.esc == 1 and flag_record(bridge)["why"] == "budget"


@pytest.mark.parametrize("config, tier", [
    (budget(5, NOON, NOON + 1800), 15),                   # every budget of the setup: the full roster, the brake paces it
    (budget(10, NOON, NOON + 3 * 24 * HOUR), 15),
    ({"no_quota_cap": {"eur": 12}}, 5),                    # an older config: a tier per step of the ceiling
    ({"no_quota_cap": {"eur": 30}}, 15),
    ({}, 1),                                               # no limit: the smallest
    (dict(budget(5, NOON, NOON + 1800), no_quota_cap={"eur": 5}), 15),  # the setup's budget wins
])
def test_the_first_roster_of_an_api_key_follows_the_budget(config, tier):
    config = dict(config, providers={"zai": {"auth_method": "api_key"}})
    assert plan_registry.api_key_plan(config, "zai")["tier"] == tier


# --- a budget of a DURATION starts when the team starts working, not when the setup saved it (JHT-T322 P2) ----------

def duration_budget(usd, minutes, saved, hours=None, **extra):
    team = {"budget": dict({"usd": usd, "duration_minutes": minutes, "saved_at": iso(saved), "timezone": "UTC",
                            "set_by": "setup"}, **extra)}
    if hours is not None:
        team["working_hours"] = hours
    return {"team": team}


def start_file(home: Path) -> Path:
    return home / "state" / "budget-start.json"


def onboarding_then_scout(home: Path, onboarding, scout):
    """The Captain and the Assistente talk during the onboarding; the first Scout works later."""
    pi_calls(home, onboarding, name="c.jsonl", agent="capitano")
    if scout:
        pi_calls(home, scout, name="s.jsonl", agent="scout-1")


def test_a_trial_does_not_run_out_during_the_onboarding(tmp_path):
    """Saved two hours ago, nothing but the onboarding since: the 30 minutes have not started, no pause."""
    onboarding_then_scout(tmp_path, [(NOON - HOUR, 0.5, 100)], [])
    bridge = Bridge(tmp_path, duration_budget(5, 30, NOON - 2 * HOUR))
    bridge.tick()
    assert bridge.esc == 0 and bridge.sent == [] and not start_file(tmp_path).exists()


def test_the_trial_starts_at_the_first_call_of_a_worker_and_ends_30_minutes_later(tmp_path):
    onboarding_then_scout(tmp_path, [(NOON - HOUR, 0.5, 100)], [(NOON - 600, 0.2, 100)])
    config = duration_budget(5, 30, NOON - 2 * HOUR)
    bridge = Bridge(tmp_path, config)
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.esc == 0
    record = json.loads(start_file(tmp_path).read_text(encoding="utf-8"))
    assert record == {"saved_at": iso(NOON - 2 * HOUR), "starts_at": "2026-11-09T11:50:00+00:00",
                      "ends_at": "2026-11-09T12:20:00+00:00", "spent_before_usd": 0.5}
    b = team_budget.read(config, tmp_path)
    assert (b["starts"], b["ends"], b["counts_from"]) == (NOON - 600, NOON + 1200, NOON - 2 * HOUR)
    bridge.clock["now"] = NOON + 1140  # the end (12:20) is a look away: not yet
    bridge.tick(state=state)
    assert bridge.esc == 0
    bridge.clock["now"] = NOON + 1141  # the end falls before the next look: now
    bridge.tick(state=state)
    assert bridge.esc == 1
    flag = flag_record(bridge)
    assert flag["why"] == "period" and flag["starts_at"] == "2026-11-09T11:50:00+00:00"
    assert flag["ends_at"] == "2026-11-09T12:20:00+00:00" and flag["spent"] == 0.7, "the onboarding's 0.50 counts too"


def test_the_dollars_of_the_onboarding_count_and_stop_the_team_before_the_start(tmp_path):
    onboarding_then_scout(tmp_path, [(NOON - HOUR, 4.9, 100)], [])
    bridge = Bridge(tmp_path, duration_budget(5, 30, NOON - 2 * HOUR))
    bridge.tick()
    flag = flag_record(bridge)
    assert bridge.esc == 1 and flag["why"] == "budget" and flag["starts_at"] is None and flag["ends_at"] is None
    assert not start_file(tmp_path).exists()


def test_the_spending_before_the_setup_never_counts(tmp_path):
    onboarding_then_scout(tmp_path, [(NOON - 3 * HOUR, 30.0, 100), (NOON - HOUR, 0.5, 100)], [])
    bridge = Bridge(tmp_path, duration_budget(5, 30, NOON - 2 * HOUR))
    bridge.tick()
    assert bridge.esc == 0


def test_a_new_setup_starts_again_and_the_old_start_is_not_read(tmp_path):
    onboarding_then_scout(tmp_path, [], [(NOON - 600, 0.2, 100)])
    bridge = Bridge(tmp_path, duration_budget(5, 30, NOON - HOUR))
    state: dict = {}
    bridge.tick(state=state)
    assert start_file(tmp_path).exists()
    bridge.config = duration_budget(5, 30, NOON - 300)  # saved again after that Scout's call
    assert team_budget.read(bridge.config, tmp_path)["starts"] is None
    bridge.clock["now"] = NOON + 2 * HOUR
    bridge.tick(state=state)
    assert bridge.esc == 0, "no worker has worked since the new setup: its 30 minutes have not started"


@pytest.mark.parametrize("bad", ["{broken", json.dumps(["x"]), json.dumps({"saved_at": "other"}),
                                 json.dumps({"saved_at": None, "starts_at": "2026-11-09T11:00:00Z"})])
def test_a_start_file_that_is_not_ours_is_not_a_start(tmp_path, bad):
    config = duration_budget(5, 30, NOON - HOUR)
    start_file(tmp_path).parent.mkdir(parents=True)
    start_file(tmp_path).write_text(bad, encoding="utf-8")
    assert team_budget.read(config, tmp_path)["starts"] is None


def test_a_link_in_place_of_the_start_file_is_neither_read_nor_followed(tmp_path):
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps({"saved_at": iso(NOON - HOUR), "starts_at": "2026-11-01T00:00:00Z",
                                   "ends_at": "2026-11-01T00:30:00Z"}), encoding="utf-8")
    home = tmp_path / "home"
    (home / "state").mkdir(parents=True)
    start_file(home).symlink_to(outside)
    config = duration_budget(5, 30, NOON - HOUR)
    assert team_budget.read(config, home)["starts"] is None
    onboarding_then_scout(home, [], [(NOON - 600, 0.2, 100)])
    Bridge(home, config).tick()
    assert not start_file(home).is_symlink() and json.loads(start_file(home).read_text())["starts_at"].startswith("2026-11-09")
    assert json.loads(outside.read_text())["starts_at"] == "2026-11-01T00:00:00Z", "the target was not written"


def test_a_few_days_start_at_the_first_work_and_go_at_their_pace_over_the_hours(tmp_path):
    """10 $ for 3 days of 08:00-18:00 (Rome), saved on Sunday night, first Scout on Monday 13:00 Rome: the same 30
    worked hours as a budget with dates from that moment."""
    config = duration_budget(10, 3 * 1440, NOON - 15 * HOUR, ROME_8_18, timezone="Europe/Rome")
    onboarding_then_scout(tmp_path, [], [(NOON, 0.1, 100), (NOON + 3 * HOUR, 4.4, 100)])
    bridge = Bridge(tmp_path, config)
    bridge.clock["now"] = NOON + 4 * HOUR
    bridge.tick()
    record = flag_record(bridge)
    assert record["why"] == "pace" and record["resumes_at"] == "2026-11-10T09:00:00+01:00"
    assert record["starts_at"] == "2026-11-09T13:00:00+01:00"


def test_the_first_roster_of_a_budget_of_a_duration_is_the_full_one(tmp_path):
    config = dict(duration_budget(5, 30, NOON), providers={"zai": {"auth_method": "api_key"}})
    plan = plan_registry.api_key_plan(config, "zai")
    assert plan["tier"] == 15 and "first work of the team" in plan["label"] and "assumed" not in plan
    assert team_budget.per_day(config) == 5.0
    assert team_budget.per_day(duration_budget(30, 3 * 1440, NOON)) == 10.0


@pytest.mark.parametrize("raw", [
    {"usd": 5, "duration_minutes": 0, "saved_at": "2026-11-09T11:00:00Z"},
    {"usd": 5, "duration_minutes": "30", "saved_at": "2026-11-09T11:00:00Z"},
    {"usd": 5, "duration_minutes": 30},
    {"usd": 5, "duration_minutes": 30, "saved_at": "2026-11-09T11:00:00"}])
def test_a_budget_of_a_duration_that_is_not_readable_is_no_budget(raw):
    assert team_budget.read({"team": {"budget": raw}}) is None


# --- the brake looks every minute and stops BEFORE the budget at the pace of the team (giro Windows 15/11) ------------

def claude_minutes(home: Path, start: float, minutes: int, per_minute=0.5):
    """A team on Claude: about 0.5 $ a minute, one call every 20 seconds."""
    pi_calls(home, [(start + 20 * i, per_minute / 3, 100) for i in range(minutes * 3)], name="claude.jsonl")


def test_a_team_on_claude_stops_within_the_budget_looking_every_minute(tmp_path):
    """5 $ for 30 minutes at 0.5 $ a minute: looking every minute, at most one minute of spending more than when it looks,
    and the look stops when the next minute would pass 5 $ - margin. The spending at the pause stays within 5.00 $."""
    start = NOON - 3600
    bridge = Bridge(tmp_path, budget(5, start, start + 1800))
    state: dict = {}
    for minute in range(1, 30):
        bridge.clock["now"] = start + 60 * minute
        claude_minutes(tmp_path, start, minute)  # what the team has spent by then
        bridge.tick(state=state)
        if bridge.esc:
            break
    record = flag_record(bridge)
    assert record["why"] == "budget" and record["spent"] <= 5.0 - 0.10
    # the calls already in flight at the pause: one more minute at most, still within the 5 $
    assert record["spent"] + 0.5 <= 5.0


def test_without_the_pace_the_brake_would_be_a_look_late(tmp_path):
    """4.70 $ spent, 0.5 $ in the last 5 minutes (0.1 $ a minute): 4.70 + 0.10 is under 4.90, no pause; at 2.5 $ in the last
    5 minutes (Claude) 4.70 + 0.50 is over it, and the team stops now."""
    slow, fast = tmp_path / "slow", tmp_path / "fast"
    for home, recent in ((slow, 0.5), (fast, 2.5)):
        pi_calls(home, [(NOON - 1500, 4.70 - recent, 100), (NOON - 120, recent, 100)])
    Bridge(slow, budget(5, NOON - 1800, NOON + 1800)).tick()
    fast_bridge = Bridge(fast, budget(5, NOON - 1800, NOON + 1800))
    fast_bridge.tick()
    assert not (slow / "logs" / "daily-halt.flag").exists() and fast_bridge.esc == 1


def test_the_sentinella_sleeps_between_ticks_looking_at_the_spending_every_minute(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 1.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON - 1800, NOON + 150))  # the end falls inside the next sleep
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        bridge.clock["now"] += seconds

    bridge.api.time.sleep = sleep
    bridge.api.datetime = datetime
    run = SimpleNamespace(state={"no_quota_declared": dict(NO_QUOTA)}, now_h="12:00:00", _bi_on=False, sleep_sec=300)
    import quota_data
    original = quota_data._notify_user
    quota_data._notify_user = lambda text, reason: bridge.users.append((text, reason))
    try:
        loop._sleep_watching_the_spending(bridge.api, run)
    finally:
        quota_data._notify_user = original
    assert sleeps == [60, 60, 60, 60, 60], "the 5 minutes in steps of one, the brake after each but the last"
    assert bridge.esc == 1 and flag_record(bridge)["why"] == "period", "stopped inside the sleep, not at the next tick"


# --- the onboarding is outside the pace, and the pace leaves the first burst something (giro Mac 21, JHT-T322 P2-3) -----

def test_a_small_budget_on_claude_lets_the_scouts_search_after_an_expensive_onboarding(tmp_path):
    """2 $ for a day on Claude: the Assistente and the Captain spend 1.71 $ in the onboarding, then the first Scout works.
    The 1.71 $ count against the 2 $ (the budget), not against the pace: the pace spreads the 0.29 $ left over the day,
    with a quarter of it ahead, so the Scouts search; before, the pace paused the team at their first minute."""
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(saved + 600, 0.71, 100)], name="a.jsonl", agent="assistente")
    pi_calls(tmp_path, [(saved + 1200, 1.00, 100)], name="c.jsonl", agent="capitano")
    pi_calls(tmp_path, [(NOON - 1800, 0.02, 100), (NOON - 900, 0.03, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(2, 1440, saved))
    bridge.tick()
    assert bridge.esc == 0, "1.76 $ spent, 0.05 $ of them since the start: within 0.29 × (25 % + 30 min of a day)"
    b = team_budget.read(bridge.config, tmp_path)
    assert b["starts"] == NOON - 1800


def test_the_onboarding_still_counts_against_the_budget(tmp_path):
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(saved + 600, 1.88, 100)], name="a.jsonl", agent="assistente")
    pi_calls(tmp_path, [(NOON - 1800, 0.02, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(2, 1440, saved))
    bridge.tick()
    assert bridge.esc == 1 and flag_record(bridge)["why"] == "budget", "1.90 $ of 2 is at the margin (0.10 $): the budget, whatever the pace"


def test_the_pace_after_an_onboarding_still_pauses_a_team_that_runs_ahead(tmp_path):
    """The same 2 $: 1.71 $ of onboarding, then the Scouts spend 0.15 $ in half an hour (0.29 $ left, a quarter ahead is
    0.07 $ plus the half hour's share): above the pace, a pause, and the flag says the ceiling with the onboarding in it."""
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(saved + 600, 1.71, 100)], name="a.jsonl", agent="assistente")
    pi_calls(tmp_path, [(NOON - 1800, 0.05, 100), (NOON - 900, 0.10, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(2, 1440, saved))
    bridge.tick()
    record = flag_record(bridge)
    allowance = 0.29 * 1800 / 86400 + 0.25 * 0.29
    assert record["why"] == "pace" and record["ceiling"] == round(1.71 + allowance, 6)


def test_an_onboarding_that_ate_more_than_half_the_budget_is_said(tmp_path):
    """The Captain is told once, to say it to the person; the start file and the flag of a later pause carry it for the
    status (spent_before_usd, before_work)."""
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(saved + 600, 1.71, 100)], name="a.jsonl", agent="assistente")
    pi_calls(tmp_path, [(NOON - 1800, 0.05, 100), (NOON - 900, 0.10, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(2, 1440, saved))
    state: dict = {}
    bridge.tick(state=state)
    captain = [t for s, t in bridge.sent if s == "CAPITANO" and "ONBOARDING" in t]
    assert len(captain) == 1 and "1.71 USD of the 2 USD" in captain[0] and "0.29 USD are left" in captain[0]
    assert json.loads(start_file(tmp_path).read_text())["spent_before_usd"] == 1.71
    assert flag_record(bridge)["before_work"] == {"spent": 1.71, "budget_usd": 2.0}
    bridge.clock["now"] += 60
    bridge.tick(state=state)
    assert len([t for s, t in bridge.sent if "ONBOARDING" in t]) == 1, "once"


def test_a_cheap_onboarding_says_nothing(tmp_path):
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(saved + 600, 0.30, 100)], name="a.jsonl", agent="assistente")
    pi_calls(tmp_path, [(NOON - 900, 0.02, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(2, 1440, saved))
    bridge.tick()
    assert not [t for _, t in bridge.sent if "ONBOARDING" in t]
    assert json.loads(start_file(tmp_path).read_text())["spent_before_usd"] == 0.3


# --- a bridge started again (the container made again by the switch onto the full tools) keeps the pause (giro Windows
# 16/11: «PI-SPEND-CEILING cleared» at 2.05 $ of 2, the team started again and ended at 2.81 $) ------------------------

def test_a_bridge_started_again_keeps_the_pause_of_a_spent_budget(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 2.05, 100)])
    bridge = Bridge(tmp_path, budget(2, NOON - HOUR, NOON + 23 * HOUR))
    bridge.tick()
    assert flag_record(bridge)["why"] == "budget"
    bridge.sent.clear()
    for _ in range(3):  # a new bridge: its state is empty, the no-quota mode not declared yet
        bridge.clock["now"] += 60
        bridge.tick(no_quota=False, state={})
    assert bridge.flag.exists() and flag_record(bridge)["why"] == "budget"
    assert not any("allows work again" in text for text in bridge.texts())


def test_a_bridge_started_again_does_not_lift_a_ceiling_it_has_not_read_yet(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    bridge.tick()
    assert flag_record(bridge)["why"] == "eur"
    bridge.tick(no_quota=False, state={})  # before the mode is declared: the eur ceiling is not read
    assert bridge.flag.exists()
    bridge.tick(state={})  # the mode declared: it reads it, still over: stays
    assert bridge.flag.exists()


def test_a_burn_intent_opens_the_pause_of_the_brake_for_the_gate_of_the_agents(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 25.0, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": EUR})
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.flag.exists()
    bridge.tick(state=state, burn_intent=True)
    assert not bridge.flag.exists(), "the person's override: the agents' gate reads the flag, so it goes"


def test_clock_names_the_zone_of_the_person():
    config = {"team": {"budget": {"usd": 5, "timezone": "Europe/Rome"}}}
    moment = datetime(2026, 11, 16, 13, 26, tzinfo=timezone.utc).timestamp()
    assert cap.clock(moment, config, today=moment) == "14:26 (Europe/Rome)"


# --- the gate before the words, and a resume time that moves (giro Windows 16/11, build5, Claude, 2 $) ---------------------

def test_the_gate_of_the_agents_is_closed_before_anyone_is_told(tmp_path):
    """The notices to the Captain and the Sentinella wait for the sessions: written first, they held the flag back 23 s, and
    the Captain made four more calls (0.16 $). The flag with the brake's reason now comes before the ESC and the words."""
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON, NOON + 10 * HOUR))
    bridge.clock["now"] = NOON + HOUR
    bridge.tick()
    assert bridge.esc == 1
    assert bridge.gate_at_esc["reason"] == "pi_spend_cap" and bridge.gate_at_esc["pi_spend_cap"]["why"] == "pace"
    assert bridge.told_at_esc == 0, "someone was told before the gate closed"
    assert sorted(s for s, _ in bridge.sent) == ["CAPITANO", "SENTINELLA"] and len(bridge.users) == 1


def _paused_at_13_30(tmp_path):
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON, NOON + 10 * HOUR))
    bridge.clock["now"] = NOON + HOUR
    state: dict = {}
    bridge.tick(state=state)
    assert flag_record(bridge)["resumes_at"] == "2026-11-09T13:30:00+00:00" and len(bridge.users) == 1
    return bridge, state


def test_spending_after_the_pause_moves_the_resume_time_in_the_flag_and_the_person_is_told(tmp_path):
    """A turn already running and a welcome at `jht up` spent after the pause: the brake reckoned 16:53, the flag and the chat
    still said 14:58, and at 16:11 the team was still paused past the time the person was given."""
    bridge, state = _paused_at_13_30(tmp_path)
    pi_calls(tmp_path, [(NOON + HOUR + 30, 0.5, 100)], name="after.jsonl", agent="capitano")   # 0.50 $ more: one hour later
    bridge.clock["now"] = NOON + HOUR + 120
    bridge.tick(state=state)
    record = flag_record(bridge)
    assert record["resumes_at"] == "2026-11-09T14:30:00+00:00" and record["resumes_told_at"] == record["resumes_at"]
    assert bridge.esc == 1, "no second ESC"
    assert len(bridge.users) == 2 and "14:30" in bridge.users[-1][0]
    assert any("lifts by itself at 14:30" in t for t in bridge.texts())
    bridge.clock["now"] = NOON + HOUR + 180
    bridge.tick(state=state)
    assert len(bridge.users) == 2, "the same time is not said again"


def test_a_small_move_is_written_in_the_flag_and_said_once_the_moves_add_up(tmp_path):
    bridge, state = _paused_at_13_30(tmp_path)
    pi_calls(tmp_path, [(NOON + HOUR + 30, 0.02, 100)], name="a.jsonl", agent="capitano")     # 2.4 minutes later
    bridge.clock["now"] = NOON + HOUR + 120
    bridge.tick(state=state)
    record = flag_record(bridge)
    assert record["resumes_at"] == "2026-11-09T13:32:24+00:00" and record["resumes_told_at"] == "2026-11-09T13:30:00+00:00"
    assert len(bridge.users) == 1, "a move of two minutes is not a new message"
    pi_calls(tmp_path, [(NOON + HOUR + 150, 0.03, 100)], name="b.jsonl", agent="capitano")    # 6 minutes in all
    bridge.clock["now"] = NOON + HOUR + 240
    bridge.tick(state=state)
    assert flag_record(bridge)["resumes_at"] == "2026-11-09T13:36:00+00:00" and len(bridge.users) == 2
    assert flag_record(bridge)["resumes_told_at"] == "2026-11-09T13:36:00+00:00"


def test_a_pause_that_does_not_move_is_left_alone(tmp_path):
    bridge, state = _paused_at_13_30(tmp_path)
    before = bridge.flag.read_text(encoding="utf-8")
    for minutes in (5, 10, 20):
        bridge.clock["now"] = NOON + HOUR + minutes * 60
        bridge.tick(state=state)
    assert bridge.flag.read_text(encoding="utf-8") == before and len(bridge.users) == 1 and bridge.esc == 1


# --- a stop for the budget is not lifted when the spending that raised it goes quiet (giro Windows 16/11, build 8) --------------
# 13:00:14 «reached (budget: 4.77 of 5.0)», 13:02:56 «cleared» with the spending not lower, 14 more calls, a second stop at 4.93.

def _a_stop_that_looks_ahead(tmp_path):
    """4.80 $ spent, 1 $ of it in the last two minutes: 4.80 + 0.20 (the pace of the next look) is over 5.00 - 0.10, so the
    brake stops BEFORE the budget; five minutes later that pace is gone and 4.80 alone is under the line."""
    pi_calls(tmp_path, [(NOON - 1500, 3.8, 100), (NOON - 120, 1.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON - 1800, NOON + 1800))
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.esc == 1 and flag_record(bridge)["why"] == "budget"
    return bridge, state


def test_the_stop_of_a_budget_is_not_cleared_when_the_pace_that_raised_it_is_gone(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    for _ in range(4):
        bridge.clock["now"] += 150  # the last calls leave the window of the pace
        bridge.sent.clear()
        bridge.tick(state=state)
    assert bridge.flag.exists() and bridge.esc == 1, "the pause stays: nothing said «allows work again»"
    assert not any("allows work again" in t for t in bridge.texts())
    assert len(bridge.users) == 1


def test_a_new_budget_lifts_that_stop_and_the_person_is_told_under_another_id(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    bridge.clock["now"] += 600
    bridge.tick(state=state)
    assert bridge.flag.exists()
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)  # jht setup: a new budget
    bridge.tick(state=state)
    assert not bridge.flag.exists()
    ids = [reason for _, reason in bridge.users]
    assert len(ids) == 2 and ids[0] != ids[1] and all(i.startswith("pi_spend_cap-") for i in ids)


def test_the_same_budget_is_told_to_the_person_under_the_same_id_only_once_but_a_flag_without_the_budget_field_is_still_held(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    payload = json.loads(bridge.flag.read_text(encoding="utf-8"))
    del payload["pi_spend_cap"]["counts_from"]  # a flag written by a brake before the field
    bridge.flag.write_text(json.dumps(payload), encoding="utf-8")
    bridge.clock["now"] += 600
    bridge.tick(state=state)
    assert bridge.flag.exists() and bridge.esc == 1


def test_the_notice_of_the_brake_to_the_person_is_accepted_by_jht_notify_user_each_time(tmp_path, monkeypatch):
    """Every notice of the brake went under the SAME source id with another text: the tool answered exit 2 (collision) from the second
    one on, and the person was told of the first pause only (giro Windows 16/11: «jht-notify-user failed with exit 2»)."""
    import sqlite3
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE pending_user_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, body TEXT, kind TEXT,
        related_position_id INTEGER, source_id TEXT UNIQUE, source_action TEXT, source_payload TEXT,
        delivered_via TEXT DEFAULT 'web', delivered_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
    conn.commit()
    conn.close()
    import quota_data
    monkeypatch.setenv("JHT_DB", str(db))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    seen = []

    def real(text, reason):
        # the very function of the product (it runs the tool by the repository path when /app is not there)
        try:
            quota_data._notify_user(text, reason)
            seen.append(0)
        except RuntimeError as error:
            seen.append(str(error))

    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    # the tick of the helper told through the test double; tell again through the real tool: a halt, then the resume of a new setup
    run = SimpleNamespace(state={"no_quota_declared": dict(NO_QUOTA)}, now_h="12:00:00", _bi_on=False)
    bridge.flag.unlink()
    bridge.config = budget(5, NOON - 1800, NOON + 1800)
    cap.step(bridge.api, run, notify_user=real)
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    cap.step(bridge.api, run, notify_user=real)
    assert seen == [0, 0], seen


# --- the agents the pause stopped are woken the moment it is lifted (a VPS round: «allows work again» 18:31, the Scouts back at 18:46) ---

def _woken(bridge):
    return sorted(s for s, t in bridge.sent if t.startswith("[RIPRENDI]"))


def test_a_new_budget_wakes_the_agents_the_pause_stopped_at_once(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert not bridge.flag.exists()
    assert _woken(bridge) == ["scout-1", "scout-2"], "the two Scouts, not the Captain or the Sentinella (own notice) or a watchdog"
    wake = next(t for s, t in bridge.sent if s == "scout-1" and t.startswith("[RIPRENDI]"))
    assert "budget allows work again" in wake and "pick up EXACTLY where you were" in wake


def test_nobody_is_woken_while_the_pause_stands(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    bridge.clock["now"] += 600
    bridge.tick(state=state)
    assert bridge.flag.exists() and _woken(bridge) == []


def test_a_team_the_person_stopped_or_in_standby_is_not_woken_by_the_brake(tmp_path):
    for name in (".team-halted.flag", ".team-standby.flag"):
        bridge, state = _a_stop_that_looks_ahead(tmp_path / name.strip("."))
        (bridge.home / name).write_text("x", encoding="utf-8")
        bridge.clock["now"] += 600
        bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
        bridge.tick(state=state)
        assert not bridge.flag.exists() and _woken(bridge) == [], name


def test_an_agent_the_person_paused_alone_is_not_woken(tmp_path, monkeypatch):
    import agent_pause
    monkeypatch.setattr(agent_pause, "paused_sessions", lambda home=None: ["scout-2"])
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert _woken(bridge) == ["scout-1"]


def test_a_session_that_does_not_answer_does_not_stop_the_resume(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    send = bridge.api.jht_tmux_send

    def failing(session, text):
        if session == "scout-1":
            raise OSError("no pane")
        return send(session, text)

    bridge.api.jht_tmux_send = failing
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert not bridge.flag.exists() and _woken(bridge) == ["scout-2"]


def test_a_session_born_during_the_pause_is_woken_with_its_held_first_message_said(tmp_path):
    """An update during the pause: the Analyst is born with the new container, its first message is held by the gate and never
    comes again, and it is not in the list the ESC wrote. A new budget must wake it, and say that its first message never arrived."""
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    bridge.api.list_tmux_sessions = lambda: ["CAPITANO", "SENTINELLA", "ANALISTA-5", "MENTOR", "scout-1", "my shell", "notes"]
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert not bridge.flag.exists()
    assert _woken(bridge) == ["ANALISTA-5", "scout-1", "scout-2"], "the new worker too; not a fixed agent that was not in the list, nor a session that is not of the team"
    newcomer = next(t for s, t in bridge.sent if s == "ANALISTA-5")
    assert "held back" in newcomer and "never reached you" in newcomer
    old = next(t for s, t in bridge.sent if s == "scout-1")
    assert "pick up EXACTLY where you were" in old and "never reached you" not in old


def test_the_newcomer_is_not_woken_when_the_team_is_stopped_by_the_person_or_paused_alone(tmp_path, monkeypatch):
    import agent_pause
    monkeypatch.setattr(agent_pause, "paused_sessions", lambda home=None: ["ANALISTA-5"])
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    bridge.api.list_tmux_sessions = lambda: ["ANALISTA-5"]
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert "ANALISTA-5" not in _woken(bridge)


def test_a_bridge_that_cannot_list_the_sessions_wakes_the_ones_the_esc_reached(tmp_path):
    bridge, state = _a_stop_that_looks_ahead(tmp_path)

    def broken():
        raise OSError("tmux")
    bridge.api.list_tmux_sessions = broken
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert _woken(bridge) == ["scout-1", "scout-2"]


def test_a_pause_of_the_pace_keeps_a_reserve_for_the_restart_and_says_the_later_time():
    """5 $ over 10 hours from noon, 0.50 $ an hour, 1.25 $ ahead. 2.00 $ spent at 13:00 (1.75 allowed): without a reserve the pace
    catches up at 13:30; the team that comes back spends in a minute what the cache costs, so the reserve (10 % of the budget =
    0.50 $) and a margin of 0.10 $ move the resume to 14:42, and the pause is not lifted a minute before it."""
    config = budget(5, NOON, NOON + 10 * HOUR)
    base = {"budget_cost": 2.0, "recent_cost": 0.0, "before_start": 0.0}
    verdict = cap.decide(config, base, False, NOON + HOUR, cap.team_budget.read(config))
    assert verdict["why"] == "pace" and datetime.fromtimestamp(verdict["resumes"], timezone.utc).strftime("%H:%M") == "14:42", "the line 2.00 + the reserve 0.50 + a margin 0.10"
    # the time said is the time the lift finds (the Linux round said 17:10 and the pause was lifted at 16:50: the announcement
    # counted a margin the lift does not ask for)
    said = verdict["resumes"]
    assert cap.decide(config, base, False, said - 30, cap.team_budget.read(config), held_by_pace=True)["why"] == "pace"
    assert cap.decide(config, base, False, said + 1, cap.team_budget.read(config), held_by_pace=True)["action"] == "none"
    held = cap.decide(config, base, False, NOON + HOUR + 31 * 60, cap.team_budget.read(config), held_by_pace=True)
    assert held and held["why"] == "pace", "13:31: the plain pace would be lifted, the room for the restart is not there yet"
    assert cap.decide(config, base, False, NOON + 3 * HOUR, cap.team_budget.read(config), held_by_pace=True)["action"] == "none"
    # a team that is NOT paused keeps working at the plain pace: the reserve is for the restart only
    assert cap.decide(config, dict(base, budget_cost=1.6), False, NOON + HOUR, cap.team_budget.read(config))["action"] == "none"


def test_the_pace_looks_ahead_at_the_rate_of_the_last_minutes():
    config = budget(5, NOON, NOON + 10 * HOUR)
    spent = {"budget_cost": 1.6, "recent_cost": 1.0, "before_start": 0.0}   # 1.0 $ in the last 5 minutes: 0.2 $ by the next look
    assert cap.decide(config, spent, False, NOON + HOUR, cap.team_budget.read(config))["why"] == "pace"
    assert cap.decide(config, dict(spent, recent_cost=0.0), False, NOON + HOUR, cap.team_budget.read(config))["action"] == "none"


def test_the_pace_stops_one_slack_before_the_line_so_the_calls_in_flight_do_not_cross_it():
    """Allowed 1.75 at 13:00: a team at 1.70 is stopped (0.10 $ of margin: the calls in flight are paid), one at 1.60 is not."""
    config = budget(5, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    mid = {"recent_cost": 0.0, "before_start": 0.0}
    assert cap.decide(config, dict(mid, budget_cost=1.70), False, NOON + HOUR, read)["why"] == "pace"
    assert cap.decide(config, dict(mid, budget_cost=1.60), False, NOON + HOUR, read)["action"] == "none"


def test_the_cache_rewritten_at_a_resume_is_not_counted_against_the_pace_slack_kept(tmp_path):
    """Linux 12b: 0.454 $ in 31 s at every resume (Capitano 0.18, Assistente 0.15, Scorer 0.07, Mentor 0.05, others 0.03), and the pace
    stopped the team again 80 s later. 3 $ over 10 hours: 1.35 $ allowed after two hours; 1.0 spent, resume at 14:00."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    resumed = NOON + 2 * HOUR
    pi_calls(tmp_path, [(NOON + HOUR, 1.0, 100), (resumed + 5, 0.20, 100), (resumed + 20, 0.254, 100)])
    at = resumed + 40
    plain = cap.spend(tmp_path, at, NOON, NOON)
    assert cap.decide(config, plain, False, at, read)["why"] == "pace", "without the exclusion the restart stops the team"
    cap.note_resume(tmp_path, resumed)
    kept = cap.spend(tmp_path, at, NOON, NOON)
    assert kept["restart_cost"] == 0.454 and kept["budget_cost"] == 1.454
    assert cap.decide(config, kept, False, at, read)["action"] == "none"
    # after the window the work counts again: 0.40 $ of work at 14:03 on top of 1.0 + the restart
    pi_calls(tmp_path, [(resumed + 180, 0.40, 100)], name="t.jsonl")
    later = cap.spend(tmp_path, resumed + 190, NOON, NOON)
    assert later["restart_cost"] == 0.454 and cap.decide(config, later, False, resumed + 190, read)["why"] == "pace"


def test_the_restart_never_leaves_the_hard_stop_of_the_budget(tmp_path):
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    pi_calls(tmp_path, [(NOON + HOUR, 1.0, 100), (NOON + 2 * HOUR + 5, 1.95, 100)])
    cap.note_resume(tmp_path, NOON + 2 * HOUR)
    spent = cap.spend(tmp_path, NOON + 2 * HOUR + 40, NOON, NOON)
    assert cap.decide(config, spent, False, NOON + 2 * HOUR + 40, read)["why"] == "budget"


def _wake_api(tmp_path, sessions):
    sent = []
    api = SimpleNamespace(_path=lambda name: str(tmp_path), CAPITANO_SESSION="CAPITANO", SENTINELLA_SESSION="SENTINELLA",
                          jht_tmux_send=lambda s, t: sent.append(s) or True, list_tmux_sessions=lambda: [])
    return api, sent


def test_the_assistant_and_the_mentor_are_not_woken_at_a_resume_unless_the_person_is_waiting(tmp_path):
    api, sent = _wake_api(tmp_path, None)
    team = ["SCOUT-1", "ASSISTENTE", "MENTOR", "SCORER-1", "CAPITANO"]
    chat = tmp_path / "agents" / "assistente"
    chat.mkdir(parents=True)
    (chat / "chat.jsonl").write_text('{"role":"user","ts":1}\n{"role":"assistant","ts":2}\n', encoding="utf-8")
    assert cap._wake_the_team(api, team, "x") == ["SCOUT-1", "SCORER-1"], "answered: asleep, like the Mentor"
    (chat / "chat.jsonl").write_text('{"role":"assistant","ts":1}\n{"role":"user","ts":2}\n', encoding="utf-8")
    sent.clear()
    assert cap._wake_the_team(api, team, "x") == ["SCOUT-1", "ASSISTENTE", "SCORER-1"], "the person's last message has no answer"
    (chat / "chat.jsonl").unlink()
    assert "ASSISTENTE" in cap._wake_the_team(api, team, "x"), "a chat that cannot be read is woken: the person costs more than 0.15 $"


def test_right_after_a_resume_the_pace_looks_ahead_at_the_rate_of_the_work_not_at_the_pause_before(tmp_path):
    """Linux build13: the team restarted and spent 0.86 $ in 282 s, 0.45 $ over the pace: the last five minutes were mostly the pause,
    and a fifth of the real rate was what the brake looked ahead at."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    resumed = NOON + 2 * HOUR
    now = resumed + 200   # 80 s after the restart window: 0.20 $ of work in those 80 s = 0.15 $ a minute
    pi_calls(tmp_path, [(NOON + HOUR, 0.9, 100), (resumed + 10, 0.30, 100), (resumed + 130, 0.10, 100), (resumed + 170, 0.10, 100)])
    cap.note_resume(tmp_path, resumed)
    spent = cap.spend(tmp_path, now, NOON, NOON)
    assert spent["since_resume"] == 200 and spent["restart_cost"] == 0.30 and spent["recent_cost"] == 0.5
    allowance = cap.team_budget.allowed(config, dict(read, usd=3.0), now)
    slack = cap.team_budget.margin(3.0)
    worked = spent["budget_cost"] - spent["restart_cost"]
    old_ahead = (0.5 - 0.30) / cap.RATE_WINDOW_SEC * cap.CHECK_EVERY_SEC     # the five-minute window
    new_ahead = (0.5 - 0.30) / (200 - cap.RESTART_WINDOW_SEC) * cap.CHECK_EVERY_SEC
    assert new_ahead > 3 * old_ahead
    # a budget spent so that the old look-ahead lets it through and the new one stops it
    spent["budget_cost"] = round(allowance - slack - old_ahead - 0.01 + spent["restart_cost"], 6)
    assert worked <= spent["budget_cost"]
    assert cap.decide(config, dict(spent, since_resume=None), False, now, read)["action"] == "none"
    assert cap.decide(config, spent, False, now, read)["why"] == "pace"
    # the pause before the resume is not in the rate: spending of a minute before it does not count as the work after
    pi_calls(tmp_path, [(resumed - 30, 0.50, 100)], name="u.jsonl")
    assert cap.spend(tmp_path, now, NOON, NOON)["recent_cost"] == 0.5


def test_a_worker_retired_during_the_pause_has_no_window_and_is_not_written_to(tmp_path):
    api, sent = _wake_api(tmp_path, None)
    api.session_exists = lambda s: s != "SCOUT-2"
    assert cap._wake_the_team(api, ["SCOUT-1", "SCOUT-2", "SCORER-1"], "x") == ["SCOUT-1", "SCORER-1"]
    assert "SCOUT-2" not in sent
