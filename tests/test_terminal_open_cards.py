"""A person at a terminal sees the open cards of the agent, with their options numbered, whatever channel they were
delivered by.

Gate CLI Linux 19i (A6): the plan's card was in the database (`delivered_via` = web) and `jht team chat assistente`
showed nothing, so the person had to guess that «2» was the answer. `agent_chat.py questions AGENT` lists the open
questions of that agent for the REPL to print; the answer itself is `reply` (test_terminal_reply_answers_the_card).
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import yaml

from test_agent_questions import ROOT, THREE, T0, ask_via_tool, aq, box, build, conn, insert_question  # noqa: F401
from test_profile_confirm_card import ask, stage  # noqa: F401
from test_terminal_reply_answers_the_card import reply

CHAT = ROOT / "shared" / "skills" / "agent_chat.py"


def questions(box, agent: str) -> list[dict]:
    env = dict(box.env, PYTHONPATH=str(Path(yaml.__file__).resolve().parent.parent))
    done = subprocess.run([sys.executable, str(CHAT), "questions", agent], capture_output=True, text=True, env=env, timeout=120)
    assert done.returncode == 0, (done.stdout, done.stderr)
    return json.loads(done.stdout)["questions"]


def test_an_open_card_is_listed_with_its_code_its_text_and_its_options_in_order(box):
    qid = ask_via_tool(box, *THREE)

    (card,) = questions(box, "assistente")

    assert card["id"] == qid and card["code"] == aq.answer_code(qid)
    assert card["subject"] == "CV per Acme" and card["text"] == "Quale versione del CV uso?"
    assert card["options"] == ["CV breve", "CV completo", "Nessuno dei due"]
    assert card["multiple"] is False


def test_the_card_is_listed_whatever_channel_it_was_delivered_by(box):
    """The Gate CLI's case: delivered_via = web (the app's card), nothing on Telegram. The terminal lists it all the same."""
    ask_via_tool(box, *THREE)
    with sqlite3.connect(box.db) as connection:
        connection.execute("UPDATE pending_user_messages SET delivered_via = 'web', delivered_at = CURRENT_TIMESTAMP")
    assert [card["options"][0] for card in questions(box, "assistente")] == ["CV breve"]
    with sqlite3.connect(box.db) as connection:
        connection.execute("UPDATE pending_user_messages SET delivered_via = 'telegram'")
    assert len(questions(box, "assistente")) == 1
    with sqlite3.connect(box.db) as connection:
        connection.execute("UPDATE pending_user_messages SET delivered_via = NULL")
    assert len(questions(box, "assistente")) == 1


def test_only_the_cards_of_the_agent_asked_about(box):
    ask_via_tool(box, *THREE, agent="assistente")
    ask_via_tool(box, *THREE, agent="capitano", text="Quale CV uso per il Capitano?")

    assert [c["text"] for c in questions(box, "assistente")] == ["Quale versione del CV uso?"]
    assert [c["text"] for c in questions(box, "capitano")] == ["Quale CV uso per il Capitano?"]
    assert questions(box, "mentor") == []


def test_an_answered_card_is_no_longer_listed(box):
    stage(box)
    ask(box)
    assert len(questions(box, "assistente")) == 1

    assert reply(box, "assistente", "1")["result"] == "answered"

    assert questions(box, "assistente") == []


def test_two_open_cards_are_both_listed_oldest_first(box):
    first = ask_via_tool(box, *THREE, text="Prima domanda?")
    second = ask_via_tool(box, *THREE, text="Seconda domanda?")

    assert [c["id"] for c in questions(box, "assistente")] == [first, second]


def test_a_card_past_its_deadline_is_not_offered(box, conn):
    question = build(scade_tra="1h")
    insert_question(box, question)

    assert [c["id"] for c in aq.open_cards(conn, "assistente", now=T0 + timedelta(minutes=30))] == [question.source_id]
    assert aq.open_cards(conn, "assistente", now=T0 + timedelta(hours=2)) == []


def test_no_database_means_no_cards(tmp_path):
    env = {"JHT_HOME": str(tmp_path), "PYTHONPATH": str(Path(yaml.__file__).resolve().parent.parent), "PATH": "/usr/bin:/bin"}
    done = subprocess.run([sys.executable, str(CHAT), "questions", "assistente"], capture_output=True, text=True, env=env, timeout=60)
    assert done.returncode == 0 and json.loads(done.stdout) == {"questions": []}
