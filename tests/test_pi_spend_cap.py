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
        monkeypatch.setattr(cap, "RESTART_COST_PER_SESSION", 0.0)
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
            _activate_daily_halt=self.activate, _write_daily_halt_payload=self.write, list_tmux_sessions=lambda: self.live())

    def write(self, payload):
        self.flag.parent.mkdir(parents=True, exist_ok=True)
        self.flag.write_text(json.dumps(payload), encoding="utf-8")
        return True

    def live(self):
        return getattr(self, "team", None) or ["CAPITANO", "SENTINELLA", "scout-1", "scout-2", "DOCTOR-WATCHDOG"]

    def activate(self, consumed, cap_pct, budget, extra=None):
        # as the bridge: the flag (with what the brake adds) is written before the ESC
        self.esc += 1
        self.write({"consumed_pct": consumed, "cap_pct": cap_pct, "budget_pct": budget, "sessions": [], **(extra or {})})
        self.gate_at_esc = json.loads(self.flag.read_text(encoding="utf-8"))
        self.told_at_esc = len(self.sent) + len(self.users)
        self.paused = self.live()
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
    assert sorted(s for s, _ in bridge.sent) == ["ASSISTENTE", "CAPITANO", "SENTINELLA"]
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
    assert bridge.esc == 1 and len(bridge.sent) == 3 and len(bridge.users) == 1


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
    # JHT-T354: the person reads one plain sentence that asks them to decide, in USD terms, with no figure that goes stale in the
    # chat (W1 F-09), no «pi» and no configuration key
    user = bridge.users[0][0]
    assert "jht setup" in user and "%s" not in user and " pi " not in user and "no_quota_cap" not in user and "EUR" not in user


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
    assert bridge.esc == 1 and sorted(s for s, _ in bridge.sent) == ["ASSISTENTE", "CAPITANO", "SENTINELLA"]


# --- the budget of the setup: dollars over a period, spread over the working hours (JHT-T322) ------------------------

import plan_registry  # noqa: E402
import team_budget  # noqa: E402

HOUR = 3600


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")  # as the setup writes it


def budget(usd, starts, ends, hours=None, **extra):
    team = {"budget": dict({"usd": usd, "starts_at": iso(starts), "ends_at": iso(ends), "set_by": "setup", "pace": True}, **extra)}
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
    # the hour told is the one of the lift: 13:30 for the line to reach 2.00 $, plus the room of the reload of the team (Captain, Sentinella, a
    # Scout) and the work after it, three times, at 0.50 $ an hour: 16:01
    assert record["why"] == "pace" and record["ceiling"] == 1.75 and record["resumes_at"] == "2026-11-09T16:01:12+00:00"
    assert all("BUDGET PACE" in t and "lifts by itself at 16:01" in t for t in bridge.texts())
    assert "16:01" in bridge.users[0][0] and "⏸️" in bridge.users[0][0]
    bridge.clock["now"] = NOON + 4 * HOUR
    bridge.tick(state=state)
    assert bridge.flag.exists(), "16:00: not yet"
    bridge.clock["now"] = NOON + 4 * HOUR + 3 * 60
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
    assert record["why"] == "pace" and record["resumes_at"] == "2026-11-10T12:46:48+01:00"
    text = bridge.users[0][0]
    assert "12:46" in text and "2026-11-10" not in text and "Europe/Rome" not in text, "the day after: the hour and the word, no date, no zone"
    assert "12:46 tomorrow" in text or "12:46 di domani" in text


