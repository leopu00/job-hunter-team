"""The list of positions says where each one is, and the Assistente is told to take the place from it.

A company's name can hold the name of another city («Acme Montpellier» with an office in Lyon). The list the Assistente reads had no
place column, so the model filled it in from the name and told the person about an offer «in Montpellier» that was in Lyon.

Eseguire con: pytest tests/test_positions_listing_location.py -v
"""

import glob
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')


def _listing(tmp_path, rows):
    db = str(tmp_path / 'jobs.db')
    env = {**os.environ, 'JHT_DB': db, 'JHT_HOME': str(tmp_path), 'PYTHONDONTWRITEBYTECODE': '1'}
    seed = subprocess.run([sys.executable, '-c', f'''
import sys
sys.path.insert(0, {SKILLS_DIR!r})
from _db import get_db, ensure_schema
c = get_db(); ensure_schema(c)
for title, company, location, city in {rows!r}:
    c.execute("INSERT INTO positions (title, company, location, loc_city, status) VALUES (?, ?, ?, ?, 'scored')", (title, company, location, city))
c.commit(); c.close()
'''], capture_output=True, text=True, env=env)
    assert seed.returncode == 0, seed.stderr
    done = subprocess.run([sys.executable, os.path.join(SKILLS_DIR, 'db_query.py'), 'positions'], capture_output=True, text=True, env=env)
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_the_list_has_a_location_column(tmp_path):
    out = _listing(tmp_path, [('Aide-soignant', 'Acme Montpellier', 'Lyon 7e', 'Lyon')])
    header = next(line for line in out.splitlines() if 'Company' in line)
    assert 'Location' in header
    assert header.index('Title') < header.index('Location') < header.index('Remote')


def test_the_place_is_the_one_of_the_position_not_the_one_in_the_company_name(tmp_path):
    out = _listing(tmp_path, [('Aide-soignant', 'Acme Montpellier', 'Lyon 7e', 'Lyon')])
    row = next(line for line in out.splitlines() if 'Aide-soignant' in line)
    assert 'Lyon 7e' in row
    # the city the name holds is in the company column, which ends before the place starts
    assert row.index('Montpellier') < row.index('Lyon 7e')
    assert row.count('Montpellier') == 1


def test_without_a_location_the_city_is_used_then_a_dash(tmp_path):
    out = _listing(tmp_path, [('A', 'One', None, 'Parma'), ('B', 'Two', None, None)])
    one = next(line for line in out.splitlines() if ' One ' in line)
    two = next(line for line in out.splitlines() if ' Two ' in line)
    assert 'Parma' in one
    assert ' - ' in two


def test_every_prompt_of_the_assistente_says_the_place_comes_from_the_position():
    prompts = glob.glob(os.path.join(REPO_ROOT, 'agents', 'assistente', 'assistente*.md'))
    assert len(prompts) == 7
    for path in prompts:
        with open(path, encoding='utf-8') as handle:
            text = handle.read()
        rule = next(line for line in text.splitlines() if line.startswith('**A-04**'))
        assert '`location`' in rule and 'Location' in rule, path
