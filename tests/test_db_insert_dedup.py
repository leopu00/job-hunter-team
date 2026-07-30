"""Test dedup positions in shared/skills/db_insert.py.

Due famiglie di test, un solo tema — che una posizione buona non venga
scartata come doppione, e che un doppione non entri due volte:

1. city normalization + synonym map, che addresses anomalia #3 da
   docs/internal/postmortems/2026-05-21-vps1-run-postmortem.md (7
   (title, company) duplicate quando stessa position arriva da source
   multipli);
2. correttezza del livello 0 (LinkedIn job ID) — [DEDUP-URL-CORRECTNESS],
   audit del 2026-07-30.

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


# ---------------------------------------------------------------------------
# Livello 0 — LinkedIn job ID: dedup sì, sottostringa no
#
# [DEDUP-URL-CORRECTNESS]. `url LIKE '%<id>%'` non sa dove finisce l'id:
# cercando 4381470286 matchava la riga il cui id è 43814702861, e una
# posizione NUOVA veniva scartata come doppione con il log a dire che era un
# doppione. Il livello 0 deve restare (lo stesso annuncio LinkedIn circola con
# URL diversi): quello che sparisce è il falso positivo, non la dedup.
# ---------------------------------------------------------------------------

class TestLinkedInJobIdLevel0:

    def test_un_id_prefisso_di_un_altro_non_e_un_duplicato(self, in_memory_db):
        """Il caso misurato in laboratorio: 4381470286 vs 43814702861."""
        conn = in_memory_db
        _insert_test_row(conn, 'Backend Dev', 'Acme', 'Milan',
                         url='https://www.linkedin.com/jobs/view/43814702861')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/4381470286',
            company='Beta Corp', title='Data Engineer', location='Rome',
        )
        assert existing is None, (
            f"4381470286 non è 43814702861: match spurio ({match_type}) — "
            "una posizione buona verrebbe scartata come doppione"
        )

    def test_il_verso_opposto_e_altrettanto_sbagliato(self, in_memory_db):
        """L'id più lungo cercato contro il più corto già in tabella."""
        conn = in_memory_db
        _insert_test_row(conn, 'Backend Dev', 'Acme', 'Milan',
                         url='https://www.linkedin.com/jobs/view/4381470286')

        existing, _ = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/43814702861',
            company='Beta Corp', title='Data Engineer', location='Rome',
        )
        assert existing is None

    def test_current_job_id_di_un_altro_annuncio_non_crea_un_duplicato(self, in_memory_db):
        """L'id sta nel path; `currentJobId=` in query string è un altro annuncio.

        È il caso che rende il difetto IMMEDIATO, non solo latente: basta che
        uno Scout salvi un URL con la query string così com'è.
        """
        conn = in_memory_db
        _insert_test_row(
            conn, 'Backend Dev', 'Acme', 'Milan',
            url='https://www.linkedin.com/jobs/view/1111111111?currentJobId=4381470286')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/4381470286',
            company='Beta Corp', title='Data Engineer', location='Rome',
        )
        assert existing is None, (
            f"match su un currentJobId= altrui ({match_type}): l'id dell'annuncio "
            "è quello del path"
        )

    def test_lo_stesso_annuncio_con_url_diversi_resta_un_duplicato(self, in_memory_db):
        """La funzione del livello 0, quella da NON perdere."""
        conn = in_memory_db
        _insert_test_row(conn, 'Data Engineer', 'Beta Corp', 'Rome',
                         url='https://www.linkedin.com/jobs/view/4381470286')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://it.linkedin.com/jobs/view/4381470286?refId=abc&trackingId=xyz',
            company='Beta Srl', title='Data Eng', location='Roma',
        )
        assert existing is not None, "stesso annuncio, URL diverso: è un duplicato"
        assert (match_type or '').startswith('LinkedIn job ID'), match_type

    def test_lo_stesso_annuncio_con_current_job_id_proprio_resta_un_duplicato(self, in_memory_db):
        """`?currentJobId=` che ripete l'id del path non deve confondere."""
        conn = in_memory_db
        _insert_test_row(conn, 'Data Engineer', 'Beta Corp', 'Rome',
                         url='https://www.linkedin.com/jobs/view/4381470286')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/4381470286?currentJobId=4381470286',
            company='Beta Srl', title='Data Eng', location='Roma',
        )
        assert existing is not None
        assert (match_type or '').startswith('LinkedIn job ID'), match_type

    def test_trova_la_riga_giusta_anche_se_il_prefiltro_ne_pesca_un_altra(self, in_memory_db):
        """Il duplicato vero può arrivare DOPO un candidato preso di striscio.

        Con `fetchone` la query restituiva la prima riga che il LIKE toccava:
        se era quella dall'id più lungo, il duplicato vero non veniva mai
        guardato. Serve scorrere i candidati, non fermarsi al primo.
        """
        conn = in_memory_db
        _insert_test_row(conn, 'Backend Dev', 'Acme', 'Milan',
                         url='https://www.linkedin.com/jobs/view/43814702861')
        _insert_test_row(conn, 'Data Engineer', 'Beta Corp', 'Rome',
                         url='https://www.linkedin.com/jobs/view/4381470286')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/4381470286?refId=q',
            company='Beta Srl', title='Data Eng', location='Roma',
        )
        assert existing is not None, "il duplicato vero è la seconda riga, non la prima"
        assert existing['company'] == 'Beta Corp', dict(existing)

    def test_url_non_linkedin_non_passa_dal_livello_0(self, in_memory_db):
        """Un id che compare in un URL non-LinkedIn non è un LinkedIn job ID."""
        conn = in_memory_db
        _insert_test_row(conn, 'Backend Dev', 'Acme', 'Milan',
                         url='https://jobs.lever.co/acme/4381470286')

        existing, _ = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/4381470286',
            company='Beta Corp', title='Data Engineer', location='Rome',
        )
        assert existing is None


