"""The chat page carries the agent's questions, and the app answers them (agent_chat.py read / answer).

One system of questions: agent_questions.py in jobs.db. The chat only reads them (read-only) and records
the person's answer through record_answer, so the first answer wins and an expired question keeps its
default. The codes the app gets are the closed ones of the contract table at the top of agent_chat.py;
the last test holds that table equal to agent_questions.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from test_agent_chat import FAKE_TMUX, STUB_DELIVERY

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
SCRIPT = SKILLS / "agent_chat.py"
NONCE = "t90nonce"

BUILD = r"""
import json, sys
from datetime import timedelta
import agent_questions as aq
spec = json.loads(sys.argv[1])
if spec.pop("past", False):
    from datetime import datetime, timezone
    spec["now"] = datetime(2026, 1, 1, tzinfo=timezone.utc)
q = aq.build_question(**spec)
print(json.dumps({"agent": q.agent, "body": q.body, "kind": q.kind, "source_id": q.source_id,
                  "payload": q.payload_json, "action": aq.SOURCE_ACTION}))
"""


@pytest.fixture()
def box(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    db = home / "jobs.db"
    base = {**os.environ, "JHT_DB": str(db), "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1",
            "JHT_EXTERNAL_CONTENT_NONCE": NONCE, "JHT_LANG": "it"}
    seed = subprocess.run([sys.executable, "-c", "from _db import get_db, ensure_schema; c=get_db(); ensure_schema(c); c.commit(); c.close()"],
                          cwd=SKILLS, env=base, capture_output=True, text=True)
    assert seed.returncode == 0, seed.stderr
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    state = tmp_path / "pane"
    state.mkdir()
    (bin_dir / "tmux").write_text(FAKE_TMUX, encoding="utf-8")
    (bin_dir / "tmux").chmod(0o755)
    (bin_dir / "jht-tmux-send").write_text(STUB_DELIVERY, encoding="utf-8")
    (bin_dir / "jht-tmux-send").chmod(0o755)
    env = {**base, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "FAKE_TMUX_STATE": str(state),
           "FAKE_TMUX_SESSIONS": "CAPITANO ASSISTENTE MENTOR"}
    return type("Box", (), {"db": db, "home": home, "env": env, "state": state})


def ask(box, agent="assistente", **spec) -> str:
    spec = {"agent": agent, "testo": "Quale versione del CV uso?", "oggetto": "CV per Acme",
            "opzioni": [{"id": "breve", "label": "CV breve"}, {"id": "lungo", "label": "CV completo"}], **spec}
    if "scade_tra" in spec:
        spec["default"] = "_rinvia"
    done = subprocess.run([sys.executable, "-c", BUILD, json.dumps(spec)], cwd=SKILLS, env=box.env, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    q = json.loads(done.stdout)
    with sqlite3.connect(box.db) as conn:
        conn.execute("INSERT INTO pending_user_messages (agent, body, kind, source_id, source_action, source_payload) VALUES (?,?,?,?,?,?)",
                     (q["agent"], q["body"], q["kind"], q["source_id"], q["action"], q["payload"]))
    return q["source_id"]


def chat(box, *argv, stdin: str | None = None):
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), *argv], input=stdin, capture_output=True, text=True, env=box.env, timeout=60)
    return done.returncode, json.loads(done.stdout) if done.stdout.strip() else None


def page(box, agent="assistente"):
    rc, out = chat(box, "read", agent)
    assert rc == 0, out
    return out


def test_an_image_without_the_database_gives_no_questions_and_the_app_shows_no_answer(box):
    box.db.unlink()
    assert "questions" not in page(box)


def test_the_page_carries_the_questions_in_the_codes_of_the_contract(box):
    open_id = ask(box, tipo="urgente")
    ask(box, agent="capitano")                                      # another agent's: not on this page
    found = page(box)["questions"]
    assert [q["id"] for q in found] == [open_id]
    q = found[0]
    assert q["kind"] == "urgent" and q["state"] == "open" and q["expiresAt"] is None
    assert q["subject"] == "CV per Acme" and q["text"] == "Quale versione del CV uso?"
    assert q["options"] == [{"id": "breve", "label": "CV breve"}, {"id": "lungo", "label": "CV completo"}]
    assert q["multiple"] is False and q["free"] is False and isinstance(q["at"], float)
    assert "answer" not in q


def test_an_agents_line_carries_its_kind_and_suggestions_only_from_the_closed_lists(box):
    chat_file = box.home / "agents" / "capitano" / "chat.jsonl"
    chat_file.parent.mkdir(parents=True)
    rows = [
        {"role": "assistant", "text": "Fermo: manca il CV", "ts": 1.0, "kind": "blocked"},
        {"role": "assistant", "text": "Fatto", "ts": 2.0, "kind": "info"},
        {"role": "assistant", "text": "Strano", "ts": 3.0, "kind": "question"},
        {"role": "assistant", "text": "Scegli", "ts": 4.0, "choices": [{"label": "Sì"}, {"label": "No"}, {"label": 7}]},
        {"role": "user", "text": "ciao", "ts": 5.0, "kind": "urgent"},
    ]
    chat_file.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    messages = page(box, "capitano")["messages"]
    assert messages[0]["kind"] == "blocked"
    assert "kind" not in messages[1], "info is the default"
    assert "kind" not in messages[2], "a question is never a line's kind"
    assert messages[3]["suggestions"] == ["Sì", "No"]
    assert "kind" not in messages[4], "only the agent's lines"


def test_the_first_answer_wins_and_the_page_shows_it(box):
    qid = ask(box)
    rc, out = chat(box, "answer", "assistente", qid, stdin=json.dumps({"choices": ["breve"], "text": None}))
    assert rc == 0, out
    assert out["questionId"] == qid and out["accepted"] is True and isinstance(out["at"], float)
    rc, out = chat(box, "answer", "assistente", qid, stdin=json.dumps({"choices": ["lungo"], "text": None}))
    assert (rc, out) == (118, {"error": "question_closed"})
    q = page(box)["questions"][0]
    assert q["state"] == "answered"
    assert q["answer"]["choices"] == ["breve"] and q["answer"]["origin"] == "user" and q["answer"]["seenAt"] is None


@pytest.mark.parametrize("body, code", [
    ({"choices": ["altro"], "text": None}, (117, "invalid_choice")),          # not an option
    ({"choices": ["breve", "lungo"], "text": None}, (117, "invalid_choice")),  # one choice only
    ({"choices": [], "text": "scrivo io"}, (117, "invalid_choice")),          # free text not allowed
    ({"choices": [], "text": None}, (117, "invalid_choice")),                 # empty
    ({"choices": ["BREVE!"], "text": None}, (117, "invalid_choice")),         # outside the alphabet
])
def test_an_answer_the_question_does_not_allow_is_refused_and_nothing_is_written(box, body, code):
    qid = ask(box)
    rc, out = chat(box, "answer", "assistente", qid, stdin=json.dumps(body))
    assert (rc, out["error"]) == code
    assert page(box)["questions"][0]["state"] == "open"


def test_a_question_of_another_agent_or_unknown_is_not_found(box):
    other = ask(box, agent="capitano")
    assert chat(box, "answer", "assistente", other, stdin='{"choices":["breve"]}')[0] == 116
    assert chat(box, "answer", "assistente", "aq:assistente:1-abc", stdin='{"choices":["breve"]}')[0] == 116
    assert chat(box, "answer", "assistente", "bad id!", stdin='{"choices":["breve"]}')[0] == 120


def test_an_expired_question_keeps_its_default_and_says_so(box):
    qid = ask(box, scade_tra="5m", past=True)
    rc, out = chat(box, "answer", "assistente", qid, stdin=json.dumps({"choices": ["breve"]}))
    assert (rc, out) == (118, {"error": "question_closed"})
    q = page(box)["questions"][0]
    assert q["state"] == "expired" and q["answer"]["origin"] == "expiry" and q["answer"]["choices"] == ["_rinvia"]


def test_the_agent_is_woken_with_one_fixed_line_only_when_at_its_prompt(box):
    qid = ask(box)
    (box.state / "screen").write_text("Menu\n> 1. Yes\n  2. No\n", encoding="utf-8")
    assert chat(box, "answer", "assistente", qid, stdin='{"choices":["breve"]}')[0] == 0
    assert not (box.state / "delivered.envelopes").exists(), "nothing typed over a menu"
    qid2 = ask(box)
    (box.state / "screen").unlink()
    assert chat(box, "answer", "assistente", qid2, stdin='{"choices":["lungo"]}')[0] == 0
    typed = (box.state / "delivered.envelopes").read_text(encoding="utf-8").strip("\0")
    assert typed == "[ANSWER] The user answered one of your questions. Run: jht-check-user-replies --agent assistente"


def test_the_contract_table_is_the_one_of_agent_questions():
    spec = importlib.util.spec_from_file_location("t90_agent_chat", SCRIPT)
    chat_module = importlib.util.module_from_spec(spec)
    saved = os.environ.get("JHT_EXTERNAL_CONTENT_NONCE")
    os.environ["JHT_EXTERNAL_CONTENT_NONCE"] = NONCE
    try:
        spec.loader.exec_module(chat_module)
        aq = chat_module._questions_module()
    finally:
        if saved is None:
            os.environ.pop("JHT_EXTERNAL_CONTENT_NONCE", None)
        else:
            os.environ["JHT_EXTERNAL_CONTENT_NONCE"] = saved
    assert set(chat_module.QUESTION_KIND_OF_TIPO) == set(aq.TIPI)
    assert set(chat_module.QUESTION_KIND_OF_TIPO.values()) == set(chat_module.MESSAGE_KINDS) | {"question"}
    assert set(chat_module.ORIGIN_OF) == set(aq.ORIGINS)
    assert chat_module.MAX_CHOICES == aq.MAX_OPTIONS
    for code in set(chat_module.ANSWER_REFUSAL.values()) | {"question_closed", "answer_failed", "answer_unavailable"}:
        assert code in chat_module.EXIT
    exits = list(chat_module.EXIT.values())
    assert len(exits) == len(set(exits)), "every closed code has its own exit"


@pytest.mark.parametrize("rc, receipt", [
    ("0", {"taken": True}),                                   # the transport saw the CLI take it
    ("7", {"taken": None, "reason": "unconfirmed"}),          # gone from the composer, no proof
])
def test_a_send_says_whether_the_transport_has_a_proof_and_never_types_twice(box, rc, receipt):
    env = {**box.env, "FAKE_DELIVERY_RC": rc}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "send", "capitano", "c-1"], input="ciao",
                          capture_output=True, text=True, env=env, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    first = json.loads(done.stdout)
    assert {k: first[k] for k in receipt} == receipt
    again = subprocess.run([sys.executable, "-I", str(SCRIPT), "send", "capitano", "c-1"], input="ciao",
                           capture_output=True, text=True, env=env, timeout=60)
    assert json.loads(again.stdout) == first, "the same id answers what was recorded"
    sessions = (box.state / "delivered.sessions").read_text(encoding="utf-8").split()
    assert sessions == ["CAPITANO"], "typed once"


def test_a_terminal_held_by_another_writer_is_busy_and_nothing_is_recorded_as_delivered(box):
    env = {**box.env, "FAKE_DELIVERY_RC": "8"}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "send", "capitano", "c-2"], input="ciao",
                          capture_output=True, text=True, env=env, timeout=60)
    assert (done.returncode, json.loads(done.stdout)) == (124, {"error": "agent_busy"})
    assert not (box.home / "agents" / "capitano" / "chat-delivered.jsonl").exists()


# -- «enter» (C7): only Enter, once, and only on THAT message still in the composer ------------------------------------

STUB_WITH_SIGNATURE = """#!/bin/sh
# Like the real transport, hands every message to message_origin.py (the fence).
printf '%s\\n' "$*" >> "$FAKE_TMUX_STATE/transport.calls"
if [ "$1" = "--enter" ]; then
  [ -n "${FAKE_ENTER_SAYS:-}" ] && printf '%s\\n' "$FAKE_ENTER_SAYS"
  exit "${FAKE_ENTER_RC:-0}"
