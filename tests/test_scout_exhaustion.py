"""«Exhausted» is a measure, and the quiet after it is a short, growing ladder.

Before: a Scout wrote [SCOUT-ESAUSTO] after ONE bounded pass of a few minutes on one or two sources, the Captain took the
sentence for good and kept the team quiet for hours (a live team, night of 31/10: three Scouts, zero positions, the budget
intact). Now `scout_exhaustion.py` decides from the pass log: enough DIFFERENT sources, enough DIFFERENT queries, enough
minutes of searching and not one position inserted; the quiet is 30 min, 1 h, 2 h, 4 h at most, restarts at each working
window, and the heartbeat re-orders a Scout when it ends.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import types
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import scout_exhaustion as se  # noqa: E402

NOW = 1_800_000_000.0   # a fixed instant: no test depends on the clock


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    for name in ("JHT_SCOUT_EXHAUST_MIN_SOURCES", "JHT_SCOUT_EXHAUST_MIN_QUERIES", "JHT_SCOUT_EXHAUST_MIN_SPAN_MIN",
                 "JHT_SCOUT_QUIESCENCE_LADDER_MIN"):
        monkeypatch.delenv(name, raising=False)
    # No working hours configured: the window is the last 12 hours, whatever the clock of the machine.
    monkeypatch.setattr(se, "window_start", lambda now: None)
    # The coverage plan has its own tests (test_scout_coverage.py): here it covers everything unless a test says otherwise.
    use_coverage(monkeypatch, [])
    return tmp_path


def use_coverage(monkeypatch, missing, *, fail=False):
    """A scout_coverage that answers `missing` for the core portals (or raises), whatever is on disk."""
    fake = types.ModuleType("scout_coverage")
    def portal_states(rows, profile=None, now=None):
        if fail:
            raise RuntimeError("profile unreadable")
        fake.seen_rows = list(rows)
        return ["states"]
    fake.portal_states = portal_states
    fake.core_missing = lambda states: list(missing)
    fake.plan_missing = lambda states: list(missing)
    monkeypatch.setitem(sys.modules, "scout_coverage", fake)
    return fake


def write_log(home: Path, rows: list) -> None:
    path = home / "logs"
    path.mkdir(parents=True, exist_ok=True)
    (path / "scout-passes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def passes(count: int, *, sources: int, start: float = NOW - 3600, minutes: float = 30.0, agent="scout-1") -> list:
    """`count` passes over `sources` different source+country pairs with `count` different queries, spread over `minutes`."""
    rows = []
    for i in range(count):
        rows.append({"v": 1, "kind": "pass", "ts": start + (minutes * 60) * i / max(1, count - 1), "agent": agent,
                     "source": "src%d" % (i % sources), "country": "nl", "returned": 20, "query_kind": "role",
                     "query_hash": "h%08d" % i})
    return rows


def test_one_bounded_pass_is_not_exhaustion(isolated_home):
    """The case of the night of 31/10: one pass of a few minutes on one source."""
    write_log(isolated_home, passes(1, sources=1))
    result = se.check(NOW)
    assert result["verdict"] == "not_exhausted"
    assert any(m.startswith("sources 1/5") for m in result["missing"])
    assert any(m.startswith("queries 1/10") for m in result["missing"])
    assert any(m.startswith("search time 0/15") for m in result["missing"])


def test_enough_different_sources_queries_and_time_with_nothing_inserted_is_exhaustion(isolated_home):
    write_log(isolated_home, passes(12, sources=6))
    result = se.check(NOW)
    assert result["verdict"] == "exhausted" and result["missing"] == []
    assert (result["sources"], result["queries"], result["inserted"]) == (6, 12, 0)


@pytest.mark.parametrize("sources,count,minutes,short", [
    (4, 12, 30.0, "sources 4/5"),       # many queries, few different sources
    (6, 9, 30.0, "queries 9/10"),       # many sources, too few queries
    (6, 12, 5.0, "search time 5/15"),   # the right breadth, searched too fast to mean it
])
def test_each_of_the_three_minimums_is_needed(isolated_home, sources, count, minutes, short):
    write_log(isolated_home, passes(count, sources=sources, minutes=minutes))
    result = se.check(NOW)
    assert result["verdict"] == "not_exhausted"
    assert any(m.startswith(short) for m in result["missing"]), result["missing"]


def test_the_same_query_repeated_counts_once(isolated_home):
    rows = passes(12, sources=6)
    for row in rows:
        row["query_hash"] = "same"
    write_log(isolated_home, rows)
    assert se.check(NOW)["queries"] == 1


def test_a_position_inserted_means_the_sources_still_give(isolated_home):
    rows = passes(12, sources=6) + [{"v": 1, "kind": "candidate", "ts": NOW - 600, "agent": "scout-1", "source": "src1",
                                     "country": "nl", "outcome": "inserted", "opened": True}]
    write_log(isolated_home, rows)
    result = se.check(NOW)
    assert result["verdict"] == "not_exhausted"
    assert any("inserted" in m for m in result["missing"])


def test_without_a_log_the_sources_are_unmeasured_never_exhausted(isolated_home):
    assert se.check(NOW)["verdict"] == "unmeasured"
    code, result = se.declare(NOW)
    assert code == 3 and result["verdict"] == "unmeasured"
    assert se.status(NOW)["quiet"] is False


def test_lines_outside_the_window_and_lines_that_are_not_ours_do_not_count(isolated_home):
    old = passes(12, sources=6, start=NOW - 30 * 3600)
    (isolated_home / "logs").mkdir(parents=True)
    (isolated_home / "logs" / "scout-passes.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in old) + "not json\n" + json.dumps({"kind": "other", "ts": NOW - 5}) + "\n",
        encoding="utf-8")
    assert se.check(NOW)["verdict"] == "unmeasured"


def test_the_quiet_is_a_ladder_30_60_120_240_and_stops_there(isolated_home, monkeypatch):
    monkeypatch.setattr(se, "DEFAULT_LOOKBACK_H", 100.0)   # the ladder outlives the 12 h of a machine with no working hours
    write_log(isolated_home, passes(12, sources=6))
    steps = []
    now = NOW
    for round_ in range(6):
        code, result = se.declare(now)
        assert code == 0, result
        steps.append(result["quiet_min"])
        # the Scout is woken, runs ONE new pass that finds nothing, and declares again
        now += result["quiet_min"] * 60 + 30
        rows = [json.loads(line) for line in (isolated_home / "logs" / "scout-passes.jsonl").read_text().splitlines()]
        rows.append({"v": 1, "kind": "pass", "ts": now - 10, "agent": "scout-1", "source": "src0", "country": "nl",
                     "returned": 0, "query_kind": "role", "query_hash": "probe%d" % round_})
        write_log(isolated_home, rows)
    assert steps == [30, 60, 120, 240, 240, 240]


def test_a_second_exhaustion_without_a_new_search_is_refused(isolated_home):
    """The quiet is not skipped by repeating the sentence: after an accepted exhaustion at least one new pass is needed."""
    write_log(isolated_home, passes(12, sources=6))
    assert se.declare(NOW)[0] == 0
    code, result = se.declare(NOW + 31 * 60)
    assert code == 3 and any("no new search" in m for m in result["missing"])


def test_a_position_found_after_the_wake_restarts_the_ladder(isolated_home):
    write_log(isolated_home, passes(12, sources=6))
    se.declare(NOW)
    code, second = se.declare(NOW + 1)   # refused: no new search; the ladder stays at 1
    assert code == 3
    later = NOW + 40 * 60
    rows = [json.loads(line) for line in (isolated_home / "logs" / "scout-passes.jsonl").read_text().splitlines()]
    rows += [{"v": 1, "kind": "pass", "ts": later - 60, "agent": "scout-1", "source": "src0", "country": "nl",
              "returned": 3, "query_kind": "role", "query_hash": "new"},
             {"v": 1, "kind": "candidate", "ts": later - 30, "agent": "scout-1", "source": "src0", "country": "nl",
              "outcome": "inserted", "opened": True}]
    write_log(isolated_home, rows)
    assert se.declare(later)[0] == 3, "a position was inserted: the sources are not dry"


def test_status_is_quiet_until_the_step_ends_and_then_not(isolated_home):
    write_log(isolated_home, passes(12, sources=6))
    se.declare(NOW)
    assert se.status(NOW + 10 * 60) == {**se.status(NOW + 10 * 60), "quiet": True, "minutes_left": 20, "consecutive": 1}
    assert se.status(NOW + 31 * 60)["quiet"] is False


def test_reset_ends_the_quiet_at_once(isolated_home):
    write_log(isolated_home, passes(12, sources=6))
    se.declare(NOW)
    se.reset()
    assert se.status(NOW + 60)["quiet"] is False


def test_a_new_working_window_starts_the_ladder_again(isolated_home, monkeypatch):
    write_log(isolated_home, passes(12, sources=6))
    monkeypatch.setattr(se, "window_start", lambda now: NOW - 7200)
    assert se.declare(NOW)[1]["quiet_min"] == 30
    # the next night: another window start, and the same log is now older than that window → measure again from there
    nxt = NOW + 24 * 3600
    monkeypatch.setattr(se, "window_start", lambda now: nxt - 7200)
    write_log(isolated_home, passes(12, sources=6, start=nxt - 3600))
    code, result = se.declare(nxt)
    assert code == 0 and result["consecutive"] == 1 and result["quiet_min"] == 30


def test_thresholds_and_ladder_can_be_set_from_the_environment(isolated_home, monkeypatch):
    monkeypatch.setenv("JHT_SCOUT_EXHAUST_MIN_SOURCES", "2")
    monkeypatch.setenv("JHT_SCOUT_EXHAUST_MIN_QUERIES", "3")
    monkeypatch.setenv("JHT_SCOUT_EXHAUST_MIN_SPAN_MIN", "1")
    monkeypatch.setenv("JHT_SCOUT_QUIESCENCE_LADDER_MIN", "5,10")
    write_log(isolated_home, passes(4, sources=2, minutes=5.0))
    assert se.declare(NOW)[1]["quiet_min"] == 5


def test_the_cli_speaks_json_and_exits_with_the_verdict(isolated_home):
    write_log(isolated_home, passes(12, sources=6, start=time.time() - 3600))
    env = {**os.environ, "JHT_HOME": str(isolated_home)}
    run = lambda *a: subprocess.run([sys.executable, "-I", str(SKILLS / "scout_exhaustion.py"), *a],
                                    capture_output=True, text=True, env=env, timeout=60)
    checked = run("check")
    assert checked.returncode == 0 and json.loads(checked.stdout)["verdict"] == "exhausted"
    declared = run("declare")
    assert declared.returncode == 0 and json.loads(declared.stdout)["quiet_min"] == 30
    assert run("status").returncode == 0
    assert run("reset", "--reason", "user").returncode == 0
    assert run("status").returncode == 1


# ── the heartbeat: the quiet is the state's, not twelve fixed hours ────────────────────────────────────────────────

def load_heartbeat(home: Path):
    import importlib.util
    os.environ["JHT_HOME"] = str(home)
    spec = importlib.util.spec_from_file_location("heartbeat_quiet_under_test", ROOT / ".launcher" / "heartbeat-bridge.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def message(minutes_ago: float, now) -> dict:
    return {"ts": (now - __import__("datetime").timedelta(minutes=minutes_ago)).isoformat(),
            "body": "[SCOUT-ESAUSTO] sources dry"}


def test_the_heartbeat_is_quiet_until_the_accepted_step_ends(isolated_home):
    from datetime import datetime, timezone
    hb = load_heartbeat(isolated_home)
    now = datetime.now(timezone.utc)
    (isolated_home / "state").mkdir()
    state = isolated_home / "state" / "scout-quiescence.json"
    state.write_text(json.dumps({"next_wake_at": now.timestamp() + 600}), encoding="utf-8")
    assert hb._scout_exhausted_recently(now) is True
    state.write_text(json.dumps({"next_wake_at": now.timestamp() - 1}), encoding="utf-8")
    # a fresh sentence of a Scout does not keep the order away once the accepted step is over: the state decides
    (isolated_home / "logs").mkdir(exist_ok=True)
    (isolated_home / "logs" / "messages.jsonl").write_text(json.dumps(message(1, now)) + "\n", encoding="utf-8")
    assert hb._scout_exhausted_recently(now) is False


@pytest.mark.parametrize("raw", ["Infinity", "1e300", "9999999999999", "1e18"])
def test_a_huge_or_infinite_wake_time_silences_the_heartbeat_for_four_hours_at_most(isolated_home, raw):
    from datetime import datetime, timedelta, timezone
    hb = load_heartbeat(isolated_home)
    now = datetime.now(timezone.utc)
    (isolated_home / "state").mkdir()
    (isolated_home / "state" / "scout-quiescence.json").write_text('{"next_wake_at": %s}' % raw, encoding="utf-8")
    assert hb._scout_exhausted_recently(now) is True, "inside the ladder's last step the quiet holds"
    assert hb._scout_exhausted_recently(now + timedelta(hours=4, minutes=30)) is False, "past the cap the order can go"


@pytest.mark.parametrize("raw", ['"never"', "true", "null", "NaN", "[1]"])
def test_a_wake_time_that_is_not_a_number_is_not_a_state(isolated_home, raw):
    from datetime import datetime, timezone
    hb = load_heartbeat(isolated_home)
    now = datetime.now(timezone.utc)
    (isolated_home / "state").mkdir()
    (isolated_home / "state" / "scout-quiescence.json").write_text('{"next_wake_at": %s}' % raw, encoding="utf-8")
    # no log either: nothing known, so the order can go
    assert hb._scout_exhausted_recently(now) is False
    # with a fresh sentence of a Scout the old signal decides, as when there is no state
    (isolated_home / "logs").mkdir(exist_ok=True)
    (isolated_home / "logs" / "messages.jsonl").write_text(json.dumps(message(1, now)) + "\n", encoding="utf-8")
    assert hb._scout_exhausted_recently(now) is True


def test_without_a_state_a_scouts_sentence_silences_the_heartbeat_for_thirty_minutes_not_hours(isolated_home):
    from datetime import datetime, timezone
    hb = load_heartbeat(isolated_home)
    now = datetime.now(timezone.utc)
    (isolated_home / "logs").mkdir(exist_ok=True)
    log = isolated_home / "logs" / "messages.jsonl"
    log.write_text(json.dumps(message(10, now)) + "\n", encoding="utf-8")
    assert hb._scout_exhausted_recently(now) is True
    log.write_text(json.dumps(message(120, now)) + "\n", encoding="utf-8")
    assert hb._scout_exhausted_recently(now) is False, "two hours later the order must be able to go"


def test_the_heartbeat_order_no_longer_talks_about_markers_of_the_day():
    source = (ROOT / ".launcher" / "heartbeat-bridge.py").read_text(encoding="utf-8")
    assert "no [SCOUT-ESAUSTO] marker exists today" not in source
    assert 'os.environ.get("JHT_HEARTBEAT_SCOUT_EXHAUST_LOOKBACK_H", "12")' not in source


# ---- the core portals of the coverage plan stand on top of the three numbers ----

def test_dry_by_the_numbers_but_a_core_portal_not_covered_is_not_exhaustion(isolated_home, monkeypatch):
    """Five LinkedIn pages are 5 sources worth of numbers and none of the national portals: the plan says where to go."""
    use_coverage(monkeypatch, ["platsbanken/se 1/3", "blocket-jobb/se 0/3"])
    write_log(isolated_home, passes(12, sources=6))
    result = se.check(NOW)
    assert result["verdict"] == "not_exhausted"
    assert (result["sources"], result["queries"]) == (6, 12)          # the three numbers alone would have said yes
    assert result["uncovered"] == ["platsbanken/se 1/3", "blocket-jobb/se 0/3"]
    assert any("platsbanken/se 1/3" in m and "scout_coverage.py next" in m for m in result["missing"])


def test_all_core_portals_covered_and_the_numbers_reached_is_exhaustion(isolated_home):
    write_log(isolated_home, passes(12, sources=6))
    result = se.check(NOW)
    assert result["verdict"] == "exhausted" and result["core_missing"] == []


def test_the_coverage_clause_gets_the_rows_of_the_window(isolated_home, monkeypatch):
    fake = use_coverage(monkeypatch, [])
    write_log(isolated_home, passes(12, sources=6) + [{"v": 1, "kind": "pass", "ts": NOW - 40 * 3600, "source": "old",
                                                        "country": "se", "returned": 1, "query_hash": "hold"}])
    se.check(NOW)
    assert len(fake.seen_rows) == 12 and all(r["source"] != "old" for r in fake.seen_rows)


def test_a_coverage_that_cannot_be_computed_never_blocks_exhaustion(isolated_home, monkeypatch):
    """An unreadable profile, a language the table lacks, a bug: the three numbers decide, no impossible exhaustion."""
    use_coverage(monkeypatch, ["platsbanken/se 0/3"], fail=True)
    write_log(isolated_home, passes(12, sources=6))
    result = se.check(NOW)
    assert result["verdict"] == "exhausted" and result["core_missing"] == []


def test_a_coverage_answer_that_is_not_a_list_of_lines_is_ignored(isolated_home, monkeypatch):
    fake = use_coverage(monkeypatch, [])
    fake.core_missing = lambda states: "everything"
    fake.plan_missing = lambda states: "everything"
    write_log(isolated_home, passes(12, sources=6))
    assert se.check(NOW)["verdict"] == "exhausted"


def test_without_the_coverage_module_the_numbers_stand_alone(isolated_home, monkeypatch):
    monkeypatch.setitem(sys.modules, "scout_coverage", None)            # import raises ImportError
    write_log(isolated_home, passes(12, sources=6))
    assert se.check(NOW)["verdict"] == "exhausted"


def test_declare_refuses_while_a_core_portal_is_missing_and_names_it(isolated_home, monkeypatch):
    use_coverage(monkeypatch, ["platsbanken/se 2/3"])
    write_log(isolated_home, passes(12, sources=6))
    code, result = se.declare(NOW)
    assert code == 3 and "platsbanken/se 2/3" in " ".join(result["missing"])
    assert se.status(NOW)["quiet"] is False                              # nothing was written


def test_the_coverage_clause_does_not_change_unmeasured(isolated_home, monkeypatch):
    use_coverage(monkeypatch, ["platsbanken/se 0/3"])
    result = se.check(NOW)
    assert result["verdict"] == "unmeasured" and result["core_missing"] == []
