"""The Assistente has no name of its own, and asks a pending question once, not after every message.

The operator's own use of the 18c (the macOS gate): the Assistente invented a name for itself («Ava», then «Eva
works too») and asked «what's your full name?» again after every message that was not an answer. Nothing in the
prompt gave it a name, so it made one up; and the metronome of the onboarding («after every turn, ask the next
question on the first empty field») was the one rule that said what to do after a message that brought no
information: ask again.

The prompt now says it has no personal name, and the skill says what the metronome does not cover: a message that is
not the answer gets its own answer, without the question, which is taken up once, later.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SUFFIXES = ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]

# the words of the rule in each language: it names the product, and says «not the next reply»
NAME_HEADING = {
    "": "**Your name.**", ".it": "**Il tuo nome.**", ".es": "**Tu nombre.**", ".fr": "**Ton nom.**",
    ".de": "**Dein Name.**", ".hu": "**A neved.**", ".pt": "**O teu nome.**",
}
QUESTION_HEADING = {
    "": "**When the person does not answer, or changes the subject.**",
    ".it": "**Quando la persona non risponde o cambia argomento.**",
    ".es": "**Cuando la persona no responde o cambia de tema.**",
    ".fr": "**Quand la personne ne répond pas ou change de sujet.**",
    ".de": "**Wenn die Person nicht antwortet oder das Thema wechselt.**",
    ".hu": "**Amikor a személy nem válaszol, vagy témát vált.**",
    ".pt": "**Quando a pessoa não responde ou muda de assunto.**",
}
ONCE = {
    "": "ONCE", ".it": "UNA SOLA VOLTA", ".es": "UNA SOLA VEZ", ".fr": "UNE SEULE FOIS",
    ".de": "EINMAL", ".hu": "EGYSZER", ".pt": "UMA SÓ VEZ",
}


def _prompt(suffix: str) -> str:
    return (ROOT / "agents" / "assistente" / f"assistente{suffix}.md").read_text(encoding="utf-8")


def _skill(suffix: str) -> str:
    return (ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{suffix}.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_prompt_says_the_assistente_has_no_name_of_its_own_and_must_not_invent_one(suffix):
    text = _prompt(suffix)
    identity = text[text.index("## 🆔"): text.index("\n---", text.index("## 🆔"))]
    assert NAME_HEADING[suffix] in identity, "the rule is in the identity section, where the prompt says who it is"
    paragraph = [p for p in identity.split("\n\n") if p.startswith(NAME_HEADING[suffix])][0]
    # the two names it invented are the examples of what not to do, and the product's name is the one it uses
    assert "«Ava»" in paragraph or "„Ava“" in paragraph or "« Ava »" in paragraph or "„Ava”" in paragraph
    assert "Eva" in paragraph and "Job Hunter Team" in paragraph


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_skill_answers_a_message_that_is_not_an_answer_and_takes_the_question_back_once(suffix):
    text = _skill(suffix)
    assert QUESTION_HEADING[suffix] in text
    paragraph = [p for p in text.split("\n\n") if p.startswith(QUESTION_HEADING[suffix])][0]
    assert ONCE[suffix] in paragraph
    # it sits right after the metronome, and the rule of the metronome points to it
    metronome = text.index("```\n", text.index("```\n") + 4)
    assert text.index(QUESTION_HEADING[suffix]) > metronome
    assert text.index(QUESTION_HEADING[suffix]) - metronome < 1200


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_metronome_no_longer_forces_the_question_after_a_message_without_information(suffix):
    """The sentence «a reply without a next question only when the checklist is complete» has its exception
    now (in bold, in the paragraph just before the new rule)."""
    paragraphs = _skill(suffix).split("\n\n")
    at = next(i for i, p in enumerate(paragraphs) if p.startswith(QUESTION_HEADING[suffix]))
    assert "**" in paragraphs[at - 1], paragraphs[at - 1]
