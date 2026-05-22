"""Test dedup positions in shared/skills/db_insert.py.

Focus: city normalization + synonym map che addresses anomalia #3 da
docs/internal/2026-05-21-vps1-run-postmortem.md (7 (title, company)
duplicate quando stessa position arriva da source multipli).

Eseguire:
    pytest tests/test_db_insert_dedup.py -v
"""

import os
import sys
import sqlite3
import pytest

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

# Inietto SKILLS_DIR e import senza side effect su DB reale.
sys.path.insert(0, SKILLS_DIR)
import _db as _db_module  # noqa: E402
import db_insert  # noqa: E402


# ---------------------------------------------------------------------------
# Unit test: city normalization
# ---------------------------------------------------------------------------

class TestNormalizeCity:
    """_normalize_city e _normalize_city_canonical sono pure functions."""

    def test_first_token_extracted(self):
        assert db_insert._normalize_city('Milan, Italy') == 'milan'
        assert db_insert._normalize_city('Milan, Lombardy, IT') == 'milan'
        assert db_insert._normalize_city('New York, NY, USA') == 'new york'

    def test_diacritics_stripped(self):
        # 'München' (u + combining diaeresis decomposes via NFD)
        munich_decomp = 'M' + 'u' + chr(0x308) + 'nchen'
        assert db_insert._normalize_city(munich_decomp + ', Germany') == 'munchen'
        # Precomposed form
        assert db_insert._normalize_city('München') == 'munchen'
        # Köln
        assert db_insert._normalize_city('Köln') == 'koln'

    def test_empty_and_none(self):
        assert db_insert._normalize_city('') == ''
        assert db_insert._normalize_city(None) == ''
        assert db_insert._normalize_city('   ') == ''

    def test_already_lowercase(self):
        assert db_insert._normalize_city('milano') == 'milano'

    def test_synonym_map_it_to_en(self):
        # IT names map to EN canonical
        assert db_insert._normalize_city_canonical('Milano') == 'milan'
        assert db_insert._normalize_city_canonical('Roma') == 'rome'
        assert db_insert._normalize_city_canonical('Torino') == 'turin'
        # EN names map to themselves
        assert db_insert._normalize_city_canonical('Milan') == 'milan'
        assert db_insert._normalize_city_canonical('Rome') == 'rome'

    def test_synonym_map_de_to_en(self):
        assert db_insert._normalize_city_canonical('Munchen') == 'munich'
        assert db_insert._normalize_city_canonical('München') == 'munich'
        assert db_insert._normalize_city_canonical('Koln') == 'cologne'

    def test_unknown_city_unchanged(self):
        # Citta' non in synonym map → ritorna normalizzata
        assert db_insert._normalize_city_canonical('Brescia') == 'brescia'
        assert db_insert._normalize_city_canonical('Lisbon, Portugal') == 'lisbon'

    def test_multi_word_city(self):
        assert db_insert._normalize_city_canonical('New York') == 'new york'
        assert db_insert._normalize_city_canonical('Los Angeles, CA') == 'los angeles'


# ---------------------------------------------------------------------------
# Integration test: check_duplicate Level 2/3 con city varianti
# ---------------------------------------------------------------------------

@pytest.fixture()
def in_memory_db(monkeypatch):
    """DB SQLite in-memory con schema base positions, no companies FK."""
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            company_id INTEGER,
            location TEXT,
            url TEXT,
            status TEXT DEFAULT 'new',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    return conn


def _insert_test_row(conn, title, company, location, url='https://test.example/1'):
    conn.execute(
        "INSERT INTO positions(title, company, location, url) VALUES (?, ?, ?, ?)",
        (title, company, location, url)
    )
    conn.commit()


class TestCheckDuplicate:
    """check_duplicate deve matchare Milano/Milan/Milan-Lombardy come stessa city."""

    def test_level2_same_title_same_company_milano_vs_milan(self, in_memory_db):
        conn = in_memory_db
        _insert_test_row(conn, 'Software Engineer', 'Acme Corp', 'Milan, Italy')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://different.url/2',
            company='Acme Corp',
            title='Software Engineer',
            location='Milano, IT'
        )
        assert existing is not None, "Milano should match Milan via synonym"
        assert 'city-norm' in (match_type or ''), f"Expected city-norm match, got {match_type}"

    def test_level2_same_title_same_company_milan_lombardy_variant(self, in_memory_db):
        conn = in_memory_db
        _insert_test_row(conn, 'Software Engineer', 'Acme Corp', 'Milan, Italy')

        existing, _ = db_insert.check_duplicate(
            conn,
            url='https://different.url/3',
            company='Acme Corp',
            title='Software Engineer',
            location='Milan, Lombardy, IT'
        )
        assert existing is not None, "Milan-Lombardy should match Milan"

    def test_level3_similar_title_same_city(self, in_memory_db):
        conn = in_memory_db
        # Pair con similarity > 0.85: 'Senior Data Engineer' vs 'Senior Data Engineer II'
        # (0.93). Coppie con riordino (Junior X vs X Junior, ratio ~0.69) NON
        # vengono catturate dal threshold 0.85 — limitazione nota di difflib.
        _insert_test_row(conn, 'Senior Data Engineer', 'Acme Corp', 'Milano')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://different.url/4',
            company='Acme Corp',
            title='Senior Data Engineer II',
            location='Milan, Italy'
        )
        assert existing is not None
        assert 'simile' in (match_type or '')

    def test_different_cities_not_matched(self, in_memory_db):
        """Stessa azienda+titolo ma citta' davvero diverse → NON dedup."""
        conn = in_memory_db
        _insert_test_row(conn, 'Software Engineer', 'Acme Corp', 'Milan, Italy')

        existing, _ = db_insert.check_duplicate(
            conn,
            url='https://different.url/5',
            company='Acme Corp',
            title='Software Engineer',
            location='Berlin, Germany'
        )
        assert existing is None, "Milan and Berlin must be distinct"

    def test_different_company_not_matched(self, in_memory_db):
        conn = in_memory_db
        _insert_test_row(conn, 'Software Engineer', 'Acme Corp', 'Milan')

        existing, _ = db_insert.check_duplicate(
            conn,
            url='https://different.url/6',
            company='Beta Corp',
            title='Software Engineer',
            location='Milan'
        )
        assert existing is None, "Same role, different company = distinct"

    def test_diacritics_match(self, in_memory_db):
        """München vs Munich devono matchare (diacritic + synonym)."""
        conn = in_memory_db
        _insert_test_row(conn, 'Senior Backend', 'EuroCorp', 'München, Germany')

        existing, _ = db_insert.check_duplicate(
            conn,
            url='https://different.url/7',
            company='EuroCorp',
            title='Senior Backend',
            location='Munich'
        )
        assert existing is not None, "München should match Munich via diacritic+synonym"
