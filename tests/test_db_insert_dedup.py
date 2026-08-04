"""Test dedup positions in shared/skills/db_insert.py.

Due famiglie di test, un solo tema — che una posizione buona non venga
scartata come doppione, e che un doppione non entri due volte:

1. city normalization + synonym map, che addresses anomalia #3 da
   docs/internal/postmortems/2026-05-21-vps1-run-postmortem.md (7
   (title, company) duplicate quando stessa position arriva da source
   multipli);
2. correttezza del livello 0 (LinkedIn job ID) e del vincolo UNIQUE su
   `positions.url` — [DEDUP-URL-CORRECTNESS], audit del 2026-07-30.

Eseguire:
    pytest tests/test_db_insert_dedup.py -v
"""

import json
import os
import subprocess
import sys
import sqlite3
import pytest

REPO_ROOT  = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_INSERT  = os.path.join(SKILLS_DIR, 'db_insert.py')

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


# ---------------------------------------------------------------------------
# positions.url UNIQUE — il vincolo, e la politica sui duplicati già in casa
# ---------------------------------------------------------------------------

UNIQUE_INDEX = 'idx_positions_url_unique'


def _fresh_db(tmp_path, name='jobs.db'):
    """DB reale su disco con lo schema completo.

    `ensure_schema` lavora sulla connessione che le passi — `DB_PATH` serve
    solo a `get_db`, che qui non usiamo. Niente subprocess: i test restano
    veloci e leggibili.
    """
    conn = sqlite3.connect(str(tmp_path / name))
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    _db_module.ensure_schema(conn)
    return conn


def _indexes(conn):
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'")}


def _make_preexisting_duplicates(conn, rows):
    """Riporta il DB allo stato PRIMA del vincolo e ci mette dei duplicati.

    È il solo modo onesto di provare la migrazione: il DB deve arrivarci già
    sporco, come quello di un utente vero.
    """
    conn.execute(f"DROP INDEX IF EXISTS {UNIQUE_INDEX}")
    ids = []
    for title, company, url, status in rows:
        cur = conn.execute(
            "INSERT INTO positions (title, company, url, status) VALUES (?,?,?,?)",
            (title, company, url, status))
        ids.append(cur.lastrowid)
    conn.commit()
    return ids


class TestVincoloUnicoSuUrl:

    def test_un_db_nuovo_nasce_gia_col_vincolo(self, tmp_path):
        """La trappola di `fix(db): a new jobs.db was missing every column`:
        una migrazione che gira solo prima del CREATE TABLE non trova niente
        da fare su un DB nuovo. `_run_migrations` gira sui due lati, quindi
        UNA chiamata deve bastare."""
        conn = _fresh_db(tmp_path)
        assert UNIQUE_INDEX in _indexes(conn)

    def test_due_righe_con_lo_stesso_url_vengono_rifiutate(self, tmp_path):
        conn = _fresh_db(tmp_path)
        conn.execute("INSERT INTO positions (title, company, url) VALUES ('A','Acme','https://x.example/1')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO positions (title, company, url) VALUES ('B','Beta','https://x.example/1')")

    def test_le_righe_senza_url_non_si_danno_fastidio(self, tmp_path):
        """L'indice è parziale: NULL e stringa vuota restano fuori."""
        conn = _fresh_db(tmp_path)
        for i in range(3):
            conn.execute("INSERT INTO positions (title, company, url) VALUES (?,?,NULL)", (f'T{i}', 'Acme'))
            conn.execute("INSERT INTO positions (title, company, url) VALUES (?,?,'')", (f'E{i}', 'Acme'))
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0] == 6

    def test_una_seconda_ensure_schema_non_rifa_il_lavoro(self, tmp_path):
        conn = _fresh_db(tmp_path)
        before = _indexes(conn)
        _db_module.ensure_schema(conn)
        assert _indexes(conn) == before


