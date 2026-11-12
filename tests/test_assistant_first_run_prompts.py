"""The Assistant's first run, in the seven languages: what it must not announce, say or send when it is not true.

Three defects of a live run with a made-up CV: a button for the subscription plan announced and never posted (an API key has no
plan to ask), «in this first half hour» said after seven minutes, and the message that the profile is ready sent to a Capitano
that does not exist yet. The yes typed with a «go on» after it is tested in test_terminal_reply_answers_the_card.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["", ".it", ".de", ".es", ".fr", ".hu", ".pt"]


def assistant(lang: str) -> str:
    return (ROOT / "agents" / "assistente" / f"assistente{lang}.md").read_text(encoding="utf-8")


def profile_skill(lang: str) -> str:
    return (ROOT / "agents" / "_skills" / "profile-yaml" / f"SKILL{lang}.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistant_names_the_plan_card_only_after_it_is_posted_and_gives_no_time_from_memory(lang: str) -> None:
    text = assistant(lang)
    lines = [line for line in text.splitlines() if "`asked: true`" in line and "`ok: false`" in line and "`date`" in line]
    assert len(lines) == 1, f"assistente{lang}.md: the rule about announcing a card and an elapsed time is missing or repeated"


@pytest.mark.parametrize("lang", LANGS)
def test_the_message_that_the_profile_is_ready_to_a_missing_capitano_is_not_an_error(lang: str) -> None:
    text = profile_skill(lang)
    assert "[PROFILO-PRONTO]" in text
    tail = text.split("[PROFILO-PRONTO]", 1)[1]
    assert "`first_run.py status`" in tail and "`jht-tmux-send`" in tail, f"SKILL{lang}.md: the case of a Capitano that is not there yet"


@pytest.mark.parametrize("lang", LANGS)
def test_the_yes_the_assistant_tells_the_person_to_write_is_one_the_terminal_accepts(lang: str) -> None:
    sys_path = str(ROOT / "shared" / "skills")
    import sys

    sys.path.insert(0, sys_path)
    import agent_questions as aq

    text = profile_skill(lang)
    step5 = next(line for line in text.splitlines() if line.startswith("5. ") and "ask-confirm" in line)
    said = {".it": "conferma", ".de": "ja, speichern", ".es": "sí, guarda", ".fr": "oui, enregistre", ".hu": "igen, mentsd", ".pt": "sim, guarda", "": "confirm"}[lang]
    assert f"«{said}»" in step5 or f"„{said}“" in step5 or f"« {said} »" in step5 or f"„{said}”" in step5, step5[:300]
    assert aq._affirmative(said)
