"""work_stats: what the team did while it worked, kept as counts on this computer (contract
banda/piani/CONTRATTO-orari-proiezioni-20261026.md).

All data is synthetic: positions called «posizione-N», no real person, no real company.
"""
from __future__ import annotations

import json
import os
import sqlite3
import stat
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import work_stats  # noqa: E402
import working_hours  # noqa: E402

UTC = timezone.utc


def at(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M").replace(tzinfo=UTC)


NIGHT = {"team": {"working_hours": {"timezone": "Europe/Rome", "windows": [
    {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "22:00", "end": "08:00"}]}}}
DAY = {"team": {"working_hours": {"timezone": "UTC", "windows": [
    {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "09:00", "end": "19:00"}]}}}


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(work_stats, "_last_schedule_state", None)
    return tmp_path


def put_config(home, config):
    (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")


def put_rows(home, rows):
    directory = home / "stats"
    directory.mkdir(mode=0o700, exist_ok=True)
    (directory / "work-hours.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def row(hour, minutes=60, threshold=75, delta=None):
    return {"hour": hour, "activeMinutes": minutes, "scoreThreshold": threshold, "weeklyDeltaPct": delta}


def make_db(home, positions):
    """positions: (found_at 'YYYY-MM-DD HH:MM:SS', best score or None)."""
    conn = sqlite3.connect(home / "jobs.db")
    conn.executescript("""
        CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT, found_at TIMESTAMP, status TEXT,
                                is_open INTEGER, expires_at TEXT);
        CREATE TABLE scores (id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER);
        CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER);
    """)
    for number, (found, score) in enumerate(positions, 1):
        conn.execute("INSERT INTO positions (id, title, company, found_at, status) VALUES (?,?,?,?, 'scored')",
                     (number, f"posizione-{number}", f"azienda-{number}", found))
        if score is not None:
            conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)", (number, score))
    conn.commit()
    conn.close()


# ── the archive: shape, permissions, retention ─────────────────────────────────────────────────────

def test_a_recording_writes_one_row_with_exactly_the_closed_fields(home):
    put_config(home, DAY)
    written = work_stats.record(now=at("2026-10-26T10:30"), log=lambda *_: None)
    assert set(written) == {"hour", "activeMinutes", "scoreThreshold", "weeklyDeltaPct"}
    lines = (home / "stats" / "work-hours.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1 and set(json.loads(lines[0])) == {"hour", "activeMinutes", "scoreThreshold", "weeklyDeltaPct"}
    assert written["hour"] == "2026-10-26T10:00:00Z" and written["activeMinutes"] == 31
    assert written["scoreThreshold"] == 75


def test_the_folder_and_the_file_are_private_and_no_temporary_is_left(home):
    work_stats.record(now=at("2026-10-26T10:30"), log=lambda *_: None)
    assert stat.S_IMODE((home / "stats").stat().st_mode) == 0o700
    assert stat.S_IMODE((home / "stats" / "work-hours.jsonl").stat().st_mode) == 0o600
    assert sorted(p.name for p in (home / "stats").iterdir()) == ["work-hours.jsonl"]


def test_the_temporary_is_born_private_and_removed_when_the_write_fails(home, monkeypatch):
    seen = {}
    real_replace = os.replace

    def failing_replace(source, target):
        seen["mode"] = stat.S_IMODE(os.stat(source).st_mode)
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", failing_replace)
    with pytest.raises(OSError):
        work_stats.record(now=at("2026-10-26T10:30"), log=lambda *_: None)
    monkeypatch.setattr(os, "replace", real_replace)
    assert seen["mode"] == 0o600
    assert list((home / "stats").iterdir()) == []


def test_a_second_recording_in_the_same_hour_replaces_the_row(home):
    put_config(home, DAY)
    work_stats.record(now=at("2026-10-26T10:10"), log=lambda *_: None)
    work_stats.record(now=at("2026-10-26T10:50"), log=lambda *_: None)
    rows, _ = work_stats.load_rows()
    assert len(rows) == 1 and rows[0]["activeMinutes"] == 51


def test_rows_past_ninety_days_are_dropped(home):
    old = (at("2026-10-26T10:00") - timedelta(days=91)).strftime("%Y-%m-%dT%H:00:00Z")
    kept = (at("2026-10-26T10:00") - timedelta(days=89)).strftime("%Y-%m-%dT%H:00:00Z")
    put_rows(home, [row(old), row(kept)])
    work_stats.record(now=at("2026-10-26T10:30"), log=lambda *_: None)
    assert [r["hour"] for r in work_stats.load_rows()[0]] == [kept, "2026-10-26T10:00:00Z"]


def test_clear_removes_the_archive_and_the_next_recording_starts_again(home):
    work_stats.record(now=at("2026-10-26T10:30"), log=lambda *_: None)
    assert work_stats.clear() == {"cleared": True}
    assert not (home / "stats" / "work-hours.jsonl").exists()
    assert work_stats.clear() == {"cleared": True}, "clearing nothing is not an error"
    assert work_stats.read()["nights"] == []


# ── the file is NOT trusted: every row is checked ──────────────────────────────────────────────────

BAD_ROWS = [
    ({**row("2026-10-26T10:00:00Z"), "title": "posizione-1"}, "an extra field"),
    ({"hour": "2026-10-26T10:00:00Z", "activeMinutes": 60, "scoreThreshold": 75}, "a missing field"),
    (row("2026-10-26T10:00:00Z", minutes="sessanta"), "a string where a number goes"),
    (row("2026-10-26T10:00:00Z", minutes=10 ** 30), "a huge number"),
    (row("2026-10-26T10:00:00Z", minutes=61), "minutes out of range"),
    (row("2026-10-26T10:00:00Z", minutes=True), "a boolean"),
    (row("2026-10-26T10:00:00Z", delta=101), "a delta over 100"),
    (row("2026-10-26T10:00:00Z", delta=-1), "a negative delta"),
    (row("2026-10-26T10:00:00Z", delta=1.5), "a fractional delta"),
    (row("2026-10-26T10:30:00Z"), "an hour that is not whole"),
    (row("<img src=x>"), "an hour that is not a date"),
    (row("2026-13-45T10:00:00Z"), "an impossible date"),
    ([1, 2, 3], "a list"),
]


@pytest.mark.parametrize("bad,why", BAD_ROWS, ids=[why for _bad, why in BAD_ROWS])
def test_a_row_that_fails_the_check_is_dropped_and_the_page_gets_only_the_good_one(home, bad, why):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-25T10:00:00Z", delta=2), bad])
    rows, dropped = work_stats.load_rows()
    assert [r["hour"] for r in rows] == ["2026-10-25T10:00:00Z"] and dropped
    page = work_stats.read(home=home)
    assert [n["date"] for n in page["nights"]] == ["2026-10-25"]
    assert all(isinstance(n[key], (int, float, type(None))) or key == "date"
               for n in page["nights"] for key in n)


def test_a_line_of_ten_megabytes_is_not_read(home):
    directory = home / "stats"
    directory.mkdir()
    (directory / "work-hours.jsonl").write_bytes(b'{"hour":"' + b"x" * (10 * 1024 * 1024) + b'"}\n')
    assert work_stats.load_rows() == ([], True)


def test_a_long_line_inside_a_normal_file_is_dropped_without_stopping_the_rest(home):
    directory = home / "stats"
    directory.mkdir()
    good = json.dumps(row("2026-10-25T10:00:00Z"))
    (directory / "work-hours.jsonl").write_text("x" * 100000 + "\n" + good + "\n", encoding="utf-8")
    rows, dropped = work_stats.load_rows()
    assert len(rows) == 1 and dropped


def test_a_corrupt_archive_starts_again_empty_and_the_registry_says_so_without_the_content(home):
    directory = home / "stats"
    directory.mkdir()
    (directory / "work-hours.jsonl").write_text("not json at all\n\x00\x01\n", encoding="utf-8")
    lines: list[str] = []
    work_stats.record(now=at("2026-10-26T10:30"), log=lines.append)
    assert [r["hour"] for r in work_stats.load_rows()[0]] == ["2026-10-26T10:00:00Z"]
    assert "[work_stats] work_stats_reset" in lines and not any("not json" in line for line in lines)


def test_the_validation_is_what_keeps_a_bad_row_out(home, monkeypatch):
    """Counter-check: without the check the extra field would reach the page."""
    put_config(home, DAY)
    put_rows(home, [{**row("2026-10-25T10:00:00Z"), "title": "posizione-1"}])
    assert work_stats.load_rows()[0] == []
    monkeypatch.setattr(work_stats, "valid_row", lambda r: r)
    assert "title" in work_stats.load_rows()[0][0]


# ── what the page reads ────────────────────────────────────────────────────────────────────────────

def test_a_night_across_midnight_is_the_night_of_the_day_it_started(home):
    put_config(home, NIGHT)        # Europe/Rome, 22:00-08:00: UTC+2 until 25/10 03:00 UTC, then +1
    # Monday 19/10/2026: 22:00-24:00 and Tuesday 00:00-08:00 local = 20:00-22:00 and 22:00-06:00 UTC
    hours = [f"2026-10-19T{h:02d}:00:00Z" for h in (20, 21)] + [f"2026-10-19T{h:02d}:00:00Z" for h in (22, 23)] + \
            [f"2026-10-20T{h:02d}:00:00Z" for h in range(0, 6)]
    put_rows(home, [row(h) for h in hours])
    page = work_stats.read(home=home)
    assert [(n["date"], n["hoursActive"]) for n in page["nights"]] == [("2026-10-19", 10.0)]


def test_a_day_window_is_counted_on_its_own_date(home):
    put_config(home, DAY)
    put_rows(home, [row(f"2026-10-26T{h:02d}:00:00Z") for h in range(9, 19)])
    assert [(n["date"], n["hoursActive"]) for n in work_stats.read(home=home)["nights"]] == [("2026-10-26", 10.0)]


def test_hours_outside_the_team_hours_do_not_make_a_night(home):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T03:00:00Z", minutes=0), row("2026-10-26T10:00:00Z")])
    nights = work_stats.read(home=home)["nights"]
    assert [n["hoursActive"] for n in nights] == [1.0]


def test_the_clock_change_gives_real_hours(home):
    # Europe/Rome 25/10/2026 ends summer time: the local day has 25 hours; 29/03/2026 starts it: 23.
    put_config(home, {"team": {"working_hours": {"timezone": "Europe/Rome", "windows": [
        {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "00:00", "end": "23:59"}]}}})
    import zoneinfo
    rome = zoneinfo.ZoneInfo("Europe/Rome")
    for day, expected in (("2026-10-25", 25), ("2026-03-29", 23)):
        start = datetime.fromisoformat(day).replace(tzinfo=rome)
        end = (start.replace(hour=0) + timedelta(days=1)).replace(tzinfo=rome)
        hours = []
        cursor = start.astimezone(UTC)
        while cursor.astimezone(rome).date().isoformat() == day:
            hours.append(cursor.strftime("%Y-%m-%dT%H:00:00Z"))
            cursor += timedelta(hours=1)
        assert len(hours) == expected
        put_rows(home, [row(h) for h in hours])
        night = work_stats.read(home=home)["nights"][0]
        assert night["date"] == day and night["hoursActive"] == float(expected)


def test_found_and_above_are_counted_from_the_database_by_the_hour_and_the_threshold_of_the_hour(home):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z", threshold=75), row("2026-10-26T11:00:00Z", threshold=90)])
    make_db(home, [("2026-10-26 10:05:00", 80), ("2026-10-26 10:40:00", 60), ("2026-10-26 11:10:00", 80),
                   ("2026-10-26 11:20:00", None), ("2026-10-25 10:05:00", 99)])
    night = work_stats.read(home=home)["nights"][0]
    assert night["found"] == 4 and night["aboveThreshold"] == 1, "80 is above 75 at 10, not above 90 at 11"
    assert night["scoreThreshold"] == 90, "a night whose hours had two thresholds carries the higher one"


def test_above_threshold_is_null_not_zero_when_nothing_is_scored(home):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z")])
    make_db(home, [("2026-10-26 10:05:00", None)])
    night = work_stats.read(home=home)["nights"][0]
    assert night["found"] == 1 and night["aboveThreshold"] is None


def test_without_a_database_found_is_null(home):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z")])
    night = work_stats.read(home=home)["nights"][0]
    assert night["found"] is None and night["aboveThreshold"] is None


def test_the_counts_are_the_ones_the_harvest_queue_gives_for_the_same_positions(home):
    """Same set of positions, same number as the dashboard's count (db_query.harvest_scope)."""
    import db_query
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z", threshold=db_query.HARVEST_MIN_SCORE)])
    make_db(home, [("2026-10-26 10:01:00", 80), ("2026-10-26 10:02:00", 75), ("2026-10-26 10:03:00", 74),
                   ("2026-10-26 10:04:00", None)])
    night = work_stats.read(home=home)["nights"][0]
    conn = sqlite3.connect(home / "jobs.db")
    query, params, count = db_query.harvest_scope(db_query.HARVEST_MIN_SCORE)
    from_dashboard = conn.execute(f"SELECT {count} {query}", params).fetchone()[0]
    assert night["aboveThreshold"] == from_dashboard == 2
    assert work_stats.score_threshold() == db_query.HARVEST_MIN_SCORE


def test_the_consumption_is_the_sum_of_the_hours_and_null_when_no_hour_has_it(home):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z", delta=2), row("2026-10-26T11:00:00Z", delta=None),
                    row("2026-10-26T12:00:00Z", delta=3), row("2026-10-27T10:00:00Z")])
    nights = {n["date"]: n for n in work_stats.read(home=home)["nights"]}
    assert nights["2026-10-26"]["consumptionPct"] == 5 and nights["2026-10-27"]["consumptionPct"] is None
    assert all(n["turnMedianSec"] is None for n in nights.values()), "no source for the length of a turn"


def test_the_page_gets_the_last_nights_the_retention_and_the_last_observation(home):
    put_config(home, DAY)
    put_rows(home, [row(f"2026-10-{d:02d}T10:00:00Z") for d in range(1, 21)])
    page = work_stats.read(nights=5, home=home)
    assert [n["date"] for n in page["nights"]] == [f"2026-10-{d:02d}" for d in range(16, 21)]
    assert page["from"] == "2026-10-16" and page["to"] == "2026-10-20"
    assert page["lastObservation"] == "2026-10-20T10:00:00Z" and page["retentionDays"] == 90
    assert page["threshold"] == 75


def test_the_output_has_no_field_outside_the_closed_list_and_no_text_of_the_database(home):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z", delta=1)])
    make_db(home, [("2026-10-26 10:05:00", 80)])
    page = work_stats.read(home=home)
    assert set(page) == {"nights", "from", "to", "lastObservation", "retentionDays", "threshold", "scheduleState"}
    assert set(page["nights"][0]) == {"date", "hoursActive", "found", "aboveThreshold", "scoreThreshold",
                                      "consumptionPct", "turnMedianSec"}
    text = json.dumps(page)
    assert "posizione" not in text and "azienda" not in text


def test_nothing_in_the_team_reads_the_archive_outside_work_stats_and_the_backup():
    names = ("work-hours.jsonl", "stats/work-hours")
    found = []
    for base in ("shared", "agents", ".launcher", "cli/src", "web/app", "web/lib", "desktop/src-tauri/src", "desktop/src"):
        for path in (ROOT / base).rglob("*"):
            if path.suffix not in {".py", ".js", ".ts", ".tsx", ".rs", ".sh"} or "node_modules" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if any(name in text for name in names):
                found.append(str(path.relative_to(ROOT)))
    allowed = {"shared/skills/work_stats.py", "desktop/src-tauri/src/team_backup.rs"}
    assert set(found) <= allowed, f"something else reads the statistics: {sorted(set(found) - allowed)}"
    cloud = [p for p in found if "cloud" in p]
    assert cloud == [], "no cloud code touches the statistics"


# ── the weekly delta from the sentinel ─────────────────────────────────────────────────────────────

def sample(ts, used):
    return json.dumps({"ts": ts, "weekly_usage": used}) + "\n"


def test_the_weekly_delta_is_the_whole_points_used_inside_the_hour(tmp_path):
    sentinel = tmp_path / "sentinel-data.jsonl"
    sentinel.write_text(sample("2026-10-26T09:55:00+00:00", 40) + sample("2026-10-26T10:10:00+00:00", 41) +
                        sample("2026-10-26T10:50:00+00:00", 43), encoding="utf-8")
    hour = at("2026-10-26T10:00")
    assert work_stats.weekly_delta(sentinel, hour, at("2026-10-26T10:55")) == 3


def test_a_reset_a_missing_file_or_no_sample_in_the_hour_is_null(tmp_path):
    hour = at("2026-10-26T10:00")
    assert work_stats.weekly_delta(tmp_path / "none.jsonl", hour, at("2026-10-26T10:55")) is None
    sentinel = tmp_path / "s.jsonl"
    sentinel.write_text(sample("2026-10-26T09:55:00+00:00", 90) + sample("2026-10-26T10:20:00+00:00", 2), encoding="utf-8")
    assert work_stats.weekly_delta(sentinel, hour, at("2026-10-26T10:55")) is None, "a reset in the hour"
    sentinel.write_text(sample("2026-10-26T09:00:00+00:00", 90), encoding="utf-8")
    assert work_stats.weekly_delta(sentinel, hour, at("2026-10-26T10:55")) is None, "no sample inside the hour"


# ── when a change of hours takes effect (contract §6) ──────────────────────────────────────────────

def test_a_change_of_hours_takes_effect_at_the_next_check_without_a_restart(home):
    put_config(home, DAY)
    noon = at("2026-10-26T12:00")
    assert working_hours.is_within_working_hours(noon) is True
    put_config(home, {"team": {"working_hours": {"timezone": "UTC", "windows": [
        {"days": ["mon"], "start": "20:00", "end": "22:00"}]}}})
    assert working_hours.is_within_working_hours(noon) is False, "the file is read again at every call: no cache, no restart"


# ── the state of the schedule file (contract §7; in 0.4 the gate itself is unchanged) ──────────────

UNREADABLE = {
    "empty file": "",
    "broken JSON": "{not json",
    "a list": "[1,2]",
    "team is not an object": '{"team": 3}',
    "working_hours is a list": '{"team": {"working_hours": []}}',
    "windows is not a list": '{"team": {"working_hours": {"windows": 5}}}',
    "hour 25:00": '{"team": {"working_hours": {"windows": [{"days": ["mon"], "start": "25:00", "end": "08:00"}]}}}',
    "minute 99": '{"team": {"working_hours": {"windows": [{"days": ["mon"], "start": "09:99", "end": "18:00"}]}}}',
    "day xyz": '{"team": {"working_hours": {"windows": [{"days": ["xyz"], "start": "09:00", "end": "18:00"}]}}}',
    "no days": '{"team": {"working_hours": {"windows": [{"days": [], "start": "09:00", "end": "18:00"}]}}}',
    "unknown zone": '{"team": {"working_hours": {"timezone": "Mars/Phobos", "windows": [{"days": ["mon"], "start": "09:00", "end": "18:00"}]}}}',
    "window not an object": '{"team": {"working_hours": {"windows": ["09:00-18:00"]}}}',
}


@pytest.mark.parametrize("content", UNREADABLE.values(), ids=list(UNREADABLE))
def test_a_declared_but_unreadable_schedule_is_reported_as_unreadable(home, content):
    (home / "jht.config.json").write_text(content, encoding="utf-8")
    assert working_hours.schedule_status() == "unreadable"


def test_a_file_nobody_can_read_is_unreadable(home):
    path = home / "jht.config.json"
    path.write_text(json.dumps(DAY), encoding="utf-8")
    path.chmod(0)
    try:
        if os.access(path, os.R_OK):
            pytest.skip("running as a user who can read anything")
        assert working_hours.schedule_status() == "unreadable"
    finally:
        path.chmod(0o600)


def test_no_declared_schedule_is_undeclared_and_a_good_one_is_valid(home):
    assert working_hours.schedule_status() == "undeclared", "no file"
    for content in ('{}', '{"team": {}}', '{"team": {"working_hours": {"windows": []}}}'):
        (home / "jht.config.json").write_text(content, encoding="utf-8")
        assert working_hours.schedule_status() == "undeclared"
    put_config(home, NIGHT)
    assert working_hours.schedule_status() == "valid"
    put_config(home, DAY)
    assert working_hours.schedule_status() == "valid"


def test_in_this_release_an_unreadable_file_still_means_the_team_works_and_the_registry_says_so(home):
    (home / "jht.config.json").write_text("{not json", encoding="utf-8")
    assert working_hours.is_within_working_hours(at("2026-10-26T03:00")) is True, "the gate is unchanged in 0.4"
    lines: list[str] = []
    work_stats.record(now=at("2026-10-26T03:30"), log=lines.append)
    work_stats.record(now=at("2026-10-26T03:40"), log=lines.append)
    assert lines.count("[work_stats] schedule_unreadable state=always_on_fallback") == 1, "once while the state lasts"
    assert all("not json" not in line and "jht.config" not in line for line in lines)
    assert work_stats.read(home=home)["scheduleState"] == "unreadable"


def test_the_container_mounts_the_home_writable_so_the_hours_are_a_convenience_not_a_control():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "${HOME}/.jht:/jht_home" in compose and "${HOME}/.jht:/jht_home:ro" not in compose
    assert "jht.config.json" not in compose, "if the file is ever protected, the contract (§7) changes"


# ── the command line ───────────────────────────────────────────────────────────────────────────────

def test_the_command_line_reads_and_clears(home, capsys):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z")])
    assert work_stats.main(["read", "--nights", "5"]) == 0
    assert json.loads(capsys.readouterr().out)["nights"][0]["date"] == "2026-10-26"
    assert work_stats.main(["clear"]) == 0
    assert json.loads(capsys.readouterr().out) == {"cleared": True}
    assert work_stats.main(["read"]) == 0
    assert json.loads(capsys.readouterr().out)["nights"] == []


def test_an_unreadable_database_is_a_closed_code(home, capsys):
    put_config(home, DAY)
    put_rows(home, [row("2026-10-26T10:00:00Z")])
    (home / "jobs.db").write_text("this is not a database", encoding="utf-8")
    assert work_stats.main(["read"]) == 1
    assert json.loads(capsys.readouterr().out) == {"error": "stats_unreadable"}


def test_the_sentinel_bridge_records_after_each_reading_and_never_stops_on_a_failure():
    source = (ROOT / ".launcher" / "sentinel-bridge.py").read_text(encoding="utf-8")
    assert source.index("_write_role_usage(entry, time.time())\n            _record_work_stats()") > 0
    body = source[source.index("def _record_work_stats"):source.index("def _atomic_write_json")]
    assert "except Exception" in body and "work_stats.py" in body
    assert "sentinel_path=DATA_JSONL" in body


def test_a_link_in_place_of_the_archive_is_not_read_and_a_second_name_neither(home, tmp_path):
    put_config(home, DAY)
    outside = tmp_path / "elsewhere.jsonl"
    outside.write_text(json.dumps(row("2026-10-25T10:00:00Z")) + "\n", encoding="utf-8")
    directory = home / "stats"
    directory.mkdir()
    (directory / "work-hours.jsonl").symlink_to(outside)
    assert work_stats.load_rows() == ([], True), "a link is not our archive"
    (directory / "work-hours.jsonl").unlink()
    os.link(outside, directory / "work-hours.jsonl")
    assert work_stats.load_rows() == ([], True), "a file with two names is not ours"
    (directory / "work-hours.jsonl").unlink()
    (directory / "work-hours.jsonl").mkdir()
    assert work_stats.load_rows() == ([], True), "a directory is not a file"


def test_a_file_that_grows_past_the_cap_after_the_check_is_still_bounded(home, monkeypatch):
    directory = home / "stats"
    directory.mkdir()
    (directory / "work-hours.jsonl").write_text(json.dumps(row("2026-10-25T10:00:00Z")) + "\n", encoding="utf-8")
    monkeypatch.setattr(work_stats, "MAX_FILE_BYTES", 10)
    assert work_stats.load_rows() == ([], True)


# ── a pipe where a file should be must not stall the sentinel ──────────────────────────────────────

def _within(seconds, call):
    """Run `call` in a thread; fail if it does not come back in time (the open of a pipe would not)."""
    import threading
    box = {}

    def target():
        try:
            box["value"] = call()
        except BaseException as error:      # noqa: BLE001
            box["error"] = error

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    assert not thread.is_alive(), "the call is stuck on a named pipe"
    if "error" in box:
        raise box["error"]
    return box["value"]


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="no named pipes here")
def test_a_named_pipe_in_place_of_the_archive_comes_back_at_once_with_no_rows(home):
    directory = home / "stats"
    directory.mkdir()
    os.mkfifo(directory / "work-hours.jsonl")
    assert _within(5, work_stats.load_rows) == ([], True)
    lines: list[str] = []
    put_config(home, DAY)
    row_written = _within(5, lambda: work_stats.record(now=at("2026-10-26T10:30"), log=lines.append))
    assert row_written["hour"] == "2026-10-26T10:00:00Z"
    assert "[work_stats] work_stats_reset" in lines


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="no named pipes here")
def test_a_named_pipe_in_place_of_the_sentinel_data_or_the_config_comes_back_at_once(home, tmp_path):
    pipe = tmp_path / "sentinel-data.jsonl"
    os.mkfifo(pipe)
    assert _within(5, lambda: work_stats.weekly_delta(pipe, at("2026-10-26T10:00"), at("2026-10-26T10:55"))) is None
    os.mkfifo(home / "jht.config.json")
    assert _within(5, working_hours.schedule_status) == "unreadable"


