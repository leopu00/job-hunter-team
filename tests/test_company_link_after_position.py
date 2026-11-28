"""A position inserted before its company is linked to it when the company is created or updated.

The SCOUT inserts a position with the company's name before the ANALISTA creates the company; the position linked itself
only at its own insert (resolve_company_id), so it kept company_id NULL for good. Now `db_insert.py company` and
`db_update.py company` link the positions of the same name (case-insensitive) that have no company yet, and leave an
existing link alone.
"""
from scout_insert_helper import checked_position

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
    run = checked_position if script == "db_insert.py" and args[0] == "position" else subprocess.run
    r = run([sys.executable, str(SKILLS / script), *args], capture_output=True, text=True,
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


def test_a_legal_form_at_the_end_of_the_name_does_not_keep_the_position_unlinked(home):
    # «Gamma Italia S.p.a.» in the ad, «Gamma Italia» in the companies row: the same company (a test round left two
    # agencies with their row and their positions unlinked). The legal form only: the rest of the name still counts.
    _position(home, 1, "Gamma Italia S.p.a.")
    _position(home, 2, "GAMMA ITALIA SPA")
    _position(home, 3, "Gamma Italia (cliente non nominato)")

    _script(home, "analista-1", "db_insert.py", "company", "--name", "Gamma Italia")

    gamma = _company_id(home, "Gamma Italia")
    assert _links(home) == {"Gamma Italia S.p.a.": gamma, "GAMMA ITALIA SPA": gamma,
                            "Gamma Italia (cliente non nominato)": None}
    # a position inserted after the company links itself at its insert the same way
    _position(home, 4, "Gamma Italia s.r.l.")
    assert _links(home)["Gamma Italia s.r.l."] == gamma


def test_two_companies_of_the_same_name_but_the_legal_form_link_only_the_exact_name(home):
    _script(home, "analista-1", "db_insert.py", "company", "--name", "Delta Lavoro")
    _script(home, "analista-1", "db_insert.py", "company", "--name", "Delta Lavoro Spa")
    spa = _company_id(home, "Delta Lavoro Spa")
    _position(home, 1, "Delta Lavoro Spa")
    _position(home, 2, "DELTA LAVORO s.p.a")
    _position(home, 3, "Delta Lavoro S.r.l.")
    _script(home, "analista-1", "db_update.py", "company", "Delta Lavoro", "--sector", "Servizi")
    # two rows share the key: only the exact name decides, a guess between them would be a wrong link
    assert _links(home) == {"Delta Lavoro Spa": spa, "DELTA LAVORO s.p.a": None, "Delta Lavoro S.r.l.": None}


@pytest.mark.parametrize(("name", "key"), [
    ("Gamma Italia S.p.a.", "gamma italia"), ("GAMMA ITALIA SpA", "gamma italia"),
    ("Nuove Opere Lavoro S.p.A .", "nuove opere lavoro"), ("Lavorobello Srl", "lavorobello"),
    ("L’Oréal S.A.", "loreal"), ("Acme GmbH & Co. KG", "acme gmbh co"), ("AG", "ag"), ("", ""),
    ("Alfa Italia (azienda cliente non nominata)", "alfa italia azienda cliente non nominata"),
])
def test_company_key(name, key):
    sys.path.insert(0, str(SKILLS))
    try:
        from _db import company_key
    finally:
        sys.path.remove(str(SKILLS))
    assert company_key(name) == key
