"""The plan is asked ONLY with `first_run.py ask-plan`, by any agent, the Assistente included.

TEST 16: after the person pressed «Confirm and save» the Assistente asked the plan with
`jht-notify-user --kind question` and free text («which Codex plan do you use?»). That question did not show in the
Messages, only in the Agents panel, and the person waited three minutes. The one way to ask the plan is the card
`ask-plan` posts; it takes the chat of the agent the person is talking to (`--agent assistente`), it never posts a
second card while one is open, whoever posted it, and it says which agent has the open one.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from test_agent_questions import ROOT, aq, box, sql  # noqa: F401  (box is a fixture)
from test_plan_question_is_always_a_card import FIRST_RUN, answer, configure, import_profile, questions, run

LANGS = ("en", "it", "es", "fr", "de", "hu", "pt")
SUFFIX = {"en": "", "it": ".it", "es": ".es", "fr": ".fr", "de": ".de", "hu": ".hu", "pt": ".pt"}
COMMAND = "python3 /app/shared/skills/first_run.py ask-plan --agent assistente"
ONLY = {"en": "ONLY", "it": "SOLO", "es": "SOLO", "fr": "SEULEMENT", "de": "NUR", "hu": "CSAK", "pt": "SÓ"}
TOPIC = {
    "en": "The subscription plan", "it": "Il piano di abbonamento", "es": "El plan de suscripción",
    "fr": "La formule d'abonnement", "de": "Das Abonnement", "hu": "Az előfizetési csomag", "pt": "O plano de subscrição",
}


def state(box) -> dict:
    return json.loads((box.home / "state" / "first-run.json").read_text(encoding="utf-8"))


# ── the card goes to the chat of the agent the person is in ──────────────────

def test_the_assistente_asks_the_plan_with_a_card_in_its_own_chat(box):
    configure(box)

    out = run(box, "ask-plan", "--agent", "assistente")

    assert out["ok"] and out["asked"], out
    (card,) = questions(box)
    assert card["agent"] == "assistente" and card["id"] == out["question_id"]
    assert [o["id"] for o in card["payload"]["opzioni"]] == ["plus", "pro", "pro_max", "unknown"]
    assert state(box)["plan_question"]["agent"] == "assistente"


def test_without_an_agent_the_card_is_the_capitanos_as_before(box):
    configure(box)

    run(box, "ask-plan")

    (card,) = questions(box)
    assert card["agent"] == "capitano" and state(box)["plan_question"]["agent"] == "capitano"


def test_an_agent_that_is_not_one_the_person_talks_to_is_refused(box):
    configure(box)

    import subprocess, sys

    done = subprocess.run([sys.executable, str(FIRST_RUN), "ask-plan", "--agent", "scout"], capture_output=True, text=True, env=box.env, timeout=60)

    assert done.returncode == 2 and "invalid choice" in done.stderr and questions(box) == []


def test_the_function_refuses_such_an_agent_too_and_posts_nothing(box, monkeypatch):
    configure(box)
    import importlib.util

    spec = importlib.util.spec_from_file_location("first_run_t_asker", FIRST_RUN)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setenv("JHT_HOME", str(box.home))
    monkeypatch.setenv("JHT_DB", str(box.db))
    spec.loader.exec_module(module)

    out = module.ask_plan(agent="mentor")

    assert out["ok"] is False and out["asked"] is False and questions(box) == []


# ── one question about the plan, whoever asked ───────────────────────────────

def test_the_assistente_makes_no_second_card_when_the_capitano_has_one_open_and_says_who_has_it(box):
    configure(box)
    first = run(box, "ask-plan")

    again = run(box, "ask-plan", "--agent", "assistente")

    assert again["ok"] and again["asked"] is False
    assert again["question_id"] == first["question_id"] and again["agent"] == "capitano"
    assert len(questions(box)) == 1


def test_the_capitano_makes_no_second_card_when_the_assistente_has_one_open(box):
    configure(box)
    first = run(box, "ask-plan", "--agent", "assistente")

    again = run(box, "ask-plan")

    assert again["asked"] is False and again["question_id"] == first["question_id"] and again["agent"] == "assistente"
    assert len(questions(box)) == 1


def test_a_card_posted_before_the_agent_was_recorded_counts_as_the_capitanos(box):
    configure(box)
    first = run(box, "ask-plan")
    saved = state(box)
    del saved["plan_question"]["agent"]  # a state written by the previous version
    (box.home / "state" / "first-run.json").write_text(json.dumps(saved), encoding="utf-8")

    again = run(box, "ask-plan", "--agent", "assistente")

    assert again["asked"] is False and again["agent"] == "capitano" and again["question_id"] == first["question_id"]


def test_after_an_i_do_not_know_the_assistente_asks_again_only_after_the_hour(box):
    configure(box)
    first = run(box, "ask-plan", "--agent", "assistente")
    answer(box, first["question_id"], "unknown")

    soon = run(box, "ask-plan", "--agent", "assistente")

    assert soon["asked"] is False and 3000 < soon["seconds_left"] <= 3600 and len(questions(box)) == 1


# ── the answer to the Assistente's card declares the plan, and closing works for its card ──

def test_the_answer_to_the_assistentes_card_is_written_by_the_net_when_nobody_wrote_it(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    first = run(box, "ask-plan", "--agent", "assistente")
    answer(box, first["question_id"], "pro")

    done = run(box, "plan-question-check", "--after", "0")

    assert done["action"] == "declared" and done["plan"] == "pro"
    assert json.loads((box.home / "jht.config.json").read_text())["providers"]["openai"]["plan"] == "pro"


def test_the_plan_declared_in_the_chat_closes_the_assistentes_card(box):
    configure(box)
    first = run(box, "ask-plan", "--agent", "assistente")
    configure(box, plan="pro")

    out = run(box, "plan-question-check")

    assert out["action"] == "closed" and out["question_id"] == first["question_id"]


# ── the instructions: one way, in seven languages ────────────────────────────

@pytest.mark.parametrize("lang", LANGS)
def test_the_onboarding_skill_asks_the_plan_only_with_the_card(lang: str):
    text = (ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    front = next(l for l in text.splitlines() if l.startswith("allowed-tools:"))
    heading = r"^## (?:Subscription plan|Piano di abbonamento|Plan de suscripción|Formule d'abonnement|Abonnement|Előfizetési csomag|Plano de subscrição)[^\n]*\n"
    section = re.search(heading, text, re.M)
    assert section, lang
    body = text[section.start(): text.index("\n## ", section.end())]

    assert body.count(COMMAND) >= 2, lang  # the rule at the top and the step that runs it
    assert "plan_registry.py get" in body and "set codex:<id>" in body
    assert "--kind question" not in body and "--kind question" not in text.split("## ")[0], lang
    assert "ask-plan *" in front and "plan_registry.py list" not in front and "plan_registry.py list" not in text
    assert "jht-notify-user" in body  # named only to say it is not the way
    for status in ("asked: true", "asked: false", "question_id", "capitano"):
        assert status in body, (lang, status)


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistente_prompt_says_the_plan_is_asked_only_with_the_card(lang: str):
    text = (ROOT / "agents" / "assistente" / f"assistente{SUFFIX[lang]}.md").read_text(encoding="utf-8")

    line = next(l for l in text.splitlines() if COMMAND in l)
    assert line.startswith("- ") and "jht-notify-user" in line and "onboarding-flow" in line
    assert ONLY[lang] in line, (lang, line)


@pytest.mark.parametrize("lang", LANGS)
def test_after_the_profile_is_saved_the_plan_is_asked_with_the_card_and_never_as_text(lang: str):
    text = (ROOT / "agents" / "_skills" / "profile-yaml" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    step = next(l for l in text.splitlines() if l.startswith("4. ") and "apply-confirmed" in l)

    assert "PLAN_MISSING" in step and "first_run.py ask-plan --agent assistente" in step


@pytest.mark.parametrize("lang", LANGS)
def test_the_notification_skill_lists_the_plan_among_what_it_is_not_for(lang: str):
    text = (ROOT / "agents" / "_skills" / "notify-user" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    before_usage = text[: text.index("```")]

    assert "first_run.py ask-plan" in before_usage
    assert any(l.startswith(f"- ❌ {TOPIC[lang]}") and "first_run.py ask-plan" in l and ONLY[lang] in l
               for l in before_usage.splitlines()), lang
