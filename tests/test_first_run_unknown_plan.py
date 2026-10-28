"""«I do not know» on the card about the plan does not leave the first run waiting for ever.

`begin_burst` refused to open without a declared plan, and the card comes back after an hour at most three times:
a person who could not name their plan had a team that never started, with no error and nowhere in the app to
declare it. Now the burst opens as a SLOW START (one worker per role, the smallest first pass and goal, the lowest
tier's formation), says so in the person's language, and speeds up when the plan is declared. A plan nobody was asked
for, a card still open, an answer that names a plan, or a card for another provider are not that answer: the
first run still waits for the plan, as before."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from test_agent_questions import ROOT, box  # noqa: F401  (box is a fixture)
from test_plan_question_is_always_a_card import answer, configure, import_profile, questions, run

SKILL = ROOT / "agents" / "_skills" / "first-run-burst"
LANGS = ("", ".it", ".es", ".fr", ".de", ".hu", ".pt")


def asked_and_unknown(box, provider: str = "openai") -> str:
    configure(box, provider=provider)
    out = run(box, "ask-plan")
    assert out["asked"], out
    answer(box, out["question_id"], "unknown")
    return out["question_id"]


def test_without_an_answer_the_first_run_still_waits_for_the_plan(box):
    configure(box)
    refused = run(box, "begin-burst")
    assert refused["ok"] is False and "hint" in refused
    run(box, "ask-plan")                                 # the card is open, nobody answered
    assert run(box, "begin-burst")["ok"] is False
    assert run(box, "status")["phase"] == "awaiting_profile"


def test_an_i_do_not_know_opens_a_slow_start_with_the_smallest_formation(box):
    asked_and_unknown(box)
    out = run(box, "begin-burst", lang="it")
    assert out["ok"] and out["prudent"] and out["plan_unknown"] and out["phase"] == "burst", out
    assert out["roster"] == {"scout": 1, "analista": 1, "scorer": 1}
    assert out["scout_cap_first_pass"] == 8 and out["target_scored"] == 4
    assert out["plan"]["plan"] == "unknown" and out["plan"]["weekly_capped"] is True
    assert out["say"] == "Parto piano; quando sai il tuo piano, dimmelo e acceleriamo."
    status = run(box, "status")
    assert status["phase"] == "burst" and status["plan_unknown"] is True
    assert "plan_missing" not in status, "a slow start the person chose is not a plan that went missing"


def test_a_second_begin_burst_changes_nothing_while_the_plan_is_not_known(box):
    asked_and_unknown(box)
    first = run(box, "begin-burst")
    again = run(box, "begin-burst")
    assert again["roster"] == first["roster"] and again["burst_started_at"] == first["burst_started_at"]
    assert "slow start" in again["note"] and "upgraded" not in again


def test_when_the_plan_is_declared_the_burst_speeds_up_and_keeps_its_start(box):
    asked_and_unknown(box)
    first = run(box, "begin-burst")
    configure(box, plan="pro")
    out = run(box, "begin-burst")
    assert out["ok"] and out["upgraded"] is True and out["plan_unknown"] is False, out
    assert out["plan"]["plan"] == "pro"
    assert sum(out["roster"].values()) > 3 and out["target_scored"] > first["target_scored"]
    assert out["burst_started_at"] == first["burst_started_at"] and out["scored_at_start"] == first["scored_at_start"]
    assert "sped_up_at" in out
    # and it stays a normal burst from now on
    later = run(box, "begin-burst")
    assert later["note"] == "burst already in progress" and "upgraded" not in later


def test_an_answer_that_names_a_plan_is_not_an_i_do_not_know(box):
    configure(box)
    out = run(box, "ask-plan")
    answer(box, out["question_id"], "pro")
    refused = run(box, "begin-burst")
    assert refused["ok"] is False, "the plan the person chose is written by the net, not guessed here"


def test_a_card_for_another_provider_says_nothing_about_this_one(box):
    asked_and_unknown(box, provider="openai")
    configure(box, provider="kimi")
    assert run(box, "begin-burst")["ok"] is False


def test_the_card_still_comes_back_during_a_slow_start(box):
    """The slow start is not the end of asking: the net asks again after the hour, and the plan declared then speeds it up."""
    asked_and_unknown(box)
    run(box, "begin-burst")
    waiting = run(box, "plan-question-check")
    assert waiting["action"] in {"waiting", "none"}, waiting      # not before the hour
    assert run(box, "status")["phase"] == "burst"


@pytest.mark.parametrize("lang, start", [
    ("en", "I am starting slowly"), ("it", "Parto piano"), ("de", "Ich fange langsam an"), ("es", "Empiezo despacio"),
    ("fr", "Je démarre doucement"), ("hu", "Lassan indulok"), ("pt", "Começo devagar"),
])
def test_the_sentence_is_in_the_language_of_the_person(box, lang, start):
    asked_and_unknown(box)
    out = run(box, "begin-burst", lang=lang)
    assert out["say"].startswith(start) and out["say"].endswith("."), out["say"]
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    assert out["say"] == catalog["plan.start_slow"] and catalog["plan.prudent_label"]


@pytest.mark.parametrize("lang", LANGS)
def test_the_captain_is_told_what_to_say_and_how_to_speed_up_in_every_language(lang):
    text = (SKILL / f"SKILL{lang}.md").read_text(encoding="utf-8")
    assert text.count("`prudent: true`") == 1 and text.count("`upgraded: true`") == 1
    assert "`say`" in text and "plan_registry.py set <provider>:<id>" in text


def test_a_plan_declared_by_hand_during_a_slow_start_speeds_the_team_up_from_the_watchdog(box):
    """Nobody calls begin-burst for a burst that already runs: the watchdog's check does it, once."""
    asked_and_unknown(box)
    first = run(box, "begin-burst")
    configure(box, plan="pro")
    out = run(box, "plan-question-check")
    assert out["action"] == "sped_up" and out["plan"] == "pro", out
    status = run(box, "status")
    assert status["plan_unknown"] is False and status["roster"] == out["roster"] and sum(out["roster"].values()) > 3
    assert status["burst_started_at"] == first["burst_started_at"] and "sped_up_at" in status
    assert run(box, "plan-question-check")["action"] != "sped_up", "idempotent: a burst that is not slow is left alone"
    assert run(box, "status")["sped_up_at"] == status["sped_up_at"]


def test_the_card_that_comes_back_in_a_slow_start_and_is_answered_with_a_plan_speeds_the_team_up(box):
    """The family of the 18c run: the net wrote the plan and nobody told the team."""
    asked_and_unknown(box)
    run(box, "begin-burst")
    again = run(box, "plan-question-check", "--reask", "0")
    assert again["action"] == "asked", again
    answer(box, again["question_id"], "pro")
    declared = run(box, "plan-question-check", "--after", "0", "--reask", "0")
    assert declared["action"] == "declared" and declared["plan"] == "pro", declared
    status = run(box, "status")
    assert status["plan_unknown"] is False and status["plan"]["plan"] == "pro" and sum(status["roster"].values()) > 3, status


def test_a_slow_start_without_a_declared_plan_is_not_sped_up(box):
    asked_and_unknown(box)
    run(box, "begin-burst")
    assert run(box, "plan-question-check")["action"] != "sped_up"
    assert run(box, "status")["plan_unknown"] is True
