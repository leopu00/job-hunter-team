"""The questions each agent asked the user, as the agents' panel reads them.

agent_state.py reads them from jobs.db in the same read-only opening as the
«waits for you» state, with the same rule of what is open: an agent's question
with no reply and no older than seven days. A structured question
(agent_questions.py) also needs no answer and its expiry still ahead. The
counts are SQL's; at most five rows per agent come out, twenty in the list.
What the agent wrote is data: one line, no invisible commands, cut short.
«Not known» is null, never zero.
"""

from __future__ import annotations

import importlib.util
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

spec = importlib.util.spec_from_file_location("agent_state_questions_under_test", SKILLS / "agent_state.py")
st = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = st
spec.loader.exec_module(st)

NOW_DT = datetime(2026, 10, 22, 21, 0, 0, tzinfo=timezone.utc)
NOW = NOW_DT.timestamp()
OPTIONS = [{"id": "breve", "label": "CV breve", "reversibile": True}, {"id": "lungo", "label": "CV completo"}]


@pytest.fixture(autouse=True)
def _modules_as_they_were():
    """The contract is loaded by file and imports external_content by name: other
    test files fix their own nonce on that name, so it is put back as it was."""
    saved = {name: sys.modules.get(name) for name in ("external_content", "agent_questions_for_state")}
    yield
    for name, module in saved.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


@pytest.fixture()
def aq():
    return st._question_contract()


@pytest.fixture()
def db(tmp_path):
    """A jobs.db with the product's own schema (_db.ensure_schema), never a person's."""
    path = tmp_path / "jobs.db"
    seed = subprocess.run(
        [sys.executable, "-c", "from _db import get_db, ensure_schema; c=get_db(); ensure_schema(c); c.commit(); c.close()"],
        cwd=SKILLS, capture_output=True, text=True,
        env={**os.environ, "JHT_DB": str(path), "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"},
    )
    assert seed.returncode == 0, seed.stdout + seed.stderr
    return path


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d %H:%M:%S")


def ask(db, aq, agent="scout", tipo="domanda", ago=timedelta(hours=1), expires=None, options=OPTIONS, nonce=None, **extra):
    """A structured question, exactly as jht-notify-user stores it."""
    asked_at = NOW_DT - ago
    question = aq.build_question(agent=agent, testo=extra.pop("testo", "Quale CV uso per Acme?"),
                                 oggetto=extra.pop("oggetto", "CV per Acme"), opzioni=options, tipo=tipo,
                                 scade_tra=expires, now=asked_at, nonce=nonce, **extra)
    with sqlite3.connect(db) as con:
        con.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, source_id, source_action, source_payload, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (question.agent, question.body, question.kind, question.source_id, aq.SOURCE_ACTION,
             question.payload_json, stamp(asked_at)),
        )
    return question.source_id


def free(db, agent="capitano", body="Procedo con Acme?", ago=timedelta(hours=1), kind="question", **columns):
    """A row the way an agent wrote it before the contract (or a plain message)."""
    names = ["agent", "body", "kind", "created_at", *columns]
    values = [agent, body, kind, stamp(NOW_DT - ago), *columns.values()]
    with sqlite3.connect(db) as con:
        cur = con.execute(f"INSERT INTO pending_user_messages ({','.join(names)}) VALUES ({','.join('?' * len(names))})", values)
        return cur.lastrowid


def read(db):
    return st.read_agent_questions(str(db), NOW)


def test_every_type_comes_with_its_type_and_its_options(db, aq):
    for n, tipo in enumerate(st.QUESTION_TIPI):
        ask(db, aq, agent=f"scout-{n + 1}", tipo=tipo, nonce=f"t{n}")
    table = read(db)
    for n, tipo in enumerate(st.QUESTION_TIPI):
        entry = table[f"scout-{n + 1}"]
        assert entry["count"] == 1
        item = entry["open"][0]
        assert item["tipo"] == tipo
        assert item["oggetto"] == "CV per Acme" and item["testo"] == "Quale CV uso per Acme?"
        assert [o["id"] for o in item["opzioni"]] == ["breve", "lungo"]
    # urgente is stored with kind=alert: it is still a question of the panel
    assert table["scout-1"]["open"][0]["tipo"] == "urgente"


def test_zero_questions_is_a_known_zero_and_an_unreadable_db_is_not_known(db, tmp_path):
    assert read(db) == {}
    assert st.questions_of("scout-1", read(db)) == {"open": 0, "unread": 0, "items": []}
    assert st.read_agent_questions(str(tmp_path / "missing.db"), NOW) is None
    assert st.questions_of("scout-1", None) is None


def test_without_the_question_contract_nothing_is_said(db, aq, monkeypatch):
    ask(db, aq, tipo="urgente")
    monkeypatch.setattr(st, "_question_contract", lambda: None)
    # not a count of the free questions only: an urgent one (kind=alert) would vanish
    assert read(db) is None


