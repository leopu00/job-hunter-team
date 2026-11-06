"""JHT-T187: «saturated market» only at full coverage; a blocked source is not an empty one.

Real scout_coverage.py and scout_exhaustion.py over a made-up profile (Swedish and English) and made-up pass lines. What is held here:

  - a Scout dry on a source while other portals of the plan are not covered is NOT exhaustion: the Captain sends it to the next
    portal, it does not put it to rest;
  - every portal of the plan (core and minor, every country) covered, closed or read by email, in the last 24 hours, and the
    numbers reached: «saturated» is allowed;
  - a source that answers with an error (429, 5xx, timeout) is `blocked`: neither covered, nor closed, nor dry; it rests for a few
    hours and is asked again, `next` goes on to another portal, exhaustion is refused while it rests, and three blocked passes
    with no good one close it.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SKILLS = REPO / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cov = _load("scout_coverage_saturation_test", SKILLS / "scout_coverage.py")
ex = _load("scout_exhaustion_saturation_test", SKILLS / "scout_exhaustion.py")
plog = _load("scout_pass_log_saturation_test", SKILLS / "scout_pass_log.py")

NOW = 1_800_000_000.0
HOUR = 3600.0
PROFILE = "languages:\n  - language: Svenska\n    level: native\n  - language: English\n    level: C1\n"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    for name in ("JHT_SCOUT_COVER_PASSES", "JHT_SCOUT_COVER_QUERIES", "JHT_SCOUT_COVER_RECENT_H", "JHT_SCOUT_BLOCKED_PAUSE_H"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    monkeypatch.setattr(ex, "window_start", lambda now: None)
    monkeypatch.setattr(ex, "DEFAULT_LOOKBACK_H", 12.0)
    return tmp_path


def write(home, rows):
    path = home / "logs"
    path.mkdir(parents=True, exist_ok=True)
    (path / "scout-passes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def passline(entry, i, ts, kind, status=None, returned=4, agent="scout-1"):
    row = {"v": 1, "kind": "pass", "ts": ts, "agent": agent, "source": entry["slug"], "country": entry["country"],
           "returned": returned, "query_kind": kind, "query_hash": "%s%s%s%d" % (entry["slug"][:4], entry["country"], kind[:3], i)}
    if status:
        row["status"] = status
    return row


def cover(entry, start, step=60.0):
    """The three passes with three different questions that make a portal «covered» (one in its own language, one wide)."""
    kinds = ["broad", "role", "synonym"] if entry["portal_language"] == "en" else ["broad", "role_language", "role"]
    return [passline(entry, i, start + i * step, kind) for i, kind in enumerate(kinds)]


def plan():
    return cov.load_plan()


def searchable(entries):
    return [e for e in entries if e["access"] == "search"]


def everything_covered(start):
    rows = []
    clock = start
    for entry in searchable(plan()["entries"]):
        rows += cover(entry, clock)
        clock += 4 * 60.0
    return rows


def test_the_plan_of_the_made_up_profile_has_core_and_minor_portals_in_more_than_one_country():
    entries = plan()["entries"]
    assert {e["tier"] for e in entries} == {"core", "minor"}
    assert len({e["country"] for e in entries}) >= 3


# ── 1. dry on a source, others not covered: no quiet, the next portal ──────────────────────────────────────────────────────
def test_dry_on_one_source_with_other_portals_not_covered_is_not_saturation_and_names_where_to_go(home):
    first = searchable(plan()["entries"])[0]
    # numbers met by passes that all returned nothing, on the first sources of the plan only
    rows = []
    for i, entry in enumerate(searchable(plan()["entries"])[:6]):
        rows += cover(entry, NOW - 3 * HOUR + i * 600)
    rows = [dict(r, returned=0) for r in rows]
    write(home, rows)
    result = ex.check(NOW)
    assert result["verdict"] == "not_exhausted"
    assert (result["sources"], result["queries"]) >= (5, 10)                   # the three numbers alone would have said yes
    assert result["uncovered"], "the portals of the plan still to cover are named"
    assert not any(first["slug"] in line and first["country"] in line for line in result["uncovered"])
    code, refused = ex.declare(NOW)
    assert code == 3 and ex.status(NOW)["quiet"] is False                        # nothing is put to rest
    step = cov.next_step(plan(), ex.read_rows(NOW - 24 * HOUR), now=NOW)
    assert step["plan_done"] is False and (step["source"], step["country"]) not in {(e["slug"], e["country"]) for e in searchable(plan()["entries"])[:6]}


def test_minor_portals_and_other_countries_count_not_only_the_core_ones(home):
    entries = searchable(plan()["entries"])
    core = [e for e in entries if e["tier"] == "core"]
    rows = []
    for i, entry in enumerate(core):
        rows += cover(entry, NOW - 3 * HOUR + i * 300)
    write(home, rows)
    result = ex.check(NOW)
    assert result["core_missing"] == []                              # the old clause would have said «done»
    assert result["verdict"] == "not_exhausted" and result["uncovered"]
    assert any(e["slug"] in " ".join(result["uncovered"]) for e in entries if e["tier"] == "minor")


# ── 2. everything covered: saturated is allowed ───────────────────────────────────────────────────────────────────────────
def test_every_portal_covered_closed_or_by_email_and_the_numbers_reached_allows_saturation(home):
    write(home, everything_covered(NOW - 5 * HOUR))
    result = ex.check(NOW)
    assert result["verdict"] == "exhausted", result["missing"]
    assert result["uncovered"] == [] and result["core_missing"] == []
    code, accepted = ex.declare(NOW)
    assert code == 0 and accepted["accepted"] is True


def test_the_coverage_is_read_over_the_last_24_hours_not_only_the_window(home):
    rows = everything_covered(NOW - 5 * HOUR)
    old = [dict(r, ts=r["ts"] - 17 * HOUR) for r in everything_covered(NOW - 5 * HOUR)]   # about 22 h ago: still «recent»
    # the window (12 h) holds only the last pass of a few portals; the rest of the coverage is about 22 h old
    write(home, old + rows[:8])
    assert ex.check(NOW)["uncovered"] == [], "passes of 22 h ago still count as recent coverage"
    too_old = [dict(r, ts=r["ts"] - 30 * HOUR) for r in rows]
    write(home, too_old + rows[:8])
    assert ex.check(NOW)["uncovered"], "passes of 35 h ago do not"


# ── 3. a blocked source is not an empty one ───────────────────────────────────────────────────────────────────────────────
def test_a_blocked_pass_is_neither_covered_nor_closed_nor_dry(home):
    entry = searchable(plan()["entries"])[0]
    rows = [passline(entry, 0, NOW - 600, "broad", status="blocked", returned=0)]
    state = next(s for s in cov.portal_states(rows, now=NOW) if (s["source"], s["country"]) == (entry["slug"], entry["country"]))
    assert state["state"] == "blocked" and state["passes"] == 0 and state["blocks"] == 1
    assert state["retry_at"] == pytest.approx(NOW - 600 + 3 * HOUR)
    assert state["state"] not in cov.DONE_STATES
    missing = cov.plan_missing(cov.portal_states(rows, now=NOW))
    assert any("%s/%s blocked, retry at" % (entry["slug"], entry["country"]) in line for line in missing)


def test_next_goes_on_to_another_portal_and_lists_the_one_that_rests(home):
    entry = searchable(plan()["entries"])[0]
    rows = [passline(entry, 0, NOW - 600, "broad", status="blocked", returned=0)]
    step = cov.next_step(plan(), rows, now=NOW)
    assert (step["source"], step["country"]) != (entry["slug"], entry["country"])
    assert step["paused"] == [{"source": entry["slug"], "country": entry["country"], "retry_at": cov._iso(NOW - 600 + 3 * HOUR)}]


def test_the_portal_is_asked_again_when_the_pause_ends(home):
    entry = searchable(plan()["entries"])[0]
    rows = [passline(entry, 0, NOW - 4 * HOUR, "broad", status="blocked", returned=0)]
    state = next(s for s in cov.portal_states(rows, now=NOW) if (s["source"], s["country"]) == (entry["slug"], entry["country"]))
    assert state["state"] == "untouched" and state["retry_at"] is None


def test_a_good_pass_after_the_block_ends_the_rest(home):
    entry = searchable(plan()["entries"])[0]
    rows = [passline(entry, 0, NOW - 900, "broad", status="blocked", returned=0)] + [passline(entry, 1, NOW - 600, "broad")]
    state = next(s for s in cov.portal_states(rows, now=NOW) if (s["source"], s["country"]) == (entry["slug"], entry["country"]))
    assert state["state"] == "partial" and state["passes"] == 1


def test_three_blocked_passes_with_no_good_one_close_the_portal(home):
    entry = searchable(plan()["entries"])[0]
    rows = [passline(entry, i, NOW - (9 - i) * HOUR, "broad", status="blocked", returned=0) for i in range(3)]
    state = next(s for s in cov.portal_states(rows, now=NOW) if (s["source"], s["country"]) == (entry["slug"], entry["country"]))
    assert state["state"] == "closed"


def test_exhaustion_is_refused_while_a_source_rests_and_the_blocked_pass_is_not_a_search(home):
    rows = everything_covered(NOW - 5 * HOUR)
    victim = searchable(plan()["entries"])[0]
    rows = [r for r in rows if not (r["source"] == victim["slug"] and r["country"] == victim["country"])]
    rows.append(passline(victim, 0, NOW - 1800, "broad", status="blocked", returned=0))
    write(home, rows)
    result = ex.check(NOW)
    assert result["verdict"] == "not_exhausted"
    assert any("%s/%s blocked, retry at" % (victim["slug"], victim["country"]) in line for line in result["uncovered"])
    before = result["sources"]
    # the error does not enter the numbers: the sources are those of the good passes
    assert before == len({(r["source"], r["country"]) for r in rows if r.get("status") != "blocked"})
    # once the pause is over and a good round is done, saturation is allowed again
    later = rows + cover(victim, NOW - 600)
    write(home, later)
    assert ex.check(NOW)["verdict"] == "exhausted"


def test_the_pause_hours_can_be_set_and_a_nonsense_value_is_the_default(home, monkeypatch):
    monkeypatch.setenv("JHT_SCOUT_BLOCKED_PAUSE_H", "6")
    assert cov.pause_hours() == 6.0
    for raw in ("0", "-3", "999", "soon", ""):
        monkeypatch.setenv("JHT_SCOUT_BLOCKED_PAUSE_H", raw)
        assert cov.pause_hours() == cov.DEFAULT_PAUSE_H


def test_every_portal_resting_is_not_a_plan_done_and_not_a_dry_market(home):
    rows = []
    for entry in searchable(plan()["entries"]):
        rows.append(passline(entry, 0, NOW - 600, "broad", status="blocked", returned=0))
    step = cov.next_step(plan(), rows, now=NOW)
    assert step["plan_done"] is False and step["waiting"] is True and step["paused"] and step["retry_at"]


def test_the_pass_log_takes_the_blocked_status_and_a_nonsense_one_is_refused():
    assert "blocked" in plog.STATUSES
    args = plog.parser().parse_args(["pass", "--source", "indeed", "--country", "de", "--returned", "0", "--status", "blocked"])
    assert plog.build(args, NOW)["status"] == "blocked"
    with pytest.raises(SystemExit):
        plog.parser().parse_args(["pass", "--source", "indeed", "--returned", "0", "--status", "rate-limited"])
