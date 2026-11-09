"""agent_chat reads the composer of Pi's TUI: empty, a draft, a turn running, and what is NOT Pi's."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared/skills"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent_chat
from pi_screens import FOLDER, RULE, TOTALS, WORKING, screen


def test_an_empty_composer_at_rest():
    pane = screen()
    assert agent_chat.composer_snapshot(pane) == ("empty", False)
    assert agent_chat.composer_state(pane) == "empty"
    assert agent_chat.delivery_gate(pane) == "empty"
    assert agent_chat.prompt_state(pane) == "ready"
    assert agent_chat.composer_text(pane) == ""


def test_a_draft_is_text_and_is_read_whole():
    pane = screen(["[@capitano -> @scout-1] [MSG] prova", "seconda riga di bozza"])
    assert agent_chat.composer_snapshot(pane) == ("text", False)
    assert agent_chat.delivery_gate(pane) == "text"
    assert agent_chat.composer_text(pane) == "[@capitano -> @scout-1] [MSG] provaseconda riga di bozza"


def test_a_turn_running_is_busy_and_an_empty_composer_under_it_is_still_safe_to_paste_into():
    pane = screen(busy=True, above=["", " Rispondi solo con la parola: uno", ""])
    assert agent_chat.composer_snapshot(pane) == ("empty", True)
    assert agent_chat.delivery_gate(pane) == "empty"
    assert agent_chat.prompt_state(pane) == "busy"
    typed = screen(["a bozza"], busy=True)
    assert agent_chat.composer_snapshot(typed) == ("text", True)


def test_the_screen_with_the_escape_codes_of_capture_pane_dash_e_reads_the_same():
    pane = screen(["bozza"]).replace(RULE, "\x1b[38;5;240m" + RULE + "\x1b[0m").replace(TOTALS, "\x1b[2m" + TOTALS + "\x1b[0m")
    assert agent_chat.composer_snapshot(pane) == ("text", False)


@pytest.mark.parametrize("totals", [
    "0.0%/272k (auto)                                         gpt-5.6-terra • low",
    "?/272k (auto)                                            gpt-5.6-terra • low",
    "↑1.7k ↓237 R13k $0.006 100.0%/8192                        local-model • off",
    "↑12k ↓3k $0.41 12.5%/1.0M (auto)                          some-model • high",
])
def test_the_totals_row_in_its_forms(totals):
    assert agent_chat.composer_snapshot(screen(["x"], totals=totals)) == ("text", False)


def test_the_folder_row_may_be_followed_by_a_row_of_an_extension_and_may_be_missing_none_of_them():
    assert agent_chat.composer_snapshot(screen(["x"], folder=(FOLDER, "main", "mcp: 3 servers"))) == ("text", False)
    assert agent_chat.composer_snapshot(screen(["x"], folder=())) == ("text", False)


def test_a_long_draft_taller_than_the_tail_is_still_text():
    rows = [f"riga {n} della bozza" for n in range(20)]
    assert agent_chat.composer_snapshot(screen(rows)) == ("text", False)
    assert agent_chat.composer_text(screen(rows)).endswith("riga 19 della bozza")


def test_a_rule_in_the_conversation_above_is_not_the_composers():
    above = ["", " risposta del modello", RULE, " un'altra riga", ""]
    assert agent_chat.composer_snapshot(screen(["x"], above=above)) == ("text", False)
    assert agent_chat.composer_snapshot(screen(above=above)) == ("empty", False)


@pytest.mark.parametrize("pane", [
    # no totals row at the bottom: a menu or a list drawn under the draft, or the footer cut off
    "\n".join(["", RULE, "", RULE, "  1. Yes", "  2. No"]) + "\n",
    "\n".join(["", RULE, "testo", RULE, FOLDER]) + "\n",
    # a bare shell
    "user@host ~ $ \n",
    # the totals row alone, no rules around a composer
    "\n".join(["qualcosa", FOLDER, TOTALS]) + "\n",
    # two rules with nothing between them
    "\n".join(["", RULE, RULE, FOLDER, TOTALS]) + "\n",
])
def test_what_is_not_pis_composer_is_left_to_the_other_readers(pane):
    assert agent_chat.agent_chat_pi.screen(pane, agent_chat.strip_terminal_codes, 15)[1] is None
    assert agent_chat.composer_snapshot(pane)[0] == "none"


def test_a_claude_box_and_a_codex_composer_are_still_theirs():
    claude = "\n".join(["╭" + "─" * 46 + "╮", "│ ❯ ciao │", "╰" + "─" * 46 + "╯", "  ? for shortcuts"]) + "\n"
    codex = "\n".join(["› ciao", "", "  gpt-5.6-sol high · ~/agents/capitano"]) + "\n"
    assert agent_chat.agent_chat_pi.screen(claude, agent_chat.strip_terminal_codes, 15)[1] is None and agent_chat.composer_snapshot(claude) == ("text", False)
    assert agent_chat.agent_chat_pi.screen(codex, agent_chat.strip_terminal_codes, 15)[1] is None and agent_chat.composer_snapshot(codex)[0] == "text"


def test_the_label_of_the_top_rule_is_busy_only_for_a_turn():
    # the editor scrolls with an arrow in the rule: not a turn
    scrolled = "── ↑ 3 more " + "─" * 100
    assert agent_chat.composer_snapshot(screen(["x"], top=scrolled)) == ("text", False)
    assert agent_chat.composer_snapshot(screen(["x"], top=WORKING)) == ("text", True)


from pi_screens import LOGIN, NO_KEY, RETRYING, TRUST, selector  # noqa: E402


@pytest.mark.parametrize("rows", [LOGIN, TRUST], ids=["login", "trust"])
def test_a_selector_in_place_of_the_composer_is_a_menu_nothing_is_pasted_into(rows):
    pane = selector(rows)
    assert agent_chat.agent_chat_pi.menu(pane)
    assert agent_chat.delivery_gate(pane) == "blocked"
    assert agent_chat.composer_snapshot(pane)[0] == "none"
    assert agent_chat.prompt_state(pane) == "not_at_prompt"


def test_a_selector_below_an_old_rule_is_not_taken_for_a_composer():
    """The conversation above may hold a rule: two rules with the choices between them are not a draft."""
    pane = selector(LOGIN, above=["", RULE, " una riga della conversazione", ""])
    assert agent_chat.composer_snapshot(pane)[0] == "none"
    assert agent_chat.delivery_gate(pane) == "blocked"


def test_the_composer_after_a_selector_closed_is_a_composer_again():
    """Escape brings back the prompt with the error still on screen."""
    pane = screen(above=STARTUP_WITH_ERROR)
    assert agent_chat.delivery_gate(pane) == "empty"


def test_the_error_of_a_pi_that_is_not_logged_in_leaves_a_free_prompt_and_no_turn():
    pane = screen(above=NO_KEY)
    assert agent_chat.composer_snapshot(pane) == ("empty", False)


def test_the_retry_of_a_rate_limit_is_a_turn_running():
    assert agent_chat.composer_snapshot(screen(top=RETRYING)) == ("empty", True)
    assert agent_chat.prompt_state(screen(top=RETRYING)) == "busy"


STARTUP_WITH_ERROR = NO_KEY