def test_an_answered_expired_or_old_question_is_not_open(db, aq):
    answered = ask(db, aq, agent="scout-1", nonce="a1")
    with sqlite3.connect(db) as con:
        assert aq.record_answer(con, answered, ["breve"], canale="desktop", now=NOW_DT).status == "recorded"
    ask(db, aq, agent="scout-2", expires="1h", ago=timedelta(hours=2), nonce="a2")  # expired an hour ago
    ask(db, aq, agent="scout-3", expires="6h", ago=timedelta(hours=2), nonce="a3")  # four hours to go
    ask(db, aq, agent="scout-4", ago=timedelta(days=8), nonce="a4")  # no expiry, older than seven days
    table = read(db)
    count = lambda agent: table.get(agent, {"count": 0})["count"]
    assert (count("scout-1"), count("scout-2"), count("scout-4")) == (0, 0, 0)
    assert table["scout-3"]["count"] == 1
    assert table["scout-3"]["open"][0]["scadenza"] == (NOW_DT + timedelta(hours=4)).timestamp()
    assert table["scout-3"]["open"][0]["default"] == "_rinvia"


def test_an_answer_row_alone_closes_a_structured_question(db, aq):
    """The answer is its own row (ans:<id>): that is what closes it, as for the
    sweeper (expire_due), even where the question's own reply is still empty."""
    question = ask(db, aq)
    with sqlite3.connect(db) as con:
        con.execute("INSERT INTO pending_user_messages (agent, body, author, source_id, source_action, source_payload) "
                    "VALUES ('scout', 'CV breve', 'user', ?, ?, '{}')", ("ans:" + question, aq.ANSWER_ACTION))
    assert read(db)["scout"]["count"] == 0


def test_a_reply_written_in_a_text_box_closes_a_structured_question_too(db, aq):
    question = ask(db, aq)
    with sqlite3.connect(db) as con:
        con.execute("UPDATE pending_user_messages SET user_reply = '1' WHERE source_id = ?", (question,))
    assert read(db)["scout"]["count"] == 0


def test_a_free_question_is_open_until_replied_read_or_not_as_the_wait_says(db):
    free(db, agent="capitano", body="Procedo?")
    free(db, agent="mentor", body="Letta, senza risposta", acknowledged_at=stamp(NOW_DT))
    free(db, agent="assistente", body="Risposta", user_reply="si")
    free(db, agent="critico", body="Una notizia", kind="notification")
    table = read(db)
    item = table["capitano"]["open"][0]
    assert (item["tipo"], item["id"], item["opzioni"], item["testo"]) == (None, None, [], "Procedo?")
    # the same rule as «waits for you» (read_questions): read, not replied, still open
    assert table["mentor"]["count"] == 1
    assert st.read_questions(str(db), NOW).keys() >= {"capitano", "mentor"}
    assert table.get("assistente", {"count": 0})["count"] == 0
    assert table.get("critico", {"count": 0})["count"] == 0


def test_a_payload_that_breaks_the_contract_is_never_shown_nor_taken_for_a_free_question(db, aq):
    good = ask(db, aq)
    forged = json.loads(sqlite3.connect(db).execute("SELECT source_payload FROM pending_user_messages").fetchone()[0])
    forged["opzioni"][0]["id"] = "Rm -rf"
    with sqlite3.connect(db) as con:
        for payload, source_id in ((json.dumps(forged), "aq:scout:1-bad1"), ("{not json", "aq:scout:1-bad2"),
                                   (json.dumps({**forged, "tipo": "ordine"}), "aq:scout:1-bad3")):
            con.execute(
                "INSERT INTO pending_user_messages (agent, body, kind, source_id, source_action, source_payload, created_at) "
                "VALUES ('scout', 'falsa', 'question', ?, ?, ?, ?)", (source_id, aq.SOURCE_ACTION, payload, stamp(NOW_DT)))
    items = read(db)["scout"]["open"]
    assert [item["id"] for item in items] == [good]
    assert all(item["testo"] != "falsa" for item in items)


def test_the_unread_are_the_agents_rows_not_acknowledged(db, aq):
    free(db, agent="assistente", kind="notification", body="uno")
    free(db, agent="assistente", kind="notification", body="due")
    free(db, agent="assistente", kind="notification", body="letto", acknowledged_at=stamp(NOW_DT))
    free(db, agent="assistente", kind="notification", body="mio", author="user")
    table = read(db)
    assert table["assistente"]["unread"] == 2
    assert table["assistente"]["count"] == 0


def test_a_role_goes_to_its_first_instance_as_the_wait_does(db, aq):
    ask(db, aq, agent="scout", nonce="r1")
    ask(db, aq, agent="scout-2", nonce="r2")
    table = read(db)
    assert st.questions_of("scout-1", table)["open"] == 1
    assert st.questions_of("scout-2", table)["open"] == 1
    assert st.questions_of("scout-3", table)["open"] == 0


