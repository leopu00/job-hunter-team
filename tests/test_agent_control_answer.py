"""The agents' panel answers an agent's structured question: `agent_control.py answer ID OPTION`.

One option of the question, by the ids agent_questions.py gave them: never text, and the
channel is the script's own («desktop»), not the request's. agent_questions.record_answer
stays the only writer of an answer: the option must be the question's, the first answer
wins, an expired question takes its default. The answer runs one action at a time, and
the reply and the journal carry only the ids and the outcome: never the question's
subject, text or labels, which are the agent's words and may be the person's data.

Every database here is a temporary one with the product's own schema.
"""

from __future__ import annotations

import fcntl
import importlib.machinery
import importlib.util
import io
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
TOOL = SKILLS / "agent_control.py"


def _load(name: str, path: Path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def _modules_as_they_were():
    """agent_questions imports external_content by name: other test files fix their own nonce on it."""
    names = ("external_content", "agent_control_questions", "aq_for_answer_tests", "agent_control_answer_under_test")
    saved = {name: sys.modules.get(name) for name in names}
    yield
    for name, module in saved.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


@pytest.fixture()
def team(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    db = home / "jobs.db"
    seed = subprocess.run(
        [sys.executable, "-c", "from _db import get_db, ensure_schema; c=get_db(); ensure_schema(c); c.commit(); c.close()"],
        cwd=SKILLS, capture_output=True, text=True,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"},
    )
    assert seed.returncode == 0, seed.stdout + seed.stderr
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_DB", str(db))
    tool = _load("agent_control_answer_under_test", TOOL)
    aq = _load("aq_for_answer_tests", SKILLS / "agent_questions.py")

    class Team:
        pass

    t = Team()
    t.home, t.db, t.tool, t.aq = home, db, tool, aq

    def ask(expires=None, ago=timedelta(minutes=10), nonce="ab12cd"):
        asked_at = datetime.now(timezone.utc).replace(microsecond=0) - ago
        question = aq.build_question(
            agent="scrittore", oggetto="CV per Acme", testo="Quale CV uso per Acme?",
            opzioni=[{"id": "breve", "label": "CV breve", "reversibile": True}, {"id": "lungo", "label": "CV completo"}],
            scade_tra=expires, now=asked_at, nonce=nonce)
        with sqlite3.connect(db) as con:
            con.execute(
                "INSERT INTO pending_user_messages (agent, body, kind, source_id, source_action, source_payload) VALUES (?,?,?,?,?,?)",
                (question.agent, question.body, question.kind, question.source_id, aq.SOURCE_ACTION, question.payload_json))
        return question.source_id

    def run(*argv, capsys):
        code = tool.main(list(argv))
        return code, json.loads(capsys.readouterr().out)

    def answers(question):
        with sqlite3.connect(db) as con:
            return [json.loads(row[0]) for row in con.execute(
                "SELECT source_payload FROM pending_user_messages WHERE source_id = ?", ("ans:" + question,))]

    def journal():
        path = home / "logs" / "agent-control.jsonl"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    t.ask, t.run, t.answers, t.journal = ask, run, answers, journal
    return t


def test_an_option_of_the_question_is_recorded_from_the_desktop(team, capsys):
    question = team.ask()
    code, reply = team.run("answer", question, "breve", capsys=capsys)
    assert code == 0
    assert reply == {"ok": True, "op": "answer", "session": None, "result": "answered", "question": question, "choice": "breve"}
    [stored] = team.answers(question)
    assert stored["scelte"] == ["breve"] and stored["origine"] == "utente"
    # the channel is the script's own, whatever the request
    assert stored["canale"] == "desktop"
    with sqlite3.connect(team.db) as con:
        reply_on_question = con.execute(
            "SELECT user_reply FROM pending_user_messages WHERE source_id = ?", (question,)).fetchone()[0]
    assert reply_on_question == "CV breve"


def test_the_first_answer_wins(team, capsys):
    question = team.ask()
    assert team.run("answer", question, "breve", capsys=capsys)[1]["result"] == "answered"
    code, reply = team.run("answer", question, "lungo", capsys=capsys)
    assert (code, reply["result"]) == (0, "already_answered")
    assert [a["scelte"] for a in team.answers(question)] == [["breve"]]


def test_an_expired_question_has_taken_its_default(team, capsys):
    question = team.ask(expires="5m", ago=timedelta(minutes=30))
    code, reply = team.run("answer", question, "breve", capsys=capsys)
    assert (code, reply["result"]) == (0, "expired")
    [stored] = team.answers(question)
    assert stored["origine"] == "scadenza" and stored["scelte"] == ["_rinvia"]


def test_an_option_that_is_not_the_questions_is_refused_and_nothing_is_written(team, capsys):
    question = team.ask()
    code, reply = team.run("answer", question, "medio", capsys=capsys)
    assert (code, reply["error"]) == (118, "answer_refused")
    assert team.answers(question) == []


def test_a_question_that_is_not_there_is_unknown(team, capsys):
    code, reply = team.run("answer", "aq:scrittore:1790000000-ffffff", "breve", capsys=capsys)
    assert (code, reply["error"]) == (117, "question_unknown")


@pytest.mark.parametrize("argv", [
    ["answer"],
    ["answer", "aq:scrittore:1-ab"],
    ["answer", "aq:scrittore:1-ab", "CV breve"],
    ["answer", "aq:scrittore:1-ab", "breve", "lungo"],
    ["answer", "aq:scrittore:1-ab", "breve", "--canale", "telegram"],
    ["answer", "ans:aq:scrittore:1-ab", "breve"],
    ["answer", "aq:scrittore:1-ab\n", "breve"],
    ["answer", "aq:scrittore:1-ab", "breve\n"],
    ["answer", "aq:scrittore:1-ab", "_altro"],
])
def test_anything_outside_the_ids_is_invalid_and_is_never_echoed(team, capsys, argv):
    code, reply = team.run(*argv, capsys=capsys)
    assert (code, reply["error"]) == (100, "agent_control_invalid")
    # a newline would be written escaped inside the JSON line
    for word in ("CV breve", "\\n", "_altro", "ans:", "telegram"):
        assert word not in json.dumps(reply)
        assert word not in team.journal()


def test_the_reply_and_the_journal_carry_the_ids_never_the_agents_words(team, capsys):
    question = team.ask()
    team.run("answer", question, "breve", capsys=capsys)
    team.run("answer", question, "medio", capsys=capsys)
    lines = [json.loads(line) for line in team.journal().splitlines()]
    assert [(line["op"], line.get("result"), line.get("error"), line.get("question"), line.get("choice")) for line in lines] == [
        ("answer", "answered", None, question, "breve"),
        ("answer", None, "answer_refused", question, "medio"),
    ]
    for words in ("CV per Acme", "Quale CV uso", "CV breve", "CV completo"):
        assert words not in team.journal()


def test_an_image_without_the_questions_says_so(team, capsys, monkeypatch):
    question = team.ask()
    monkeypatch.setattr(team.tool, "AGENT_QUESTIONS", team.home / "missing" / "agent_questions.py")
    code, reply = team.run("answer", question, "breve", capsys=capsys)
    assert (code, reply["error"]) == (120, "questions_unsupported")
    assert team.answers(question) == []


def test_a_team_without_its_database_does_not_make_one(team, capsys, monkeypatch):
    question = team.ask()
    missing = team.home / "elsewhere" / "jobs.db"
    monkeypatch.setenv("JHT_DB", str(missing))
    code, reply = team.run("answer", question, "breve", capsys=capsys)
    assert (code, reply["error"]) == (119, "answer_failed")
    assert not missing.exists()


def test_one_action_at_a_time_an_answer_too(team, capsys):
    question = team.ask()
    lock = team.home / "locks" / "agent-control.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        code, reply = team.run("answer", question, "breve", capsys=capsys)
    assert (code, reply["error"]) == (102, "agent_control_busy")
    assert team.answers(question) == []


def test_on_stdin_an_answer_is_refused(team, capsys, monkeypatch):
    question = team.ask()
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"op": "answer", "question": question, "choice": "breve"}) + "\n"))
    assert team.tool.main([]) == 0
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "agents_unavailable"}
    assert team.answers(question) == []


def test_the_ids_have_the_contracts_shape(team):
    aq = team.aq
    for good in ("aq:scrittore:1790000000-ab12cd", "aq:scout-1:1-a"):
        assert team.tool.QUESTION_ID.match(good) and aq.QUESTION_ID_RE.fullmatch(good)
    for bad in ("aq:Scout:1-a", "aq:scout:1-", "ans:aq:scout:1-a", "aq:scout:1-a\n"):
        assert not team.tool.QUESTION_ID.match(bad)
    for good in ("breve", "_rinvia", "cv_2"):
        assert team.tool.OPTION_ID.match(good)
    for bad in ("Breve", "a-b", "_altro", "x" * 25, "breve\n"):
        assert not team.tool.OPTION_ID.match(bad)
