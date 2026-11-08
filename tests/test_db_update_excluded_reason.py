"""A position moves into `excluded` only with the reason in its notes: `EXCLUDED: [CATEGORY] <reason>`.

On a real profile 72 of 120 excluded positions had notes with no category, so the pipeline's drops could not be
explained and a profile that found nothing could not be diagnosed. RULE-07 of the Analista asked for the tag; nothing
enforced it. Now `db_update.py position <id> --status excluded` is refused (exit 1, nothing written) without it, and
the refusal says what to write. The commands the shipped skills and prompts tell the agents to run are tested too:
a documented flow must not stop at the refusal.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import _db  # noqa: E402
import db_update  # noqa: E402

CATEGORIES = ("DEAD_LINK", "GEO", "LANGUAGE", "SENIORITY", "STACK", "DEGREE", "CERT", "SCAM",
              "DUPLICATE", "LOW_SCORE", "CRITIC", "EXPIRED")


@pytest.fixture(scope="module")
def seeded_db(tmp_path_factory):
    directory = tmp_path_factory.mktemp("update-seed")
    path = directory / "jobs.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute("INSERT INTO companies (name) VALUES ('Acme')")
    for i in (1, 2):
        conn.execute("INSERT INTO positions (title, company, company_id, status, url) VALUES (?, 'Acme', 1, 'checked', ?)",
                     ("Engineer %d" % i, "https://x.example/%d" % i))
    conn.commit()
    conn.close()
    assert set(os.listdir(directory)) == {"jobs.db"}, "seed has unclosed SQLite sidecars"
    original = hashlib.sha256(path.read_bytes()).digest()
    yield path
    assert set(os.listdir(directory)) == {"jobs.db"}, "a case wrote into the shared seed directory"
    assert hashlib.sha256(path.read_bytes()).digest() == original, "a case changed the shared seed"


@pytest.fixture
def db(tmp_path, seeded_db):
    """Each case keeps its own writable database and adjacent files."""
    path = tmp_path / "jobs.db"
    shutil.copyfile(seeded_db, path)
    return path


def _update(db: Path, *args: str, stdin: str = "") -> subprocess.CompletedProcess:
    env = {**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent), "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("JHT_AGENT_NAME", None)
    return subprocess.run([sys.executable, str(SKILLS / "db_update.py"), "position", *args], env=env, input=stdin,
                          capture_output=True, text=True, timeout=60)


def _row(db: Path, pid: int = 1):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT status, notes, title FROM positions WHERE id = ?", (pid,)).fetchone()
    finally:
        conn.close()


@pytest.mark.parametrize("notes", [None, "non pertinente", "EXCLUDED: [GEO]", "EXCLUDED: [GEO]   ", "EXCLUDED: [WRONG] x",
                                   "EXCLUDED: [geo] x", "excluded: [GEO] x", "see EXCLUDED: [GEO] x", "[GEO] x",
                                   "ESCLUSA: x", "DUPLICATA di #abc"])
def test_excluding_without_the_reason_is_refused_and_nothing_is_written(db, notes):
    args = ["1", "--status", "excluded", "--title", "Renamed in the same command"]
    if notes is not None:
        args += ["--notes", notes]
    done = _update(db, *args)
    assert done.returncode == 1
    assert "EXCLUDED REJECTED" in done.stderr and "EXCLUDED: [CATEGORY]" in done.stderr
    for category in CATEGORIES:
        assert category in done.stderr, "the refusal must say what to write"
    assert _row(db) == ("checked", None, "Engineer 1"), "a refused command writes nothing, not even its other fields"


@pytest.mark.parametrize("category", CATEGORIES)
def test_every_category_is_accepted_with_a_reason(db, category):
    done = _update(db, "1", "--status", "excluded", "--notes", "EXCLUDED: [%s] the specific reason" % category)
    assert done.returncode == 0, done.stderr
    assert _row(db)[:2] == ("excluded", "EXCLUDED: [%s] the specific reason" % category)


@pytest.mark.parametrize("notes", ["DUPLICATA di #12", "ESCLUSA: [LINK_MORTO] verified before writing", "[SCADUTO] page gone"])
def test_the_forms_the_skills_tell_agents_to_write_today_still_pass(db, notes):
    assert _update(db, "1", "--status", "excluded", "--notes", notes).returncode == 0
    assert _row(db)[0] == "excluded"


def test_the_reason_can_come_from_stdin_and_with_literal_newlines(db):
    done = _update(db, "1", "--status", "excluded", "--notes", "-", stdin="EXCLUDED: [LANGUAGE] German C1 required\nsecond line")
    assert done.returncode == 0, done.stderr
    assert _row(db)[1].startswith("EXCLUDED: [LANGUAGE]")
    assert _update(db, "2", "--status", "excluded", "--notes", "EXCLUDED: [STACK] \\n real reason").returncode == 0


def test_notes_already_on_the_row_count_when_none_are_passed(db):
    assert _update(db, "1", "--notes", "EXCLUDED: [SENIORITY] 8 years required").returncode == 0
    assert _update(db, "1", "--status", "excluded").returncode == 0
    assert _row(db)[:2] == ("excluded", "EXCLUDED: [SENIORITY] 8 years required")
    assert _update(db, "2", "--notes", "just a remark").returncode == 0
    assert _update(db, "2", "--status", "excluded").returncode == 1, "a remark is not a reason"


def test_a_position_already_excluded_can_be_edited_freely(db):
    assert _update(db, "1", "--status", "excluded", "--notes", "EXCLUDED: [GEO] only US").returncode == 0
    assert _update(db, "1", "--notes", "later remark with no tag").returncode == 0
    assert _update(db, "1", "--status", "excluded").returncode == 0, "repeating the same status is not a move into it"
    assert _row(db)[:2] == ("excluded", "later remark with no tag")


def test_the_other_moves_are_not_asked_for_a_reason(db):
    assert _update(db, "1", "--status", "scored").returncode == 0
    assert _update(db, "1", "--status", "checked", "--loc-country", "Italy").returncode == 0
    assert _update(db, "1", "--title", "Plain edit").returncode == 0


def test_the_transition_log_carries_the_reason(db):
    _update(db, "1", "--status", "excluded", "--notes", "EXCLUDED: [DEAD_LINK] 404")
    conn = sqlite3.connect(db)
    try:
        notes = conn.execute("SELECT notes FROM position_state_transitions WHERE position_id = 1 AND to_state = 'excluded'").fetchone()
    finally:
        conn.close()
    assert notes == ("EXCLUDED: [DEAD_LINK] 404",)


def test_the_rules_categories_are_the_ones_the_analista_is_told():
    """RULE-07 names eight; the engine must accept all of them (and the four more are said in the skill)."""
    prompt = (ROOT / "agents" / "analista" / "analista.md").read_text(encoding="utf-8")
    line = next(l for l in prompt.splitlines() if "RULE-07" in l and "EXCLUDED:" in l)
    told = set(re.findall(r"`\[([A-Z_]+)\]`", line))
    assert told and told <= set(db_update.EXCLUDE_CATEGORIES), told - set(db_update.EXCLUDE_CATEGORIES)


# ── the commands the shipped skills and prompts tell the agents to run ──────────────────────────────
_SHIPPED = sorted(p for pattern in ("agents/_skills/*/SKILL*.md", "agents/*/*.md")
                  for p in ROOT.glob(pattern) if "_manual" not in p.parts and "_team" not in p.parts)
_COMMAND = re.compile(r"db_update\.py position\b[^`]*?--status excluded\b")


def _documented_commands():
    for path in _SHIPPED:
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines):
            match = _COMMAND.search(line)
            if not match:
                continue
            rest = line[match.end():]
            if rest.rstrip().endswith("\\") and number + 1 < len(lines):  # the command goes on the next line
                rest += "\n" + lines[number + 1]
            where = path.relative_to(ROOT).as_posix()
            yield pytest.param(where, rest, id="%s:%d" % (where, number + 1))


@pytest.mark.parametrize("where,rest", list(_documented_commands()))
def test_every_documented_exclusion_command_carries_an_accepted_reason(where, rest):
    notes = re.search(r"--notes\s+(?:\"([^\"]*)\"|'([^']*)')", rest)
    assert notes, "%s documents `--status excluded` with no --notes: the refusal would stop that flow" % where
    text = re.sub(r"<[^>]*>", "1", notes.group(1) or notes.group(2))  # a placeholder stands for a value
    assert db_update.excluded_reason_ok(text), "%s: %r would be refused" % (where, text)


def test_the_scan_found_the_commands_it_is_meant_to_guard():
    found = [p.values[0] for p in _documented_commands()]
    # analista, scorer, application-flow (two), critic-loop, db-update, position-insert, recheck-batch, 7 languages
    assert len(found) >= 40
    assert any("scorer/scorer.md" in f for f in found) and any("application-flow/SKILL.pt.md" in f for f in found)
