"""A `$` in a message between agents arrives whole: `jht-tmux-send SESSION -` takes the message from stdin.

Between double quotes the shell reads `$1`..`$9` as its own arguments and replaces them with nothing before the
transport starts, so "budget $120k" reached the other agent as "budget 20k" and an order changed. The transport
cannot undo that: it can take the message from stdin, where a quoted heredoc leaves every `$` alone, and the skill
tells the agents so. A message whose last line is `TXT` (an indented closing line: the heredoc never closed) is
refused, and nothing is typed in the other agent's box.

The transport runs against the fake `tmux` of `test_tmux_send_delivery_proof.py`: what the other agent finally reads
is the conversation of the fake pane.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from test_tmux_send_delivery_proof import FAKE_TMUX, TRANSPORT, box  # noqa: F401  (box is a fixture)

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]
ORDER = "[@capitano -> @scout-1] [MSG] Budget: $120k, bonus $10k, floor $5"
# the transport adds a mark to the envelope of a sender it cannot verify: what the other agent reads after it
ORDER_TAIL = "[MSG] Budget: $120k, bonus $10k, floor $5"
CLOSINGS = ["   TXT", "\tTXT", "TXT   "]  # a copied indent of 3 spaces, a tab, trailing spaces


def _bash(box, script: str) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "FT": str(box.state),
        "PATH": f"{box.state.parent / 'bin'}:{Path(sys.executable).parent}:/usr/bin:/bin",
        "JHT_HOME": str(box.home),
        "JHT_TMUX_PROMPT_WAIT": "0",
        "JHT_TMUX_TEXT_WAIT": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    for name in ("TMUX", "JHT_TMUX_SEND_FROM", "JHT_TMUX_FOREIGN_WAIT"):
        env.pop(name, None)
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=120, env=env)


def _read(box) -> str:
    return (box.state / "transcript").read_text(encoding="utf-8") if (box.state / "transcript").exists() else ""


def test_double_quotes_do_eat_the_digits_after_a_dollar():
    done = subprocess.run(["bash", "-c", f'set --; printf %s "{ORDER}"'], capture_output=True, text=True)
    assert done.stdout == "[@capitano -> @scout-1] [MSG] Budget: 20k, bonus 0k, floor "


def test_the_message_from_stdin_keeps_every_dollar(box):
    done = _bash(box, f"{TRANSPORT} CAPITANO - <<'TXT'\n{ORDER}\nTXT\n")

    assert done.returncode == 0, done.stderr
    assert ORDER_TAIL in _read(box)
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_message_with_an_apostrophe_and_a_dollar_goes_in_whole(box):
    # one line: the fake pane draws a box around the composer and cannot show a message of several lines
    body = "[@capitano -> @scout-1] [MSG] Don't stop at $20/h, $100 is the ceiling."
    done = _bash(box, f"{TRANSPORT} CAPITANO - <<'TXT'\n{body}\nTXT\n")

    assert done.returncode == 0, done.stderr
    assert "Don't stop at $20/h, $100 is the ceiling." in _read(box)


def test_single_quotes_keep_the_dollar_too(box):
    done = _bash(box, f"{TRANSPORT} CAPITANO '{ORDER}'")

    assert done.returncode == 0, done.stderr
    assert ORDER_TAIL in _read(box)


def test_words_after_the_session_are_still_the_message(box):
    # only a lone "-" means stdin: a dash among the words of a message is the message
    done = _bash(box, f"{TRANSPORT} CAPITANO '[@capitano -> @scout-1] [MSG] ready' - 3 positions")

    assert done.returncode == 0, done.stderr
    assert "ready - 3 positions" in _read(box)


@pytest.mark.parametrize("stdin", ["", "\n", "  \n\n"])
def test_an_empty_stdin_delivers_nothing(box, stdin: str):
    done = subprocess.run(
        [str(TRANSPORT), "CAPITANO", "-"], input=stdin, capture_output=True, text=True, timeout=60,
        env={**os.environ, "FT": str(box.state), "PATH": f"{box.state.parent / 'bin'}:{Path(sys.executable).parent}:/usr/bin:/bin"},
    )

    assert done.returncode == 1
    assert "vuoto" in done.stderr
    assert box.typed() == [] and box.keys("Enter") == []


@pytest.mark.parametrize("closing", CLOSINGS)
def test_a_message_that_ends_in_the_delimiter_line_delivers_nothing(box, closing: str):
    done = subprocess.run(
        [str(TRANSPORT), "CAPITANO", "-"], input=f"{ORDER}\n{closing}\n", capture_output=True, text=True, timeout=60,
        env={**os.environ, "FT": str(box.state), "PATH": f"{box.state.parent / 'bin'}:{Path(sys.executable).parent}:/usr/bin:/bin"},
    )

    assert done.returncode == 1
    assert "TXT" in done.stderr and "non consegno" in done.stderr.lower()
    assert box.typed() == [] and box.keys("Enter") == []


def test_an_indented_closing_line_in_a_real_heredoc_delivers_nothing(box):
    done = _bash(box, f"{TRANSPORT} CAPITANO - <<'TXT'\n{ORDER}\n   TXT\n")

    assert done.returncode == 1
    assert box.typed() == []


def test_a_message_that_only_names_txt_is_delivered(box):
    done = _bash(box, f"{TRANSPORT} CAPITANO - <<'TXT'\n[@capitano -> @scout-1] [MSG] Save the TXT file, TXT is plain text.\nTXT\n")

    assert done.returncode == 0, done.stderr
    assert "Save the TXT file, TXT is plain text." in _read(box)


@pytest.mark.parametrize("suffix", LANGUAGES)
def test_every_language_of_the_skill_says_how_to_write_a_dollar(suffix: str):
    text = (ROOT / "agents" / "_skills" / "tmux-send" / f"SKILL{suffix}.md").read_text(encoding="utf-8")

    assert "jht-tmux-send SCOUT-2 - <<'TXT'" in text
    assert "`$1`" in text and "`$2`" in text
    assert "`TXT`" in text  # the closing line in the first column, with no spaces before it
