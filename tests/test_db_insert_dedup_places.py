"""The same ad written with a different spelling of its place is one position (synthetic data)."""

import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
sys.path.insert(0, SKILLS_DIR)
import city_names  # noqa: E402
import db_insert  # noqa: E402

TITLE, COMPANY = 'Cameriere di sala', 'Trattoria Esempio'


@pytest.fixture()
def conn():
    c = sqlite3.connect(':memory:')
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, company TEXT NOT NULL, company_id INTEGER,
            location TEXT, url TEXT, status TEXT DEFAULT 'new',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    return c


def _store(conn, location, title=TITLE, company=COMPANY):
    conn.execute("INSERT INTO positions(title, company, location, url) VALUES (?,?,?,?)",
                 (title, company, location, 'https://example.test/stored'))
    conn.commit()


def _check(conn, location, title=TITLE, company=COMPANY):
    return db_insert.check_duplicate(conn, 'https://example.test/other', company, title, location)


@pytest.mark.parametrize('query', [
    'Gioia del Colle',
    'Gioia del Colle, Bari',
    'Gioia del Colle (BA)',
    'GIOIA DEL COLLE (ba), Puglia',
    '',
    None,
    '   ',
], ids=['bare', 'with_province_name', 'with_province_code', 'case_and_region', 'empty', 'none', 'blank'])
def test_gioia_del_colle_stored_with_province_code_is_one_place(conn, query):
    _store(conn, 'Gioia del Colle (BA)')
    existing, match_type = _check(conn, query)
    assert existing is not None, f'{query!r} must be a duplicate of «Gioia del Colle (BA)»'
    assert 'city-norm' in match_type


@pytest.mark.parametrize('stored', ['', None, 'Gioia del Colle', 'Gioia del Colle, Bari'])
def test_query_with_province_code_matches_the_other_spellings_stored(conn, stored):
    _store(conn, stored)
    existing, _ = _check(conn, 'Gioia del Colle (BA)')
    assert existing is not None


def test_similar_title_is_also_a_duplicate_across_spellings(conn):
    _store(conn, 'Gioia del Colle (BA)', title='Cuoco di linea senior')
    existing, match_type = _check(conn, 'Gioia del Colle, Bari', title='Cuoco di linea senior II')
    assert existing is not None
    assert 'simile' in match_type


@pytest.mark.parametrize('stored,query', [
    ('Gioia del Colle (BA)', 'Bari'),
    ('Gioia del Colle (BA)', 'Gioia Tauro (RC)'),
    ('Bari (BA)', 'Brindisi (BR)'),
    ('Milano (MI)', 'Roma (RM)'),
], ids=['neighbour_town', 'same_start_other_town', 'two_provinces', 'two_cities'])
def test_different_places_are_still_different(conn, stored, query):
    _store(conn, stored)
    existing, _ = _check(conn, query)
    assert existing is None


def test_different_company_or_title_is_never_a_duplicate_even_with_empty_place(conn):
    _store(conn, 'Gioia del Colle (BA)')
    assert _check(conn, '', company='Altra Trattoria')[0] is None
    assert _check(conn, '', title='Lavapiatti')[0] is None


def test_brackets_alone_are_not_turned_into_an_empty_place():
    assert city_names.normalize_city('(Remote)') == '(remote)'
    assert city_names.normalize_city('Gioia del Colle (BA)') == 'gioia del colle'
    assert city_names.normalize_city('Gioia del Colle, Bari') == 'gioia del colle'
    assert city_names.same_place('Milano (MI)', 'Milan, Italy')
    assert city_names.same_place('', 'Roma')
    assert not city_names.same_place('Roma', 'Milano')
