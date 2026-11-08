"""Position identity, city aliases, URL uniqueness and legacy migration."""

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

    @pytest.mark.parametrize('normalizer,cases', [
        pytest.param('_normalize_city', [('Milan, Italy', 'milan'),
                     ('Milan, Lombardy, IT', 'milan'), ('New York, NY, USA', 'new york')],
                     id='first_token_extracted'),
        pytest.param('_normalize_city', [('Mu\u0308nchen, Germany', 'munchen'),
                     ('München', 'munchen'), ('Köln', 'koln')], id='diacritics_stripped'),
        pytest.param('_normalize_city', [('', ''), (None, ''), ('   ', '')], id='empty_and_none'),
        pytest.param('_normalize_city', [('milano', 'milano')], id='already_lowercase'),
        pytest.param('_normalize_city_canonical', [('Milano', 'milan'), ('Roma', 'rome'),
                     ('Torino', 'turin'), ('Milan', 'milan'), ('Rome', 'rome')], id='synonym_map_it_to_en'),
        pytest.param('_normalize_city_canonical', [('Munchen', 'munich'), ('München', 'munich'),
                     ('Koln', 'cologne')], id='synonym_map_de_to_en'),
        pytest.param('_normalize_city_canonical', [('Brescia', 'brescia'),
                     ('Lisbon, Portugal', 'lisbon')], id='unknown_city_unchanged'),
        pytest.param('_normalize_city_canonical', [('New York', 'new york'),
                     ('Los Angeles, CA', 'los angeles')], id='multi_word_city'),
    ])
    def test_normalization(self, normalizer, cases):
        for value, expected in cases:
            assert getattr(db_insert, normalizer)(value) == expected


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
    """Each case retains its own database, query URL and matching oracle."""

    @pytest.mark.parametrize('stored,query,matched,match_fragment', [
        pytest.param(('Software Engineer', 'Acme Corp', 'Milan, Italy'),
                     ('Software Engineer', 'Acme Corp', 'Milano, IT', 'https://different.url/2'),
                     True, 'city-norm', id='level2_same_title_same_company_milano_vs_milan'),
        pytest.param(('Software Engineer', 'Acme Corp', 'Milan, Italy'),
                     ('Software Engineer', 'Acme Corp', 'Milan, Lombardy, IT', 'https://different.url/3'),
                     True, None, id='level2_same_title_same_company_milan_lombardy_variant'),
        pytest.param(('Senior Data Engineer', 'Acme Corp', 'Milano'),
                     ('Senior Data Engineer II', 'Acme Corp', 'Milan, Italy', 'https://different.url/4'),
                     True, 'simile', id='level3_similar_title_same_city'),
        pytest.param(('Software Engineer', 'Acme Corp', 'Milan, Italy'),
                     ('Software Engineer', 'Acme Corp', 'Berlin, Germany', 'https://different.url/5'),
                     False, None, id='different_cities_not_matched'),
        pytest.param(('Software Engineer', 'Acme Corp', 'Milan'),
                     ('Software Engineer', 'Beta Corp', 'Milan', 'https://different.url/6'),
                     False, None, id='different_company_not_matched'),
        pytest.param(('Senior Backend', 'EuroCorp', 'München, Germany'),
                     ('Senior Backend', 'EuroCorp', 'Munich', 'https://different.url/7'),
                     True, None, id='diacritics_match'),
    ])
    def test_match(self, in_memory_db, stored, query, matched, match_fragment):
        _insert_test_row(in_memory_db, *stored)
        title, company, location, url = query
        existing, match_type = db_insert.check_duplicate(
            in_memory_db, url=url, company=company, title=title, location=location)
        assert (existing is not None) == matched
        if match_fragment is not None:
            assert match_fragment in (match_type or '')

# LinkedIn IDs must match completely and survive tracking URL variations.