fi
[ "${FAKE_DELIVERY_RC:-0}" = 5 ] && printf 'JHT_SIGNATURE %s\\n' "${FAKE_SIGNATURE:-e29fa755}"
exit "${FAKE_DELIVERY_RC:-0}"
"""


def _stuck(box):
    """A send whose Enter the CLI swallowed: taken false, and the transport's signature recorded."""
    stub = Path(box.env["PATH"].split(":", 1)[0]) / "jht-tmux-send"
    stub.write_text(STUB_WITH_SIGNATURE, encoding="utf-8")
    env = {**box.env, "FAKE_DELIVERY_RC": "5", "FAKE_SIGNATURE": "e29fa755"}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "send", "capitano", "c-enter"], input="ciao",
                          capture_output=True, text=True, env=env, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    receipt = json.loads(done.stdout)
    assert receipt["taken"] is False and "reason" not in receipt
    return receipt


def _enter(box, message_id, **extra):
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "enter", "capitano", message_id],
                          capture_output=True, text=True, env={**box.env, **extra}, timeout=60)
    return done.returncode, json.loads(done.stdout)


def _transport_calls(box):
    return (box.state / "transport.calls").read_text(encoding="utf-8").splitlines()


def test_enter_asks_the_transport_for_enter_only_on_that_signature_and_then_answers_what_was_recorded(box):
    receipt = _stuck(box)
    rc, first = _enter(box, receipt["messageId"])
    assert rc == 0 and first["taken"] is True and first["messageId"] == receipt["messageId"]
    calls = _transport_calls(box)
    assert len(calls) == 2 and calls[1] == "--enter CAPITANO e29fa755", "Enter on that signature, the text never again"
    rc, again = _enter(box, receipt["messageId"])
    assert (rc, again) == (0, first) and len(_transport_calls(box)) == 2, "taken: never pressed again"


