"""In the first burst the split of circles and sources among the Scouts is decided by the plan, not negotiated by message.

Measured 11/11: five Scouts spent ~3.5 minutes of their first 6 exchanging messages to split what the plan already lists. Now
`scout_coord.py auto <scout>` takes the first lane nobody holds (one write under a lock) and prints it with the first search.
Synthetic profile and database only.

Run:
    pytest tests/test_scout_lanes.py -v
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
PROFILE = "languages:\n  - language: Italiano\n    level: native\n  - language: English\n    level: B2\npreferences:\n  work_mode: remote\n"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cov = _load("scout_coverage_lanes_test", SKILLS / "scout_coverage.py")


@pytest.fixture
def home(tmp_path, monkeypatch):
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    monkeypatch.delenv("JHT_SCOUT_LANES", raising=False)
    return tmp_path


def _env(home, lanes=None):
    env = {"PATH": "/usr/bin:/bin", "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db"), "PYTHONDONTWRITEBYTECODE": "1"}
    if lanes:
        env["JHT_SCOUT_LANES"] = str(lanes)
    return env


def _auto(home, scout, lanes=None):
    done = subprocess.run([sys.executable, str(SKILLS / "scout_coord.py"), "auto", scout], capture_output=True, text=True,
                          timeout=60, env=_env(home, lanes))
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


# ── the lanes: a function of the plan and the count ──────────────────────────────────────────────────────────────────
def test_lanes_split_the_plans_sources_with_none_in_two_lanes_and_none_of_the_closed_or_email_ones(home):
    plan = cov.load_plan()
    for count in (1, 2, 3, 5):
        out = cov.lanes(plan, count)
        assert [l["lane"] for l in out] == list(range(count))
        flat = [f for l in out for f in l["sources"]]
        assert len(flat) == len(set(flat)), count                        # no source in two lanes
        assert all(l["sources"] for l in out), count                      # every Scout has something to do
        closed = {e["slug"] for e in plan["entries"] if e["access"] != "search"}
        assert not closed & set(flat), count                             # nothing closed or read by email


def test_linkedin_has_one_holder_and_the_company_boards_go_to_the_last_lane_from_three_scouts(home):
    plan = cov.load_plan()
    one = cov.lanes(plan, 1)
    assert "linkedin" in one[0]["sources"] and set(cov.ATS_FAMILIES).isdisjoint(one[0]["sources"])
    two = cov.lanes(plan, 2)
    assert "linkedin" in two[0]["sources"] and "linkedin" not in two[1]["sources"] and set(cov.ATS_FAMILIES).isdisjoint(sum((l["sources"] for l in two), []))
    five = cov.lanes(plan, 5)
    assert "linkedin" in five[0]["sources"] and all("linkedin" not in l["sources"] for l in five[1:])
    assert set(cov.ATS_FAMILIES) <= set(five[-1]["sources"]) and all(set(cov.ATS_FAMILIES).isdisjoint(l["sources"]) for l in five[:-1])


def test_the_same_plan_and_count_give_the_same_lanes_whoever_asks(home):
    assert cov.lanes(cov.load_plan(), 4) == cov.lanes(cov.load_plan(), 4)


# ── auto: the first free lane, written once ──────────────────────────────────────────────────────────────────────────
def test_the_scouts_that_boot_one_after_the_other_take_lanes_0_1_2_and_each_gets_a_first_search(home):
    answers = [_auto(home, "scout-%d" % n, lanes=3) for n in (1, 2, 3)]
    assert [a["lane"] for a in answers] == [0, 1, 2] and all(a["of"] == 3 and a["negotiate"] is False for a in answers)
    flat = [f for a in answers for f in a["sources"]]
    assert len(flat) == len(set(flat))
    for a in answers:
        assert a["next"]["source"] in a["sources"] or a["next"].get("plan_done"), a      # the first search is in the Scout's own lane
        assert a["avoid"], "the dead sources the table knows are printed with the first search"
    assert "linkedin" in answers[0]["sources"]


def test_a_respawned_scout_keeps_its_lane_and_nothing_is_written_twice(home):
    first = _auto(home, "scout-1", lanes=2)
    _auto(home, "scout-2", lanes=2)
    again = _auto(home, "scout-1", lanes=2)
    assert again["lane"] == first["lane"] and again["sources"] == first["sources"]
    import sqlite3
    rows = sqlite3.connect(str(home / "jobs.db")).execute("SELECT scout FROM scout_coordination WHERE superseded_at IS NULL").fetchall()
    assert sorted(r[0] for r in rows) == ["scout-1", "scout-2"]


def test_scouts_that_boot_at_the_same_moment_never_take_the_same_lane(home):
    """The team database is made before the Scouts boot (jht setup / team start): the schema of a brand-new file is not made
    by five processes at once, here as in the product."""
    assert subprocess.run([sys.executable, str(SKILLS / "scout_coord.py"), "bootstrap"], capture_output=True, text=True, timeout=60,
                          env=_env(home)).returncode == 0
    procs = [subprocess.Popen([sys.executable, str(SKILLS / "scout_coord.py"), "auto", "scout-%d" % n], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=_env(home, 5)) for n in range(1, 6)]
    answers = []
    for p in procs:
        out, err = p.communicate(timeout=120)
        assert p.returncode == 0, err
        answers.append(json.loads(out.strip().splitlines()[-1]))
    assert sorted(a["lane"] for a in answers) == [0, 1, 2, 3, 4]


def test_more_scouts_than_lanes_share_the_lightest_one(home):
    lanes = [_auto(home, "scout-%d" % n, lanes=2)["lane"] for n in (1, 2, 3)]
    assert lanes[:2] == [0, 1] and lanes[2] in (0, 1)


def test_the_lane_of_a_scout_that_is_gone_is_free_again(home, monkeypatch):
    coord = _load("scout_coord_lanes_test", SKILLS / "scout_coord.py")
    monkeypatch.setenv("JHT_SCOUT_LANES", "2")
    monkeypatch.setattr(coord, "_live_scouts", lambda: {"scout-1", "scout-2"})
    coord.cmd_auto("scout-1")
    coord.cmd_auto("scout-2")
    monkeypatch.setattr(coord, "_live_scouts", lambda: {"scout-1", "scout-3"})     # scout-2 stopped, scout-3 is new
    coord.cmd_auto("scout-3")
    assert coord.lane_sources("scout-3") == cov.lanes(cov.load_plan(), 2)[1]["sources"]
    assert coord.lane_sources("scout-2") == [], "its row was superseded"


def test_the_count_comes_from_the_override_then_the_roster_then_who_is_alive(home, monkeypatch):
    coord = _load("scout_coord_count_test", SKILLS / "scout_coord.py")
    assert coord.planned_scouts({"scout-1", "scout-2"}) == 2 and coord.planned_scouts(None) == 1
    (home / "state").mkdir()
    (home / "state" / "first-run.json").write_text(json.dumps({"phase": "burst", "roster": {"scout": 5}}), encoding="utf-8")
    assert coord.planned_scouts({"scout-1"}) == 5
    monkeypatch.setenv("JHT_SCOUT_LANES", "3")
    assert coord.planned_scouts({"scout-1"}) == 3


def test_a_name_that_is_not_a_scout_writes_nothing(home):
    done = subprocess.run([sys.executable, str(SKILLS / "scout_coord.py"), "auto", "--help"], capture_output=True, text=True, timeout=60,
                          env=_env(home))
    assert done.returncode == 3 and not (home / "jobs.db").exists()


# ── next honours the lane ────────────────────────────────────────────────────────────────────────────────────────────
def test_next_for_a_scout_with_a_lane_names_a_portal_of_its_lane_first_and_the_rest_when_the_lane_is_done(home):
    _auto(home, "scout-1", lanes=3)
    second = _auto(home, "scout-2", lanes=3)
    out = subprocess.run([sys.executable, str(SKILLS / "scout_coverage.py"), "next", "--agent", "scout-2"], capture_output=True, text=True,
                         timeout=60, env=_env(home, 3))
    assert out.returncode == 0, out.stderr
    step = json.loads(out.stdout)
    assert step["source"] in second["sources"]
    plan = cov.load_plan()
    keys = frozenset(cov._lang.portal_slug(f) for f in second["sources"])
    done_rows = [{"kind": "pass", "ts": 1000.0 + i, "agent": "scout-2", "source": e["slug"], "country": e["country"], "returned": 0,
                  "query_kind": "broad", "status": "closed"} for i, e in enumerate(plan["entries"]) if keys & cov.entry_keys(e)]
    rest = cov.next_step(plan, done_rows, lane=keys)
    assert rest["source"] not in second["sources"], "the lane is done: the plan's other portals follow"
    nothing = cov.next_step(plan, [], lane=None)
    assert nothing["source"] == cov.next_step(plan, [])["source"]
