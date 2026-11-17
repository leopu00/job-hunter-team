"""The country of a position is written at the INSERT, from what the Scout wrote (banco build9: 26 new positions of 28 had none).

Until the Analista read the ad the country was empty: the Scouts write only the free text of the place. It is now taken from
the place (a country it names, a place written the Italian way) or from the portal (talent-com-it, randstad.it, it.talent.com), and
left empty when nothing says it: a city name never implies a country.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import scout_area  # noqa: E402


@pytest.mark.parametrize("location,source,url,code", [
    ("Bologna, Italia", "linkedin", "https://www.linkedin.com/jobs/view/1", "it"),
    ("Stockholm, Sweden", "linkedin", "https://www.linkedin.com/jobs/view/1", "se"),
    ("Zürich, CH", "jobs.ch", "https://www.jobs.ch/x", "ch"),
    ("Bra (CN), Piemonte", "linkedin", "https://www.linkedin.com/jobs/view/1", "it"),
    ("Modugno (BA)", "talent-com-it", "https://it.talent.com/view?id=1", "it"),
    ("Modugno", "linkedin", "https://www.linkedin.com/jobs/view/1", None),
    ("Torino", "randstad.it", "https://www.randstad.it/offerte-lavoro/x/", "it"),
    ("", "it-talent-com", "https://it.talent.com/view?id=2", "it"),
    ("Lugano", "indeed", "https://ch.indeed.com/viewjob?jk=1", "ch"),
    ("Wien", "karriere-at", "https://www.karriere.at/j/1", "at"),
    ("London", "reed", "https://www.reed.co.uk/jobs/1", "gb"),
    # a city name implies no country, and a portal of the world says none
    ("Torino", "linkedin", "https://www.linkedin.com/jobs/view/1", None),
    ("Roma", "glassdoor", "https://www.glassdoor.com/job/1", None),
    ("Remote", "linkedin", "https://www.linkedin.com/jobs/view/1", None),
    (None, None, None, None),
])
def test_the_country_is_what_the_place_or_the_portal_say(location, source, url, code):
    assert scout_area.derive_country(location, source, url) == code


def _insert(tmp_path, n, location, source, url, agent="scout-1"):
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_AGENT_NAME": agent, "JHT_DB": str(tmp_path / "jobs.db")}
    cmd = [sys.executable, str(SKILLS / "db_insert.py"), "position", "--title", "Muratore %d" % n, "--company", "Acme %d" % n, "--url", url,
           "--source", source, "--found-by", agent, "--remote-type", "onsite"]
    if location is not None:
        cmd += ["--location", location]
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)


def _row(tmp_path, n):
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    return conn.execute("SELECT loc_country, loc_country_code FROM positions WHERE title = ?", ("Muratore %d" % n,)).fetchone()


def test_a_position_is_inserted_with_its_country(tmp_path):
    done = _insert(tmp_path, 1, "Modugno (BA)", "talent-com-it", "https://it.talent.com/view?id=1")
    assert done.returncode == 0, done.stdout + done.stderr
    assert _row(tmp_path, 1) == ("Italy", "IT")
    assert _insert(tmp_path, 2, "Zürich, CH", "jobs.ch", "https://www.jobs.ch/x", agent="user").returncode == 0
    assert _row(tmp_path, 2) == ("Switzerland", "CH")


def test_a_position_with_nothing_that_says_its_country_has_none(tmp_path):
    assert _insert(tmp_path, 1, "Torino", "linkedin", "https://www.linkedin.com/jobs/view/9").returncode == 0
    assert _row(tmp_path, 1) == (None, None)
    assert _insert(tmp_path, 2, None, "linkedin", "https://www.linkedin.com/jobs/view/10").returncode == 0
    assert _row(tmp_path, 2) == (None, None)
