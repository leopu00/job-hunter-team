"""A position inserted before its company is linked to it when the company is created or updated.

The SCOUT inserts a position with the company's name before the ANALISTA creates the company; the position linked itself
only at its own insert (resolve_company_id), so it kept company_id NULL for good. Now `db_insert.py company` and
`db_update.py company` link the positions of the same name (case-insensitive) that have no company yet, and leave an
existing link alone.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"


@pytest.fixture
def home(tmp_path):
    return tmp_path


def _env(home, agent):
    return {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent, "JHT_DB": str(home / "jobs.db"),
            "PYTHONDONTWRITEBYTECODE": "1"}


def _script(home, agent, script, *args):
    r = subprocess.run([sys.executable, str(SKILLS / script), *args], capture_output=True, text=True,
                       env=_env(home, agent), timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    return r


TITLES = {1: "Magazziniere", 2: "Contabile senior", 3: "Receptionist", 4: "Autista patente C", 5: "Cuoco di linea"}
CITIES = {1: "Bari, Italy", 2: "Torino, Italy", 3: "Lecce, Italy", 4: "Parma, Italy", 5: "Trento, Italy"}


def _position(home, n, company):
    # distinct titles and cities: the SCOUT's duplicate check refuses a similar title at the same company
    _script(home, "scout-1", "db_insert.py", "position", "--title", TITLES[n], "--company", company,
            "--url", "https://jobs.example/%d" % n, "--source", "test", "--found-by", "scout-1", "--location", CITIES[n],
            "--remote-type", "onsite", "--jd-text", "annuncio sintetico %d" % n, "--requirements", "requisiti generici")


def _links(home):
    with sqlite3.connect(str(home / "jobs.db")) as c:
        return dict(c.execute("SELECT company, company_id FROM positions ORDER BY id").fetchall())


def _company_id(home, name):
    with sqlite3.connect(str(home / "jobs.db")) as c:
        return c.execute("SELECT id FROM companies WHERE name = ?", (name,)).fetchone()[0]


def test_creating_the_company_links_the_positions_inserted_before_it(home):
    _position(home, 1, "Azienda Uno")
    _position(home, 2, "azienda uno")  # same company, other case
    _position(home, 3, "Azienda Due")
    assert set(_links(home).values()) == {None}

    _script(home, "analista-1", "db_insert.py", "company", "--name", "Azienda Uno", "--sector", "Servizi")

    uno = _company_id(home, "Azienda Uno")
    assert _links(home) == {"Azienda Uno": uno, "azienda uno": uno, "Azienda Due": None}


def test_updating_a_known_company_links_what_was_left_unlinked_and_keeps_other_links(home):
    _script(home, "analista-1", "db_insert.py", "company", "--name", "Azienda Tre")
    _script(home, "analista-1", "db_insert.py", "company", "--name", "Azienda Quattro")
    tre, quattro = _company_id(home, "Azienda Tre"), _company_id(home, "Azienda Quattro")
    _position(home, 4, "Azienda Tre")  # linked at its insert: the company exists
    assert _links(home)["Azienda Tre"] == tre
    # a position left unlinked (as in the rounds of 16-17/11), and one already pointing elsewhere
    _position(home, 5, "Azienda Cinque")
    with sqlite3.connect(str(home / "jobs.db")) as c:
        c.execute("UPDATE positions SET company_id = NULL WHERE company = 'Azienda Tre'")
        c.execute("UPDATE positions SET company = 'AZIENDA TRE', company_id = ? WHERE company = 'Azienda Cinque'", (quattro,))

    _script(home, "analista-1", "db_update.py", "company", "Azienda Tre", "--sector", "Logistica")

    with sqlite3.connect(str(home / "jobs.db")) as c:
        rows = c.execute("SELECT company, company_id FROM positions ORDER BY id").fetchall()
    assert rows == [("Azienda Tre", tre), ("AZIENDA TRE", quattro)]
