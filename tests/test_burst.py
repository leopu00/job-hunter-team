"""«Lavora a tutta fino alle HH:MM» (`shared/skills/burst.py`): una fascia a termine che il team chiude da solo.

Cosa tiene fermo:

  1. `start` allarga gli orari, salva quelli di prima e concede il burn fino a quell'ora;
  2. `sweep` (il tick del sentinel, a app chiusa) rimette gli orari di prima alla scadenza, o se il burn
     è stato revocato prima, e li lascia stare se nel frattempo li ha cambiati qualcun altro;
  3. una seconda `start` non scambia gli orari allargati per quelli normali;
  4. se la config non si legge o non si scrive lo stato resta e si riprova;
  5. il sentinel chiama lo sweep a ogni tick.

Eseguire:
    pytest tests/test_burst.py -v
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
import burn_intent  # noqa: E402
import burst  # noqa: E402

ROME = "Europe/Rome"
# 2026-10-29 22:00 in Rome (CET, UTC+1) = 21:00 UTC
NOW = datetime(2026, 10, 29, 21, 0, tzinfo=timezone.utc)
OFFICE = {"timezone": ROME, "windows": [{"days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "18:00"}]}


@pytest.fixture
def home(tmp_path, monkeypatch):
    burn_intent.INTENT_FLAG = tmp_path / ".burn-intent.flag"
    burn_intent.AUDIT_LOG = tmp_path / "logs" / "burn-intent.jsonl"
    burn_intent.NOTICES_FILE = tmp_path / ".burn-intent-notices.json"
    burst.CONFIG_FILE = tmp_path / "jht.config.json"
    burst.STATE_FILE = tmp_path / ".burst.json"
    burst.AUDIT_LOG = tmp_path / "logs" / "burst.jsonl"
    monkeypatch.setattr(burn_intent, "_user_zone", lambda: None)
    monkeypatch.setattr(burn_intent, "_system_zone", lambda: timezone.utc)
    return tmp_path


def put_config(home, hours, **extra):
    team = dict(extra)
    if hours is not None:
        team["working_hours"] = hours
    (home / "jht.config.json").write_text(json.dumps({"team": team, "other": 1}), encoding="utf-8")


def hours_now(home):
    return json.loads((home / "jht.config.json").read_text(encoding="utf-8"))["team"].get("working_hours")


def test_the_burst_adds_its_stretch_to_the_hours_the_team_has_and_never_takes_one_away(home):
    put_config(home, OFFICE)
    out = burst.start("03:00", now=NOW)           # Thursday 22:00 in Rome
    assert out["ok"] and out["burst"]["active"] and out["burst"]["untilLocal"] == "03:00"
    assert out["burst"]["until"] == "2026-10-30T02:00:00+00:00"
    wide = hours_now(home)
    assert burst.valid_hours(wide) and wide["timezone"] == ROME
    # Every other day keeps its window; Thursday's holds its own hours and the stretch up to 03:00.
    assert wide["windows"] == [
        {"days": ["mon", "tue", "wed", "fri"], "start": "09:00", "end": "18:00"},
        {"days": ["thu"], "start": "09:00", "end": "03:00"},
    ]
    assert burn_intent.status(NOW)["active"] and burn_intent.status(NOW)["expires_at"] == "2026-10-30T02:00:00+00:00"
    saved = json.loads((home / ".burst.json").read_text(encoding="utf-8"))
    assert saved["previous_hours"] == OFFICE and saved["written_hours"] == wide


def test_a_burst_inside_the_hours_the_team_already_has_changes_nothing(home):
    put_config(home, OFFICE)
    at_1053 = datetime(2026, 10, 29, 9, 53, tzinfo=timezone.utc)        # Thursday 10:53 in Rome
    out = burst.start("14:53", now=at_1053)
    assert out["burst"]["active"] and burn_intent.status(at_1053)["active"]
    assert hours_now(home) == OFFICE
    assert burst.sweep(at_1053 + timedelta(hours=4, minutes=1)) == "restored" and hours_now(home) == OFFICE


def test_a_burst_that_runs_past_the_end_of_the_day_extends_that_window_and_the_old_hours_come_back(home):
    put_config(home, OFFICE)
    at_17 = datetime(2026, 10, 29, 16, 0, tzinfo=timezone.utc)          # Thursday 17:00 in Rome
    burst.start("22:00", now=at_17)
    wide = hours_now(home)
    assert burst.valid_hours(wide)
    assert wide["windows"] == [
        {"days": ["mon", "tue", "wed", "fri"], "start": "09:00", "end": "18:00"},
        {"days": ["thu"], "start": "09:00", "end": "22:00"},
    ]
    assert burst.sweep(at_17 + timedelta(hours=5, minutes=1)) == "restored"
    assert hours_now(home) == OFFICE


def test_a_day_with_no_window_of_its_own_gets_the_stretch_and_the_four_hours_the_rule_wants(home):
    put_config(home, OFFICE)
    saturday = datetime(2026, 10, 31, 21, 0, tzinfo=timezone.utc)       # Saturday 22:00 in Rome
    burst.start("23:30", now=saturday)
    wide = hours_now(home)
    assert burst.valid_hours(wide)
    assert {"days": ["sat"], "start": "19:30", "end": "23:30"} in wide["windows"]
    assert {"days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "18:00"} in wide["windows"]


def test_the_rest_of_the_config_is_left_alone(home):
    put_config(home, OFFICE, role_models={"scout": {"model": "luna"}})
    burst.start("03:00", now=NOW)
    cfg = json.loads((home / "jht.config.json").read_text(encoding="utf-8"))
    assert cfg["other"] == 1 and cfg["team"]["role_models"] == {"scout": {"model": "luna"}}


def test_a_team_that_was_already_24_7_gets_only_the_burn(home):
    put_config(home, None)
    out = burst.start("03:00", now=NOW)
    assert out["burst"]["active"] and hours_now(home) is None
    assert burn_intent.status(NOW)["active"]
    later = NOW + timedelta(hours=6)
    assert burst.sweep(later) == "unchanged"
    assert hours_now(home) is None and not (home / ".burst.json").exists()


def test_the_sweep_before_the_end_does_nothing_and_after_it_puts_the_old_hours_back(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    assert burst.sweep(NOW + timedelta(hours=2)) is None
    assert hours_now(home) != OFFICE
    assert burst.sweep(NOW + timedelta(hours=5, minutes=1)) == "restored"
    assert hours_now(home) == OFFICE and not (home / ".burst.json").exists()
    assert (home / "logs" / "burst.jsonl").exists()


def test_a_burn_revoked_before_the_end_ends_the_burst_too(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    burn_intent.revoke(now=NOW)
    assert burst.sweep(NOW + timedelta(hours=1)) == "restored"
    assert hours_now(home) == OFFICE


def test_hours_changed_by_somebody_else_during_the_burst_are_not_overwritten(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    mine = {"timezone": ROME, "windows": [{"days": ["sat"], "start": "10:00", "end": "16:00"}]}
    put_config(home, mine)
    assert burst.sweep(NOW + timedelta(hours=6)) == "kept"
    assert hours_now(home) == mine and not (home / ".burst.json").exists()


def test_a_second_start_moves_the_end_but_keeps_the_original_hours_to_put_back(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    burst.start("05:00", now=NOW + timedelta(hours=1))
    saved = json.loads((home / ".burst.json").read_text(encoding="utf-8"))
    assert saved["previous_hours"] == OFFICE
    assert burst.sweep(NOW + timedelta(hours=9)) == "restored" and hours_now(home) == OFFICE


def test_stop_puts_the_hours_back_now_and_revokes_the_burn(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    out = burst.stop(now=NOW + timedelta(minutes=30))
    assert out == {"ok": True, "burst": {"active": False}}
    assert hours_now(home) == OFFICE and not burn_intent.status(NOW)["active"]
    assert burst.status(NOW)["burst"] == {"active": False}


def test_stop_with_nothing_running_is_not_an_error_and_does_not_touch_a_burn_the_user_made(home):
    put_config(home, OFFICE)
    burn_intent.grant(3, now=NOW)
    assert burst.stop(now=NOW)["ok"]
    assert burn_intent.status(NOW)["active"]


@pytest.mark.parametrize("until,code", [("25:00", "until_invalid"), ("8:00", "until_invalid"), ("", "until_invalid"),
                                         ("22:05", "until_too_soon"), ("12:00", "until_too_far")])
def test_an_end_out_of_the_rules_is_refused_with_a_closed_code_and_nothing_is_written(home, until, code):
    put_config(home, OFFICE)
    with pytest.raises(burst.Refused) as e:
        burst.start(until, now=NOW)
    assert e.value.code == code
    assert hours_now(home) == OFFICE and not (home / ".burst.json").exists() and not burn_intent.status(NOW)["active"]


def test_the_time_is_the_next_time_the_teams_clock_reads_it_in_its_own_zone(home):
    put_config(home, OFFICE)
    out = burst.start("08:00", now=NOW)           # 22:00 in Rome -> 08:00 tomorrow, 10 h
    assert out["burst"]["until"] == "2026-10-30T07:00:00+00:00"


def test_a_config_that_cannot_be_read_at_the_end_keeps_the_state_and_the_next_tick_retries(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    good = (home / "jht.config.json").read_text(encoding="utf-8")
    (home / "jht.config.json").write_text("{not json", encoding="utf-8")
    assert burst.sweep(NOW + timedelta(hours=6)) is None
    assert (home / ".burst.json").exists()
    (home / "jht.config.json").write_text(good, encoding="utf-8")
    assert burst.sweep(NOW + timedelta(hours=6, minutes=5)) == "restored"
    assert hours_now(home) == OFFICE


def test_a_start_on_a_config_that_cannot_be_read_is_refused(home):
    (home / "jht.config.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(burst.Refused) as e:
        burst.start("03:00", now=NOW)
    assert e.value.code == "config_unreadable" and not burn_intent.status(NOW)["active"]


def test_a_state_file_with_hours_off_the_shape_is_never_trusted_to_write_them(home):
    put_config(home, OFFICE)
    (home / ".burst.json").write_text(json.dumps({
        "until": (NOW - timedelta(hours=1)).isoformat(),
        "previous_hours": {"timezone": "Nowhere/Land", "windows": []},
        "written_hours": OFFICE,
    }), encoding="utf-8")
    assert burst.sweep(NOW) is None
    assert hours_now(home) == OFFICE


def test_the_command_line_answers_one_json_line(home, capsys):
    put_config(home, OFFICE)
    assert burst.main(["status"]) == 0
    assert json.loads(capsys.readouterr().out) == {"ok": True, "burst": {"active": False}}
    assert burst.main(["start", "--until", "99:99"]) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "code": "until_invalid"}


def test_the_sentinel_sweeps_the_burst_at_every_tick_right_after_the_burn():
    source = (REPO_ROOT / ".launcher" / "sentinel-bridge.py").read_text(encoding="utf-8")
    body = source[source.index("_burn_intent_notify_user()\n        _burn_intent_sweep()"):]
    assert body.index("_burn_intent_sweep()") < body.index("_burst_sweep()") < body.index("_burn_intent_status()")


def test_the_script_runs_as_the_container_runs_it(home):
    put_config(home, OFFICE)
    r = subprocess.run([sys.executable, str(SKILLS_DIR / "burst.py"), "status"], capture_output=True, text=True,
                       env={"JHT_HOME": str(home), "PATH": "/usr/bin:/bin"}, timeout=30)
    assert r.returncode == 0 and json.loads(r.stdout) == {"ok": True, "burst": {"active": False}}


# ── the burst adds, to the minute: what the person asked is covered and nothing the team had is taken away ──

WEEK = 7 * 24 * 60


def covered(hours):
    """The minutes of the week (from Monday 00:00) that `hours` lets the team work."""
    minutes = set()
    for w in hours["windows"]:
        s, e = burst._minutes(w["start"]), burst._minutes(w["end"])
        length = e - s if e > s else e + 24 * 60 - s
        for day in w["days"]:
            base = burst.WEEKDAYS.index(day) * 24 * 60 + s
            minutes.update((base + k) % WEEK for k in range(length))
    return minutes


def wall(day_index, minute_of_day):
    """A wall-clock moment in Rome: 2026-10-26 is a Monday (CET, UTC+1 from the 25th)."""
    return datetime(2026, 10, 26, tzinfo=timezone(timedelta(hours=1))) + timedelta(days=day_index, minutes=minute_of_day)


def test_a_burst_that_runs_past_midnight_on_a_nearly_day_long_window_is_split_in_two_days_not_cut(home):
    friday_long = {"timezone": ROME, "windows": [{"days": ["fri"], "start": "08:00", "end": "07:59"}]}
    put_config(home, friday_long)
    now = wall(4, 21 * 60)                                       # Friday 21:00 in Rome
    burst.start("08:10", now=now)                                # Saturday 08:10
    wide = hours_now(home)
    assert burst.valid_hours(wide)
    assert wide["windows"] == [
        {"days": ["fri"], "start": "08:00", "end": "00:00"},
        {"days": ["sat"], "start": "00:00", "end": "08:10"},
    ]
    until = covered({"windows": [{"days": ["fri"], "start": "21:00", "end": "08:10"}]})
    assert until <= covered(wide) and covered(friday_long) <= covered(wide)
    assert burst.sweep(now + timedelta(hours=12)) == "restored" and hours_now(home) == friday_long


def during(hours, now, until):
    """The minutes of `hours` that fall inside the burst, from `now` to `until` (hours already over do not count)."""
    start = now.weekday() * 24 * 60 + now.hour * 60 + now.minute
    minute = lambda t: t.replace(second=0, microsecond=0)            # noqa: E731
    span = int((minute(until) - minute(now)).total_seconds() // 60)
    mine = covered(hours)
    return {m for m in ((start + k) % WEEK for k in range(span)) if m in mine}


def test_a_long_window_of_the_next_day_is_kept_when_the_stretch_reaches_into_it(home):
    long_days = {"timezone": ROME, "windows": [{"days": ["fri", "sat"], "start": "06:00", "end": "05:59"}]}
    put_config(home, long_days)
    now, until = wall(4, 22 * 60), wall(5, 9 * 60)               # Friday 22:00 -> Saturday 09:00
    burst.start("09:00", now=now)
    wide = hours_now(home)
    assert burst.valid_hours(wide)
    assert during(long_days, now, until) <= during(wide, now, until)
    assert during({"windows": [{"days": ["fri"], "start": "22:00", "end": "09:00"}]}, now, until) <= during(wide, now, until)


def test_whatever_the_hours_and_the_moment_the_stretch_is_covered_and_no_hour_of_it_is_taken_away():
    import random
    rng = random.Random(20261029)
    for _ in range(3000):
        windows, free = [], list(burst.WEEKDAYS)
        rng.shuffle(free)
        while free and len(windows) < rng.randint(1, 4):
            days = [free.pop() for _ in range(rng.randint(1, min(3, len(free))))]
            start = rng.randrange(0, 24 * 60, 5)
            length = rng.choice([4, 6, 8, 10, 14, 18, 22]) * 60 + rng.choice([0, 30, 59])
            windows.append({"days": days, "start": burst._clock(start), "end": burst._clock(start + length)})
        previous = {"timezone": ROME, "windows": windows}
        assert burst.valid_hours(previous), previous
        # The person gives an HH:MM, the moment of the click has seconds: the end is still exactly that minute.
        now = wall(rng.randrange(7), rng.randrange(24 * 60)) + timedelta(seconds=rng.randrange(60))
        until = (now + timedelta(minutes=rng.randrange(15, 12 * 60 + 1))).replace(second=0, microsecond=0)
        wide = burst.widened(previous, now, until, (until - now).total_seconds() / 3600)
        assert burst.valid_hours(wide), (previous, now, until, wide)
        # Every minute of the burst is allowed, and every minute the team already had during it still is.
        everything = {"windows": [{"days": list(burst.WEEKDAYS), "start": "00:00", "end": "00:00"}]}
        assert during(everything, now, until) <= during(wide, now, until), (previous, now, until, wide)


def reads(hours, moment):
    """What the scheduler answers (working_hours.is_within_working_hours) for `hours` at `moment`."""
    import working_hours
    return working_hours.is_within_working_hours(moment, {"team": {"working_hours": hours}})


def test_a_burst_to_half_past_midnight_ends_at_half_past_midnight_and_the_scheduler_reads_it_across_midnight(home):
    put_config(home, OFFICE)
    now = wall(3, 17 * 60 + 31) + timedelta(seconds=45)          # Thursday 17:31:45 in Rome
    burst.start("00:30", now=now)
    wide = hours_now(home)
    assert burst.valid_hours(wide)
    # One window of the day it starts on, ending the next morning: the schema's way to cross midnight.
    assert {"days": ["thu"], "start": "09:00", "end": "00:30"} in wide["windows"]
    for day, minute, allowed in [(3, 9 * 60, True), (3, 23 * 60 + 59, True), (4, 0, True), (4, 29, True),
                                 (4, 30, False), (4, 31, False), (4, 8 * 60 + 59, False), (4, 9 * 60, True)]:
        assert reads(wide, wall(day, minute)) is allowed, (day, minute)


def test_the_end_is_the_minute_asked_with_the_seconds_of_the_click_and_on_a_day_with_no_window(home):
    put_config(home, OFFICE)
    now = wall(5, 22 * 60) + timedelta(seconds=59)               # Saturday 22:00:59 in Rome
    burst.start("23:30", now=now)
    wide = hours_now(home)
    assert {"days": ["sat"], "start": "19:30", "end": "23:30"} in wide["windows"]
    assert reads(wide, wall(5, 23 * 60 + 29)) and not reads(wide, wall(5, 23 * 60 + 30))


# ── «a tutta»: the pause of the throttle ──────────────────────────────────────────────────────────────

@pytest.fixture
def throttle(home, monkeypatch):
    """throttle-config.py (a hyphen in the name) on a config of its own, reading the burn of this test."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("throttle_config_burst", SKILLS_DIR / "throttle-config.py")
    tc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tc)
    tc.CONFIG_DIR = home / "config"
    tc.CONFIG_FILE = home / "config" / "throttle.json"
    tc._FLOOR_EXEMPT_FILE = home / "config" / "throttle-floor-exempt.txt"
    tc._BURN_INTENT_MOD = burn_intent
    tc.CONFIG_DIR.mkdir()
    tc.CONFIG_FILE.write_text(json.dumps({"scout-1": 300, "analista-1": 780, "capitano": 0}), encoding="utf-8")
    return tc