class TestMigrazioneConDuplicatiPreesistenti:
    """La politica dichiarata: nessuna riga viene cancellata, vince chi ha più
    lavoro sopra, i perdenti tengono la riga e cambiano URL con un frammento."""

    def test_la_migrazione_non_fallisce_e_non_perde_righe(self, tmp_path, monkeypatch):
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        url = 'https://jobs.example/duplicato'
        ids = _make_preexisting_duplicates(conn, [
            ('Backend Dev', 'Acme', url, 'new'),
            ('Backend Dev', 'Acme', url, 'new'),
            ('Backend Dev', 'Acme', url, 'new'),
        ])

        _db_module.ensure_schema(conn)   # non deve sollevare

        assert UNIQUE_INDEX in _indexes(conn), "il vincolo non è stato creato"
        rimaste = {r[0] for r in conn.execute(
            "SELECT id FROM positions WHERE id IN (?,?,?)", ids)}
        assert rimaste == set(ids), "la migrazione ha cancellato delle righe"

    def test_vince_la_riga_con_piu_lavoro_sopra(self, tmp_path, monkeypatch):
        """Non 'la più vecchia': quella con application > score > status più
        avanzato. Qui il vincitore è la riga con lo score, che ha l'id più
        ALTO — così il test non passerebbe per caso ordinando per id."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        url = 'https://jobs.example/con-score'
        primo, secondo = _make_preexisting_duplicates(conn, [
            ('Backend Dev', 'Acme', url, 'new'),
            ('Backend Dev', 'Acme', url, 'scored'),
        ])
        conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?, 80)", (secondo,))
        conn.commit()

        _db_module.ensure_schema(conn)

        urls = dict(conn.execute("SELECT id, url FROM positions WHERE id IN (?,?)", (primo, secondo)))
        assert urls[secondo] == url, "doveva vincere la riga con lo score"
        assert urls[primo].startswith(url + '#jht-duplicate-'), urls[primo]
        assert str(secondo) in urls[primo], "il frammento deve dire di chi è duplicato"

    def test_tre_righe_sullo_stesso_url_finiscono_tutte_distinte(self, tmp_path, monkeypatch):
        """Due perdenti nello stesso gruppo non possono ricevere la stessa
        stringa, altrimenti l'indice unico non nascerebbe comunque."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        url = 'https://jobs.example/tre-volte'
        ids = _make_preexisting_duplicates(conn, [
            ('Backend Dev', 'Acme', url, 'new'),
            ('Backend Dev', 'Acme', url, 'new'),
            ('Backend Dev', 'Acme', url, 'new'),
        ])

        _db_module.ensure_schema(conn)

        urls = [r[0] for r in conn.execute(
            "SELECT url FROM positions WHERE id IN (?,?,?)", ids)]
        assert len(set(urls)) == 3, urls
        assert UNIQUE_INDEX in _indexes(conn)

    def test_il_link_del_perdente_apre_ancora_la_stessa_pagina(self, tmp_path, monkeypatch):
        """Frammento, non query string: `#...` non viaggia al server."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        url = 'https://jobs.example/frammento'
        primo, secondo = _make_preexisting_duplicates(conn, [
            ('Backend Dev', 'Acme', url, 'scored'),
            ('Backend Dev', 'Acme', url, 'new'),
        ])

        _db_module.ensure_schema(conn)

        perdente = conn.execute("SELECT url, notes FROM positions WHERE id = ?", (secondo,)).fetchone()
        assert perdente['url'].split('#', 1)[0] == url
        assert 'duplicato' in (perdente['notes'] or '').lower(), perdente['notes']

    def test_lo_spostamento_finisce_nel_log(self, tmp_path, monkeypatch):
        """Su un DB di un utente vero deve restare una traccia leggibile."""
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        url = 'https://jobs.example/loggato'
        _make_preexisting_duplicates(conn, [
            ('Backend Dev', 'Acme', url, 'new'),
            ('Backend Dev', 'Acme', url, 'new'),
        ])

        _db_module.ensure_schema(conn)

        log = tmp_path / 'logs' / 'url-dedup.log'
        assert log.exists(), "nessun audit dello spostamento"
        righe = [json.loads(l) for l in log.read_text(encoding='utf-8').splitlines() if l.strip()]
        assert righe and righe[0]['url'] == url, righe

    def test_un_db_di_giugno_con_duplicati_si_aggiorna(self, tmp_path, monkeypatch):
        """La prova vera: il DB di partenza è costruito col `_db.py` di un
        commit precedente, non a mano. Uno schema scritto a mano non è mai
        fedele abbastanza per provare che una migrazione regge."""
        old_src = subprocess.run(
            ['git', 'show', '50d804009:shared/skills/_db.py'],
            capture_output=True, text=True, cwd=REPO_ROOT)
        if old_src.returncode != 0:
            pytest.skip('commit di riferimento non presente in questo checkout')

        old_dir = tmp_path / 'old'
        old_dir.mkdir()
        (old_dir / '_db.py').write_text(old_src.stdout, encoding='utf-8')

        db = str(tmp_path / 'jobs.db')
        url = 'https://jobs.example/vecchio-duplicato'
        build = subprocess.run(
            [sys.executable, '-c', f"""