class TestLivelli1e3RestanoIntatti:
    """Il fix tocca SOLO il livello 0: gli altri tre devono comportarsi uguale."""

    def test_livello_1_url_esatto_anche_su_url_linkedin(self, in_memory_db):
        conn = in_memory_db
        url = 'https://www.linkedin.com/jobs/view/4381470286'
        _insert_test_row(conn, 'Data Engineer', 'Beta Corp', 'Rome', url=url)

        existing, match_type = db_insert.check_duplicate(
            conn, url=url, company='Beta Corp', title='Data Engineer', location='Rome')
        assert existing is not None
        # L'URL esatto è anche lo stesso job id: vince il livello 0, che è
        # più specifico. Quello che conta è che il duplicato sia visto.
        assert match_type is not None

    def test_livello_1_url_esatto_non_linkedin(self, in_memory_db):
        conn = in_memory_db
        url = 'https://jobs.lever.co/acme/abc-123'
        _insert_test_row(conn, 'Data Engineer', 'Beta Corp', 'Rome', url=url)

        existing, match_type = db_insert.check_duplicate(
            conn, url=url, company='Altro', title='Altro Titolo', location='Berlin')
        assert existing is not None
        assert match_type == 'URL esatto'

    def test_livello_2_e_3_ancora_raggiungibili_da_un_url_linkedin(self, in_memory_db):
        """Un URL LinkedIn che non matcha al livello 0 deve cadere sui livelli
        successivi, non uscire dalla funzione."""
        conn = in_memory_db
        _insert_test_row(conn, 'Software Engineer', 'Acme Corp', 'Milan, Italy',
                         url='https://www.linkedin.com/jobs/view/1111111111')

        existing, match_type = db_insert.check_duplicate(
            conn,
            url='https://www.linkedin.com/jobs/view/2222222222',
            company='Acme Corp', title='Software Engineer', location='Milano, IT',
        )
        assert existing is not None
        assert 'city-norm' in (match_type or ''), match_type
