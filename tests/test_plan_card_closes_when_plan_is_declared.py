"""The card that asks for the plan closes by itself when the plan is declared some other way.

TEST 15: the user confirmed the Pro plan in the Assistente's chat, the first run wrote `plan: pro` and the burst
started, but the card the Capitano had posted for the same question (`plan_question`) stayed «1 open question» in
the Agents panel and in the Messages with the Capitano. The plan can be written by a path that never meets the
card: the Assistente's chat, `jht providers plan`, the app, a hand edit of the configuration. Whatever the path, a
plan in the configuration means the card has nothing left to ask: the net the watchdog runs every tick
(`plan-question-check`) closes it, as the system's answer (origin `sistema`), never as something the person chose.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

import pytest

from test_agent_questions import ROOT, aq, box, sql  # noqa: F401  (box is a fixture)
from test_plan_question_is_always_a_card import (
    FIRST_RUN,
    QUESTIONS,
    _net_function,
    _watchdog_function,
    answer,
    configure,
    import_profile,
    questions,
    run,
)

CHAT = ROOT / "shared" / "skills" / "agent_chat.py"


def stored_answer(box, question_id: str) -> dict | None:
    with sqlite3.connect(box.db, timeout=10) as conn:
        return aq.existing_answer(conn, question_id)


def answer_rows(box) -> list[tuple]:
    return sql(box, "SELECT source_id, agent, author, delivered_via FROM pending_user_messages WHERE source_action = 'agent_question_answer'")


def card_open(box, question_id: str) -> bool:
    return stored_answer(box, question_id) is None


def post_card(box) -> str:
    out = run(box, "ask-plan")
    assert out["asked"], out
    return out["question_id"]


# ── the net closes the card ──────────────────────────────────────────────────

def test_the_plan_written_by_another_path_closes_the_open_card(box):
    configure(box)
    import_profile(box, minutes_ago=60)
    qid = post_card(box)
    assert card_open(box, qid)

    configure(box, plan="pro")  # the Assistente's chat, the CLI, the app: the configuration is all the net sees
    out = run(box, "plan-question-check")

    assert out == {"action": "closed", "question_id": qid, "choice": ["pro"]}
    closed = stored_answer(box, qid)
    assert closed["scelte"] == ["pro"] and closed["origine"] == "sistema" and closed["canale"] == "tool"
    assert closed["testo"] == ""


def test_the_card_is_closed_with_the_option_that_stands_for_the_plan(box):
    configure(box)
    qid = post_card(box)

    configure(box, plan="pro-max")  # the table writes `pro-max`, the card's option is `pro_max`
    run(box, "plan-question-check")

    assert stored_answer(box, qid)["scelte"] == ["pro_max"]


def test_a_second_tick_finds_nothing_to_close(box):
    configure(box)
    qid = post_card(box)
    configure(box, plan="plus")
    assert run(box, "plan-question-check")["action"] == "closed"

    again = run(box, "plan-question-check")

    assert again["action"] == "none"
    assert len(answer_rows(box)) == 1 and stored_answer(box, qid)["scelte"] == ["plus"]


@pytest.mark.parametrize("profile", [True, False], ids=["profile-imported", "profile-not-imported"])
def test_the_card_closes_whether_or_not_the_profile_is_imported(box, profile: bool):
    configure(box)
    qid = post_card(box)
    if not profile:
        (box.home / "profile" / "candidate_profile.yml").unlink()  # the card was posted with a profile; now there is none
    configure(box, plan="pro")

    assert run(box, "plan-question-check")["action"] == "closed"
    assert not card_open(box, qid)


def test_the_card_closes_when_the_first_run_is_already_over(box):
    configure(box)
    qid = post_card(box)
    state_file = box.home / "state" / "first-run.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    state_file.write_text(json.dumps(dict(state, phase="steady")), encoding="utf-8")  # as `complete` leaves it
    configure(box, plan="pro")

    assert run(box, "plan-question-check")["action"] == "closed"
    assert not card_open(box, qid)


def test_while_the_plan_is_missing_the_card_stays_open(box):
    configure(box)
    import_profile(box, minutes_ago=60)
    qid = post_card(box)

    out = run(box, "plan-question-check")

    assert out["action"] == "none" and card_open(box, qid)
    assert answer_rows(box) == []


def test_a_card_the_user_answered_is_never_touched(box):
    configure(box)
    qid = post_card(box)
    answer(box, qid, "plus")
    configure(box, plan="pro")  # the plan written afterwards is not the card's business: the user's answer stands

    out = run(box, "plan-question-check")

    assert out["action"] != "closed"
    kept = stored_answer(box, qid)
    assert kept["scelte"] == ["plus"] and kept["origine"] == "utente" and len(answer_rows(box)) == 1


def test_no_card_asked_means_nothing_to_close(box):
    configure(box, plan="pro")

    out = run(box, "plan-question-check")

    assert out["action"] == "none" and answer_rows(box) == []


def test_a_card_for_another_provider_is_closed_with_i_do_not_know(box):
    configure(box)  # openai
    qid = post_card(box)
    configure(box, plan="max5", provider="claude")  # the provider changed: the card has no option for this plan

    out = run(box, "plan-question-check")

    assert out["action"] == "closed" and out["choice"] == ["unknown"]
    assert stored_answer(box, qid)["origine"] == "sistema"


# ── the other ways in ────────────────────────────────────────────────────────

def test_ask_plan_with_the_plan_declared_closes_the_card_and_says_so(box):
    configure(box)
    qid = post_card(box)
    configure(box, plan="pro")

    out = run(box, "ask-plan")

    assert out["ok"] and not out["asked"] and "declared" in out["reason"]
    assert out["closed_question"] == qid and not card_open(box, qid)
    assert len(questions(box)) == 1  # nothing new asked


def test_ask_plan_with_the_plan_declared_and_no_card_says_nothing_of_closing(box):
    configure(box, plan="pro")

    out = run(box, "ask-plan")

    assert out["ok"] and not out["asked"] and "closed_question" not in out


def test_begin_burst_closes_the_card_of_the_plan_it_starts_from(box):
    configure(box)
    qid = post_card(box)
    configure(box, plan="pro")

    out = run(box, "begin-burst")

    assert out["phase"] == "burst" and out["ok"]
    assert not card_open(box, qid) and stored_answer(box, qid)["scelte"] == ["pro"]


def test_a_card_that_cannot_be_closed_does_not_stop_the_burst(box, monkeypatch):
    configure(box)
    post_card(box)
    configure(box, plan="pro")
    import importlib.util

    spec = importlib.util.spec_from_file_location("first_run_t_burst", FIRST_RUN)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setenv("JHT_HOME", str(box.home))
    monkeypatch.setenv("JHT_DB", str(box.db))
    spec.loader.exec_module(module)

    def broken(now=None):
        raise RuntimeError("the database is locked")

    monkeypatch.setattr(module, "close_plan_question", broken)
    out = module.begin_burst()

    assert out["ok"] and out["phase"] == "burst"


# ── what the app and the agents see ──────────────────────────────────────────

def chat_page(box, agent: str = "capitano") -> dict:
    done = subprocess.run(
        [sys.executable, "-I", str(CHAT), "read", agent], capture_output=True, text=True, env=box.env, timeout=60
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return json.loads(done.stdout)


def test_the_app_shows_the_closed_card_as_answered_and_not_as_the_persons_choice(box):
    configure(box)
    qid = post_card(box)
    assert [q["state"] for q in chat_page(box)["questions"]] == ["open"]

    configure(box, plan="pro")
    run(box, "plan-question-check")

    (shown,) = chat_page(box)["questions"]
    assert shown["id"] == qid and shown["state"] == "answered"
    assert shown["answer"]["choices"] == ["pro"] and shown["answer"]["origin"] == "system"


def test_the_capitano_reads_the_closure_with_its_origin_and_it_is_not_an_invalid_row(box):
    configure(box)
    qid = post_card(box)
    configure(box, plan="pro")
    run(box, "plan-question-check")

    with sqlite3.connect(box.db, timeout=10) as conn:
        conn.row_factory = None
        found = aq.answers_for_agent(conn, "capitano", mark_seen=False)

    (item,) = found
    assert "invalid" not in item, item
    assert item["answer"]["origine"] == "sistema" and item["answer"]["scelte"] == ["pro"]
    assert "origine=sistema" in aq.render_answer(item["answer"], item["question"])


def test_the_closure_is_one_row_the_first_answer_wins_and_a_late_tap_is_refused(box):
    configure(box)
    qid = post_card(box)
    configure(box, plan="pro")
    run(box, "plan-question-check")

    with sqlite3.connect(box.db, timeout=10) as conn:
        late = aq.record_answer(conn, qid, ["plus"], canale="telegram")

    assert late.status == "already_answered" and late.answer["origine"] == "sistema"
    assert len(answer_rows(box)) == 1


# ── close_as_system, on its own ──────────────────────────────────────────────

def test_close_as_system_takes_the_first_option_the_question_has(box):
    configure(box)
    qid = post_card(box)

    with sqlite3.connect(box.db, timeout=10) as conn:
        done = aq.close_as_system(conn, qid, ["gold", "pro", "plus"], now=datetime(2026, 10, 28, 14, 30, tzinfo=timezone.utc))

    assert done.status == "recorded" and done.answer["scelte"] == ["pro"]
    assert done.answer["ts"].startswith("2026-10-28T14:30:00")


def test_close_as_system_refuses_what_the_question_does_not_offer_and_writes_nothing(box):
    configure(box)
    qid = post_card(box)

    with sqlite3.connect(box.db, timeout=10) as conn:
        with pytest.raises(aq.AnswerRejected) as nothing:
            aq.close_as_system(conn, qid, ["gold", "silver"])
        with pytest.raises(aq.AnswerRejected) as unknown:
            aq.close_as_system(conn, "aq:capitano:1-abc", ["pro"])

    assert nothing.value.code == "choice_unknown" and unknown.value.code == "question_unknown"
    assert answer_rows(box) == []


def test_close_as_system_leaves_an_answered_question_as_it_is(box):
    configure(box)
    qid = post_card(box)
    answer(box, qid, "unknown")

    with sqlite3.connect(box.db, timeout=10) as conn:
        done = aq.close_as_system(conn, qid, ["pro"])

    assert done.status == "already_answered" and done.answer["origine"] == "utente"
    assert len(answer_rows(box)) == 1


def test_the_origin_the_system_writes_is_one_the_module_lists_and_the_page_names():
    assert "sistema" in aq.ORIGINS


# ── when it cannot close ─────────────────────────────────────────────────────

def test_a_database_that_cannot_be_read_says_failed_and_the_card_is_not_touched(box):
    configure(box)
    qid = post_card(box)
    configure(box, plan="pro")
    box.db.write_bytes(b"this is not a database" * 100)

    out = run(box, "plan-question-check")

    assert out["action"] == "failed" and "not closed" in out["reason"]
    assert box.db.read_bytes().startswith(b"this is not a database")
    assert qid


def test_a_database_that_went_away_says_failed(box):
    configure(box)
    post_card(box)
    configure(box, plan="pro")
    box.db.unlink()

    assert run(box, "plan-question-check")["action"] == "failed"


# ── the watchdog says it ─────────────────────────────────────────────────────

def test_the_watchdog_logs_a_closed_card_and_does_not_count_it_as_a_failure(tmp_path):
    closed = _watchdog_function(
        tmp_path, '{\n  "action": "closed",\n  "question_id": "aq:capitano:1-x",\n  "choice": ["pro"]\n}'
    )

    assert closed.stdout.count("LOG plan question:") == 3 and "closed" in closed.stdout and "DONE-0" in closed.stdout
    assert "NOT posted" not in closed.stdout


def test_the_watchdog_function_names_the_closing_action():
    assert '"action": "closed"' in _net_function()


def test_the_net_closes_before_it_asks_whether_the_profile_is_imported():
    source = FIRST_RUN.read_text(encoding="utf-8")
    start = source.index("def plan_question_check")
    body = source[start : source.index("def main(")]

    assert body.index("close_plan_question(") < body.index("_profile_imported()")


# ── the loader of first_run.py leaves the modules of others alone ────────────

def _first_run_module(box, monkeypatch):
    import importlib.util

    monkeypatch.setenv("JHT_HOME", str(box.home))
    monkeypatch.setenv("JHT_DB", str(box.db))
    spec = importlib.util.spec_from_file_location("first_run_t_loader", FIRST_RUN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_loading_a_skill_does_not_replace_the_module_somebody_imported(box, monkeypatch):
    module = _first_run_module(box, monkeypatch)
    sentinel = object()
    monkeypatch.setitem(sys.modules, "agent_questions", sentinel)

    loaded = module._load_module("agent_questions", "agent_questions.py")

    assert loaded is not None and loaded is not sentinel and sys.modules["agent_questions"] is sentinel


def test_loading_a_skill_leaves_no_trace_in_the_modules_when_nobody_had_it(box, monkeypatch):
    module = _first_run_module(box, monkeypatch)
    monkeypatch.delitem(sys.modules, "agent_questions", raising=False)

    loaded = module._load_module("agent_questions", "agent_questions.py")

    assert loaded is not None and "agent_questions" not in sys.modules


# ── the tool the agent reads its answers with names the new origin ───────────

def test_the_header_of_the_reply_tool_names_the_origin_the_system_writes():
    text = (ROOT / "agents" / "_tools" / "jht-check-user-replies").read_text(encoding="utf-8")

    assert "origine=sistema" in text and "non e' una scelta dell'utente" in text


def test_the_app_lists_the_origin_in_rust_and_in_the_screen():
    rust = (ROOT / "desktop" / "src-tauri" / "src" / "direct_chat.rs").read_text(encoding="utf-8")
    cleaner = (ROOT / "desktop" / "src" / "pages" / "messages" / "chat-kinds.ts").read_text(encoding="utf-8")

    assert 'ANSWER_ORIGINS: [&str; 3] = ["user", "expiry", "system"]' in rust
    assert 'value.origin === "system"' in cleaner
