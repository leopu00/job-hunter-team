"""A franchise, a business for sale, a lead is not a job: the INSERT of a Scout refuses it (banco 17/11, a cook in Rimini).

Two of the 19 inserted were ads the Scout itself called «not a job» in its notes (a franchise, «lead marketplace, non posizione di lavoro»).
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
ROOT = SKILLS.parents[1]
sys.path.insert(0, str(SKILLS))

import db_insert  # noqa: E402


@pytest.mark.parametrize("title,notes,found", [
    ("Opportunità di franchising a Savignano sul Rubicone (FC)", None, True),
    ("Franchise opportunity - open your own store", None, True),
    ("Cedesi attività di ristorazione", None, True),
    ("Personal chef", "lead marketplace, non posizione di lavoro", True),
    ("Cuoco", "Questo non è un lavoro ma una quota di ingresso", True),
    ("Cuoco", "Not a job offer: a paid course", True),
    # a job stays a job
    ("Responsabile franchising", None, False), ("Cuoco di linea", None, False),
    ("Chef de partie", "Partita IVA, non contratto dipendente: verificare", False),
    ("Cuoco a domicilio", "il cliente non lavoro stabile", False), ("Cuoco", None, False), (None, None, False),
])
def test_what_says_an_ad_is_not_a_job(title, notes, found):
    assert (db_insert.not_a_job(title, notes) is not None) is found


def _insert(tmp_path, agent, title, notes=None, n=1):
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_AGENT_NAME": agent, "JHT_DB": str(tmp_path / "jobs.db")}
    cmd = [sys.executable, str(SKILLS / "db_insert.py"), "position", "--title", title, "--company", "Acme", "--url", "https://x.example/%d" % n,
           "--source", "test", "--found-by", agent, "--location", "Rimini", "--remote-type", "onsite"]
    if notes:
        cmd += ["--notes", notes]
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)


def _count(tmp_path):
    return sqlite3.connect(str(tmp_path / "jobs.db")).execute("SELECT COUNT(*) FROM positions").fetchone()[0]


def test_a_scout_cannot_insert_a_franchise_and_nothing_is_written(tmp_path):
    done = _insert(tmp_path, "scout-1", "Opportunità di franchising a Savignano")
    assert done.returncode == 6 and done.stdout.startswith("NOT_A_JOB") and "INSERT refused" in done.stdout, done.stdout + done.stderr
    assert _count(tmp_path) == 0
    done = _insert(tmp_path, "scout-1", "Personal chef", "lead marketplace, non posizione di lavoro")
    assert done.returncode == 6 and _count(tmp_path) == 0


def test_the_gate_is_for_the_scout_alone_and_a_job_goes_in(tmp_path):
    first = _insert(tmp_path, "user", "Opportunità di franchising a Savignano")
    assert first.returncode == 0, first.stdout + first.stderr          # a position the person adds is theirs
    assert _insert(tmp_path, "scout-1", "Cuoco di linea", "Partita IVA, non contratto dipendente", n=2).returncode == 0
    assert _count(tmp_path) == 2


def test_the_prompts_say_it_in_every_language():
    for lang in ("", ".it", ".de", ".es", ".fr", ".hu", ".pt"):
        text = (ROOT / "agents" / "_skills" / "position-insert" / f"SKILL{lang}.md").read_text(encoding="utf-8")
        assert ("franchis" in text.lower() or "franquia" in text.lower() or "franquicia" in text.lower()) and "`other`" in text, lang
