"""A `$` in what an agent sends to a company arrives whole: the answer of a form and the body of an email.

Between double quotes the shell reads `$8`, `$2`, `$1` as its own arguments and replaces them with nothing before
the command starts, so `--value "$80,000"` saved "0,000" and the form went out with it. No command can bring the
digits back. `application_answers.py save --value -` and `email_monitor.py send --body -` take the text from
stdin, where a heredoc with a quoted delimiter leaves every `$` alone, and the prompt of the CLOSER and the
`chat-web` skill tell the agents to use it.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from test_application_answers import ROOT, SKILL, db, row  # noqa: F401  (db is a fixture)

sys.path.insert(0, str(ROOT / "shared" / "skills"))

import email_monitor  # noqa: E402

AMOUNTS = "$80,000 a year; $20/hour; $1 bonus"
LETTER = "I'd work for $80,000 a year.\n\nMy last offer was $120,000, a $5 raise per hour."
LANGUAGES = ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]


def _bash(db, tmp_path: Path, script: str) -> subprocess.CompletedProcess:
    profile = tmp_path / "cli-profile.yml"
    profile.write_text("name: Test Candidate\n", encoding="utf-8")
    env = {**os.environ, "JHT_DB": str(db), "JHT_HOME": str(tmp_path), "SAVE": f"{sys.executable} {SKILL}", "PROFILE": str(profile), "DB": str(db)}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=60)


def _answers(db) -> list[str]:
    return [json.loads(raw) for (raw,) in row(db, "SELECT answer_json FROM application_answers ORDER BY key")]


def test_double_quotes_do_eat_the_digits_after_a_dollar():
    # the cause, in the shell the agents use: it is why the command needs another way in
    done = subprocess.run(["bash", "-c", f'set --; printf %s "{AMOUNTS}"'], capture_output=True, text=True)
    assert done.stdout == "0,000 a year; 0/hour;  bonus"


# ── application_answers.py save --value - ────────────────────────────────────


def test_the_answer_from_stdin_keeps_every_dollar(db, tmp_path):
    done = _bash(db, tmp_path, f"$SAVE save --key 'expected pay' --field-type text --basis cv --db \"$DB\" --profile \"$PROFILE\" --value - <<'TXT'\n{AMOUNTS}\nTXT\n")

    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads(done.stdout)["status"] == "saved"
    assert _answers(db) == [AMOUNTS]


def test_a_long_answer_with_an_apostrophe_and_dollars_goes_in_whole(db, tmp_path):
    done = _bash(
        db, tmp_path,
        "$SAVE save --key 'why us' --field-type textarea --basis vacancy --position-id 7 --db \"$DB\" --profile \"$PROFILE\" --value - "
        f"<<'TXT'\n{LETTER}\nTXT\n",
    )

    assert done.returncode == 0, done.stdout + done.stderr
    assert _answers(db) == [LETTER]


def test_a_choice_with_amounts_in_single_quotes_matches_its_option_exactly(db, tmp_path):
    done = _bash(
        db, tmp_path,
        "$SAVE save --key 'pay band' --field-type radio --basis profile --db \"$DB\" --profile \"$PROFILE\" "
        "--options 'Under $50,000' 'Over $50,000' --value - <<'TXT'\nOver $50,000\nTXT\n",
    )

    assert done.returncode == 0, done.stdout + done.stderr
    assert _answers(db) == ["Over $50,000"]


def test_the_same_choice_in_double_quotes_is_not_an_option(db, tmp_path):
    # what the agents wrote until now: the option the form shows and the one the shell left are not the same text
    done = _bash(
        db, tmp_path,
        "$SAVE save --key 'pay band' --field-type radio --basis profile --db \"$DB\" --profile \"$PROFILE\" "
        "--options 'Under $50,000' 'Over $50,000' --value \"Over $50,000\"",
    )

    assert done.returncode == 1
    assert json.loads(done.stdout)["reason"] == "closer_answer_not_exact_option"
    assert _answers(db) == []


@pytest.mark.parametrize("stdin", ["", "\n", "  \n\n"])
def test_an_empty_stdin_is_an_empty_answer_and_saves_nothing(db, tmp_path, stdin: str):
    profile = tmp_path / "cli-profile.yml"
    profile.write_text("name: Test Candidate\n", encoding="utf-8")
    done = subprocess.run(
        [sys.executable, str(SKILL), "save", "--key", "expected pay", "--field-type", "text", "--basis", "cv",
         "--db", str(db), "--profile", str(profile), "--value", "-"],
        input=stdin, capture_output=True, text=True, env={**os.environ, "JHT_HOME": str(tmp_path)},
    )

    assert done.returncode == 1
    assert json.loads(done.stdout) == {"key": "expected pay", "reason": "closer_answer_empty", "status": "rejected"}
    assert _answers(db) == []


@pytest.mark.parametrize("closing", ["   TXT", "\tTXT", "TXT   "])
def test_an_answer_that_ends_in_the_delimiter_line_is_rejected(db, tmp_path, closing: str):
    # a copied indent: the heredoc never closed, the shell passed on the delimiter line too, and the form would carry it
    profile = tmp_path / "cli-profile.yml"
    profile.write_text("name: Test Candidate\n", encoding="utf-8")
    done = subprocess.run(
        [sys.executable, str(SKILL), "save", "--key", "expected pay", "--field-type", "text", "--basis", "cv",
         "--db", str(db), "--profile", str(profile), "--value", "-"],
        input=f"$80,000 a year\n{closing}\n", capture_output=True, text=True, env={**os.environ, "JHT_HOME": str(tmp_path)},
    )

    assert done.returncode == 1
    assert json.loads(done.stdout) == {"key": "expected pay", "reason": "closer_answer_heredoc_unterminated", "status": "rejected"}
    assert _answers(db) == []


def test_an_indented_closing_line_in_a_real_heredoc_saves_nothing(db, tmp_path):
    done = _bash(db, tmp_path, "$SAVE save --key 'expected pay' --field-type text --basis cv --db \"$DB\" --profile \"$PROFILE\" --value - <<'TXT'\n$80,000 a year\n   TXT\n")

    assert done.returncode == 1
    assert json.loads(done.stdout)["reason"] == "closer_answer_heredoc_unterminated"
    assert _answers(db) == []


def test_a_value_in_the_argument_is_unchanged(db, tmp_path):
    done = _bash(db, tmp_path, "$SAVE save --key 'expected pay' --field-type text --basis cv --db \"$DB\" --profile \"$PROFILE\" --value '$80,000'")

    assert done.returncode == 0, done.stdout + done.stderr
    assert _answers(db) == ["$80,000"]


# ── email_monitor.py send --body - ───────────────────────────────────────────


@pytest.fixture()
def sent(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def broker(op, args):
        calls.append((op, args))
        return {"ok": True, "status": "pending_user_approval"}

    monkeypatch.setattr(email_monitor, "_broker_call", broker)
    return calls


@pytest.mark.parametrize("option", [["--body", "-"], ["--body-file", "-"], []])
def test_the_body_from_stdin_keeps_every_dollar(monkeypatch, sent, option):
    monkeypatch.setattr(sys, "stdin", io.StringIO(LETTER + "\n"))

    code = email_monitor.main(["send", "--to", "hr@example.com", "--subject", "Offer", *option])

    assert code == 0
    ((op, args),) = sent
    assert op == "mail.send"
    assert args["body"] == LETTER + "\n"


@pytest.mark.parametrize("option", [["--body", "-"], ["--body-file", "-"], []])
@pytest.mark.parametrize("closing", ["   TXT", "\tTXT", "TXT   "])
def test_a_body_that_ends_in_the_delimiter_line_is_not_sent(monkeypatch, sent, capsys, option, closing: str):
    # a copied indent of 3 spaces: the heredoc never closed and the mail to the company would end in "TXT"
    monkeypatch.setattr(sys, "stdin", io.StringIO(f"Dear team, I ask $80,000.\n{closing}\n"))

    code = email_monitor.main(["send", "--to", "hr@example.com", "--subject", "Offer", *option])

    assert code == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "reason": "closer_answer_heredoc_unterminated"}
    assert sent == []


def test_a_body_that_only_mentions_txt_inside_a_sentence_is_sent(monkeypatch, sent):
    monkeypatch.setattr(sys, "stdin", io.StringIO("The attachment is a TXT file.\nTXT is plain text.\n"))

    assert email_monitor.main(["send", "--to", "hr@example.com", "--subject", "S", "--body", "-"]) == 0
    assert sent[0][1]["body"] == "The attachment is a TXT file.\nTXT is plain text.\n"


def test_a_body_in_the_argument_and_a_body_file_are_unchanged(tmp_path, monkeypatch, sent):
    body_file = tmp_path / "body.txt"
    body_file.write_text("From a file: $20\n", encoding="utf-8")
    monkeypatch.setattr(sys, "stdin", io.StringIO("never read"))

    assert email_monitor.main(["send", "--to", "a@example.com", "--subject", "S", "--body", "Plain $20"]) == 0
    assert email_monitor.main(["send", "--to", "a@example.com", "--subject", "S", "--body-file", str(body_file)]) == 0

    assert [args["body"] for _, args in sent] == ["Plain $20", "From a file: $20\n"]


# ── the prompts and skills ───────────────────────────────────────────────────


@pytest.mark.parametrize("suffix", LANGUAGES)
def test_every_language_of_the_closer_says_how_to_pass_an_answer_with_a_dollar(suffix: str):
    text = (ROOT / "agents" / "closer" / f"closer{suffix}.md").read_text(encoding="utf-8")

    assert "`--value -`" in text and "`$80,000`" in text and "`$8`" in text
    # the model the agents copy is the one that works: the answer on stdin, never between double quotes
    # ... and its closing line sits in the first column: the list indent is not part of the command
    assert "--basis profile|cv|vacancy|judgement [--position-id $PID] <<'TXT'\n<answer>\nTXT\n```\n" in text
    assert "\n   TXT" not in text
    assert '--value "<answer>"' not in text
    # the closing line must be in the first column: the prompt says so too
    assert "`TXT`" in text
    assert "application_answers.py save --key \"<key>\" --value - --field-type" in text


@pytest.mark.parametrize("suffix", LANGUAGES)
def test_every_language_of_chat_web_sends_the_email_body_from_stdin(suffix: str):
    text = (ROOT / "agents" / "_skills" / "chat-web" / f"SKILL{suffix}.md").read_text(encoding="utf-8")

    assert "--subject '<subject>' --body - <<'TXT'" in text
    assert "`$20`" in text and "`TXT`" in text
    assert "printf '%s\\n' \"<body>\"" not in text
