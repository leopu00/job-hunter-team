"""The plan card comes AFTER the saved profile and goes to the chat where the person is.

TEST 17: the Capitano posted the plan card (`ask-plan`) right after the welcome, before the profile, in the
Capitano's chat, while the person was talking to the Assistente: no card there, and the Assistente told them
«the card is already in this chat», which was false. Now `ask-plan` posts nothing until the profile is saved
(the net's own rule), the card goes to the Assistente's chat while the person confirms their profile with it,
and every reply says whether the card is in the caller's chat (`in_your_chat`) so nobody points to the wrong one.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys

import pytest

from test_agent_questions import ROOT, aq, box, sql  # noqa: F401  (box is a fixture)
from test_plan_question_is_always_a_card import FIRST_RUN, configure, import_profile, questions, run, steady

LANGS = ("en", "it", "es", "fr", "de", "hu", "pt")
SUFFIX = {"en": "", "it": ".it", "es": ".es", "fr": ".fr", "de": ".de", "hu": ".hu", "pt": ".pt"}


def state(box) -> dict:
    return json.loads((box.home / "state" / "first-run.json").read_text(encoding="utf-8"))


def run_state(box) -> str:
    """The first-run state as the product reads it (it may not exist yet: then it is the default one)."""
    run(box, "status", profile=False)
    return (box.home / "state" / "first-run.json").read_text(encoding="utf-8")


def confirming_with_the_assistente(box) -> None:
    """The person confirmed their profile with the Assistente's card: that is the chat they are in."""
    directory = box.home / "state"
    directory.mkdir(exist_ok=True)
    (directory / "profile-confirm-card.json").write_text(
        json.dumps({"review_id": "r1", "question_id": "aq:assistente:1-abc", "cards": 1}), encoding="utf-8"
    )


# ── never before the profile ─────────────────────────────────────────────────

@pytest.mark.parametrize("agent", ["capitano", "assistente"])
def test_ask_plan_posts_nothing_before_the_profile_is_saved(box, agent: str):
    configure(box)

    out = run(box, "ask-plan", "--agent", agent, profile=False)

    assert out["ok"] is True and out["asked"] is False and out["wait_for_profile"] is True, out
    assert questions(box) == []
    assert "plan_question" not in json.loads(run_state(box))


def test_ask_plan_without_a_profile_is_not_an_error_for_the_caller(box):
    configure(box)

    done = subprocess.run([sys.executable, str(FIRST_RUN), "ask-plan"], capture_output=True, text=True, env=box.env, timeout=60)

    assert done.returncode == 0, done.stderr


def test_a_half_written_profile_is_not_a_saved_profile(box):
    configure(box)
    import_profile(box, content="name: Test Person\n")  # no target role: the product's own gate says not usable

    out = run(box, "ask-plan", profile=False)

    assert out["wait_for_profile"] is True and questions(box) == []


def test_once_the_profile_is_saved_the_same_call_posts_the_card(box):
    configure(box)
    run(box, "ask-plan", profile=False)
    import_profile(box)

    out = run(box, "ask-plan", profile=False)

    assert out["asked"] is True and len(questions(box)) == 1


def test_the_plan_declared_is_still_reported_before_the_profile(box):
    configure(box, plan="pro")

    out = run(box, "ask-plan", profile=False)

    assert out["ok"] is True and out["asked"] is False and "wait_for_profile" not in out and questions(box) == []


# ── the chat where the person is ─────────────────────────────────────────────

def test_while_the_person_confirms_with_the_assistente_the_capitanos_call_posts_in_the_assistentes_chat(box):
    configure(box)
    confirming_with_the_assistente(box)

    out = run(box, "ask-plan")  # the Capitano asks

    (card,) = questions(box)
    assert card["agent"] == "assistente" and out["agent"] == "assistente" and out["in_your_chat"] is False
    assert state(box)["plan_question"]["agent"] == "assistente"


def test_the_assistentes_own_call_says_the_card_is_in_its_chat(box):
    configure(box)
    confirming_with_the_assistente(box)

    out = run(box, "ask-plan", "--agent", "assistente")

    (card,) = questions(box)
    assert card["agent"] == "assistente" and out["agent"] == "assistente" and out["in_your_chat"] is True


def test_without_the_assistentes_confirmation_each_caller_gets_its_own_chat(box):
    configure(box)

    out = run(box, "ask-plan", "--agent", "assistente")

    (card,) = questions(box)
    assert card["agent"] == "assistente" and out["in_your_chat"] is True

    other = run(box, "ask-plan")  # the Capitano, with the card open
    assert other["asked"] is False and other["agent"] == "assistente" and other["in_your_chat"] is False


def test_the_capitano_without_the_confirmation_keeps_its_own_chat(box):
    configure(box)

    out = run(box, "ask-plan")

    (card,) = questions(box)
    assert card["agent"] == "capitano" and out["in_your_chat"] is True


def test_the_net_posts_in_the_assistentes_chat_too(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    confirming_with_the_assistente(box)

    out = run(box, "plan-question-check")

    (card,) = questions(box)
    assert out["action"] == "asked" and card["agent"] == "assistente" and state(box)["plan_question"]["asked_by"] == "net"


def test_once_the_first_run_is_over_the_old_confirmation_decides_nothing(box):
    configure(box)
    confirming_with_the_assistente(box)
    steady(box)

    run(box, "ask-plan")

    (card,) = questions(box)
    assert card["agent"] == "capitano"


# ── who has the open card, said for the caller ───────────────────────────────

def test_the_open_card_is_not_in_the_chat_of_the_assistente_when_the_capitano_has_it(box):
    configure(box)
    first = run(box, "ask-plan")

    again = run(box, "ask-plan", "--agent", "assistente")

    assert again["question_id"] == first["question_id"] and again["agent"] == "capitano" and again["in_your_chat"] is False


def test_the_open_card_is_in_the_chat_of_the_one_who_has_it(box):
    configure(box)
    first = run(box, "ask-plan", "--agent", "assistente")

    again = run(box, "ask-plan", "--agent", "assistente")

    assert again["question_id"] == first["question_id"] and again["in_your_chat"] is True


# ── the instructions, in seven languages ─────────────────────────────────────

def section(text: str) -> str:
    heading = r"^## (?:Subscription plan|Piano di abbonamento|Plan de suscripción|Formule d'abonnement|Abonnement|Előfizetési csomag|Plano de subscrição)[^\n]*\n"
    found = re.search(heading, text, re.M)
    assert found
    return text[found.start(): text.index("\n## ", found.end())]


@pytest.mark.parametrize("lang", LANGS)
def test_the_onboarding_skill_asks_the_plan_after_the_profile_and_points_to_the_right_chat(lang: str):
    body = section((ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8"))

    assert "wait_for_profile" in body and "in_your_chat" in body, lang
    assert "apply-confirmed" in body, lang  # «after the profile is saved» names the step that saves it
    assert "first two or three answers" not in body and "at the latest before" not in body, lang


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistente_prompt_never_says_this_chat_for_a_card_that_is_elsewhere(lang: str):
    text = (ROOT / "agents" / "assistente" / f"assistente{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    line = next(l for l in text.splitlines() if "first_run.py ask-plan --agent assistente" in l)

    assert "in_your_chat" in line and "wait_for_profile" in line, lang


@pytest.mark.parametrize("lang", LANGS)
def test_the_capitano_skill_does_not_ask_before_the_profile_and_knows_the_card_may_be_in_another_chat(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")

    assert "wait_for_profile" in text and text.count("in_your_chat") >= 2, lang  # the field, and the rule about «this chat»