@pytest.mark.parametrize("reason", ["menu", "empty_unseen", "not_ours"])
def test_enter_that_finds_something_else_pressed_nothing_and_says_why(box, reason):
    receipt = _stuck(box)
    rc, answer = _enter(box, receipt["messageId"], FAKE_ENTER_RC="9", FAKE_ENTER_SAYS=f"JHT_REASON {reason}")
    assert rc == 0 and answer["taken"] is None and answer["reason"] == reason
    rc, again = _enter(box, receipt["messageId"])
    assert again == answer and len(_transport_calls(box)) == 2, "no second try once the composer held something else"


def test_enter_still_swallowed_stays_taken_false_and_may_be_asked_again(box):
    receipt = _stuck(box)
    rc, answer = _enter(box, receipt["messageId"], FAKE_ENTER_RC="5")
    assert rc == 0 and answer["taken"] is False
    rc, answer = _enter(box, receipt["messageId"])
    assert answer["taken"] is True and _transport_calls(box)[1:] == ["--enter CAPITANO e29fa755"] * 2


def test_enter_on_a_message_taken_or_unknown_never_calls_the_transport(box):
    stub = Path(box.env["PATH"].split(":", 1)[0]) / "jht-tmux-send"
    stub.write_text(STUB_WITH_SIGNATURE, encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "send", "capitano", "c-ok"], input="ciao",
                          capture_output=True, text=True, env=box.env, timeout=60)
    taken = json.loads(done.stdout)
    assert taken["taken"] is True
    assert _enter(box, taken["messageId"]) == (0, taken)
    rc, refused = _enter(box, "nessun-messaggio")
    assert refused == {"error": "chat_invalid"} and rc != 0
    rc, refused = _enter(box, "../etc")
    assert refused == {"error": "chat_invalid"}
    assert len(_transport_calls(box)) == 1, "only the send typed; enter pressed nothing"