class TestLinkedInJobIdLevel0:
    @pytest.mark.parametrize('stored,query,matched,expected_company', [
        pytest.param([('Backend Dev', 'Acme', 'Milan',
                       'https://www.linkedin.com/jobs/view/43814702861')],
                     ('Data Engineer', 'Beta Corp', 'Rome',
                      'https://www.linkedin.com/jobs/view/4381470286'), False, None,
                     id='un_id_prefisso_di_un_altro_non_e_un_duplicato'),
        pytest.param([('Backend Dev', 'Acme', 'Milan',
                       'https://www.linkedin.com/jobs/view/4381470286')],
                     ('Data Engineer', 'Beta Corp', 'Rome',
                      'https://www.linkedin.com/jobs/view/43814702861'), False, None,
                     id='il_verso_opposto_e_altrettanto_sbagliato'),
        pytest.param([('Backend Dev', 'Acme', 'Milan',
                       'https://www.linkedin.com/jobs/view/1111111111?currentJobId=4381470286')],
                     ('Data Engineer', 'Beta Corp', 'Rome',
                      'https://www.linkedin.com/jobs/view/4381470286'), False, None,
                     id='current_job_id_di_un_altro_annuncio_non_crea_un_duplicato'),
        pytest.param([('Data Engineer', 'Beta Corp', 'Rome',
                       'https://www.linkedin.com/jobs/view/4381470286')],
                     ('Data Eng', 'Beta Srl', 'Roma',
                      'https://it.linkedin.com/jobs/view/4381470286?refId=abc&trackingId=xyz'),
                     True, None, id='lo_stesso_annuncio_con_url_diversi_resta_un_duplicato'),
        pytest.param([('Data Engineer', 'Beta Corp', 'Rome',
                       'https://www.linkedin.com/jobs/view/4381470286')],
                     ('Data Eng', 'Beta Srl', 'Roma',
                      'https://www.linkedin.com/jobs/view/4381470286?currentJobId=4381470286'),
                     True, None, id='lo_stesso_annuncio_con_current_job_id_proprio_resta_un_duplicato'),
        pytest.param([('Backend Dev', 'Acme', 'Milan',
                       'https://www.linkedin.com/jobs/view/43814702861'),
                      ('Data Engineer', 'Beta Corp', 'Rome',
                       'https://www.linkedin.com/jobs/view/4381470286')],
                     ('Data Eng', 'Beta Srl', 'Roma',
                      'https://www.linkedin.com/jobs/view/4381470286?refId=q'),
                     True, 'Beta Corp', id='trova_la_riga_giusta_anche_se_il_prefiltro_ne_pesca_un_altra'),
        pytest.param([('Backend Dev', 'Acme', 'Milan',
                       'https://jobs.lever.co/acme/4381470286')],
                     ('Data Engineer', 'Beta Corp', 'Rome',
                      'https://www.linkedin.com/jobs/view/4381470286'), False, None,
                     id='url_non_linkedin_non_passa_dal_livello_0'),
    ])
    def test_job_identity(self, in_memory_db, stored, query, matched, expected_company):
        for row in stored:
            _insert_test_row(in_memory_db, *row)
        title, company, location, url = query
        existing, match_type = db_insert.check_duplicate(
            in_memory_db, url=url, company=company, title=title, location=location)
        assert (existing is not None) == matched
        if expected_company is not None:
            assert existing['company'] == expected_company
        elif matched:
            assert (match_type or '').startswith('LinkedIn job ID'), match_type

class TestLivelli1e3RestanoIntatti:
    @pytest.mark.parametrize('stored,query,comparison,expected', [
        pytest.param(('Data Engineer', 'Beta Corp', 'Rome',
                      'https://www.linkedin.com/jobs/view/4381470286'),
                     ('Data Engineer', 'Beta Corp', 'Rome',
                      'https://www.linkedin.com/jobs/view/4381470286'),
                     'present', None, id='livello_1_url_esatto_anche_su_url_linkedin'),
        pytest.param(('Data Engineer', 'Beta Corp', 'Rome', 'https://jobs.lever.co/acme/abc-123'),
                     ('Altro Titolo', 'Altro', 'Berlin', 'https://jobs.lever.co/acme/abc-123'),
                     'equal', 'URL esatto', id='livello_1_url_esatto_non_linkedin'),
        pytest.param(('Software Engineer', 'Acme Corp', 'Milan, Italy',
                      'https://www.linkedin.com/jobs/view/1111111111'),
                     ('Software Engineer', 'Acme Corp', 'Milano, IT',
                      'https://www.linkedin.com/jobs/view/2222222222'),
                     'contains', 'city-norm', id='livello_2_e_3_ancora_raggiungibili_da_un_url_linkedin'),
    ])
    def test_duplicate_fallback(self, in_memory_db, stored, query, comparison, expected):
        _insert_test_row(in_memory_db, *stored)
        title, company, location, url = query
        existing, match_type = db_insert.check_duplicate(
            in_memory_db, url=url, company=company, title=title, location=location)
        assert existing is not None
        if comparison == 'present':
            assert match_type is not None
        elif comparison == 'equal':
            assert match_type == expected
        else:
            assert expected in (match_type or '')


