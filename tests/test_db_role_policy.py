"""db_insert.py and db_update.py refuse what the caller's ROLE may not write (shared/skills/db_role_policy.py).

The oracle of the matrix below is the prompts and skills of each role (scout.md SC-03, analista RULE-08, scorer RULE-02..06,
scrittore application-flow, the Closer's gated flows), NOT db_role_policy.json: a test that read its expectations from the
table it checks would pass whatever the table said. The table is tied to the native harness's `role-policy.ts` by
agent-harness/runtime/tests/db-role-policy-parity.test.ts.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import db_role_policy as rp  # noqa: E402

ENTITIES_INSERT = ("position", "company", "score", "application", "highlight")
ALLOWED_INSERT = {"scout": {"position"}, "analista": {"company", "highlight"}, "scrittore": {"application"}, "scorer": {"score"}}
ALLOWED_UPDATE = {"scout": {"position"}, "analista": {"position", "company"}, "scrittore": {"position", "application"},
                  "scorer": {"position"}, "closer": {"application"}, "dottore": {"application"}, "critico": {"application"}}
ROLES = ("scout", "analista", "scrittore", "critico", "capitano", "closer", "mentor", "mantenitore", "sentinella", "scorer",
         "dottore", "assistente")
ENFORCED_ROLES = tuple(r for r in ROLES if r != "capitano")     # the Capitano is warn-only, see its own test


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_AGENT_NAME", raising=False)
    return tmp_path


def ns(entity, **kw):
    return argparse.Namespace(entity=entity, **kw)


def refused(call):
    with pytest.raises(SystemExit) as stop:
        call()
    assert stop.value.code == rp.REFUSED_EXIT
    return stop.value


# ── the entity ────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ENFORCED_ROLES)
@pytest.mark.parametrize("entity", ENTITIES_INSERT)
def test_each_role_inserts_only_what_its_prompt_says(role, entity):
    env = {"JHT_AGENT_NAME": role + "-1"}
    if entity in ALLOWED_INSERT.get(role, set()):
        rp.guard_insert(ns(entity), env)
    else:
        refused(lambda: rp.guard_insert(ns(entity), env))


@pytest.mark.parametrize("role", ENFORCED_ROLES)
@pytest.mark.parametrize("entity", ("position", "company", "application"))
def test_each_role_updates_only_what_its_prompt_says(role, entity):
    env = {"JHT_AGENT_NAME": role + "-1"}
    args = ns(entity, id=1, position_id=1, name="x")
    if entity in ALLOWED_UPDATE.get(role, set()):
        # the entity is allowed; a flag-less call has nothing else to refuse (the Scout's row rule needs a row to look at)
        rp.guard_update(args, fetch_position=lambda i: ("new", role + "-1"), environ=env)
    else:
        refused(lambda: rp.guard_update(args, environ=env))


def test_the_scout_cannot_write_the_tables_that_are_not_its_own():
    for entity in ("company", "score", "application", "highlight"):
        refused(lambda e=entity: rp.guard_insert(ns(e), {"JHT_AGENT_NAME": "scout-3"}))
    for entity in ("company", "application"):
        refused(lambda e=entity: rp.guard_update(ns(e, name="x", position_id=1), environ={"JHT_AGENT_NAME": "scout-3"}))


# ── who is the caller ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_without_the_variable_nothing_is_checked_it_is_the_person_the_app_or_a_test():
    rp.guard_insert(ns("score"), {})
    rp.guard_update(ns("company", name="x"), environ={})


@pytest.mark.parametrize("name", ["relay", "user", "sentinella-worker", "tg-bridge", "unknown"])
def test_a_name_that_is_not_a_role_of_the_table_is_not_checked(name):
    rp.guard_insert(ns("score"), {"JHT_AGENT_NAME": name})


@pytest.mark.parametrize("name", ["SCOUT-2", "Scout", "scout-12", " scout-1 "])
def test_the_name_is_read_the_way_the_launcher_writes_it(name):
    refused(lambda: rp.guard_insert(ns("score"), {"JHT_AGENT_NAME": name}))


# ── the columns and the status of a position ──────────────────────────────────────────────────────────────────────────

def pos(**kw):
    base = dict(id=7, status=None, notes=None, jd_text=None, title=None, last_checked=None, is_open=None, role_family=None,
                action=None, outcome=None)
    base.update(kw)
    return ns("position", **base)


def scout_row(status="new", found_by="scout-1"):
    return lambda i: (status, found_by)


def test_the_scout_only_recovers_its_own_new_duplicates():
    env = {"JHT_AGENT_NAME": "scout-1"}
    rp.guard_update(pos(status="excluded", notes="DUPLICATE of #3"), scout_row(), env)
    refused(lambda: rp.guard_update(pos(status="excluded", notes="x", title="Other"), scout_row(), env))      # a column
    refused(lambda: rp.guard_update(pos(jd_text="rewritten"), scout_row(), env))                              # a column
    refused(lambda: rp.guard_update(pos(status="checked"), scout_row(), env))                                 # a status
    refused(lambda: rp.guard_update(pos(status="excluded", notes="x"), scout_row(found_by="scout-2"), env))   # not its own
    refused(lambda: rp.guard_update(pos(status="excluded", notes="x"), scout_row(status="scored"), env))      # not new any more
    refused(lambda: rp.guard_update(pos(status="excluded", notes="x"), scout_row(found_by=None), env))


def test_the_scorer_moves_checked_to_scored_or_excluded_and_notes_go_with_the_exclusion():
    env = {"JHT_AGENT_NAME": "scorer"}
    rp.guard_update(pos(status="scored", last_checked="now"), environ=env)
    rp.guard_update(pos(status="excluded", notes="below the bar"), environ=env)
    refused(lambda: rp.guard_update(pos(status="scored", notes="why"), environ=env))     # notes only with the exclusion
    refused(lambda: rp.guard_update(pos(status="writing"), environ=env))
    refused(lambda: rp.guard_update(pos(title="x"), environ=env))
    refused(lambda: rp.guard_update(pos(status="applied"), environ=env))


def test_the_analista_writes_every_column_but_does_not_apply_or_go_back_to_new():
    env = {"JHT_AGENT_NAME": "analista-2"}
    rp.guard_update(pos(status="checked", jd_text="x", title="y", role_family="Data"), environ=env)
    rp.guard_update(pos(status="excluded", notes="closed", is_open="false", action="liveness", outcome="dead"), environ=env)
    refused(lambda: rp.guard_update(pos(status="new"), environ=env))
    refused(lambda: rp.guard_update(pos(status="applied"), environ=env))
    refused(lambda: rp.guard_update(pos(status="writing"), environ=env))
    rp.guard_update(ns("company", name="Acme", verdict="GO"), environ=env)


def test_the_scrittore_claims_a_scored_position_for_its_cv():
    env = {"JHT_AGENT_NAME": "scrittore"}
    rp.guard_update(pos(status="writing"), environ=env)
    rp.guard_update(pos(status="ready"), environ=env)
    rp.guard_update(pos(status="excluded", notes="dead link"), environ=env)
    refused(lambda: rp.guard_update(pos(status="scored"), environ=env))
    refused(lambda: rp.guard_update(pos(status="writing", jd_text="x"), environ=env))


def test_the_capitano_is_warned_not_refused_until_its_real_writes_are_listed(home, capsys):
    rp.guard_insert(ns("score"), {"JHT_AGENT_NAME": "capitano"})                  # no exit
    rp.guard_update(ns("company", name="x"), environ={"JHT_AGENT_NAME": "capitano"})
    assert "ROLE WARNING" in capsys.readouterr().err
    lines = [json.loads(l) for l in (home / "logs" / "db-role-refusals.jsonl").read_text().splitlines()]
    assert [l["enforced"] for l in lines] == [False, False] and {l["role"] for l in lines} == {"capitano"}


def test_the_critico_writes_its_verdict_and_never_the_cv_nor_the_status():
    env = {"JHT_AGENT_NAME": "critico-1"}
    rp.guard_update(app(critic_verdict="PASS", reviewed_by="critico-1"), environ=env)
    refused(lambda: rp.guard_update(app(status="ready"), environ=env))
    refused(lambda: rp.guard_update(app(cv_path="x"), environ=env))
    refused(lambda: rp.guard_update(pos(status="excluded", notes="x"), environ=env))


def test_the_dottore_links_an_orphan_cv_and_nothing_else():
    env = {"JHT_AGENT_NAME": "dottore"}
    rp.guard_update(app(cv_pdf_path="/jht_user/cv/x.pdf"), environ=env)
    refused(lambda: rp.guard_update(app(status="ready"), environ=env))
    refused(lambda: rp.guard_update(app(cl_path="x"), environ=env))


def test_the_log_flags_of_a_check_are_not_columns_of_the_row():
    rp.guard_update(pos(status="excluded", notes="n", action="liveness", outcome="dead"), scout_row(), {"JHT_AGENT_NAME": "scout-1"})


# ── the columns and the status of an application ──────────────────────────────────────────────────────────────────────

def app(**kw):
    base = dict(position_id=7, status=None, critic_verdict=None, cv_path=None, applied_at=None, applied_via=None, applied=None,
                response=None, written_by=None, reviewed_by=None, interview_round=None)
    base.update(kw)
    return ns("application", **base)


def test_the_scrittore_owns_the_cv_and_the_verdict_not_the_send():
    env = {"JHT_AGENT_NAME": "scrittore"}
    rp.guard_update(app(cv_path="cv.md", status="review", written_by="scrittore"), environ=env)
    rp.guard_update(app(status="ready", critic_verdict="PASS", reviewed_by="critico"), environ=env)
    refused(lambda: rp.guard_update(app(applied_at="now"), environ=env))
    refused(lambda: rp.guard_update(app(applied="true"), environ=env))
    refused(lambda: rp.guard_update(app(response="no"), environ=env))
    refused(lambda: rp.guard_update(app(status="applied"), environ=env))


def test_the_closers_flows_may_record_the_sent_state_and_nothing_else():
    env = {"JHT_AGENT_NAME": "closer"}
    rp.guard_update(app(applied_at="now", applied_via="agent_closer"), environ=env)
    refused(lambda: rp.guard_update(app(cv_path="cv.md"), environ=env))
    refused(lambda: rp.guard_update(app(status="ready"), environ=env))
    refused(lambda: rp.guard_update(pos(status="excluded", notes="x"), environ=env))


# ── the refusal, from the command line ────────────────────────────────────────────────────────────────────────────────

def run_tool(tool, args, tmp_path, agent):
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(tmp_path), "JHT_DB": str(tmp_path / "jobs.db"), "JHT_AGENT_NAME": agent}
    if not agent:
        env.pop("JHT_AGENT_NAME")
    return subprocess.run([sys.executable, str(SKILLS / tool), *args], capture_output=True, text=True, env=env, timeout=60)


def test_the_command_refuses_before_any_sql_says_why_and_writes_it_down(tmp_path):
    done = run_tool("db_insert.py", ["company", "--name", "Acme Synthetic"], tmp_path, "scout-1")
    assert done.returncode == rp.REFUSED_EXIT
    assert "ROLE REFUSED" in done.stderr and "scout" in done.stderr and "company" in done.stderr
    assert not (tmp_path / "jobs.db").exists(), "refused before the database was even opened"
    line = json.loads((tmp_path / "logs" / "db-role-refusals.jsonl").read_text().splitlines()[0])
    assert (line["role"], line["agent"], line["tool"], line["entity"]) == ("scout", "scout-1", "db_insert", "company")
    assert "Acme Synthetic" not in json.dumps(line)           # names of flags, never their values


def test_the_command_runs_as_before_for_the_person_and_for_the_role_that_owns_the_table(tmp_path):
    for agent in ("", "analista-1"):
        done = run_tool("db_insert.py", ["company", "--name", "Acme Synthetic"], tmp_path, agent)
        assert done.returncode == 0, done.stderr
    assert (tmp_path / "jobs.db").exists()
    refused_update = run_tool("db_update.py", ["company", "Acme Synthetic", "--verdict", "GO"], tmp_path, "scorer")
    assert refused_update.returncode == rp.REFUSED_EXIT and "scorer" in refused_update.stderr


# ── what the file says it adds to the native table ────────────────────────────────────────────────────────────────────

def test_the_python_only_additions_are_few_and_each_has_its_reason():
    only = rp.policy()["python_only"]
    assert set(only) == {"closer", "scrittore", "dottore", "capitano", "critico"}
    assert all(entry.get("note") for entry in only.values())
    assert set(rp.policy()["roles"]) == set(ROLES)
