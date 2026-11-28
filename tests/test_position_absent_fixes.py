"""JHT-T326, the small and isolated bugs (no schema change): a currency without amounts, a failed geocoding that comes back to the
queue for ever, and a precise salary nobody could write.

  * `salary_estimated_currency` read «EUR» on every position, estimated or not: without amounts it is NULL now (db_insert).
  * `office_geocoded=1` is «attempted» (db_update: true even when the search failed, like `logo_fetched`): the autonomous queue and
    `geocode-check` no longer give a failed attempt back; the request of the person (`geocode_requested`) is another queue.
  * `db_update.py position --salary-precise TEXT` writes the precise estimate and closes `salary_precise_requested` in the same write.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def run(db: Path, script: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SKILLS / script), *args], cwd=REPO_ROOT, capture_output=True, text=True,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent), "PYTHONDONTWRITEBYTECODE": "1"},
    )


@pytest.fixture
def db(tmp_path: Path) -> Path:
    path = tmp_path / "jobs.db"
    seed = subprocess.run(
        [sys.executable, "-c", f"import sys; sys.path.insert(0, {str(SKILLS)!r}); from _db import get_db, ensure_schema; "
                               "c=get_db(); ensure_schema(c); c.close()"],
        cwd=REPO_ROOT, capture_output=True, text=True, env={**os.environ, "JHT_DB": str(path), "JHT_HOME": str(tmp_path)})
    assert seed.returncode == 0, seed.stderr
    return path


def query(db: Path, sql: str, *params):
    conn = sqlite3.connect(db)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def insert(db: Path, n: int, *extra: str) -> int:
    done = run(db, "db_insert.py", "position", "--title", f"Warehouse operator {n}", "--company", f"Acme {n}",
               "--url", f"https://example.org/jobs/{n}", "--source", "example", "--location", "Rome, Italy",
               "--remote-type", "onsite", "--found-by", "import-synthetic", *extra)
    assert done.returncode == 0, done.stdout + done.stderr
    return query(db, "SELECT id FROM positions WHERE url = ?", f"https://example.org/jobs/{n}")[0][0]


# ── the currency of the rough estimate ───────────────────────────────────────

@pytest.mark.parametrize("extra, expected", [
    ((), None),                                                                     # no amounts: nothing to measure
    (("--salary-estimated-currency", "USD"), None),                                  # a currency alone says nothing either
    (("--salary-estimated-min", "30000"), "EUR"),                                    # amounts without a currency: the house default
    (("--salary-estimated-min", "30000", "--salary-estimated-max", "40000", "--salary-estimated-currency", "USD"), "USD"),
    (("--salary-estimated-max", "40000", "--salary-estimated-currency", "GBP"), "GBP"),
])
def test_the_currency_of_the_estimate_exists_only_with_an_amount(db, extra, expected):
    position = insert(db, 1, *extra)
    assert query(db, "SELECT salary_estimated_currency FROM positions WHERE id = ?", position) == [(expected,)]


# ── a failed geocoding does not come back ─────────────────────────────────────

def seed_position(db: Path, *, status="checked", lat=None, geocoded=0, mode="onsite") -> int:
    conn = sqlite3.connect(db)
    try:
        cur = conn.execute("INSERT INTO positions (title, company, status, loc_city, work_mode, office_lat, office_lon, office_geocoded) "
                           "VALUES ('Engineer', 'Acme', ?, 'Rome', ?, ?, ?, ?)", (status, mode, lat, lat, geocoded))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def missing_scope_ids(db: Path) -> set[int]:
    import db_query
    sql, params, _ = db_query.geocode_missing_scope(None, True)
    conn = sqlite3.connect(db)
    try:
        return {r[0] for r in conn.execute("SELECT p.id " + sql, params)}
    finally:
        conn.close()


def test_the_autonomous_queue_holds_only_what_was_never_attempted(db):
    never = seed_position(db)                                   # 0, no coordinates: to do
    legacy = seed_position(db, lat=41.9, geocoded=0)            # coordinates but not marked: counted as before
    failed = seed_position(db, geocoded=1)                      # attempted, nothing found: closed
    done = seed_position(db, lat=41.9, geocoded=1)              # attempted, found: closed
    assert missing_scope_ids(db) == {never, legacy}
    assert failed not in missing_scope_ids(db) and done not in missing_scope_ids(db)


def test_geocode_check_says_no_to_a_failed_attempt_and_says_why(db):
    failed = seed_position(db, geocoded=1)
    out = run(db, "db_query.py", "geocode-check", str(failed))
    assert out.returncode == 0 and "NO" in out.stdout and "already attempted, no coordinates found" in out.stdout, out.stdout + out.stderr
    done = seed_position(db, lat=41.9, geocoded=1)
    assert "already geocoded" in run(db, "db_query.py", "geocode-check", str(done)).stdout


def test_a_skip_after_three_attempts_closes_the_queue_for_good(db):
    """The skill writes `--office-geocoded true` on the skip after three attempts (the help of db_update: true even when it failed)."""
    position = seed_position(db)
    assert position in missing_scope_ids(db)
    done = run(db, "db_update.py", "position", str(position), "--office-geocoded", "true", "--office-verified", "false",
               "--action", "geocode", "--outcome", "failed")
    assert done.returncode == 0, done.stdout + done.stderr
    assert position not in missing_scope_ids(db)
    assert query(db, "SELECT office_lat, office_geocoded FROM positions WHERE id = ?", position) == [(None, 1)]


@pytest.mark.parametrize("lang", ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"])
def test_the_skill_writes_true_on_the_skip_after_three_attempts(lang):
    text = (REPO_ROOT / "agents" / "_skills" / "office-geocoding" / f"SKILL{lang}.md").read_text(encoding="utf-8")
    assert "--office-geocoded true --office-verified false \\\n  --action geocode --outcome failed" in text
    assert "--office-geocoded false --office-verified false \\\n  --action geocode --outcome failed" not in text


# ── the precise salary can be written ─────────────────────────────────────────

def request_precise(db: Path, position: int) -> None:
    conn = sqlite3.connect(db)
    try:
        conn.execute("UPDATE positions SET salary_precise_requested = 1, salary_precise_requested_at = '2026-11-18 09:00:00' WHERE id = ?",
                     (position,))
        conn.commit()
    finally:
        conn.close()


def precise_queue(db: Path) -> list:
    return query(db, "SELECT id FROM positions p WHERE p.salary_precise_requested = 1 AND (p.salary_precise IS NULL OR TRIM(p.salary_precise) = '')")


def test_writing_the_precise_salary_closes_the_request_and_keeps_its_instant(db):
    position = seed_position(db)
    request_precise(db, position)
    assert precise_queue(db) == [(position,)]
    done = run(db, "db_update.py", "position", str(position), "--salary-precise", "net 2100-2400 EUR/month (IT, after taxes)")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "salary_precise_requested=acknowledged" in done.stdout
    assert query(db, "SELECT salary_precise, salary_precise_requested, salary_precise_requested_at FROM positions WHERE id = ?", position) == [
        ("net 2100-2400 EUR/month (IT, after taxes)", 0, "2026-11-18 09:00:00")]
    assert precise_queue(db) == []


def test_an_empty_precise_salary_is_refused_and_the_request_stays_open(db):
    position = seed_position(db)
    request_precise(db, position)
    done = run(db, "db_update.py", "position", str(position), "--salary-precise", "   ")
    assert done.returncode == 1 and "SALARY_PRECISE REJECTED" in done.stderr
    assert precise_queue(db) == [(position,)]
