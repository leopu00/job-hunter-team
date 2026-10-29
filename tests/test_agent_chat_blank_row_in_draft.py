"""A draft that holds an empty row is still the composer's text (TEST 19f, 29/10, the Assistente).

The Doctor's message «[UNBLOCK] CAPITANO is idle…» sat in the Assistente's composer, unsent. Codex drew it as a long row, an EMPTY
row, the rest of the sentence, an empty row and the model line. The reader ended a wrapped draft at the first empty row, so it
found no composer at all («none»): the transport could not prove the text its own (no Enter for it, ever), and the wake of the
card was refused as «blocked». The screen below is the tail of the capture taken then; the message is the same one."""

from __future__ import annotations

import hashlib
import importlib.util
import sys
import time
from pathlib import Path

import pytest

from test_agent_chat_answer_wake import WAKE, chat, remember_pasted, terminal  # noqa: F401  (chat is a fixture)

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
HEAD = ("[@dottore -> @assistente] [UNBLOCK] CAPITANO is idle and has gone silent while no operative worker sessions are present. "
        "Please monitor the user channel and help restore coordination if a human decision is pending; do")
TAIL = "not wait on the Captain before handling user-facing requests."
MESSAGE = f"{HEAD} {TAIL}"
RULE = "─ Worked for 2m 06s " + "─" * 150
FOOTER = "  gpt-5.6-terra high · ~/agents/assistente"
REAL = f"• I've prepared your profile from the CV.\n\n{RULE}\n\n\n› {HEAD}\n\n  {TAIL}\n\n{FOOTER}\n"


CAPITANO_RES = ("[@capitano -> @assistente] [RES] Profile readiness confirmed. first_run begin-burst is open and the plan card is "
                "in your chat; do not ask again.")
CAPITANO_TAIL = "Relay the user's exact selection so I can record the plan and start the team."
PLAN_OFFER = "  Create a plan?  shift + tab use Plan mode   esc dismiss"
# The second capture of the same run (an agent's message, the «Create a plan?» offer as footer): same shape.
SECOND = f"• Waiting.\n\n{RULE}\n\n\n› {CAPITANO_RES}\n\n  {CAPITANO_TAIL}\n\n{PLAN_OFFER}\n"


def module(name: str):
    if str(SKILLS) not in sys.path:
        sys.path.insert(0, str(SKILLS))
    spec = importlib.util.spec_from_file_location(f"{name}_blank_row", SKILLS / f"{name}.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_the_draft_with_an_empty_row_in_it_is_the_composers_text():
    reader = module("agent_chat")
    assert reader.composer_text(REAL) == f"{HEAD}{TAIL}"
    assert reader.delivery_gate(REAL) == "text"


def test_the_message_is_signed_text_only_when_the_transport_remembers_pasting_it():
    reader, composer = module("agent_chat"), module("tmux_send_composer")
    text = reader.composer_text(REAL)
    assert composer.signed_only(text) is False                       # nobody remembers it: it may be a person's
    sha = hashlib.sha256("".join(MESSAGE.split()).encode()).hexdigest()
    assert composer.signed_only(text, None, composer.fingerprints_known([f"{int(time.time())} {sha}"], time.time(), 86400)) is True


def test_the_wake_goes_in_behind_the_message_in_the_real_shape(chat, monkeypatch):  # noqa: F811
    remember_pasted(chat, MESSAGE)
    term = terminal(chat, monkeypatch, [REAL], flush="refuses")
    assert chat._wake_attempt("assistente", "ASSISTENTE") == "sent"
    assert term.typed == [WAKE.replace("capitano", "assistente")]


def test_a_person_s_draft_of_the_same_shape_is_still_left_alone(chat, monkeypatch):  # noqa: F811
    term = terminal(chat, monkeypatch, [REAL], flush="refuses")
    assert chat._wake_attempt("assistente", "ASSISTENTE") == "text"
    assert term.typed == []


@pytest.mark.parametrize("pane", [
    # an empty composer, a model line, nothing else
    f"• Done.\n\n› \n\n{FOOTER}\n",
    # a short row with a hint under it after a blank row: not wide enough to be a wrapped draft
    f"• Done.\n\n› write\n\n  not a draft but a note\n\n{FOOTER}\n",
])
def test_the_blank_row_rule_does_not_invent_text(pane):
    reader = module("agent_chat")
    assert reader.composer_text(pane) in (None, "", "write")


def test_a_menu_under_a_long_row_with_a_blank_row_is_not_a_draft():
    reader = module("agent_chat")
    pane = f"{RULE}\n\n› 1. {HEAD}\n\n  2. {TAIL}\n\n  Press enter to confirm or esc to go back\n"
    assert reader.delivery_gate(pane) != "text"


def test_the_second_capture_of_the_run_an_agents_message_over_the_plan_offer_is_read_the_same_way():
    reader = module("agent_chat")
    assert reader.composer_text(SECOND) == f"{CAPITANO_RES}{CAPITANO_TAIL}"
    assert reader.delivery_gate(SECOND) == "text"


def test_the_wake_goes_in_behind_the_second_message_too(chat, monkeypatch):  # noqa: F811
    remember_pasted(chat, f"{CAPITANO_RES} {CAPITANO_TAIL}")
    term = terminal(chat, monkeypatch, [SECOND], flush="refuses")
    assert chat._wake_attempt("assistente", "ASSISTENTE") == "sent"
    assert term.typed == [WAKE.replace("capitano", "assistente")]
