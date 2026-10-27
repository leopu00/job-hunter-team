"""A `$` in the text an agent sends to the user arrives whole, in every command that carries that text.

Between double quotes the shell reads `$1` and `$2` as its own arguments and replaces them with nothing
before the command starts, so "Plus — $20/month; Pro — $200/month" reached the user as
"Plus — 0/month; Pro — 00/month" (collaudo 27/10). `jht-notify-user` already takes the text from stdin; this
holds the same for `jht-send`, `jht-telegram-send` and `jht-reply-options`: "-" reads the text from stdin,
where a quoted heredoc leaves every `$` alone, and each skill tells the agents so.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from test_telegram_menu_only import _calls, box  # noqa: F401  (box is a fixture: the stub curl)

ROOT = Path(__file__).resolve().parents[1]
SEND = ROOT / "agents" / "_tools" / "jht-send"
TELEGRAM = ROOT / "agents" / "_tools" / "jht-telegram-send"
REPLY_OPTIONS = ROOT / "agents" / "_skills" / "game-reply-options" / "jht-reply-options.py"

PRICES = "Plus — $20/month; Pro — $100/month; Pro 20x — $200/month"
WITH_APOSTROPHE = "It's $20/month, not $200"
LANGUAGES = ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]


def _bash(script: str, env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)


def _chat_env(tmp_path: Path) -> dict[str, str]:
    return {**os.environ, "JHT_AGENT_DIR": str(tmp_path)}


def _chat_lines(tmp_path: Path) -> list[dict]:
    chat = tmp_path / "chat.jsonl"
    return [json.loads(line) for line in chat.read_text(encoding="utf-8").splitlines()] if chat.exists() else []


def _telegram_texts(box) -> list[str]:
    texts = []
    for call in _calls(box):
        texts += [arg[len("text="):] for arg in call if arg.startswith("text=")]
    return texts


def test_double_quotes_do_eat_the_digits_after_a_dollar():
    # the cause, in the shell the agents use: it is why the commands need another way in
    done = _bash(f'set --; printf %s "{PRICES}"', dict(os.environ))
    assert done.stdout == "Plus — 0/month; Pro — 00/month; Pro 20x — 00/month"


# ── jht-send ─────────────────────────────────────────────────────────────────


def test_jht_send_takes_the_text_from_stdin_with_every_dollar(tmp_path: Path):
    done = _bash(f"{SEND} - <<'TXT'\n{PRICES}\nTXT\n", _chat_env(tmp_path))

    assert done.returncode == 0, done.stderr
    (entry,) = _chat_lines(tmp_path)
    assert entry["text"] == PRICES
    assert entry["done"] is True


def test_jht_send_stdin_carries_an_apostrophe_and_a_dollar_together(tmp_path: Path):
    done = _bash(f"{SEND} - <<'TXT'\n{WITH_APOSTROPHE}\nTXT\n", _chat_env(tmp_path))

    assert done.returncode == 0, done.stderr
    assert [entry["text"] for entry in _chat_lines(tmp_path)] == [WITH_APOSTROPHE]


def test_jht_send_stdin_keeps_its_lines_and_still_reads_the_escapes(tmp_path: Path):
    done = _bash(f"{SEND} --partial - <<'TXT'\nPlus — $20/month\\n\\nPro — $100/month\nsecond line\nTXT\n", _chat_env(tmp_path))

    assert done.returncode == 0, done.stderr
    (entry,) = _chat_lines(tmp_path)
    assert entry["text"] == "Plus — $20/month\n\nPro — $100/month\nsecond line"
    assert entry["done"] is False


def test_jht_send_stdin_goes_with_a_kind(tmp_path: Path):
    done = _bash(f"{SEND} --kind completed - <<'TXT'\nSaved $200 a month\nTXT\n", _chat_env(tmp_path))

    assert done.returncode == 0, done.stderr
    (entry,) = _chat_lines(tmp_path)
    assert (entry["text"], entry["kind"]) == ("Saved $200 a month", "completed")


def test_jht_send_single_quotes_keep_the_dollar_too(tmp_path: Path):
    done = _bash(f"{SEND} 'Plus — $20/month; Pro — $100/month'", _chat_env(tmp_path))

    assert done.returncode == 0, done.stderr
    assert [entry["text"] for entry in _chat_lines(tmp_path)] == ["Plus — $20/month; Pro — $100/month"]


@pytest.mark.parametrize("stdin", ["", "\n", "  \n\n"])
def test_jht_send_an_empty_stdin_writes_nothing(tmp_path: Path, stdin: str):
    done = subprocess.run([str(SEND), "-"], input=stdin, capture_output=True, text=True, env=_chat_env(tmp_path))

    assert done.returncode == 2
    assert "empty" in done.stderr
    assert _chat_lines(tmp_path) == []


# ── jht-telegram-send ────────────────────────────────────────────────────────


def test_jht_telegram_send_takes_the_text_from_stdin_with_every_dollar(box):
    done = _bash(f"{TELEGRAM} - <<'TXT'\n{PRICES}\nTXT\n", {**os.environ, **box["env"]})

    assert done.returncode == 0, done.stderr
    assert _telegram_texts(box) == [PRICES]


def test_jht_telegram_send_stdin_carries_an_apostrophe_and_a_dollar_together(box):
    done = _bash(f"{TELEGRAM} --from capitano - <<'TXT'\n{WITH_APOSTROPHE}\nTXT\n", {**os.environ, **box["env"]})

    assert done.returncode == 0, done.stderr
    assert _telegram_texts(box) == [WITH_APOSTROPHE]


def test_jht_telegram_send_stdin_keeps_its_lines(box):
    done = _bash(f"{TELEGRAM} - <<'TXT'\nPlus — $20/month\n\nPro — $100/month\nTXT\n", {**os.environ, **box["env"]})

    assert done.returncode == 0, done.stderr
    assert _telegram_texts(box) == ["Plus — $20/month\n\nPro — $100/month"]


def test_jht_telegram_send_single_quotes_keep_the_dollar_too(box):
    done = _bash(f"{TELEGRAM} 'Plus — $20/month; Pro — $100/month'", {**os.environ, **box["env"]})

    assert done.returncode == 0, done.stderr
    assert _telegram_texts(box) == ["Plus — $20/month; Pro — $100/month"]


@pytest.mark.parametrize("stdin", ["", "\n", "  \n\n"])
def test_jht_telegram_send_an_empty_stdin_sends_nothing(box, stdin: str):
    done = subprocess.run([str(TELEGRAM), "-"], input=stdin, capture_output=True, text=True, env={**os.environ, **box["env"]})

    assert done.returncode == 1
    assert "vuoto" in done.stderr
    assert _calls(box) == []


def test_jht_telegram_send_a_dash_among_other_words_is_still_text(box):
    # only a lone "-" means stdin: a dash inside the words of a message is the message
    done = subprocess.run([str(TELEGRAM), "ready", "-", "3", "positions"], capture_output=True, text=True, env={**os.environ, **box["env"]})

    assert done.returncode == 0, done.stderr
    assert _telegram_texts(box) == ["ready - 3 positions"]


# ── jht-reply-options ────────────────────────────────────────────────────────


def test_jht_reply_options_takes_the_prompt_from_stdin_with_every_dollar(tmp_path: Path):
    script = f"{REPLY_OPTIONS} --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'\nWhich plan? {PRICES}\nTXT\n"
    done = _bash(script, _chat_env(tmp_path))

    assert done.returncode == 0, done.stderr
    (entry,) = _chat_lines(tmp_path)
    assert entry["text"] == f"Which plan? {PRICES}"
    assert [choice["label"] for choice in entry["choices"]] == ["Plus — $20/month", "Pro — $100/month"]


def test_jht_reply_options_an_empty_prompt_on_stdin_is_refused(tmp_path: Path):
    done = subprocess.run(
        [str(REPLY_OPTIONS), "--prompt", "-", "a", "b"], input="\n", capture_output=True, text=True, env=_chat_env(tmp_path)
    )

    assert done.returncode == 2
    assert _chat_lines(tmp_path) == []


# ── the skills ───────────────────────────────────────────────────────────────

EXAMPLES = {
    "chat-web": ["jht-send 'Plus — $20/month; Pro — $100/month'", "jht-send - <<'TXT'"],
    "telegram-send": ["jht-telegram-send 'Plus — $20/month; Pro — $100/month'", "jht-telegram-send - <<'TXT'"],
    "game-reply-options": ["jht-reply-options --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'"],
}


@pytest.mark.parametrize("suffix", LANGUAGES)
@pytest.mark.parametrize("skill", sorted(EXAMPLES))
def test_every_language_of_the_skill_says_how_to_write_a_dollar(skill: str, suffix: str):
    text = (ROOT / "agents" / "_skills" / skill / f"SKILL{suffix}.md").read_text(encoding="utf-8")

    for example in EXAMPLES[skill]:
        assert example in text
    assert "`$1`" in text and "`$2`" in text
