"""A `$` in the free text an agent writes with `db_update.py` arrives whole: the option takes `-` and reads stdin.

Between double quotes the shell reads `$1`..`$9` as its own arguments and replaces them with nothing before the
command starts, so `--notes "Salary up to $120k"` kept "Salary up to 20k" in the database, and the person reads the
notes and the summaries on the position page. The command cannot undo that: it can take the text from stdin, where a
quoted heredoc leaves every `$` alone, and the skill tells the agents so. A text whose last line is `TXT` (an
indented closing line: the heredoc never closed) is refused, nothing is written; and only one option per command can
read stdin, because there is one stdin.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import _db  # noqa: E402

LANGUAGES = ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]
TEXT = "Salary up to $120k, bonus $10k, floor $5"
CLOSINGS = ["   TXT", "\tTXT", "TXT   "]  # a copied indent of 3 spaces, a tab, trailing spaces


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute("INSERT INTO companies (name) VALUES ('Acme')")
    conn.execute(
        "INSERT INTO positions (title, company, company_id, status, url) VALUES ('Engineer', 'Acme', 1, 'new', 'https://x.example/1')"
    )
    # sent already: an outcome (`--response`) is only recorded for an application that went out
    conn.execute("INSERT INTO applications (position_id, status, applied, applied_via) VALUES (1, 'applied', 1, 'email')")
    conn.commit()
    conn.close()
    return path


def _env(db: Path) -> dict[str, str]:
    env = {**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent), "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("JHT_AGENT_NAME", None)
    return env


def _bash(db: Path, script: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "-c", script], cwd=ROOT, env={**_env(db), "UPDATE": f"{sys.executable} {SKILLS / 'db_update.py'}"},
                          capture_output=True, text=True, timeout=60)


def _update(db: Path, *args: str, stdin: str = "") -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SKILLS / "db_update.py"), *args], cwd=ROOT, env=_env(db), input=stdin,
                          capture_output=True, text=True, timeout=60)


def _value(db: Path, table: str, column: str):
    with sqlite3.connect(db) as conn:
        return conn.execute(f"SELECT {column} FROM {table} ORDER BY id LIMIT 1").fetchone()[0]


# entity, id, option, table, column
FIELDS = [
    ("position", "1", "--notes", "positions", "notes"),
    ("position", "1", "--jd-text", "positions", "jd_text"),
    ("position", "1", "--jd-summary", "positions", "jd_summary"),
    ("position", "1", "--requirements", "positions", "requirements"),
    ("position", "1", "--location-notes", "positions", "location_notes"),
    ("company", "Acme", "--red-flags", "companies", "red_flags"),
    ("company", "Acme", "--culture-notes", "companies", "culture_notes"),
    ("application", "1", "--critic-notes", "applications", "critic_notes"),
    ("application", "1", "--response", "applications", "response"),
]


def test_double_quotes_do_eat_the_digits_after_a_dollar():
    # the cause, in the shell the agents use: it is why the command needs another way in
    done = subprocess.run(["bash", "-c", f'set --; printf %s "{TEXT}"'], capture_output=True, text=True)
    assert done.stdout == "Salary up to 20k, bonus 0k, floor "


@pytest.mark.parametrize("entity, ident, option, table, column", FIELDS)
def test_the_text_from_stdin_keeps_every_dollar(db, entity, ident, option, table, column):
    done = _bash(db, f"$UPDATE {entity} {ident} {option} - <<'TXT'\n{TEXT}\nTXT\n")

    assert done.returncode == 0, done.stdout + done.stderr
    assert _value(db, table, column) == TEXT


@pytest.mark.parametrize("entity, ident, option, table, column", FIELDS)
def test_the_text_in_single_quotes_keeps_the_dollar_too(db, entity, ident, option, table, column):
    done = _bash(db, f"$UPDATE {entity} {ident} {option} '{TEXT}'")

    assert done.returncode == 0, done.stdout + done.stderr
    assert _value(db, table, column) == TEXT


def test_a_text_with_an_apostrophe_a_dollar_and_lines_goes_in_whole(db):
    text = "It's $120k.\n\nSecond paragraph: bonus $10k."
    done = _bash(db, f"$UPDATE position 1 --jd-text - <<'TXT'\n{text}\nTXT\n")

    assert done.returncode == 0, done.stdout + done.stderr
    assert _value(db, "positions", "jd_text") == text


def test_the_text_on_stdin_goes_with_the_other_options(db):
    done = _bash(db, f"$UPDATE position 1 --status checked --notes - --loc-city Milan <<'TXT'\n{TEXT}\nTXT\n")

    assert done.returncode == 0, done.stdout + done.stderr
    assert (_value(db, "positions", "notes"), _value(db, "positions", "status"), _value(db, "positions", "loc_city")) == (TEXT, "checked", "Milan")


def test_two_options_cannot_both_read_stdin(db):
    done = _update(db, "position", "1", "--notes", "-", "--jd-text", "-", stdin=f"{TEXT}\n")

    assert done.returncode == 2
    assert "only one option can read stdin" in done.stderr
    assert (_value(db, "positions", "notes"), _value(db, "positions", "jd_text")) == (None, None)


@pytest.mark.parametrize("stdin", ["", "\n", "  \n\n"])
def test_an_empty_stdin_writes_nothing(db, stdin: str):
    done = _update(db, "position", "1", "--notes", "-", stdin=stdin)

    assert done.returncode == 2
    assert "empty" in done.stderr
    assert _value(db, "positions", "notes") is None


@pytest.mark.parametrize("closing", CLOSINGS)
def test_a_text_that_ends_in_the_delimiter_line_writes_nothing(db, closing: str):
    done = _update(db, "position", "1", "--notes", "-", stdin=f"{TEXT}\n{closing}\n")

    assert done.returncode == 2
    assert "TXT" in done.stderr and "Nothing was written" in done.stderr
    assert _value(db, "positions", "notes") is None


def test_an_indented_closing_line_in_a_real_heredoc_writes_nothing(db):
    done = _bash(db, f"$UPDATE position 1 --notes - <<'TXT'\n{TEXT}\n   TXT\n")

    assert done.returncode == 2
    assert _value(db, "positions", "notes") is None


def test_a_text_that_only_names_txt_is_written(db):
    done = _bash(db, "$UPDATE position 1 --notes - <<'TXT'\nThe attachment is a TXT file.\nTXT is plain text.\nTXT\n")

    assert done.returncode == 0, done.stdout + done.stderr
    assert _value(db, "positions", "notes") == "The attachment is a TXT file.\nTXT is plain text."


def test_a_text_that_is_not_the_dash_is_unchanged(db):
    done = _update(db, "position", "1", "--notes", "- a dash first, then words", stdin="never read")

    assert done.returncode == 0, done.stdout + done.stderr
    assert _value(db, "positions", "notes") == "- a dash first, then words"


@pytest.mark.parametrize("suffix", LANGUAGES)
def test_every_language_of_the_skill_says_how_to_write_a_dollar(suffix: str):
    text = (ROOT / "agents" / "_skills" / "db-update" / f"SKILL{suffix}.md").read_text(encoding="utf-8")

    assert "db_update.py position 42 --notes - <<'TXT'" in text
    assert "`$1`" in text and "`$2`" in text
    assert "`TXT`" in text  # the closing line in the first column, with no spaces before it
