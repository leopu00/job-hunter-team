"""A person who works from the terminal answers the card with its number, as the button of the app would.

TEST 19e (Gate CLI): the card «Save this profile?» says «Reply with the option number (for example 2)», and in
`jht team chat` the «1» that follows never answered it: it was typed into the Assistente's prompt as text (or refused by
the transport), and the Assistente said «select Confirm and save on the review card above», a card a terminal does not
have. The first run stayed in `awaiting_profile` for ever. Now a line written to an agent is first offered to
`agent_chat.py reply`, which records it as the person's answer (the same record, the same wake) and only a line that is
not an answer goes on as text.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from test_agent_questions import ROOT, aq, box, sql  # noqa: F401  (box is a fixture)
from test_profile_confirm_card import answer as button, ask, cards, stage, tool  # noqa: F401

CHAT = ROOT / "shared" / "skills" / "agent_chat.py"
FIRST_RUN = ROOT / "shared" / "skills" / "first_run.py"
ANSWERS = "SELECT source_id, source_payload FROM pending_user_messages WHERE source_action = 'agent_question_answer'"


def reply(box, agent: str, text: str) -> dict:
    """What the terminal runs for a line typed to `agent`: the line goes on stdin, never in an argument."""
    stub = box.bin / "tmux"
    if not stub.exists():  # no terminal to wake: the wake says why in its log and the answer stands
        stub.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        stub.chmod(0o755)
    env = dict(box.env, JHT_ANSWER_WAKE_RETRY="0", PYTHONPATH=str(Path(yaml.__file__).resolve().parent.parent))
    done = subprocess.run([sys.executable, str(CHAT), "reply", agent], input=text, capture_output=True, text=True,
                          env=env, timeout=120)
    assert done.returncode == 0, (done.stdout, done.stderr)
    return json.loads(done.stdout)


def stored_answers(box) -> list[dict]:
    return [json.loads(payload) for _, payload in sql(box, ANSWERS)]


def first_run(box, *args: str) -> dict:
    env = dict(box.env, PYTHONPATH=str(Path(yaml.__file__).resolve().parent.parent))
    done = subprocess.run([sys.executable, str(FIRST_RUN), *args], capture_output=True, text=True, env=env, timeout=120)
    assert done.stdout.strip(), done.stderr
    return json.loads(done.stdout)


@pytest.mark.parametrize("text", ["1", " 1 ", "Q%s 1", "Conferma e salva", "conferma e salva"])
def test_the_number_the_code_or_the_label_answers_the_card_like_the_button(box, text):
    stage(box)
    posted = ask(box)
    code = aq.answer_code(posted["question_id"])
    out = reply(box, "assistente", text.replace("Q%s", code) if "Q%s" in text else text)

    assert out["result"] == "answered" and out["questionId"] == posted["question_id"], out
    (answer,) = stored_answers(box)
    assert answer["scelte"] == ["confirm"] and answer["origine"] == "utente" and answer["canale"] == "cli"


def test_the_first_run_leaves_awaiting_the_profile_after_a_1_from_the_terminal(box):
    """The chain of the Gate CLI: the profile is confirmed with «1», the plan can then be asked (it was waiting for the profile)."""
    (box.home / "jht.config.json").write_text(json.dumps({"active_provider": "openai"}), encoding="utf-8")
    stage(box)
    assert first_run(box, "ask-plan", "--agent", "assistente").get("wait_for_profile") is True
    ask(box)

    assert reply(box, "assistente", "1")["result"] == "answered"
    rc, saved = tool(box, "apply-confirmed")

    assert rc == 0 and saved.get("ok") is True, saved
    after = first_run(box, "ask-plan", "--agent", "assistente")
    assert after.get("wait_for_profile") is not True and after.get("asked") is True, after


@pytest.mark.parametrize("text", ["yes", "Yes!", "sì", "Sì, salva", "ok", "oui", "ja"])
def test_a_yes_in_words_confirms_the_one_card_that_asks_to_save(box, text):
    stage(box)
    posted = ask(box)

    out = reply(box, "assistente", text)

    assert out["result"] == "answered" and out["questionId"] == posted["question_id"], out
    assert stored_answers(box)[0]["scelte"] == ["confirm"]


def test_the_second_option_is_the_number_2(box):
    stage(box)
    ask(box)
    assert reply(box, "assistente", "2")["result"] == "answered"
    assert stored_answers(box)[0]["scelte"] == ["correct"]


@pytest.mark.parametrize("text", ["ciao, come va?", "vorrei correggere il ruolo", "1 e 2", "sì ma prima aggiungo una cosa", "mi chiamo Ada"])
def test_other_text_is_chat_and_answers_nothing(box, text):
    stage(box)
    ask(box)
    assert reply(box, "assistente", text) == {"result": "chat"}
    assert stored_answers(box) == []


def test_a_number_that_is_not_an_option_is_told_when_the_code_says_which_card_and_nothing_is_recorded(box):
    stage(box)
    posted = ask(box)
    out = reply(box, "assistente", f"{aq.answer_code(posted['question_id'])} 7")
    assert out["result"] == "invalid" and out["reason"] == "number_out_of_range" and out["code"].startswith("Q")
    assert stored_answers(box) == []
    # a bare 7 is the person talking («7 years»), as it is on Telegram: chat, never a wrong answer
    assert reply(box, "assistente", "7") == {"result": "chat"}


def test_a_yes_with_no_open_question_or_for_another_agent_is_chat(box):
    assert reply(box, "assistente", "1") == {"result": "chat"}      # nothing is asked
    stage(box)
    ask(box)
    assert reply(box, "capitano", "1") == {"result": "chat"}         # the card is the Assistente's
    assert reply(box, "capitano", "yes") == {"result": "chat"}
    assert stored_answers(box) == []


def test_an_answered_card_is_not_answered_again_by_the_next_1(box):
    stage(box)
    ask(box)
    assert reply(box, "assistente", "1")["result"] == "answered"
    assert reply(box, "assistente", "1") == {"result": "chat"}      # no open question is left: it is chat again
    assert len(stored_answers(box)) == 1


def test_a_yes_does_not_answer_a_card_that_has_no_confirm_option(box):
    done = subprocess.run([str(ROOT / "agents" / "_tools" / "jht-notify-user"), "--agent", "assistente", "--oggetto", "CV",
                           "--option", "breve=CV breve", "--option", "lungo=CV completo", "Quale versione?"],
                          capture_output=True, text=True, env=box.env)
    assert done.returncode == 0, done.stderr
    assert reply(box, "assistente", "yes") == {"result": "chat"}
    assert reply(box, "assistente", "2")["result"] == "answered"


def test_two_open_cards_need_the_code(box):
    stage(box)
    ask(box)
    other = subprocess.run([str(ROOT / "agents" / "_tools" / "jht-notify-user"), "--agent", "assistente", "--oggetto", "CV",
                            "--option", "breve=CV breve", "--option", "lungo=CV completo", "Quale versione?"],
                           capture_output=True, text=True, env=box.env)
    assert other.returncode == 0, other.stderr
    code = aq.answer_code(other.stdout.split("id=")[1].strip())
    assert reply(box, "assistente", "2") == {"result": "chat"}       # which one? it is chat, never a guess
    assert reply(box, "assistente", f"{code} 2")["result"] == "answered"
    assert stored_answers(box)[0]["scelte"] == ["lungo"]