class TestUnaPosizioneEsclusaRestaUnDuplicato:
    """Excluded positions still block reinsertion at every matching level."""

    @pytest.mark.parametrize('stored_url,new_url,new_company,new_title,expected', [
        ('https://www.linkedin.com/jobs/view/4381470286',
         'https://it.linkedin.com/jobs/view/4381470286?refId=x', 'Altro', 'Altro', 'LinkedIn job ID'),
        ('https://jobs.lever.co/acme/abc-123',
         'https://jobs.lever.co/acme/abc-123', 'Altro', 'Altro', 'URL esatto'),
        ('https://test.example/1',
         'https://other.example/2', 'Acme Corp', 'Senior Data Engineer', 'azienda+titolo+city-norm'),
        ('https://test.example/1',
         'https://other.example/2', 'Acme Corp', 'Senior Data Engineer II', 'azienda+titolo simile'),
    ], ids=['livello-0', 'livello-1', 'livello-2', 'livello-3'])
    def test_esclusa_e_ancora_vista(self, in_memory_db, stored_url, new_url, new_company, new_title, expected):
        conn = in_memory_db
        _insert_test_row(conn, 'Senior Data Engineer', 'Acme Corp', 'Milan, Italy', url=stored_url)
        conn.execute("UPDATE positions SET status = 'excluded'")
        conn.commit()

        existing, match_type = db_insert.check_duplicate(
            conn, url=new_url, company=new_company, title=new_title, location='Milano, IT')
        assert existing is not None, f"una posizione esclusa non blocca il reinserimento ({expected})"
        assert (match_type or '').startswith(expected), match_type


# ---------------------------------------------------------------------------
# positions.url UNIQUE — il vincolo, e la politica sui duplicati già in casa
# ---------------------------------------------------------------------------

UNIQUE_INDEX = 'idx_positions_url_unique'


def _fresh_db(tmp_path, name='jobs.db'):
    """Build the real schema on an explicit connection without resolving DB_PATH."""
    conn = sqlite3.connect(str(tmp_path / name))
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    _db_module.ensure_schema(conn)
    return conn


def _indexes(conn):
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'")}


def _make_preexisting_duplicates(conn, rows):
    """Seed duplicates before reintroducing the real unique index."""
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
        """A single schema initialization must create the index on a new database."""
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

    @pytest.mark.parametrize('suffix', [
        pytest.param('duplicato', id='la_migrazione_non_fallisce_e_non_perde_righe'),
        pytest.param('tre-volte', id='tre_righe_sullo_stesso_url_finiscono_tutte_distinte'),
    ])
    def test_three_preexisting_rows_survive_with_distinct_urls(self, tmp_path, monkeypatch, suffix):
        monkeypatch.setenv('JHT_HOME', str(tmp_path))
        conn = _fresh_db(tmp_path)
        url = f'https://jobs.example/{suffix}'
        ids = _make_preexisting_duplicates(conn, [('Backend Dev', 'Acme', url, 'new')] * 3)
        _db_module.ensure_schema(conn)
        assert UNIQUE_INDEX in _indexes(conn), "the unique index was not created"
        rows = conn.execute("SELECT id, url FROM positions WHERE id IN (?,?,?)", ids).fetchall()
        assert {row['id'] for row in rows} == set(ids), "the migration deleted rows"
        assert len({row['url'] for row in rows}) == 3, rows

    def test_vince_la_riga_con_piu_lavoro_sopra(self, tmp_path, monkeypatch):
        """The scored row wins despite its higher ID."""
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
        assert 'duplicate' in (perdente['notes'] or '').lower(), perdente['notes']

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
        """Upgrade a database built by the historical module, not a copied schema."""
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


# check-url must use the same full LinkedIn ID boundary as insertion.

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


@pytest.mark.parametrize('title,url,needle,found', [
    pytest.param('Altro annuncio', 'https://www.linkedin.com/jobs/view/43814702861',
                 '4381470286', False, id='non_confonde_un_id_col_suo_prolungamento'),
    pytest.param('Annuncio', 'https://www.linkedin.com/jobs/view/43814702861',
                 '43814702861', True, id='trova_ancora_lid_giusto'),
    pytest.param('Annuncio', 'https://www.linkedin.com/jobs/view/1111111111?currentJobId=4381470286',
                 '4381470286', False, id='ignora_un_id_altrui_in_query_string'),
])
def test_check_url_identity(tmp_path, monkeypatch, title, url, needle, found):
    out = _check_url_out(tmp_path, monkeypatch, [(title, 'ACME', url, 'new')], needle)
    if found:
        assert 'FOUND' in out and 'NOT FOUND' not in out
    else:
        assert 'NOT FOUND' in out