import sys
sys.path.insert(0, {str(old_dir)!r})
from _db import get_db, ensure_schema
conn = get_db(); ensure_schema(conn)
for status in ('new', 'scored'):
    conn.execute("INSERT INTO positions (title, company, url, status) VALUES (?,?,?,?)",
                 ('Backend Dev', 'Acme', {url!r}, status))
conn.commit(); conn.close()
"""],
            capture_output=True, text=True,
            env={**os.environ, 'JHT_DB': db, 'JHT_HOME': str(tmp_path)})
        assert build.returncode == 0, build.stderr

        vecchio = sqlite3.connect(db)
        assert UNIQUE_INDEX not in {r[0] for r in vecchio.execute(
            "SELECT name FROM sqlite_master WHERE type='index'")}, \
            "il DB di partenza non è davvero vecchio: il test non proverebbe nulla"
        vecchio.close()

        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        _db_module.ensure_schema(conn)      # non deve sollevare

        assert UNIQUE_INDEX in _indexes(conn)
        righe = conn.execute(
            "SELECT status, url FROM positions ORDER BY id").fetchall()
        assert len(righe) == 2, "l'upgrade ha perso una riga"
        vincitore = [r for r in righe if r['status'] == 'scored'][0]
        perdente = [r for r in righe if r['status'] == 'new'][0]
        assert vincitore['url'] == url
        assert perdente['url'].startswith(url + '#jht-duplicate-')

    def test_le_righe_senza_url_non_vengono_toccate(self, tmp_path, monkeypatch):
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        conn.execute(f"DROP INDEX IF EXISTS {UNIQUE_INDEX}")
        for _ in range(3):
            conn.execute("INSERT INTO positions (title, company, url) VALUES ('T','Acme',NULL)")
            conn.execute("INSERT INTO positions (title, company, url) VALUES ('E','Acme','')")
        conn.commit()

        _db_module.ensure_schema(conn)

        assert conn.execute(
            "SELECT COUNT(*) FROM positions WHERE url IS NULL").fetchone()[0] == 3
        assert conn.execute(
            "SELECT COUNT(*) FROM positions WHERE url = ''").fetchone()[0] == 3


# ---------------------------------------------------------------------------
# La race: check-then-insert senza transazione
# ---------------------------------------------------------------------------

def test_sei_scout_sullo_stesso_url_scrivono_una_riga_sola(tmp_path):
    """Sei processi `db_insert.py position` lanciati insieme sullo stesso URL.

    Azienda e titolo sono DIVERSI apposta: i livelli 2 e 3 non devono poter
    catturare il caso, quello che deve reggere è la coppia dedup+INSERT
    sull'URL — cioè esattamente ciò che C-21 oggi evita dividendo i territori
    e che [SOURCE-YIELD-MEMORY] vuole invece mettere alla prova.

    Il test asserisce anche che nessuno dei perdenti *crepi*: con l'indice
    unico un INSERT concorrente può alzare un IntegrityError, e uno Scout
    deve leggere "DUPLICATO" (rc 1) nel proprio turno, non un traceback.

    Onestà sul potere di questo test: la finestra fra il SELECT e l'INSERT è
    di microsecondi, quindi anche col codice PRIMA del fix passerebbe quasi
    sempre. È un guardiano dell'invariante e del comportamento in
    contesa — la prova che il vincolo esiste sta in
    `TestVincoloUnicoSuUrl::test_due_righe_con_lo_stesso_url_vengono_rifiutate`.
    """
    env = {**os.environ, 'JHT_HOME': str(tmp_path)}
    # Prima un insert normale: lo schema esiste già, così la gara è fra gli
    # INSERT e non fra sei `ensure_schema` concorrenti.
    seed = subprocess.run(
        [sys.executable, DB_INSERT, 'position', '--title', 'Seed',
         '--company', 'Seed Co', '--url', 'https://jobs.example/seed',
         '--source', 'test', '--found-by', 'scout-0'],
        capture_output=True, text=True, env=env)
    assert seed.returncode == 0, seed.stderr

    url = 'https://jobs.example/gara'
    procs = [
        subprocess.Popen(
            [sys.executable, DB_INSERT, 'position', '--title', f'Ruolo {i}',
             '--company', f'Azienda {i}', '--url', url,
             '--source', 'test', '--found-by', f'scout-{i}'],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        for i in range(1, 7)
    ]
    outs = [p.communicate() for p in procs]
    rcs = [p.returncode for p in procs]

    conn = sqlite3.connect(str(tmp_path / 'jobs.db'))
    try:
        n = conn.execute("SELECT COUNT(*) FROM positions WHERE url = ?", (url,)).fetchone()[0]
    finally:
        conn.close()

    assert n == 1, f"{n} righe per lo stesso URL — la race è aperta. Output: {outs}"
    assert rcs.count(0) == 1, f"deve inserire uno solo: {rcs} {outs}"
    assert set(rcs) <= {0, 1}, (
        f"un perdente è crepato invece di riportare il duplicato: {rcs} {outs}")


# ── Gate 1 dello Scout: check-url ha lo stesso ancoraggio del livello 0 ──────
#
# `db_query.check_url` era il gemello peggiore del difetto del livello 0: il suo
# pattern aveva un `%` anche FRA `view/` e l'id (`%/jobs/view/%<id>%`), quindi
# bastava che quelle cifre comparissero in un punto qualsiasi di un URL job-view
# perche' dicesse TROVATA. E' il primo gate che lo Scout interroga: un falso
# positivo qui gli fa saltare un annuncio nuovo prima ancora di inserirlo.

def _check_url_out(tmp_path, monkeypatch, rows, needle):
    import importlib
    import sqlite3
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, "
                 "company TEXT, url TEXT, status TEXT)")
    conn.executemany("INSERT INTO positions (title,company,url,status) "
                     "VALUES (?,?,?,?)", rows)
    conn.commit()
    conn.close()

    monkeypatch.setenv("JHT_DB", str(db))
    sys.path.insert(0, SKILLS_DIR)
    import _db
    importlib.reload(_db)
    dq = importlib.import_module("db_query")
    importlib.reload(dq)
    monkeypatch.setattr(dq, "ensure_schema", lambda c: None)

    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        dq.check_url(needle)
    return buf.getvalue()


def test_check_url_non_confonde_un_id_col_suo_prolungamento(tmp_path, monkeypatch):
    out = _check_url_out(
        tmp_path, monkeypatch,
        [("Altro annuncio", "ACME",
          "https://www.linkedin.com/jobs/view/43814702861", "new")],
        "4381470286")
    assert "NON TROVATA" in out, (
        "4381470286 non e' 43814702861: un TROVATA qui fa saltare allo Scout "
        "un annuncio nuovo")


def test_check_url_trova_ancora_lid_giusto(tmp_path, monkeypatch):
    out = _check_url_out(
        tmp_path, monkeypatch,
        [("Annuncio", "ACME",
          "https://www.linkedin.com/jobs/view/43814702861", "new")],
        "43814702861")
    assert "TROVATA" in out and "NON TROVATA" not in out


def test_check_url_ignora_un_id_altrui_in_query_string(tmp_path, monkeypatch):
    out = _check_url_out(
        tmp_path, monkeypatch,
        [("Annuncio", "ACME",
          "https://www.linkedin.com/jobs/view/1111111111?currentJobId=4381470286",
          "new")],
        "4381470286")
    assert "NON TROVATA" in out, (
        "l'id sta nella query string, non nel path: non e' quell'annuncio")