def test_the_pipe_check_is_what_keeps_the_open_from_waiting():
    """Counter-check by reading the source: the flags of the open carry O_NONBLOCK in both readers."""
    for name in ("work_stats.py", "working_hours.py"):
        text = (SKILLS / name).read_text(encoding="utf-8")
        assert "O_NONBLOCK" in text and "O_NOFOLLOW" in text, name


# ── the two copies of the row check must agree ─────────────────────────────────────────────────────

def test_the_backup_check_and_the_reader_check_give_the_same_verdict_on_the_same_rows():
    import re
    rust = (ROOT / "desktop" / "src-tauri" / "src" / "team_backup.rs").read_text(encoding="utf-8")
    start = rust.index("STATS_HOUR=re.compile")
    end = rust.index("def stats_clean")
    namespace = {"re": re, "time": __import__("time")}
    exec(rust[start:end], namespace)        # the script's own text, not a copy of it
    good = row("2026-10-26T10:00:00Z", delta=3)
    cases = [good, row("2026-10-26T10:00:00Z", delta=None), {**good, "extra": 1}, {k: v for k, v in good.items() if k != "hour"},
             row("2026-10-26T10:00:00Z", minutes=61), row("2026-10-26T10:00:00Z", minutes=-1), row("2026-10-26T10:00:00Z", minutes=True),
             row("2026-10-26T10:00:00Z", minutes=1.0), row("2026-10-26T10:00:00Z", threshold=101), row("2026-10-26T10:00:00Z", delta=101),
             row("2026-10-26T10:00:00Z", delta=1.5), row("2026-10-26T10:30:00Z"), row("2026-13-45T10:00:00Z"), row("2026-10-26T24:00:00Z"),
             row("2026-02-30T10:00:00Z"), row(5), [1], "text", None, row("2026-10-26T10:00:00Z", minutes=10 ** 30)]
    for case in cases:
        assert bool(namespace["stats_ok"](case)) == (work_stats.valid_row(case) is not None), case
