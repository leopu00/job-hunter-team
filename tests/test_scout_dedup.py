"""Test scout_dedup.py — dedup gerarchica come CHECK standalone (SC-05).

Verifica l'interfaccia CLI/JSON che i prompt Scout ed email-monitor usano
PRIMA di db_insert.py position. La logica vera è in db_insert.check_duplicate;
qui testiamo il wrapper end-to-end (subprocess), come lo Scout reale.

Eseguire:
    pytest tests/test_scout_dedup.py -v
"""

import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKILLS = os.path.join(REPO_ROOT, "shared", "skills")
DB_INSERT = os.path.join(SKILLS, "db_insert.py")
SCOUT_DEDUP = os.path.join(SKILLS, "scout_dedup.py")


@pytest.fixture
def jht_home(tmp_path):
    """JHT_HOME isolato + una posizione seed nel DB."""
    env = {**os.environ, "JHT_HOME": str(tmp_path)}
    # seed: Canonical / Software Engineer / Milano
    r = subprocess.run(
        [sys.executable, DB_INSERT, "position",
         "--title", "Software Engineer", "--company", "Canonical",
         "--location", "Milano, Italy", "--url", "https://jobs.example/seed-1",
         "--source", "linkedin", "--found-by", "scout-1"],
        capture_output=True, text=True, env=env,
    )
    assert r.returncode == 0, f"seed insert failed: {r.stdout} {r.stderr}"
    return env


def _check(env, **kwargs):
    args = [sys.executable, SCOUT_DEDUP, "check"]
    for k, v in kwargs.items():
        args += [f"--{k}", v]
    r = subprocess.run(args, capture_output=True, text=True, env=env)
    return r.returncode, json.loads(r.stdout.strip())


def test_exact_url_is_skip_level_1(jht_home):
    rc, out = _check(jht_home, url="https://jobs.example/seed-1")
    assert out["action"] == "skip"
    assert out["level"] == 1
    assert rc == 10


def test_same_company_title_city_is_skip_level_2(jht_home):
    # URL diverso, ma stessa azienda+titolo+città (Milano≈Milan via synonym map)
    rc, out = _check(jht_home, url="https://other.example/x",
                     company="Canonical", title="Software Engineer",
                     location="Milan, Lombardy, IT")
    assert out["action"] == "skip"
    assert out["level"] == 2
    assert rc == 10


def test_similar_title_same_city_is_skip_level_3(jht_home):
    # titolo SIMILE (>0.85) ma non identico ("Engineers" plurale) → L3, non L2
    rc, out = _check(jht_home, url="https://other.example/y",
                     company="Canonical", title="Software Engineers",
                     location="Milano")
    assert out["action"] == "skip"
    assert out["level"] == 3
    assert rc == 10


def test_different_city_is_insert(jht_home):
    # Stessa azienda+titolo ma città diversa → offerta distinta → insert
    rc, out = _check(jht_home, url="https://other.example/z",
                     company="Canonical", title="Software Engineer",
                     location="Berlin")
    assert out["action"] == "insert"
    assert rc == 0


def test_brand_new_is_insert(jht_home):
    rc, out = _check(jht_home, url="https://new.example/a",
                     company="Acme", title="Data Analyst", location="Rome")
    assert out["action"] == "insert"
    assert rc == 0


def test_missing_args_is_error(jht_home):
    # né url né (company+title) → errore d'uso
    r = subprocess.run([sys.executable, SCOUT_DEDUP, "check"],
                       capture_output=True, text=True, env=jht_home)
    assert r.returncode == 2