def test_the_budget_zone_is_the_one_the_person_lives_in(tmp_path):
    config = budget(5, NOON, NOON + 10 * HOUR, timezone="Europe/Budapest")
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, config)
    bridge.clock["now"] = NOON + HOUR
    bridge.tick()
    assert flag_record(bridge)["resumes_at"] == "2026-11-09T17:01:12+01:00" and "17:01" in bridge.users[0][0]


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
    team = {"budget": dict({"usd": usd, "duration_minutes": minutes, "saved_at": iso(saved), "timezone": "UTC", "pace": True,
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
    assert record["why"] == "pace" and record["resumes_at"] == "2026-11-11T12:48:00+01:00"
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
    # the look ahead stops it, as the pace's pause when it has an hour to give (the team resumes later), else as the budget's
    assert record["why"] in ("budget", "pace") and record["spent"] <= 5.0 - 0.10
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


def test_the_captain_is_told_when_the_person_saves_another_budget_and_not_for_the_first(tmp_path):
    """Retest 25395266b: the Capitano kept deciding on the 3 USD of the budget before the setup. The first budget it sees is no change;
    another one saved while it runs is said once, with the new figures."""
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(NOON - 900, 0.02, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(3, 1440, saved))
    state: dict = {}
    bridge.tick(state=state)
    assert not [t for _, t in bridge.sent if "BUDGET CHANGED" in t], "the first one is not a change"
    bridge.config = duration_budget(2, 4320, NOON - 600)
    bridge.clock["now"] += 60
    bridge.tick(state=state)
    told = [t for s, t in bridge.sent if s == "CAPITANO" and "BUDGET CHANGED" in t]
    assert len(told) == 1 and "2 USD for 4320 minutes" in told[0] and "3 USD" not in told[0]
    assistant = [t for s, t in bridge.sent if s == "ASSISTENTE" and "BUDGET CHANGED" in t]
    assert len(assistant) == 1 and "2 USD for 4320 minutes" in assistant[0], "the Assistente hears it too"
    bridge.clock["now"] += 60
    bridge.tick(state=state)
    assert len([t for _, t in bridge.sent if "BUDGET CHANGED" in t]) == 2, "once each"


def test_a_budget_notice_that_raises_does_not_cost_the_look_of_the_brake(tmp_path, monkeypatch, capsys):
    """The notice of a changed budget is outside the look: it raising, the team over the budget is stopped all the same."""
    saved = NOON - 2 * HOUR
    pi_calls(tmp_path, [(saved + 600, 1.95, 100)], name="s.jsonl", agent="scout-1")
    bridge = Bridge(tmp_path, duration_budget(2, 1440, saved))
    state: dict = {"pi_spend_cap": {"budget_seen": "an older budget"}}

    def broken(*a, **k):
        raise RuntimeError("clock")

    monkeypatch.setattr(cap, "_tell_budget_changed", broken)
    bridge.tick(state=state)
    assert bridge.esc == 1 and flag_record(bridge)["why"] == "budget", "the hard stop is still decided"
    assert "WARN pi spend cap budget notice: clock" in capsys.readouterr().out


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
    assert sorted(s for s, _ in bridge.sent) == ["ASSISTENTE", "CAPITANO", "SENTINELLA"] and len(bridge.users) == 1


def _paused_at_13_30(tmp_path):
    pi_calls(tmp_path, [(NOON + 1800, 2.0, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON, NOON + 10 * HOUR))
    bridge.clock["now"] = NOON + HOUR
    state: dict = {}
    bridge.tick(state=state)
    assert flag_record(bridge)["resumes_at"] == "2026-11-09T16:01:12+00:00" and len(bridge.users) == 1
    return bridge, state


def test_spending_after_the_pause_moves_the_resume_time_in_the_flag_and_the_person_is_told_once_per_pause(tmp_path):
    """A turn already running and a welcome at `jht up` spent after the pause: the brake reckoned 16:53, the flag and the chat
    still said 14:58, and at 16:11 the team was still paused past the time the person was given. One message per pause (retest
    19/11: four or five with changing hours): the flag has the new hour, the person is told again only when the hour told is gone."""
    bridge, state = _paused_at_13_30(tmp_path)
    pi_calls(tmp_path, [(NOON + HOUR + 30, 0.5, 100)], name="after.jsonl", agent="capitano")   # 0.50 $ more: one hour later
    bridge.clock["now"] = NOON + HOUR + 120
    bridge.tick(state=state)
    record = flag_record(bridge)
    assert record["resumes_at"] == "2026-11-09T17:01:12+00:00" and record["resumes_told_at"] == "2026-11-09T16:01:12+00:00"
    assert bridge.esc == 1, "no second ESC"
    assert len(bridge.users) == 1, "16:01 is still to come: the hour moved, the person is not told a second time"
    bridge.clock["now"] = NOON + 4 * HOUR + 2 * 60   # 16:02: the hour the person was given is gone
    bridge.tick(state=state)
    assert len(bridge.users) == 2 and "17:01" in bridge.users[-1][0], "a promise that was broken is told"
    assert any("lifts by itself at 17:01" in t for t in bridge.texts())
    bridge.clock["now"] = NOON + 4 * HOUR + 3 * 60
    bridge.tick(state=state)
    assert len(bridge.users) == 2, "the same time is not said again"


def test_a_move_is_written_in_the_flag_and_never_said_while_the_hour_told_is_to_come(tmp_path):
    bridge, state = _paused_at_13_30(tmp_path)
    pi_calls(tmp_path, [(NOON + HOUR + 30, 0.02, 100)], name="a.jsonl", agent="capitano")     # 2.4 minutes later
    bridge.clock["now"] = NOON + HOUR + 120
    bridge.tick(state=state)
    record = flag_record(bridge)
    assert record["resumes_at"] == "2026-11-09T16:03:36+00:00" and record["resumes_told_at"] == "2026-11-09T16:01:12+00:00"
    assert len(bridge.users) == 1, "a move of two minutes is not a new message"
    pi_calls(tmp_path, [(NOON + HOUR + 150, 0.03, 100)], name="b.jsonl", agent="capitano")    # 6 minutes in all
    bridge.clock["now"] = NOON + HOUR + 240
    bridge.tick(state=state)
    assert flag_record(bridge)["resumes_at"] == "2026-11-09T16:07:12+00:00" and len(bridge.users) == 1, "six minutes in all: still one message"
    assert flag_record(bridge)["resumes_told_at"] == "2026-11-09T16:01:12+00:00"


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


def test_reserve_the_restart_counts_but_its_estimate_stays_under_the_line_so_no_stop_within_80_seconds_slack_kept(tmp_path):
    """Linux 12b: 0.454 $ in 31 s at a resume, and the pace stopped the team again 80 s later. Linux retest: the restart left out of the
    pace was the whole overshoot (1.90 $ against 1.04). Now the restart is in what was spent, and the stage that woke the sessions
    kept the estimate of their reload under the line: they fit when they were woken, so there is no stop while they reload."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    resumed = NOON + 4 * HOUR
    pi_calls(tmp_path, [(NOON + HOUR, 0.5, 100)])
    room = cap._stage_room(config, read, cap.spend(tmp_path, resumed, NOON, NOON), resumed)
    assert room > 0.5, room    # the line holds the estimated reload: the stage wakes them
    cap.note_wake(tmp_path, resumed, 0.5)
    pi_calls(tmp_path, [(resumed + 5, 0.20, 100), (resumed + 20, 0.254, 100)], name="t.jsonl")
    for at in (resumed + 40, resumed + 80, resumed + 119):
        kept = cap.spend(tmp_path, at, NOON, NOON)
        assert kept["budget_cost"] == 0.954, "the restart is in what was spent"
        assert kept["reserve_open"] == 0.046, "and the estimate not yet spent stays under the line"
        assert cap.decide(config, kept, False, at, read)["action"] == "none", "no stop while the sessions reload"
    after = cap.spend(tmp_path, resumed + 125, NOON, NOON)
    assert after["reserve_open"] == 0.0 and after["budget_cost"] == 0.954
    # the estimate is a reserve, not a licence: more than it, and the pace stops
    pi_calls(tmp_path, [(resumed + 100, 1.2, 100)], name="u.jsonl")
    over = cap.spend(tmp_path, resumed + 110, NOON, NOON)
    assert cap.decide(config, over, False, resumed + 110, read)["action"] == "halt"


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
    old_ahead = (0.5 - 0.30) / cap.RATE_WINDOW_SEC * cap.CHECK_EVERY_SEC     # the five-minute window
    new_ahead = (0.5 - 0.30) / (200 - cap.RESTART_WINDOW_SEC) * cap.CHECK_EVERY_SEC
    assert new_ahead > 3 * old_ahead
    # a budget spent so that the old look-ahead lets it through and the new one stops it
    spent["budget_cost"] = round(allowance - slack - old_ahead - 0.01, 6)
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


def _context_call(home, agent, ts, model, input_tokens, cache_write, cache_read, cost):
    """A call with its context, as pi writes it: for the estimate of what a session costs to start again."""
    folder = home / ".pi" / "agent" / "sessions" / f"--jht_home-agents-{agent}--"
    folder.mkdir(parents=True, exist_ok=True)
    rows = [{"type": "session", "version": 3, "id": agent, "cwd": f"/jht_home/agents/{agent}"},
            {"type": "message", "timestamp": stamp(ts), "message": {"role": "assistant", "model": model, "usage": {
                "input": input_tokens, "output": 100, "cacheRead": cache_read, "cacheWrite": cache_write, "reasoning": 0,
                "cost": {"total": cost, "totalFromProvider": False}}}}]
    path = folder / (agent + ".jsonl")
    path.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows), encoding="utf-8")
    os.utime(path, (NOON - 5, NOON - 5))


EIGHT = ["ANALISTA-5", "ANALISTA-6", "DOTTORE", "MANTENITORE", "SCORER-2", "SCOUT-1", "SCOUT-2", "SCOUT-3"]


def test_reserve_the_restart_estimate_is_session_by_session_from_the_last_context_and_the_price_of_its_model(tmp_path):
    """Linux build15: 8 sessions woken at once, 0.52 $ in 40 s, of which 0.197 $ the Scorer on Sonnet with 75k of context."""
    _context_call(tmp_path, "scorer-2", NOON, "sonnet", 1000, 74000, 0, 0.28)            # 75k tokens, 3.7 $ per million
    _context_call(tmp_path, "scout-1", NOON, "haiku", 500, 3000, 20000, 0.004)           # a small context on a cheap model
    now = NOON + 100
    estimate = cap.restart_estimate(tmp_path, now, EIGHT)
    floor = cap.RESTART_COST_PER_SESSION
    scout = cap.ROLE_RELOAD_COST["SCOUT"]
    assert abs(estimate - (0.28 + 3 * scout + 4 * floor)) < 0.001, estimate   # the Scorer 75k tokens at 3.7 $ per million, a Scout at least what the data say, the others the minimum
    assert estimate > 8 * floor + 0.15, "the Sonnet with a big context weighs more than the average"
    assert cap.restart_estimate(tmp_path, now, ["SCOUT-9"]) == scout, "no history: what a Scout costs by the data of the retest, not the minimum"
    assert cap.restart_estimate(tmp_path, now, ["ANALISTA-9"]) == floor, "no history and no role in the data: the minimum"
    assert cap.restart_estimate(tmp_path, now, ["SENTINELLA-WORKER", "ASSISTENTE"]) == 0.0, "the ones that are not woken are not counted"
    assert cap.restart_estimate(tmp_path, now, None) == 0.0


def test_reserve_a_pause_of_the_pace_is_not_lifted_when_the_restart_of_all_does_not_fit_under_the_line(tmp_path):
    """The sequence of build15: budget 1 $, pace pause at 0.598 $; with the ten per cent of room the team came back and the restart
    took it to 1.13 $. With the restart estimated the team stays paused: never past the ceiling."""
    config = budget(1, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    _context_call(tmp_path, "scorer-2", NOON, "sonnet", 1000, 74000, 0, 0.28)
    now = NOON + 9 * HOUR
    estimate = cap.restart_estimate(tmp_path, now, EIGHT)
    base = {"budget_cost": 0.598, "recent_cost": 0.0, "before_start": 0.0}
    assert cap.decide(config, base, False, now, read, held_by_pace=True)["action"] == "none", "with only the share the team would come back"
    held = cap.decide(config, base, False, now, read, held_by_pace=True, restart_estimate=estimate)
    assert held["action"] == "halt" and held["why"] == "pace" and 0.598 + estimate + cap.team_budget.margin(1.0) > 1.0


def test_reserve_after_a_resume_the_hard_stop_looks_ahead_at_the_rate_since_the_resume_restart_included(tmp_path):
    """00:23:49: 1.105 $ of 1.0 and no stop: 0.52 $ in 40 s was read as a fifth of it. Now 0.78 $ a minute, and the stop is there."""
    config = budget(1, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    now = NOON + 9 * HOUR
    spent = {"budget_cost": 0.55, "recent_cost": 0.52, "before_start": 0.0, "since_resume": 40.0}
    assert cap.decide(config, dict(spent, since_resume=None), False, now, read)["action"] != "halt", "the old window: 0.10 $ ahead"
    verdict = cap.decide(config, spent, False, now, read)
    assert verdict["action"] == "halt" and verdict["why"] == "pace" and not verdict.get("stays"), "the pace's pause, with its hour: 0.55 of 1.0 is not the budget spent"
    assert cap.decide(config, dict(spent, budget_cost=0.97), False, now, read)["why"] == "budget", "the budget spent stays the budget's stop"


def test_reserve_the_brake_looks_every_15_seconds_for_five_minutes_after_a_resume(tmp_path):
    assert cap.look_every(tmp_path, NOON) == cap.CHECK_EVERY_SEC
    cap.note_resume(tmp_path, NOON)
    assert cap.look_every(tmp_path, NOON + 10) == cap.LOOK_AFTER_RESUME_SEC == 15.0
    assert cap.look_every(tmp_path, NOON + cap.WATCH_AFTER_RESUME_SEC - 1) == 15.0
    assert cap.look_every(tmp_path, NOON + cap.WATCH_AFTER_RESUME_SEC + 1) == cap.CHECK_EVERY_SEC


def test_reserve_when_the_restart_does_not_fit_the_person_is_told_the_pause_lasts_to_the_end_of_the_period_not_an_hour(tmp_path):
    """The first pause already counts the reload of the sessions of the team: with a residue that does not cover it the person reads at once
    that the team stays paused until the period ends, or until the budget is raised, and is told once."""
    config = budget(1, NOON, NOON + 10 * HOUR)
    pi_calls(tmp_path, [(NOON + 3600, 0.75, 100)])
    bridge = Bridge(tmp_path, config)
    bridge.clock["now"] = NOON + 2 * HOUR
    state: dict = {}
    bridge.tick(state=state)
    first = flag_record(bridge)
    assert first["why"] == "pace" and first.get("stays") is True and first["resumes_at"] is None
    bridge.clock["now"] = NOON + 2 * HOUR + 60
    bridge.tick(state=state)
    record = flag_record(bridge)
    assert record.get("stays") is True and record["resumes_at"] is None and bridge.esc == 1, "no second ESC"
    assert len(bridge.users) == 1, "told once"
    said = bridge.users[-1][0]
    assert "stays paused until the end of the period" in said and "22:00" in said and "jht setup" in said
    assert "resumes by itself" not in said
    assert any("does NOT lift by itself before the period ends" in t for t in bridge.texts())
    bridge.clock["now"] = NOON + 2 * HOUR + 120
    bridge.tick(state=state)
    assert len(bridge.users) == 1, "said once"
    # the status of the CLI reads resumes_at: none, so it says the pause lasts to the end of the period
    for language in ("it", "en", "de", "es", "fr", "hu", "pt"):
        text = json.loads((Path(__file__).resolve().parent.parent / "shared" / "locales" / (language + ".json")).read_text(encoding="utf-8"))["pi_cap.halt_pace_stays"]
        assert text.count("%s") == 3 and "jht setup" in text


SEVEN_AND_THE_CAPTAIN = ["CAPITANO", "SENTINELLA", "SCOUT-1", "SCOUT-2", "SCOUT-3", "SCORER-2", "ANALISTA-5", "ANALISTA-6", "DOTTORE", "MANTENITORE"]


def _unblocked_team(tmp_path, spent_before=0.0):
    """The retest of the brake: a budget of 3 $ unblocked, the Scorer and the Captain on Sonnet with big contexts, the rest small."""
    config = budget(3, NOON, NOON + 24 * HOUR)
    bridge = Bridge(tmp_path, config)
    _context_call(tmp_path, "scorer-2", NOON - 600, "sonnet", 1000, 74000, 0, 0.28)
    _context_call(tmp_path, "capitano", NOON - 600, "sonnet", 1000, 40000, 0, 0.15)
    if spent_before:
        pi_calls(tmp_path, [(NOON + 20, spent_before, 100)], name="before.jsonl", agent="scout-9")
    bridge.flag.parent.mkdir(parents=True, exist_ok=True)
    bridge.flag.write_text(json.dumps({"reason": "pi_spend_cap", "sessions": list(SEVEN_AND_THE_CAPTAIN),
                                       "pi_spend_cap": {"why": "budget", "spent": 3.0, "ceiling": 3.0}}), encoding="utf-8")
    return bridge


def _resume_now(bridge, tmp_path, at):
    bridge.clock["now"] = at
    budget_read = cap.team_budget.read(bridge.config, tmp_path)
    spent = cap.spend(tmp_path, at, budget_read["counts_from"], budget_read["starts"])
    run = SimpleNamespace(state={"no_quota_declared": dict(NO_QUOTA)}, now_h="12:00:00", _bi_on=False)
    cap._resume(bridge.api, run, "2026-11-09", lambda *a: None, {"config": bridge.config, "budget": budget_read, "spent": spent, "now": at})
    return run, spent


def test_reserve_an_unblock_wakes_by_stages_the_scouts_first_and_the_captain_is_told_who_waits(tmp_path):
    """Retest of the brake: seven workers woken together after the unblock spent 1.90 $ against a line of 1.04 $."""
    bridge = _unblocked_team(tmp_path)
    at = NOON + 400
    run, spent = _resume_now(bridge, tmp_path, at)
    woken = [s for s, t in bridge.sent if t.startswith("[RIPRENDI]")]
    pending = cap.pending_wakes(tmp_path)
    assert woken[:1] == ["SCOUT-1"] and "SCOUT-2" in pending, "the Scouts first, as many as leave room to work after their reload"
    assert pending and set(pending) | set(woken) == set(SEVEN_AND_THE_CAPTAIN) - {"CAPITANO", "SENTINELLA"}
    assert "MANTENITORE" in pending and "SCOUT-1" not in pending, "the last of the list waits"
    reserved = cap._read_wakes(tmp_path)[-1]
    assert reserved[0] == at and reserved[1] <= cap._stage_room(bridge.config, cap.team_budget.read(bridge.config, tmp_path), spent, at) + 1e-6, \
        "what was woken fits under the line"
    notes = [t for s, t in bridge.sent if s == "CAPITANO" and "BY STAGES" in t]
    assert len(notes) == 1 and all(name in notes[0] for name in pending) and "Do NOT wake them yourself" in notes[0]
    # a later look: the line has risen, the next sessions fit
    bridge.clock["now"] = at + 3 * HOUR
    bridge.sent.clear()
    bridge.tick(state=run.state)
    later = [s for s, t in bridge.sent if t.startswith("[RIPRENDI]")]
    assert later and set(later) <= set(pending) and set(cap.pending_wakes(tmp_path)) == set(pending) - set(later)
    bridge.clock["now"] = at + 20 * HOUR
    bridge.tick(state=run.state)
    assert cap.pending_wakes(tmp_path) == [], "all woken when the line holds them"


def test_reserve_a_worker_that_starts_without_being_woken_is_stopped_by_the_pace_and_the_ceiling_holds(tmp_path):
    bridge = _unblocked_team(tmp_path)
    bridge.team = list(SEVEN_AND_THE_CAPTAIN)
    at = NOON + 400
    run, _ = _resume_now(bridge, tmp_path, at)
    assert cap.pending_wakes(tmp_path) and not bridge.flag.exists()
    # the Captain or a message wakes a waiting Analyst anyway, and it reloads a big context
    pi_calls(tmp_path, [(at + 20, 1.6, 100)], name="rogue.jsonl", agent="analista-6")
    bridge.clock["now"] = at + 30
    bridge.tick(state=run.state)
    assert bridge.flag.exists() and flag_record(bridge)["why"] in ("pace", "budget"), "the pace stops it"
    assert cap.pending_wakes(tmp_path) == [], "everyone is stopped: the next lift stages from the start"
    assert bridge.esc == 1
    # and the ceiling: what is spent never goes through the budget while the brake looks every 15 s
    spent = cap.spend(tmp_path, at + 30, bridge.clock["now"] - 1000, NOON)
    assert spent["budget_cost"] < 3.0


def test_reserve_a_lift_needs_room_for_the_first_stage_not_for_the_whole_team(tmp_path):
    """Retest of the brake, budget of 1 $: 0.36 spent and the pause lasted 24 hours, the reload of the whole team never fitting."""
    config = budget(1, NOON, NOON + 24 * HOUR)
    read = cap.team_budget.read(config)
    _context_call(tmp_path, "scorer-2", NOON - 600, "sonnet", 1000, 74000, 0, 0.28)
    _context_call(tmp_path, "capitano", NOON - 600, "sonnet", 1000, 40000, 0, 0.15)
    base = {"budget_cost": 0.36, "recent_cost": 0.0, "before_start": 0.0}
    whole = cap.restart_estimate(tmp_path, NOON, SEVEN_AND_THE_CAPTAIN)
    first = cap.first_stage_cost(tmp_path, NOON, SEVEN_AND_THE_CAPTAIN)
    assert first < whole / 2
    held_whole = [cap.decide(config, base, False, NOON + h * 3600, read, held_by_pace=True, restart_estimate=whole)["action"] for h in (6, 12, 20)]
    assert held_whole == ["halt"] * 3, "all or nothing: the line does not hold the whole reload before the period ends"
    lifted = [cap.decide(config, base, False, NOON + h * 3600, read, held_by_pace=True, restart_estimate=first)["action"] for h in (6, 12, 20)]
    assert "none" in lifted, "the first stage fits and the team works at the pace"


def test_the_queue_of_the_pace_keeps_only_names_of_sessions_that_a_resume_wakes(tmp_path):
    cap.set_pending(tmp_path, ["SCOUT-1", "ASSISTENTE", "MENTOR", "DOCTOR-WATCHDOG", "CAPITANO", "../x", "scout-2", "SCORER-2"], NOON)
    assert cap.pending_wakes(tmp_path) == ["SCOUT-1", "SCORER-2"]


def test_the_first_instant_of_a_new_budget_has_a_line_and_not_an_infinite_room():
    """Retest 19/11: after the unblock the period had not started, the room was infinite, eight sessions started together on 0.91 $ and
    the pause came 48 s later. The line at the first instant is the lead of the pace."""
    config = {"team": {"budget": {"usd": 0.91, "duration_minutes": 120, "saved_at": iso(NOON), "set_by": "setup", "pace": True}}}
    read = cap.team_budget.read(config)
    assert read["starts"] is None and read["duration"] == 7200.0
    room = cap._stage_room(config, read, {"budget_cost": 0.0, "before_start": 0.0}, NOON + 60)
    assert 0 < room < 0.91, room
    assert room < cap.team_budget.allowed(config, dict(read, starts=NOON + 60, ends=NOON + 60 + 7200.0), NOON + 60) + 1e-9
    # what was spent before counts against the same line
    assert cap._stage_room(config, read, {"budget_cost": 0.5, "before_start": 0.0}, NOON + 60) < room


def test_the_scout_goes_first_even_when_its_reload_does_not_fit_and_nobody_overtakes_it():
    """Retest 19/11: the Scouts, with the dearest reload, were skipped and a cheaper Scorer took the room; they stayed in the queue for
    sixteen minutes."""
    costs = {"SCOUT-1": 0.40, "SCORER-1": 0.10, "ANALISTA-3": 0.10}
    stage = cap.Stage(0.25, costs)
    order = sorted(costs, key=cap._wake_rank)
    assert order[0] == "SCOUT-1"
    taken = [x for x in order if stage.take(x)]
    assert taken == ["SCOUT-1"], "the Scout alone, and the cheaper ones wait behind it"
    assert stage.pending == ["SCORER-1", "ANALISTA-3"]
    # no room at all: nobody, not even the first
    stage = cap.Stage(0.0, costs)
    assert [x for x in order if stage.take(x)] == []
    # when they all fit, they all go
    stage = cap.Stage(2.0, costs)
    assert [x for x in order if stage.take(x)] == order


def test_reserve_the_queue_is_written_before_the_first_send_and_the_name_woken_is_already_out_of_it(tmp_path):
    """P2-1: the gate of a session holds every message for a name in the queue, so the [RIPRENDI] of its stage must find it out, and the ones
    still waiting must already be in: there is no moment of the stage in which a session that waits can be reached."""
    bridge = _unblocked_team(tmp_path)
    seen = []
    plain = bridge.api.jht_tmux_send

    def watch(session, text):
        if text.startswith("[RIPRENDI]"):
            seen.append((session, list(cap.pending_wakes(tmp_path))))
        return plain(session, text)

    bridge.api.jht_tmux_send = watch
    at = NOON + 400
    _resume_now(bridge, tmp_path, at)
    assert seen and all(session not in waiting for session, waiting in seen), "the name that is woken is out of the queue"
    final = cap.pending_wakes(tmp_path)
    assert final and all(waiting == final for _, waiting in seen), "the ones that wait were in it before the first send"
    # the same at a later look
    seen.clear()
    bridge.clock["now"] = at + 3 * HOUR
    bridge.tick(state={})
    assert all(session not in waiting for session, waiting in seen)


def test_reserve_closes_per_session_at_its_first_turn_and_never_counts_a_reload_twice(tmp_path):
    """Retest 19/11: a resume of 0.18 $ real (Captain 0.16, Scout 0.02) was reserved at 1.86 $ of estimates for two minutes, and the pace
    paused the team 10-47 s after every resume. The reserve of a session closes at its first turn: its real reload is in the spend."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    resumed = NOON + 4 * HOUR
    pi_calls(tmp_path, [(NOON + HOUR, 0.41, 100)], agent="analista-1")
    cap.note_wake(tmp_path, resumed, 1.858, {"SCOUT-1": 0.978, "CAPITANO": 0.88})
    waiting = cap.spend(tmp_path, resumed + 5, NOON, NOON)
    assert waiting["reserve_open"] == 1.858, "nobody has made a turn yet: all of it is reserved"
    pi_calls(tmp_path, [(resumed + 8, 0.02, 100)], name="a.jsonl", agent="scout-1")
    one = cap.spend(tmp_path, resumed + 10, NOON, NOON)
    assert one["reserve_open"] == 0.88, "the Scout has made its turn: its estimate is closed"
    pi_calls(tmp_path, [(resumed + 12, 0.16, 100)], name="b.jsonl", agent="capitano")
    for at in (resumed + 15, resumed + 42, resumed + 90):
        done = cap.spend(tmp_path, at, NOON, NOON)
        assert done["reserve_open"] == 0.0 and done["budget_cost"] == 0.59
        assert cap.decide(config, done, False, at, read)["action"] == "none", "the real spend is far under the line: no pause"


def test_reserve_the_estimate_of_a_session_is_its_last_real_reload_not_the_whole_context_at_the_write_price(tmp_path):
    pi_calls(tmp_path, [(NOON, 0.30, 100), (NOON + 20, 0.01, 100), (NOON + 4000, 0.02, 100)], agent="analista-1")
    pi_calls(tmp_path, [(NOON, 0.30, 100), (NOON + 4000, 0.003, 100)], name="t.jsonl", agent="scout-1")
    costs = cap.session_costs(tmp_path, NOON + 5000, ["ANALISTA-1", "ANALISTA-9", "SCOUT-1", "SCOUT-9", "CAPITANO"])
    assert costs["ANALISTA-1"] == 0.02, "its first turn after the stop cost 0.02 $"
    assert costs["ANALISTA-9"] == cap.RESTART_COST_PER_SESSION, "no history: the minimum"
    assert costs["SCOUT-1"] == costs["SCOUT-9"] == 0.22, "a turn of 0.003 $ (a warm cache) and no history are both what a Scout costs by the data"
    assert costs["CAPITANO"] == 0.19


def test_reserve_a_pause_with_budget_left_never_says_it_stays_until_the_period_ends(tmp_path):
    """Retest 19/11: «stays paused until the end of the period» with 2.59 $ still to spend, the reload estimate (2.7 $, five times the
    real one) being what did not fit. With the estimate of a reload as it is (0.3 $) the pause has an hour; only a reload that does not
    fit in what is left says «stays»."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    at = NOON + 2 * HOUR
    spent = {"budget_cost": 1.0, "before_start": 0.0, "recent_cost": 0.0, "restart_recent": 0.0, "reserve_open": 0.0}
    verdict = cap.decide(config, spent, False, at, read, True, 0.3)
    assert verdict["action"] == "halt" and not verdict.get("stays") and verdict["resumes"] < read["ends"]
    assert cap.decide(config, spent, False, at, read, True, 2.7).get("stays") is True, "a reload that really does not fit"


def test_reserve_a_pause_is_told_once_while_its_hour_moves(tmp_path):
    config = budget(3, NOON, NOON + 10 * HOUR)
    bridge = Bridge(tmp_path, config)
    run = SimpleNamespace(state={}, now_h="x", _bi_on=False)
    told = []
    verdict = {"action": "halt", "why": "pace", "spent": 0.4, "usd": 3, "ends": NOON + 10 * HOUR, "starts": NOON, "counts_from": NOON,
               "ceiling": 0.4, "resumes": NOON + 2 * HOUR, "before": 0.0}
    record = cap._record(verdict, config)
    record["resumes_told_at"] = record["resumes_at"]
    flag = {"reason": cap.REASON, "pi_spend_cap": record}
    moved = dict(verdict, resumes=NOON + 2 * HOUR + 1200)
    cap._resume_moved(bridge.api, run, moved, {"cost": 0.4}, "d", lambda *a: told.append(a), config, NOON + 600, flag)
    assert told == [] and not bridge.sent, "moved by 20 minutes before the told hour: written, not told again"
    assert flag["pi_spend_cap"]["resumes_at"] == cap._record(moved, config)["resumes_at"], "the flag has the new hour"


def test_reserve_the_wakes_file_written_by_an_agent_cannot_open_or_poison_the_line(tmp_path):
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "pace-wakes.json").write_text('[[%d, 1.0, {"SCOUT-1": NaN, "CAPITANO": -5, "X": 0.2}], [NaN, 1.0], [%d, -1.0]]' % (NOON, NOON))
    wakes = cap._read_wakes(tmp_path)
    assert wakes == [(float(NOON), 1.0, {"X": 0.2})]


def _broken_files(home):
    state = home / "state"
    state.mkdir(exist_ok=True)
    return {"huge": "[%s]" % ("9" * 400), "deep": "[" * 100000 + "]" * 100000, "big": "[" + "1," * 40000 + "1]",
            "text": "not json", "nan": "[NaN, -Infinity]", "dict": '{"a": 1}'}


@pytest.mark.parametrize("kind", ["huge", "deep", "big", "text", "nan", "dict"])
def test_reserve_a_broken_state_file_of_the_pace_is_an_empty_one_and_never_stops_the_look_or_the_hard_cap(tmp_path, kind):
    """A file the agents can write (an integer of 400 digits, 100000 brackets deep, over 64 KiB) raised out of spend() and the whole look
    of the brake was skipped, the hard cap with it."""
    text = _broken_files(tmp_path)[kind]
    for name in ("pace-resumes.json", "pace-wakes.json", "pace-wake-queue.json"):
        (tmp_path / "state" / name).write_text(text, encoding="utf-8")
    assert cap._read_resumes(tmp_path) == [] and cap._read_wakes(tmp_path) == []
    assert cap.pending_wakes(tmp_path) == [] and cap.waiting(tmp_path, NOON) == []
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    pi_calls(tmp_path, [(NOON + 60, 2.95, 100)])
    spent = cap.spend(tmp_path, NOON + 120, NOON, NOON)
    assert spent["budget_cost"] == 2.95 and spent["reserve_open"] == 0.0
    assert cap.decide(config, spent, False, NOON + 120, read)["action"] == "halt", "the hard cap holds"
    cap.note_wake(tmp_path, NOON + 130, 0.3, {"SCOUT-1": 0.3})
    assert cap._read_wakes(tmp_path) == [(float(NOON + 130), 0.3, {"SCOUT-1": 0.3})], "the next write of the brake mends the file"


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="no pipes with a name on this system")
@pytest.mark.parametrize("kind", ["fifo", "link", "folder"])
def test_reserve_a_state_file_of_the_pace_that_is_not_a_plain_file_is_empty_and_returns_at_once(tmp_path, kind):
    """A pipe with no writer in the place of a file of the pace held open() for ever, and with it the look of the brake and the hard cap."""
    import signal

    state = tmp_path / "state"
    state.mkdir()
    target = tmp_path / "real.json"
    target.write_text("[1.0]", encoding="utf-8")
    for name in ("pace-resumes.json", "pace-wakes.json", "pace-wake-queue.json"):
        place = state / name
        if kind == "fifo":
            os.mkfifo(str(place))
        elif kind == "link":
            place.symlink_to(target)
        else:
            place.mkdir()

    def stuck(*_):
        raise AssertionError("the reader waited for a pipe")

    signal.signal(signal.SIGALRM, stuck)
    signal.alarm(5)
    try:
        assert cap._read_resumes(tmp_path) == [] and cap._read_wakes(tmp_path) == []
        assert cap.pending_wakes(tmp_path) == [] and cap.waiting(tmp_path, NOON) == []
    finally:
        signal.alarm(0)


def test_reserve_a_resume_waits_for_the_room_of_the_reload_and_of_the_work_after_it(tmp_path):
    """Retest 8d5f09a2b: the pace lifted as soon as the line passed the reload alone (Captain + Scout, 0.30 $), the reload ate the whole room
    and the team stopped 33-35 s after the resume, twice. It lifts now with the room of the reload and of the work after it."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    at = NOON + 2 * HOUR
    stopped = {"budget_cost": 1.0, "before_start": 0.0, "recent_cost": 0.0, "restart_recent": 0.0, "reserve_open": 0.0}
    paused = cap.decide(config, stopped, False, at, read, True, 0.30)
    assert paused["action"] == "halt" and paused["why"] == "pace" and not paused.get("stays")
    lift = paused["resumes"]
    assert cap.decide(config, stopped, False, lift - 30, read, True, 0.30)["action"] == "halt"
    assert cap.decide(config, stopped, False, lift + 1, read, True, 0.30)["action"] == "none", "lifted"
    # the line at the lift leaves the reload and then room to work: the reload of 0.30 $ in 35 s does not stop the team
    after = {"budget_cost": 1.30, "before_start": 0.0, "recent_cost": 0.30, "restart_recent": 0.30, "reserve_open": 0.0, "since_resume": 35}
    assert cap.decide(config, after, False, lift + 35, read)["action"] == "none", "it works some minutes before the next pause"
    worked = dict(after, budget_cost=1.30 + 0.30, recent_cost=0.60)
    assert cap.decide(config, worked, False, lift + 35 + 240, read)["action"] == "halt", "and the line is still the line"
    # the room of the lift is the one of the reload and the work: three times the estimate under the line
    assert cap.team_budget.allowed(config, dict(read, usd=read["usd"]), lift) >= 1.0 + 3 * 0.30 - 1e-6


def test_reserve_a_budget_too_small_for_the_whole_room_lowers_the_multiple_and_never_locks_the_rest(tmp_path):
    """Small budget or end of the period: the room never reaches three times the reload. If what is left covers the reload and the work
    once more, it resumes at a true hour; only a left that does not cover that says the pause stays."""
    config = budget(1, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    at = NOON + HOUR
    slack = cap.team_budget.margin(1.0)
    est = 0.35   # three times it (1.05 $) never fits in 1 $: the lower multiples are for this
    for used, stays in ((1.0 - slack - 2.5 * est, False), (1.0 - slack - 2.05 * est, False), (1.0 - slack - 1.2 * est, False), (1.0 - slack - 0.5 * est, True)):
        spent = {"budget_cost": used, "before_start": 0.0, "recent_cost": 0.0, "restart_recent": 0.0, "reserve_open": 0.0}
        paused = cap.decide(config, spent, False, at, read, True, est)
        assert paused["action"] == "halt", (used, paused)
        assert bool(paused.get("stays")) is stays, (used, paused)
        if not stays:
            assert paused["resumes"] is not None and paused["resumes"] <= read["ends"], "a true hour, not «until the end of the period»"


def test_reserve_in_the_middle_of_a_period_that_could_the_pause_waits_for_three_times_the_reload(tmp_path):
    """Retest 22b3c6eab: lifted with 2 times the reload, the team worked 59 s. A budget that can give 3 times waits for it, and never lifts
    at 2: with less left than that it stays (a hour is told only when it is true)."""
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    est = 0.31
    spent = {"budget_cost": 3.0 - cap.team_budget.margin(3.0) - 2.2 * est, "before_start": 0.0, "recent_cost": 0.0, "restart_recent": 0.0, "reserve_open": 0.0}
    verdict = cap.decide(config, spent, False, NOON + 2 * HOUR, read, True, est)
    assert verdict["action"] == "halt" and verdict.get("stays") is True, "2.2 times left, 3 needed: it does not lift at 2"


def test_reserve_a_stage_leaves_room_to_work_so_the_seven_never_start_together(tmp_path):
    """Retest 8d5f09a2b, resume 1: [RIPRENDI] to all seven at once and the pause 0.06 $ over the line."""
    costs = {"SCOUT-1": 0.12, "SCOUT-2": 0.12, "SCORER-1": 0.20, "ANALISTA-1": 0.12, "ANALISTA-2": 0.12, "DOTTORE": 0.12, "MANTENITORE": 0.12}
    order = sorted(costs, key=cap._wake_rank)
    stage = cap.Stage(1.0, costs)
    taken = [x for x in order if stage.take(x)]
    assert 0 < len(taken) < len(order) and stage.pending == order[len(taken):], "some wait in the queue"
    assert stage.estimate * cap.WORK_MULTIPLE <= 1.0 + 1e-9, "what was woken leaves room to work after the reload"
    assert taken[0] == "SCOUT-1"


# --- a stop only the look ahead asked for is the pace's pause, with its hour (retest 22b3c6eab) -------------------------------------
# 2.54 of 3.0 «⛔ choose a new budget», 37 s later «⏸️ resumes at 17:41»: two opposite words for one pause.

def test_a_stop_that_only_the_look_ahead_asked_for_is_the_pause_of_the_pace_with_an_hour(tmp_path):
    config = budget(3, NOON, NOON + 10 * HOUR)
    read = cap.team_budget.read(config)
    spent = {"budget_cost": 1.2, "recent_cost": 1.0, "before_start": 0.0, "since_resume": 40.0}
    verdict = cap.decide(config, spent, False, NOON + 9 * HOUR, read)
    assert verdict["action"] == "halt" and verdict["why"] == "pace" and verdict["resumes"], "1.2 of 3.0 is not the budget spent: the pace pauses and says when"


def test_the_stop_of_the_budget_spent_stays_the_budgets(tmp_path):
    pi_calls(tmp_path, [(NOON - 1500, 3.8, 100), (NOON - 120, 1.15, 100)])
    bridge = Bridge(tmp_path, budget(5, NOON - 1800, NOON + 10 * HOUR))
    bridge.tick(state={})
    assert flag_record(bridge)["why"] == "budget"


def test_the_notice_key_of_a_stop_changes_after_a_resume(tmp_path):
    verdict = {"why": "budget", "counts_from": 1000.0}
    first = cap._halt_key(verdict, "d", tmp_path)
    cap.note_resume(tmp_path, 5000.0)
    second = cap._halt_key(verdict, "d", tmp_path)
    assert first != second, "the team woken in between and stopped again is a new pause for the person"


# --- the pace is the person's to ask for: off by default, only the budget and the end of the period stop the team ----------------

def test_the_pace_is_off_unless_the_budget_asks_for_it():
    assert cap.team_budget.read(budget(3, NOON, NOON + 10 * HOUR))["pace"] is True
    off = budget(3, NOON, NOON + 10 * HOUR, pace=False)
    assert cap.team_budget.read(off)["pace"] is False
    plain = {"team": {"budget": {"usd": 3, "starts_at": iso(NOON), "ends_at": iso(NOON + 10 * HOUR)}}}
    assert cap.team_budget.read(plain)["pace"] is False, "a budget written without the key: off"
    assert cap.team_budget.read(budget(3, NOON, NOON + 10 * HOUR, pace="yes"))["pace"] is False, "only a true is on"


def test_with_the_pace_off_a_team_ahead_of_the_line_goes_on_until_the_budget_or_the_period_ends():
    on = budget(3, NOON, NOON + 10 * HOUR)
    off = budget(3, NOON, NOON + 10 * HOUR, pace=False)
    spent = {"budget_cost": 1.5, "before_start": 0.0, "recent_cost": 0.0, "restart_recent": 0.0, "reserve_open": 0.0}
    at = NOON + HOUR
    assert cap.decide(on, spent, False, at, cap.team_budget.read(on))["why"] == "pace", "on: 1.5 of 3 in the first hour is ahead of the line"
    assert cap.decide(off, spent, False, at, cap.team_budget.read(off))["action"] != "halt", "off: nothing to stop"
    spent["budget_cost"] = 2.95
    assert cap.decide(off, spent, False, at, cap.team_budget.read(off))["why"] == "budget", "the budget spent stops it"
    spent["budget_cost"] = 1.0
    assert cap.decide(off, spent, False, NOON + 10 * HOUR - 10, cap.team_budget.read(off))["why"] == "period", "and so does the end of the period"


def test_a_resume_after_the_person_stopped_the_team_tells_the_truth_and_wakes_nobody(tmp_path):
    """Collaudo Linux 23/11 (P3-3): right after a stop of every agent the person read «the team is resuming». The budget allows work
    again, the brake is lifted, nobody is woken (the stop of the person wins) and the notice says the team stays stopped."""
    bridge, state = _a_stop_that_looks_ahead(tmp_path)
    (tmp_path / ".team-halted.flag").write_text("user stop\n", encoding="utf-8")
    bridge.clock["now"] += 600
    bridge.config = budget(5, bridge.clock["now"], bridge.clock["now"] + 1800)
    bridge.tick(state=state)
    assert not bridge.flag.exists() and _woken(bridge) == []
    said = [text for text, _ in bridge.users]
    assert said and "jht team start" in said[-1] and "stays stopped" in said[-1], said
    assert not any("is resuming" in text for text in said), said


# --- JHT-T349: the stop the Captain commits to, the measured rate, the figure that never goes stale ------------------

def stop_at(home: Path, usd):
    (home / "state").mkdir(parents=True, exist_ok=True)
    (home / "state" / "spend-stop-at.json").write_text(json.dumps({"usd": usd, "set_at": "2026-11-09T11:00:00+00:00",
                                                                   "by": "capitano"}), encoding="utf-8")


def test_the_stop_the_captain_committed_to_is_a_ceiling_the_system_applies(tmp_path):
    # W1 F-04: «I stop at ~2.4 $» and the team was at 3.06 $: the promise is now the brake's
    pi_calls(tmp_path, [(NOON - 900, 2.0, 100), (NOON - 120, 0.5, 100)])
    stop_at(tmp_path, 2.4)
    bridge = Bridge(tmp_path, {})
    bridge.tick(no_quota=False)
    assert bridge.esc == 1
    record = json.loads(bridge.flag.read_text(encoding="utf-8"))["pi_spend_cap"]
    assert record["why"] == "stop_at" and record["ceiling"] == 2.4 and record["spent"] == 2.5
    user = bridge.users[0][0]
    assert "2.5 USD" in user and "2.4 USD" in user and " pi " not in user
    told = dict(bridge.sent)
    assert "YOUR SPENDING STOP REACHED" in told["CAPITANO"]
    assert "NOT TO RELAY" in told["ASSISTENTE"] and "jht team status" in told["ASSISTENTE"]


def test_under_the_stop_nothing_and_raising_it_lifts_the_pause(tmp_path):
    pi_calls(tmp_path, [(NOON - 900, 2.0, 100)])
    stop_at(tmp_path, 1.5)
    bridge = Bridge(tmp_path, {})
    state: dict = {}
    bridge.tick(no_quota=False, state=state)
    assert bridge.flag.exists()
    stop_at(tmp_path, 5.0)
    bridge.clock["now"] += 60
    bridge.tick(no_quota=False, state=state)
    assert not bridge.flag.exists(), "the Captain raised the stop on the person's word: the team works again"


@pytest.mark.parametrize("body", ["{broken", json.dumps({"usd": -1}), json.dumps({"usd": True}), json.dumps([2.4])])
def test_a_stop_file_that_cannot_be_read_is_no_stop(tmp_path, body):
    pi_calls(tmp_path, [(NOON - 900, 2.0, 100)])
    (tmp_path / "state").mkdir(parents=True, exist_ok=True)
    (tmp_path / "state" / "spend-stop-at.json").write_text(body, encoding="utf-8")
    bridge = Bridge(tmp_path, {})
    bridge.tick(no_quota=False)
    assert bridge.esc == 0 and not bridge.flag.exists()


def test_every_look_writes_the_figure_and_the_measured_rate(tmp_path):
    # W1 F-09: «0.06 USD» stayed for the afternoon; the rate is the last ten minutes, in dollars per minute
    pi_calls(tmp_path, [(NOON - 3000, 2.0, 100), (NOON - 300, 1.5, 100)])
    pi_calls(tmp_path, [(NOON - 200, 0.5, 100)], name="c.jsonl", agent="capitano")
    bridge = Bridge(tmp_path, {})
    bridge.tick(no_quota=False)
    now = json.loads((tmp_path / "state" / "spend-now.json").read_text(encoding="utf-8"))
    assert now["spent_usd"] == 4.0 and now["counts"] == "today" and now["window_min"] == 10.0
    assert now["usd_per_min"] == pytest.approx(0.2) and now["workers"] == 1
    assert now["workers_usd_per_min"] == pytest.approx(0.15) and now["stop_at_usd"] is None
    pi_calls(tmp_path, [(NOON - 3000, 2.0, 100), (NOON - 300, 1.5, 100), (NOON + 30, 1.0, 100)])
    bridge.clock["now"] += 60
    bridge.tick(no_quota=False)
    assert json.loads((tmp_path / "state" / "spend-now.json").read_text(encoding="utf-8"))["spent_usd"] == 5.0


def test_the_person_is_asked_about_a_budget_once_not_every_day(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 2.5, 100)])
    bridge = Bridge(tmp_path, {})
    state: dict = {}
    bridge.tick(state=state)
    pi_calls(tmp_path, [(NOON + 86400 - 600, 2.5, 100)], name="t.jsonl")
    tomorrow = next((tmp_path / ".pi").rglob("t.jsonl"))
    os.utime(tomorrow, (NOON + 86400 - 5, NOON + 86400 - 5))
    bridge.clock["now"] += 86400
    bridge.tick(state=state)
    assert len(bridge.users) == 1, "one sentence, not a doppione a day"
    assert len([s for s, _ in bridge.sent if s == "CAPITANO"]) == 2, "the Captain keeps the figure of each day"


# --- one currency: the spending is in dollars, the daily ceiling is compared and said in dollars ----------------------------

@pytest.mark.parametrize("cap, spent, halts", [
    ({"usd": 10}, 9.99, False), ({"usd": 10}, 10.0, True),                                   # the edge, in dollars
    ({"eur": 10}, 9.99, False), ({"eur": 10}, 10.0, True),                                   # euros counted at 1 USD per EUR
    ({"eur": 10, "eur_to_usd": 1.2}, 11.99, False), ({"eur": 10, "eur_to_usd": 1.2}, 12.0, True),
    ({"usd": 5, "eur": 10}, 5.0, True),                                                       # usd wins over eur
    ({"usd": True}, 50.0, False), ({"usd": -1}, 50.0, False), ({"eur": 10, "eur_to_usd": 0}, 10.0, True),
])
def test_the_daily_ceiling_is_compared_in_dollars_at_its_edge(cap, spent, halts):
    verdict = cap_decide(cap, spent)
    assert (verdict["action"] == "halt") is halts, verdict


def cap_decide(cap, spent):
    measure = {"cost": spent, "hour_tokens": 0, "calls": 1, "credit": None}
    return cap_module.decide({"no_quota_cap": cap}, measure, True, budget=None)


cap_module = cap


def test_the_captain_and_the_person_read_the_same_currency(tmp_path):
    pi_calls(tmp_path, [(NOON - 600, 12.5, 100)])
    bridge = Bridge(tmp_path, {"no_quota_cap": {"eur": 10, "eur_to_usd": 1.2}})
    bridge.tick()
    captain = dict(bridge.sent)["CAPITANO"]
    assert "12.5 USD today against a ceiling of 12 USD (declared as 10 EUR, counted at 1.2 USD per EUR)" in captain
    user = bridge.users[0][0]
    assert "12.5 USD" in user and "12 USD" in user and "EUR" not in user
    bridge2 = Bridge(tmp_path / "b", {"no_quota_cap": {"usd": 10}})
    pi_calls(tmp_path / "b", [(NOON - 600, 10.0, 100)])
    bridge2.tick()
    assert "against a ceiling of 10 USD." in dict(bridge2.sent)["CAPITANO"] and "EUR" not in dict(bridge2.sent)["CAPITANO"]


# ── JHT-T345b: the ceiling a day spread over the day (no_quota_cap.pace) ──

DAILY_PACED = {"no_quota_cap": {"usd": 10, "pace": True}}


def test_the_ceiling_a_day_with_its_pace_is_a_budget_of_one_day_that_starts_at_midnight():
    paced = team_budget.daily_paced(DAILY_PACED, NOON)
    midnight = datetime(2026, 11, 9, tzinfo=timezone.utc).timestamp()
    assert paced == {"usd": 10.0, "counts_from": midnight, "starts": midnight, "ends": midnight + 86400, "duration": None,
                     "saved_at": None, "pace": True, "daily": True}
    assert team_budget.daily_paced({"no_quota_cap": {"usd": 10}}, NOON) is None, "no pace asked: the plain ceiling"
    assert team_budget.daily_paced({"no_quota_cap": {"pace": True}}, NOON) is None, "no ceiling"
    with_budget = dict(DAILY_PACED, **budget(5, NOON - HOUR, NOON + HOUR))
    assert team_budget.daily_paced(with_budget, NOON) is None, "a budget of a period wins"


def test_the_ceiling_a_day_spread_over_the_day_pauses_a_team_that_runs_ahead_and_says_when_it_resumes(tmp_path):
    """10 $ over 24 hours: 0.42 $ an hour, 2.50 $ ahead (a quarter). At 12:00 it may have spent 7.50."""
    pi_calls(tmp_path, [(NOON - HOUR, 6.0, 100)])
    bridge = Bridge(tmp_path, DAILY_PACED)
    state: dict = {}
    bridge.tick(state=state)
    assert bridge.esc == 0, "6 of 7.50 allowed by noon"
    pi_calls(tmp_path, [(NOON - HOUR, 8.0, 100)])
    bridge.tick(state=state)
    assert bridge.esc == 1
    record = flag_record(bridge)
    assert record["why"] == "pace" and record["resumes_at"] is not None
    assert "⏸️" in bridge.users[0][0]


def test_the_ceiling_a_day_spread_over_the_day_is_no_period_that_ends_at_midnight(tmp_path):
    late = datetime(2026, 11, 9, 23, 58, tzinfo=timezone.utc).timestamp()
    pi_calls(tmp_path, [(late - HOUR, 1.0, 100)])
    bridge = Bridge(tmp_path, DAILY_PACED)
    bridge.clock["now"] = late
    bridge.tick()
    assert bridge.esc == 0 and not bridge.flag.exists(), "23:58 with 1 $ of 10: nothing to stop, and no «period over»"