def test_without_a_burst_a_worker_waits_what_the_floor_and_the_captain_give_it(throttle):
    assert throttle.get_agent("scout-1") == 300 and throttle.get_agent("analista-1") == 780


def two_hours_from_now() -> str:
    """An end the burst accepts at any hour: the pause is read on the real clock, so the burst starts on it too."""
    from zoneinfo import ZoneInfo
    return (datetime.now(timezone.utc).astimezone(ZoneInfo(ROME)) + timedelta(hours=2)).strftime("%H:%M")


def test_during_the_burst_no_pause_is_longer_than_the_lowest_step_of_the_ladder(home, throttle):
    put_config(home, OFFICE)
    burst.start(two_hours_from_now(), now=datetime.now(timezone.utc))
    cap = burst.BURST_PAUSE_SEC
    assert cap == 60 and burn_intent.pace_cap() == 60
    assert throttle.get_agent("scout-1") == cap and throttle.get_agent("analista-1") == cap
    assert throttle.effective("scout-1", 600) == cap, "a number written by hand in a prompt is capped too"
    assert throttle.effective("scout-1", 30) == 30 and throttle.get_agent("capitano") == 0, "the cap never lengthens"


def test_the_pause_comes_back_when_the_burst_ends_or_is_stopped(home, throttle):
    put_config(home, OFFICE)
    burst.start(two_hours_from_now(), now=datetime.now(timezone.utc))
    assert throttle.get_agent("scout-1") == 60
    burst.stop()
    assert throttle.get_agent("scout-1") == 300 and throttle.get_agent("analista-1") == 780


def test_a_burn_that_does_not_say_a_tutta_leaves_the_pauses_as_they_are(home, throttle):
    burn_intent.grant(hours=2, reason="stanotte spremete")
    assert burn_intent.pace_cap() is None
    assert throttle.get_agent("scout-1") == 300 and throttle.get_agent("analista-1") == 780


def test_a_cap_that_is_not_a_number_is_no_cap(home):
    burn_intent.grant(hours=2)
    flag = json.loads(burn_intent.INTENT_FLAG.read_text(encoding="utf-8"))
    for bad in ("60", -5, True, None, 1.5):
        burn_intent.INTENT_FLAG.write_text(json.dumps({**flag, "pace_cap_sec": bad}), encoding="utf-8")
        assert burn_intent.pace_cap() is None, bad