def test_the_counts_are_whole_and_the_rows_few(db, aq):
    for n in range(12):
        free(db, agent="capitano", body=f"domanda {n}", ago=timedelta(minutes=60 - n))
    table = read(db)
    assert table["capitano"]["count"] == 12
    assert len(table["capitano"]["open"]) == st.QUESTIONS_PER_AGENT
    assert table["capitano"]["open"][0]["testo"] == "domanda 11"  # the newest first
    mine = st.questions_of("capitano", table)
    assert mine["open"] == 12 and len(mine["items"]) == 5


def test_at_most_twenty_rows_in_the_whole_list_the_newest(db):
    for agent in range(6):
        for n in range(5):
            free(db, agent=f"scout-{agent + 1}", body=f"{agent}-{n}", ago=timedelta(minutes=agent * 10 + n))
    table = read(db)
    out = {f"scout-{a + 1}": {"state": "idle", "questions": st.questions_of(f"scout-{a + 1}", table)} for a in range(6)}
    st.trim_questions(out)
    shown = [item["testo"] for v in out.values() for item in v["questions"]["items"]]
    assert len(shown) == st.QUESTIONS_PER_LIST
    assert out["scout-1"]["questions"]["open"] == 5 and len(out["scout-1"]["questions"]["items"]) == 5
    assert out["scout-6"]["questions"]["open"] == 5 and out["scout-6"]["questions"]["items"] == []


def test_what_the_agent_wrote_is_one_short_line_without_invisible_commands(db, aq):
    ask(db, aq, oggetto="CV‮per Acme", testo="riga uno\nriga due​ " + "x" * 400,
        options=[{"id": "si", "label": "Sì⁦ subito"}, {"id": "no", "label": "No"}])
    item = read(db)["scout"]["open"][0]
    assert item["oggetto"] == "CVper Acme"
    assert "\n" not in item["testo"] and "​" not in item["testo"]
    assert len(item["testo"]) == st.QUESTION_TEXT_MAX and item["testo"].endswith("…")
    assert item["opzioni"][0]["label"] == "Sì subito"


def test_reversible_is_true_only_with_the_boolean_true(db, aq):
    ask(db, aq)
    options = read(db)["scout"]["open"][0]["opzioni"]
    assert [o["reversibile"] for o in options] == [True, False]  # «lungo» says nothing: it asks for a confirmation


def test_the_read_is_read_only(db, aq):
    question = ask(db, aq, expires="1h", ago=timedelta(hours=2))  # expired: the sweeper's, never the reader's
    before = sqlite3.connect(db).execute("SELECT COUNT(*), MAX(updated_at) FROM pending_user_messages").fetchone()
    read(db)
    after = sqlite3.connect(db).execute("SELECT COUNT(*), MAX(updated_at) FROM pending_user_messages").fetchone()
    assert before == after
    assert sqlite3.connect(db).execute(
        "SELECT COUNT(*) FROM pending_user_messages WHERE source_id = ?", ("ans:" + question,)).fetchone()[0] == 0


def test_the_main_output_carries_the_questions_of_each_live_agent(db, aq, tmp_path, monkeypatch):
    ask(db, aq, agent="scout")
    (tmp_path / "agents" / "scout-1").mkdir(parents=True)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(db))
    monkeypatch.setattr(st, "tmux_sessions", lambda: {"scout-1": NOW - 600})
    monkeypatch.setattr(st.time, "time", lambda: NOW)
    printed = []
    monkeypatch.setattr("builtins.print", lambda text: printed.append(text))
    st.main()
    out = json.loads(printed[0])
    assert out["scout-1"]["questions"]["open"] == 1
    assert out["scout-1"]["questions"]["items"][0]["tipo"] == "domanda"
    assert "state" in out["scout-1"]


def _functions_naming(path: Path, pattern: str) -> set[str]:
    import ast
    import re
    source = path.read_text(encoding="utf-8")
    return {
        node.name
        for node in ast.walk(ast.parse(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and re.search(pattern, ast.get_source_segment(source, node) or "")
    }


def test_no_decision_reads_the_panels_questions():
    """Only to be shown: in agent_state.py the panel's questions are read, cut and
    attached in main, and nothing else names them (the wait reads its own,
    read_questions); in agent_control.py only the list passes them on."""
    state = _functions_naming(SKILLS / "agent_state.py", r"read_agent_questions|questions_of|trim_questions|_question_contract|\"questions\"")
    assert state == {"_question_contract", "read_agent_questions", "questions_of", "trim_questions", "main"}
    control = _functions_naming(SKILLS / "agent_control.py", r"questions")
    assert control == {"_questions", "read_list"}
