"""JHT-T187: the night is measured in positions at the bar (70), not in positions found.

scout_yield.py over a made-up database (the two tables it reads, with made-up rows), and the exhaustion tool that uses it:
an insert that scored under the bar is not «the sources still give»; one at the bar, or not scored yet, is.
"""
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime, timezone
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


sy = _load("scout_yield_test", SKILLS / "scout_yield.py")
ex = _load("scout_exhaustion_yield_test", SKILLS / "scout_exhaustion.py")

NOW = 1_800_000_000.0
HOUR = 3600.0


def stamp(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    for name in ("JHT_SCOUT_GOOD_SCORE", "JHT_SCOUT_COVER_PASSES", "JHT_SCOUT_COVER_QUERIES"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(ex, "window_start", lambda now: None)
    monkeypatch.setattr(sy, "window_start", lambda now: now - 12 * HOUR)
    return tmp_path


def make_db(home, rows):
    """rows: (found_by, hours_ago, score or None, status)"""
    con = sqlite3.connect(home / "jobs.db")
    con.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, found_by TEXT, found_at TIMESTAMP, status TEXT)")
    con.execute("CREATE TABLE scores (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE, total_score INTEGER)")
    for i, (by, ago, score, status) in enumerate(rows, 1):
        con.execute("INSERT INTO positions VALUES (?,?,?,?)", (i, by, stamp(NOW - ago * HOUR), status))
        if score is not None:
            con.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)", (i, score))
    con.commit()
    con.close()


def test_good_pending_and_below_are_told_apart(home):
    make_db(home, [("scout-1", 1, 82, "scored"), ("scout-2", 2, 70, "scored"), ("scout-1", 2, 55, "scored"),
                   ("scout-1", 1, None, "new"), ("scout-1", 1, None, "excluded")])
    out = sy.read(NOW - 12 * HOUR)
    assert (out["good"], out["pending"], out["below"], out["found"]) == (2, 1, 1, 4)    # 70 is AT the bar; excluded without score is out


def test_only_scouts_and_only_the_window_count(home):
    make_db(home, [("scout-1", 1, 90, "scored"), ("analista", 1, 90, "scored"), ("scout-1", 20, 90, "scored")])
    assert sy.read(NOW - 12 * HOUR)["good"] == 1


def test_the_bar_can_be_set_and_a_nonsense_value_is_70(home, monkeypatch):
    make_db(home, [("scout-1", 1, 75, "scored")])
    monkeypatch.setenv("JHT_SCOUT_GOOD_SCORE", "80")
    assert sy.read(NOW - HOUR * 12) ["good"] == 0
    for raw in ("0", "101", "high", ""):
        monkeypatch.setenv("JHT_SCOUT_GOOD_SCORE", raw)
        assert sy.bar() == 70


def test_an_unreadable_database_is_none_never_zero(home):
    assert sy.read(NOW - HOUR) is None                                     # no file
    (home / "jobs.db").write_text("not a database", encoding="utf-8")
    assert sy.read(NOW - HOUR) is None


def test_the_database_is_opened_read_only(home):
    make_db(home, [("scout-1", 1, 80, "scored")])
    before = (home / "jobs.db").read_bytes()
    sy.read(NOW - 12 * HOUR)
    assert (home / "jobs.db").read_bytes() == before


def test_the_output_has_numbers_only(home, capsys, monkeypatch):
    make_db(home, [("scout-1", 1, 90, "scored")])
    monkeypatch.setattr(sy.time, "time", lambda: NOW)
    assert sy.main(["--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["ok"] is True and out["good"] == 1 and set(out) == {"ok", "good", "pending", "below", "found", "min_score", "since"}
    (home / "jobs.db").unlink()
    assert sy.main(["--json"]) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "database_unreadable"}


# ── the exhaustion tool reads it ────────────────────────────────────────────────────────────────────────────────────────────
def passes(inserted):
    rows = []
    for i in range(12):
        rows.append({"v": 1, "kind": "pass", "ts": NOW - 3600 + 1800 * i / 11, "agent": "scout-1", "source": "src%d" % (i % 6),
                     "country": "nl", "returned": 20, "query_kind": "role", "query_hash": "h%08d" % i})
    if inserted:
        rows.append({"v": 1, "kind": "candidate", "ts": NOW - 1800, "agent": "scout-1", "source": "src0", "country": "nl",
                     "outcome": "inserted", "opened": True})
    (Path(ex.log_path())).parent.mkdir(parents=True, exist_ok=True)
    Path(ex.log_path()).write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def test_an_insert_that_scored_under_the_bar_is_not_the_sources_still_giving(home):
    passes(inserted=True)
    make_db(home, [("scout-1", 0.5, 41, "scored")])
    result = ex.check(NOW)
    assert result["verdict"] == "exhausted", result["missing"]
    assert (result["good"], result["below"], result["still_give"]) == (0, 1, 0)


def test_an_insert_at_the_bar_or_not_scored_yet_is_the_sources_still_giving(home):
    passes(inserted=True)
    make_db(home, [("scout-1", 0.5, 78, "scored")])
    result = ex.check(NOW)
    assert result["verdict"] == "not_exhausted" and any("score 70 or are not scored yet" in m for m in result["missing"])
    make_db_again = home / "jobs.db"
    make_db_again.unlink()
    make_db(home, [("scout-1", 0.5, None, "new")])
    assert ex.check(NOW)["verdict"] == "not_exhausted"


def test_without_a_readable_database_every_insert_still_counts(home):
    passes(inserted=True)
    result = ex.check(NOW)
    assert result["verdict"] == "not_exhausted" and "still_give" not in result
