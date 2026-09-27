"""scripts/parity/jobsdb_parity.py: the TUI and the API compared on jobs.db (B0, B3).

Synthetic rows only: no real position, company or profile.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "scripts" / "parity"))

import _db  # noqa: E402
import jobsdb_parity as parity  # noqa: E402


def new_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row  # as _db.get_db() opens it
    _db.ensure_schema(conn)
    return conn


def add_position(conn, url, title="Synthetic Engineer", company="Example Co", status="new", found_by="scout-1", source="example", **extra):
    columns = {"title": title, "company": company, "url": url, "status": status, "found_by": found_by, "source": source, **extra}
    names = ", ".join(columns)
    marks = ", ".join("?" for _ in columns)
    cur = conn.execute(f"INSERT INTO positions ({names}) VALUES ({marks})", list(columns.values()))
    conn.commit()
    return cur.lastrowid


def score(conn, position_id, total, scored_by="scorer-1", notes="fits"):
    conn.execute(
        "INSERT INTO scores (position_id, total_score, scored_by, notes) VALUES (?, ?, ?, ?)",
        (position_id, total, scored_by, notes),
    )
    conn.execute("UPDATE positions SET status='scored' WHERE id=?", (position_id,))
    conn.execute(
        "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent) VALUES (?, 'checked', 'scored', ?)",
        (position_id, scored_by),
    )
    conn.commit()


@pytest.fixture
def seeded(tmp_path: Path):
    """A seed with one checked position, and a TUI and an API copy of it."""
    seed = tmp_path / "seed.db"
    conn = new_db(seed)
    add_position(conn, "https://jobs.example/p1", status="checked", found_by="SCOUT-2")
    conn.close()
    tui = tmp_path / "tui.db"
    api = tmp_path / "api.db"
    assert parity.main(["prepare", "--seed", str(seed), "--out", str(tui)]) == 0
    assert parity.main(["prepare", "--seed", str(seed), "--out", str(api)]) == 0
    return seed, tui, api


def run_diff(tui: Path, api: Path, seed: Path | None = None) -> tuple[int, dict]:
    args = ["diff", "--tui", str(tui), "--api", str(api), "--json"]
    if seed:
        args += ["--seed", str(seed)]
    import io
    from contextlib import redirect_stdout

    out = io.StringIO()
    with redirect_stdout(out):
        code = parity.main(args)
    return code, json.loads(out.getvalue())


def test_two_sides_that_did_the_same_work_agree(seeded):
    seed, tui, api = seeded
    for path, scorer, notes in ((tui, "SCORER-3", "stack fits well"), (api, "scorer-1", "the stack matches")):
        conn = sqlite3.connect(path)
        score(conn, 1, 80, scored_by=scorer, notes=notes)
        conn.close()

    code, report = run_diff(tui, api, seed)

    assert code == 0, report
    # Same role under different instance names, and two ways of saying the same note.
    assert report["tables"]["scores"]["by_role"] == {"scorer": {"both, same": 1}}
    assert report["tables"]["positions"]["seed_changed_both_same"] == 1


def test_a_different_score_and_a_different_history_are_named_field_by_field(seeded):
    seed, tui, api = seeded
    conn = sqlite3.connect(tui)
    score(conn, 1, 80)
    conn.close()
    conn = sqlite3.connect(api)
    score(conn, 1, 55)
    conn.execute("UPDATE positions SET status='excluded' WHERE id=1")
    conn.commit()
    conn.close()

    code, report = run_diff(tui, api, seed)

    assert code == 1
    assert report["tables"]["scores"]["differing"] == {"jobs.example/p1": {"total_score": [80, 55]}}
    assert report["tables"]["positions"]["seed_changed_both_differently"] == {"jobs.example/p1": {"status": ["scored", "excluded"]}}


def test_rows_only_one_side_wrote_are_listed_by_role(seeded):
    seed, tui, api = seeded
    conn = sqlite3.connect(tui)
    add_position(conn, "https://jobs.example/only-tui", found_by="SCOUT-2")
    conn.close()
    conn = sqlite3.connect(api)
    add_position(conn, "https://jobs.example/only-api", found_by="scout-1")
    conn.execute("UPDATE positions SET notes='seen again' WHERE id=1")
    conn.commit()
    conn.close()

    code, report = run_diff(tui, api, seed)

    positions = report["tables"]["positions"]
    assert code == 1
    assert positions["only_tui"] == ["jobs.example/only-tui"]
    assert positions["only_api"] == ["jobs.example/only-api"]
    assert positions["seed_changed_api_only"] == ["jobs.example/p1"]
    assert positions["by_role"]["scout"] == {"only TUI": 1, "only API": 1, "seed row changed by API only": 1}


def test_positions_are_matched_by_what_they_mean_not_by_id(tmp_path: Path):
    tui, api = tmp_path / "tui.db", tmp_path / "api.db"
    conn = new_db(tui)
    add_position(conn, "https://jobs.example/filler")
    add_position(conn, "https://www.Jobs.Example/job/1/?utm_source=x#apply")
    conn.close()
    conn = new_db(api)
    add_position(conn, "http://jobs.example/job/1")
    add_position(conn, "https://jobs.example/filler")
    conn.close()

    code, report = run_diff(tui, api)

    assert code == 0, report
    assert report["tables"]["positions"]["both"] == 2


def test_the_advert_named_in_the_query_stays_a_different_position():
    # Indeed names the advert in `jk`: two keys, two positions; the tracking tag is not part of it.
    assert parity.url_key("https://it.indeed.com/viewjob?jk=aaa&utm_source=x") == parity.url_key("https://it.indeed.com/viewjob?jk=aaa")
    assert parity.url_key("https://it.indeed.com/viewjob?jk=aaa") != parity.url_key("https://it.indeed.com/viewjob?jk=bbb")
    assert parity.url_key("https://jobs.example/a?id=1&lang=it") == parity.url_key("https://jobs.example/a?lang=it&id=1")
    # A careers page with one fragment per opening: two openings. An in-page anchor is not one.
    assert parity.url_key("https://example.com/careers#ai-engineer") != parity.url_key("https://example.com/careers#product-engineer")
    assert parity.url_key("https://example.com/careers/x#apply") == parity.url_key("https://example.com/careers/x")


def test_office_coordinates_agree_within_the_tolerance_and_are_counted(tmp_path: Path):
    tui, api = tmp_path / "tui.db", tmp_path / "api.db"
    conn = new_db(tui)
    add_position(conn, "https://jobs.example/a", office_lat=45.4642, office_lon=9.19)
    add_position(conn, "https://jobs.example/b")
    conn.close()
    conn = new_db(api)
    add_position(conn, "https://jobs.example/a", office_lat=45.4651, office_lon=9.1911)
    add_position(conn, "https://jobs.example/b")
    conn.close()

    code, report = run_diff(tui, api)

    assert code == 0, report
    assert report["b2"]["office_coordinates"]["tui"] == {"positions": 2, "with_office_coordinates": 1, "percent": 50.0}


def test_a_mock_position_is_named_and_is_never_a_seed(tmp_path: Path):
    tui, api = tmp_path / "tui.db", tmp_path / "api.db"
    new_db(tui).close()
    conn = new_db(api)
    add_position(conn, "https://jobs.example/mock-1", company="Mock Ltd", source="mock")
    conn.close()

    code, report = run_diff(tui, api)

    assert code == 1
    assert report["b2"]["mock_positions"] == {"tui": 0, "api": 1}
    assert parity.main(["prepare", "--seed", str(api), "--out", str(tmp_path / "x.db")]) == 2
    assert not (tmp_path / "x.db").exists()


def test_the_seed_is_a_copy_that_never_touches_its_source(tmp_path: Path):
    source = tmp_path / "live" / "jobs.db"
    source.parent.mkdir()
    conn = new_db(source)
    add_position(conn, "https://jobs.example/p1")
    conn.close()
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    source.parent.chmod(0o500)  # a read-only folder: a writer would fail here
    try:
        out = tmp_path / "seed.db"
        assert parity.main(["seed", "--from", str(source), "--out", str(out)]) == 0
    finally:
        source.parent.chmod(0o700)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert stat.S_IMODE(out.stat().st_mode) == 0o600
    assert sqlite3.connect(out).execute("SELECT url FROM positions").fetchall() == [("https://jobs.example/p1",)]
    # A second seed over the first one is refused unless asked.
    assert parity.main(["seed", "--from", str(source), "--out", str(out)]) == 2


def test_prepare_always_starts_again_from_the_seed(seeded):
    seed, tui, api = seeded
    conn = sqlite3.connect(api)
    add_position(conn, "https://jobs.example/left-over")
    conn.close()
    assert parity.main(["prepare", "--seed", str(seed), "--out", str(api)]) == 2  # exists: not silently replaced
    assert parity.main(["prepare", "--seed", str(seed), "--out", str(api), "--force"]) == 0
    code, _ = run_diff(tui, api, seed)
    assert code == 0


def test_the_text_report_reads_by_table_and_role(seeded, capsys):
    seed, tui, api = seeded
    conn = sqlite3.connect(api)
    score(conn, 1, 70)
    conn.close()

    code = parity.main(["diff", "--tui", str(tui), "--api", str(api), "--seed", str(seed)])
    out = capsys.readouterr().out

    assert code == 1
    assert "== scores: DIFFERENT" in out
    assert "[scorer] only API 1" in out
    assert "== B2 checks" in out
    assert "mock positions: TUI 0 · API 0" in out


def test_a_missing_database_is_a_failed_command(tmp_path: Path):
    assert parity.main(["diff", "--tui", str(tmp_path / "no.db"), "--api", str(tmp_path / "no.db")]) == 2


@pytest.mark.parametrize(
    "agent, role",
    [("SCOUT-2", "scout"), ("scout-1", "scout"), ("scout", "scout"), ("analista-6", "analista"), (None, None), ("", None)],
)
def test_agents_are_compared_by_role(agent, role):
    assert parity.role_of(agent) == role


def test_seed_into_refreshes_a_copy_that_a_reader_keeps_open_in_wal(tmp_path: Path):
    # D06: the cloud daemon keeps its copy of jobs.db open, and _db.py puts it
    # in WAL. Every refresh must land in that same database, whole and
    # consistent, with the daemon's connection still open.
    source = tmp_path / "live.db"
    conn = new_db(source)
    add_position(conn, "https://jobs.example/first")
    conn.close()
    copy = tmp_path / "copy" / "jobs.db"
    assert parity.main(["seed", "--from", str(source), "--out", str(copy)]) == 0

    daemon = sqlite3.connect(copy)
    daemon.execute("PRAGMA journal_mode=WAL")
    daemon.execute("INSERT INTO positions (title, company, url, status) VALUES ('pulled', 'x', 'https://jobs.example/pulled', 'new')")
    daemon.commit()
    assert Path(f"{copy}-wal").exists()

    conn = sqlite3.connect(source)
    add_position(conn, "https://jobs.example/second")
    conn.close()
    assert parity.main(["seed", "--into", "--from", str(source), "--out", str(copy)]) == 0

    # The open connection sees the source as it is now, nothing else: the row
    # it wrote itself is gone, and the database checks out.
    urls = [row[0] for row in daemon.execute("SELECT url FROM positions ORDER BY url")]
    assert urls == ["https://jobs.example/first", "https://jobs.example/second"]
    daemon.close()
    fresh = sqlite3.connect(copy)
    assert fresh.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert [r[0] for r in fresh.execute("SELECT url FROM positions ORDER BY url")] == urls


def test_seed_into_needs_the_copy_to_exist_and_is_not_force(tmp_path: Path):
    source = tmp_path / "live.db"
    new_db(source).close()
    missing = tmp_path / "none.db"
    assert parity.main(["seed", "--into", "--from", str(source), "--out", str(missing)]) == 2
    assert not missing.exists()
    with pytest.raises(SystemExit):
        parity.main(["seed", "--into", "--force", "--from", str(source), "--out", str(missing)])
