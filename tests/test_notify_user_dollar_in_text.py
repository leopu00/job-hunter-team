"""A `$` in the text of a message to the user arrives whole.

Between double quotes the shell reads `$1` and `$2` as its own arguments and replaces them with nothing
before `jht-notify-user` starts, so "Plus — $20/month; Pro — $200/month" reached the user as
"Plus — 0/month; Pro — 00/month" (collaudo 27/10). The tool cannot undo that: what it can do is take the
text from stdin, where a quoted heredoc leaves every `$` alone, and the skill tells the agents to use it.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from test_agent_questions import NOTIFY, ROOT, box, sql  # noqa: F401  (box is a fixture)

PRICES = "Plus — $20/month; Pro — $100/month; Pro 20x — $200/month"
LANGUAGES = ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]


def _bash(box, script: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=box.env, timeout=30)


def test_double_quotes_do_eat_the_digits_after_a_dollar(box):
    # the cause, in the shell the agents use: it is why the tool needs another way in
    done = _bash(box, f'set --; printf %s "{PRICES}"')
    assert done.stdout == "Plus — 0/month; Pro — 00/month; Pro 20x — 00/month"


def test_the_text_from_stdin_keeps_every_dollar(box):
    done = _bash(box, f"{NOTIFY} --agent capitano --no-telegram - <<'TXT'\n{PRICES}\nTXT\n")

    assert done.returncode == 0, done.stderr
    assert sql(box, "SELECT body FROM pending_user_messages") == [(PRICES,)]


def test_a_question_with_options_takes_its_text_from_stdin_too(box):
    script = (
        f"{NOTIFY} --agent assistente --no-telegram --oggetto 'Piano' "
        "--option plus='Plus — $20/month' --option pro='Pro — $100/month' - "
        f"<<'TXT'\nWhich plan? {PRICES}\nTXT\n"
    )
    done = _bash(box, script)

    assert done.returncode == 0, done.stderr
    ((body,),) = sql(box, "SELECT body FROM pending_user_messages")
    assert f"Which plan? {PRICES}" in body


def test_an_empty_stdin_is_an_empty_body(box):
    done = subprocess.run([str(NOTIFY), "--agent", "capitano", "-"], input="\n", capture_output=True, text=True, env=box.env)

    assert done.returncode == 1
    assert "body vuoto" in done.stderr
    assert sql(box, "SELECT COUNT(*) FROM pending_user_messages") == [(0,)]


@pytest.mark.parametrize("suffix", LANGUAGES)
def test_every_language_of_the_skill_says_how_to_write_a_dollar(suffix: str):
    text = (ROOT / "agents" / "_skills" / "notify-user" / f"SKILL{suffix}.md").read_text(encoding="utf-8")

    assert "'Plus — $20/month; Pro — $100/month'" in text
    assert "- <<'TXT'" in text
    assert "`$1`" in text and "`$2`" in text
