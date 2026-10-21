"""JHT-T24: the exclusions of the profile the user accepted act on the score, from the CODE.

An accepted exclusion is a rule frozen from the structured columns of the positions the user turned down
with that reason. `db_insert.py score` takes its penalty off the total; the Scout only gets a hint; an agent
can neither accept nor withdraw one; the user's words are in none of it.
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import _db  # noqa: E402
import profile_exclusions as rules  # noqa: E402

PROFILE = 'name: "Ada Example"\ntarget_role: "Backend Engineer"\n'
SENTINEL = "SENTINEL-PRIVATE-WORDS-OF-THE-USER"


def _run(script, db, *args, stdin=None, agent=None):
    env = {**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent), "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("JHT_AGENT_NAME", None)
    if agent:
        env["JHT_AGENT_NAME"] = agent
    return subprocess.run([sys.executable, str(SKILLS / script), *args], cwd=ROOT, env=env, input=stdin,
                          capture_output=True, text=True)


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "jobs.db"
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    for name in ("Acme", "Globex", "Initech"):
        conn.execute("INSERT INTO companies (name) VALUES (?)", (name,))
    conn.commit()
    conn.close()
    return path


def _position(db, title, company_id=None, **columns):
    conn = sqlite3.connect(db)
    columns = {"title": title, "company": f"co{company_id}", "company_id": company_id, "status": "checked",
               "url": f"https://x.example/{title}", **columns}
    cursor = conn.execute(
        f"INSERT INTO positions ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        list(columns.values()),
    )
    conn.commit()
    conn.close()
    return cursor.lastrowid


def _judge(db, position_id, action, reason=None, note=None, created="2026-10-01 10:00:00"):
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO position_feedback (position_id, action, reason, note, created_at) VALUES (?,?,?,?,?)",
                 (position_id, action, reason, note, created))
    conn.commit()
    conn.close()


def _reject(db, ids, reason, **kw):
    for pid in ids:
        _judge(db, pid, "dislike", reason, **kw)


def _score(db, pid, total=80, breakdown="STACK: fine\nREMOTE: fine"):
    done = _run("db_insert.py", db, "score", "--position-id", str(pid), "--total", str(total), "--stack-match", "30",
                "--remote-fit", "20", "--salary-fit", "10", "--experience-fit", "7", "--strategic-fit", "5",
                "--breakdown", breakdown, "--notes", "n", "--scored-by", "scorer-1")
    assert done.returncode == 0, done.stdout + done.stderr
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT total_score, breakdown FROM scores WHERE position_id = ?", (pid,)).fetchone()
    finally:
        conn.close()


def _accept(db, code):
    done = _run("profile_exclusions.py", db, "accept", code)
    return done.returncode, json.loads(done.stdout)


def test_company_exclusion_takes_thirty_off_a_position_of_that_company_and_nothing_off_another(db):
    bad = [_position(db, f"b{i}", company_id=1) for i in range(3)]
    _reject(db, bad, "company")
    assert _accept(db, "company")[0] == 0
    hit = _position(db, "new-acme", company_id=1)
    other = _position(db, "new-globex", company_id=2)
    total, breakdown = _score(db, hit)
    assert total == 50, "80 - 30"
    assert breakdown.splitlines()[0] == "EXCLUSION -30: unwanted company (company)"
    assert breakdown.splitlines()[1] == "STACK: fine", "the scorer's own lines follow, untouched"
    assert _score(db, other) == (80, "STACK: fine\nREMOTE: fine"), "another company: no penalty, no line"


def test_the_other_codes_take_fifteen_and_the_sum_never_passes_the_cap(db):
    rejected = [
        _position(db, f"r{i}", company_id=1, loc_country_code="FR", role_family="Backend",
                  salary_estimated_max=40000, salary_estimated_currency="EUR")
        for i in range(3)
    ]
    for reason in ("wrong_location", "salary_low", "wrong_stack"):
        _reject(db, rejected, reason)
        assert _accept(db, reason)[0] == 0
    one = _position(db, "fr-only", company_id=2, loc_country_code="FR")
    assert _score(db, one)[0] == 65
    two = _position(db, "fr-low", company_id=2, loc_country_code="FR", salary_estimated_max=30000,
                    salary_estimated_currency="EUR")
    total, breakdown = _score(db, two)
    assert total == 50, "-15 -15 = the cap of -30, not less"
    assert breakdown.splitlines()[0].startswith("EXCLUSION -30: wrong location (wrong_location), salary too low")
    three = _position(db, "all-three", company_id=2, loc_country_code="FR", role_family="Backend",
                      salary_estimated_max=30000, salary_estimated_currency="EUR")
    assert _score(db, three)[0] == 50, "three codes: still the cap"
    none = _position(db, "elsewhere", company_id=2, loc_country_code="DE", role_family="Data",
                     salary_estimated_max=90000, salary_estimated_currency="EUR")
    assert _score(db, none)[0] == 80
    assert _score(db, _position(db, "usd", company_id=2, salary_estimated_max=10, salary_estimated_currency="USD"))[0] == 80, (
        "another currency is no match"
    )


def test_the_total_never_goes_below_zero(db):
    _reject(db, [_position(db, f"b{i}", company_id=1) for i in range(3)], "company")
    _accept(db, "company")
    assert _score(db, _position(db, "low", company_id=1), total=10)[0] == 0


def test_a_withdrawn_exclusion_stops_acting_on_the_next_score(db):
    _reject(db, [_position(db, f"b{i}", company_id=1) for i in range(3)], "company")
    _accept(db, "company")
    pid = _position(db, "p", company_id=1)
    assert _score(db, pid)[0] == 50
    done = _run("profile_exclusions.py", db, "withdraw", "company")
    assert done.returncode == 0 and json.loads(done.stdout)["status"] == "withdrawn"
    assert _score(db, pid) == (80, "STACK: fine\nREMOTE: fine"), "a re-score is whole again"
    assert _accept(db, "company")[0] == 0
    assert _score(db, pid)[0] == 50, "and accepted again, it acts again"


def test_the_parameters_come_from_the_latest_judgement_of_each_position_and_never_from_remote_or_the_catch_all(db):
    a = _position(db, "a", company_id=1, loc_country_code="FR", role_family="Backend")
    b = _position(db, "b", company_id=1, loc_country_code="DE", role_family="Other")
    c = _position(db, "c", company_id=2, loc_country_code="IT", role_family="Data", work_mode="remote")
    d = _position(db, "d", company_id=3, loc_country_code="ES", role_family="Data")
    e = _position(db, "e", company_id=3, loc_country_code="PT", role_family="Other")
    _reject(db, [a, b, c], "wrong_location")
    _reject(db, [e], "wrong_stack")
    _judge(db, d, "dislike", "wrong_location", created="2026-10-01 10:00:00")
    _judge(db, d, "clear", None, created="2026-10-02 10:00:00")  # the vote was taken back: it counts for nothing
    _judge(db, a, "like", None, created="2026-10-03 10:00:00")  # a is liked later: it counts for nothing
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    assert rules.derive_params(conn, "wrong_location") == {"country_codes": ["DE"]}, "not a, not remote c, not cleared d"
    assert rules.derive_params(conn, "wrong_stack") == {}, "Other says nothing about the stack"


def test_without_structured_evidence_there_is_nothing_to_accept(db):
    _reject(db, [_position(db, f"n{i}", company_id=1) for i in range(3)], "wrong_location")  # no country on any
    code, answer = _accept(db, "wrong_location")
    assert (code, answer["code"]) == (1, "no_evidence")
    assert _accept(db, "too_senior")[1]["code"] == "code_invalid", "the seniority is not here yet"
    assert _accept(db, "other")[1]["code"] == "code_invalid"


def test_an_agent_can_neither_accept_nor_withdraw(db):
    _reject(db, [_position(db, f"b{i}", company_id=1) for i in range(3)], "company")
    for args in (("accept", "company"), ("withdraw", "company"), ("reconcile",)):
        done = _run("profile_exclusions.py", db, *args, agent="scorer-1", stdin="[]")
        assert done.returncode == 1 and json.loads(done.stdout)["code"] == "user_only", args
    assert json.loads(_run("profile_exclusions.py", db, "list").stdout)["exclusions"] == []


def test_the_cloud_decisions_are_brought_to_the_table_and_what_cannot_be_a_rule_is_said(db):
    _reject(db, [_position(db, f"b{i}", company_id=1) for i in range(3)], "company")
    _reject(db, [_position(db, f"n{i}", company_id=2) for i in range(3)], "wrong_location")
    decisions = [
        {"reason": "company", "status": "accepted"},
        {"reason": "wrong_location", "status": "accepted"},  # no country anywhere: cannot act
        {"reason": "too_senior", "status": "accepted"},  # not in this release: ignored
        {"reason": "salary_low", "status": "dismissed"},
    ]
    done = _run("profile_exclusions.py", db, "reconcile", stdin=json.dumps(decisions))
    assert done.returncode == 0 and json.loads(done.stdout) == {"ok": True, "unusable": ["wrong_location"]}
    listed = {r["code"]: r["status"] for r in json.loads(_run("profile_exclusions.py", db, "list").stdout)["exclusions"]}
    assert listed == {"company": "active"}
    # the user withdraws it from the app: the cloud says dismissed, the rule stops
    _run("profile_exclusions.py", db, "reconcile", stdin=json.dumps([{"reason": "company", "status": "dismissed"}]))
    listed = {r["code"]: r["status"] for r in json.loads(_run("profile_exclusions.py", db, "list").stdout)["exclusions"]}
    assert listed == {"company": "withdrawn"}
    for bad in ("not json", "{}", "[1]"):
        assert _run("profile_exclusions.py", db, "reconcile", stdin=bad).returncode == 1


def test_a_frozen_rule_is_not_rewritten_by_a_later_pull(db):
    ids = [_position(db, f"b{i}", company_id=1) for i in range(3)]
    _reject(db, ids, "company")
    _accept(db, "company")
    _reject(db, [_position(db, "later", company_id=2)], "company")  # a fourth, after the user accepted
    _run("profile_exclusions.py", db, "reconcile", stdin=json.dumps([{"reason": "company", "status": "accepted"}]))
    listed = json.loads(_run("profile_exclusions.py", db, "list").stdout)["exclusions"]
    assert listed[0]["params"] == {"company_ids": [1]}


def test_the_scout_gets_the_hint_with_the_values_and_never_the_users_words(db):
    _reject(db, [_position(db, f"c{i}", company_id=1) for i in range(3)], "company", note=SENTINEL)
    _reject(db, [_position(db, f"l{i}", company_id=2, loc_country_code="FR") for i in range(3)], "wrong_location", note=SENTINEL)
    _accept(db, "company")
    _accept(db, "wrong_location")
    done = _run("db_query.py", db, "profile-exclusions")
    assert done.returncode == 0
    assert "unwanted company" in done.stdout and "FR" in done.stdout and "SC-04" in done.stdout
    as_json = json.loads(_run("db_query.py", db, "profile-exclusions", "--json").stdout)
    assert [e["code"] for e in as_json["exclusions"]] == ["company", "wrong_location"]
    pid = _position(db, "hit", company_id=1)
    total, breakdown = _score(db, pid)
    for text in (done.stdout, breakdown, json.dumps(as_json)):
        assert SENTINEL not in text
    _run("profile_exclusions.py", db, "withdraw", "company")
    _run("profile_exclusions.py", db, "withdraw", "wrong_location")
    assert "No profile exclusions in force." in _run("db_query.py", db, "profile-exclusions").stdout


def test_the_codes_that_act_are_the_ones_the_json_names_and_the_table_accepts(db):
    data = json.loads((ROOT / "shared" / "feedback-reasons.json").read_text(encoding="utf-8"))
    assert list(rules.CODES) == data["acting"]
    assert all(code in data["proposable"] for code in rules.CODES)
    conn = sqlite3.connect(db)
    table = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'profile_exclusions'").fetchone()[0]
    for code in rules.CODES:
        assert f"'{code}'" in table
    for code in set(data["proposable"]) - set(rules.CODES):
        assert f"'{code}'" not in table, "a seniority code has no row in the table yet"


def test_a_database_without_the_table_scores_as_before(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute("DROP TABLE profile_exclusions")
    conn.commit()
    assert rules.penalty_for(conn, 1) == (0, [])
