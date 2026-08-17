"""
[JHT-TEAM-API-BOUNDARY] Parità di VALORI fra i due lettori di jobs.db.

Perché esiste. `shared/queries/readonly-sqlite.js` ri-esprime in JS l'SQL di
`shared/skills/db_query.py`: è una DEPARTURE dalla lettera della decisione 4 di
ADR-0009, accettata per la fase 1 a patto che la copia non possa derivare in
silenzio. Il cancello di testo
(`tests/js/tasks/api-read-sql-drift.test.ts`) confronta le stringhe SQL e costa
millisecondi. Questo confronta i VALORI, che è l'altra metà del problema: due
query identiche parola per parola possono comunque rispondere in modo diverso
per coercizione di tipo (REAL letto come int), per NULL, per ordine a parità di
score, o per una chiave che uno dei due lettori aggiunge.

Cosa NON prova: che il payload HTTP sia questo. Qui si confronta il lettore, non
la route — la route la provano i test di `tests/js/tasks/api-handler-*`.

Eseguire con: python -m pytest tests/test_api_read_parity.py -q
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')
JS_MODULE = os.path.join(REPO_ROOT, 'shared', 'queries', 'readonly-sqlite.js')


# Lo schema lo costruisce `_db.ensure_schema` in un interprete SEPARATO, per la
# stessa ragione documentata in tests/test_db_query_json.py: `_db.DB_PATH` si
# risolve una volta sola, quindi importarlo qui legherebbe tutti i test al
# database del primo. Costa un processo, e in cambio lo schema è quello VERO —
# che è il punto: un fixture scritto a mano proverebbe la parità fra due letture
# di uno schema che non esiste in produzione.
#
# I dati sono scelti per gli assi che il confronto di testo non vede:
#   · un pareggio di score (82 su due posizioni) risolto da `p.found_at DESC` —
#     le date sono tutte DIVERSE di proposito: un pareggio pieno lascerebbe
#     l'ordine a discrezione di SQLite, e i due lettori usano due build diverse;
#   · una posizione senza score (COALESCE(...) = 0, quindi ultima);
#   · un REAL (`office_lat`) e testo accentato, che passano da due
#     serializzatori diversi;
#   · un'azienda con `verdict` NULL, che NON deve entrare in
#     `companies_by_verdict`;
#   · una posizione senza `company_id`, che non deve entrare nel conteggio.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
conn.execute("INSERT INTO companies (name, hq_country, verdict, sector) "
             "VALUES (?,?,?,?)", ('Acme SpA', 'IT', 'GO', 'Fintech'))
conn.execute("INSERT INTO companies (name, hq_country, verdict) "
             "VALUES (?,?,?)", ('Zeta GmbH', 'DE', None))
rows = [
    ('Backend Engineer', 'Acme SpA', 'scored', 'linkedin',
     '2026-08-01 09:00:00', 1, 45.4642, 'Milano'),
    ('Stripe Integrations', 'Acme SpA', 'new', 'greenhouse',
     '2026-08-02 09:00:00', None, None, None),
    ('Donn\\u00e9es Ing\\u00e9nieur', 'Stripe', 'new', 'lever',
     '2026-08-03 09:00:00', None, None, 'Paris'),
    ('Old Role', 'Zeta GmbH', 'excluded', 'indeed',
     '2026-07-01 09:00:00', 2, None, None),
]
for row in rows:
    conn.execute(
        "INSERT INTO positions (title, company, status, source, found_at, "
        "company_id, office_lat, location) VALUES (?,?,?,?,?,?,?,?)", row)
conn.execute("INSERT INTO scores (position_id, total_score, stack_match) "
             "VALUES (?,?,?)", (1, 82, 30))
conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)", (3, 82))
conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)", (4, 10))
conn.execute("INSERT INTO applications (position_id, status, written_at) "
             "VALUES (?,?,?)", (1, 'review', '2026-08-04 10:00:00'))
conn.execute("INSERT INTO applications (position_id, status, applied_at, "
             "critic_verdict) VALUES (?,?,?,?)",
             (4, 'applied', '2026-07-05 10:00:00', 'APPROVED'))
conn.commit()
conn.close()
"""


# Il lettore JS interrogato in un colpo solo: un processo, non cinque. Su questa
# macchina il disco è il collo di bottiglia documentato, e ogni `node` in più è
# un fork che se lo contende.
_JS_DRIVER = """
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const [modulePath, dbPath] = process.argv.slice(2);
const mod = await import(pathToFileURL(modulePath).href);
const backend = mod.createReadonlyBackend({ DatabaseSync, dbPath });
try {
  process.stdout.write(JSON.stringify({
    positions: backend.listPositions({}),
    filtered: backend.listPositions({ status: 'new' }),
    company: backend.listPositions({ company: 'Stripe' }),
    detail: backend.getPosition(1),
    missing: backend.getPosition(999999),
    dashboard: backend.getDashboard(),
  }));
} finally {
  backend.close();
}
"""


def _utf8_env(**extra):
    """UTF-8 su tutta la tratta: il fixture ha testo accentato e su Windows la
    codifica di default della console lo storpierebbe in un modo che sembra una
    differenza di parità e non lo è."""
    return {**os.environ, 'PYTHONIOENCODING': 'utf-8', **extra}


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / 'jobs.db')
    seed = subprocess.run(
        [sys.executable, '-c', _SEED.format(skills=SKILLS_DIR)],
        capture_output=True, text=True, encoding='utf-8',
        env=_utf8_env(JHT_DB=path),
    )
    assert seed.returncode == 0, f"seed fallito:\n{seed.stderr}"
    return path


def _py(db_path, *args):
    """Una riga JSON da `db_query.py`, cioè quello che stampa oggi
    `jht positions --json` (il CLI lo esegue nel container, non lo riscrive)."""
    result = subprocess.run(
        [sys.executable, DB_QUERY, *args, '--json'],
        capture_output=True, text=True, encoding='utf-8',
        env=_utf8_env(JHT_DB=db_path), cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr
    lines = [ln for ln in result.stdout.strip().split('\n') if ln.strip()]
    assert len(lines) == 1, f"attese 1 riga, trovate {len(lines)}: {lines[:3]}"
    return json.loads(lines[0])


@pytest.fixture
def js(db, tmp_path):
    """Le stesse letture attraverso `shared/queries/readonly-sqlite.js`."""
    node = shutil.which('node')
    if node is None:
        pytest.skip('node non è nel PATH: la parità JS non è verificabile qui')
    driver = tmp_path / 'read_via_js.mjs'
    driver.write_text(_JS_DRIVER, encoding='utf-8')
    result = subprocess.run(
        [node, str(driver), JS_MODULE, db],
        capture_output=True, text=True, encoding='utf-8', cwd=REPO_ROOT,
    )
    # stderr NON si asserisce vuoto: `node:sqlite` stampa lì il suo
    # ExperimentalWarning a ogni caricamento (misurato su v22.20.0).
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_positions_stesse_righe_stesso_ordine(db, js):
    """Il contratto è un array NUDO di oggetti con i nomi di colonna del DB."""
    expected = _py(db, 'positions')
    assert isinstance(expected, list) and len(expected) == 4
    # Il pareggio a 82 lo rompe `p.found_at DESC`: prima la #3 (03/08), poi la
    # #1 (01/08). La #2 non ha score, quindi COALESCE la manda in fondo.
    assert [r['id'] for r in expected] == [3, 1, 4, 2]
    assert js['positions'] == expected


def test_positions_stesse_chiavi_nello_stesso_ordine(db, js):
    """`SELECT p.*` più cinque alias: l'insieme delle chiavi è il payload, e
    l'ordine è quello delle colonne. Un alias rinominato da un lato solo sarebbe
    un cambio di contratto invisibile a chi confronta i valori."""
    expected = _py(db, 'positions')
    assert list(js['positions'][0].keys()) == list(expected[0].keys())
    for alias in ('total_score', 'app_status', 'critic_verdict',
                  'c_hq_country', 'company_verdict'):
        assert alias in js['positions'][0]


def test_valori_reali_e_testo_accentato_identici(db, js):
    """Il REAL e l'accento passano da due serializzatori diversi
    (`json.dumps(default=str)` e `JSON.stringify`)."""
    expected = {r['id']: r for r in _py(db, 'positions')}
    got = {r['id']: r for r in js['positions']}
    assert got[1]['office_lat'] == expected[1]['office_lat'] == 45.4642
    assert got[3]['title'] == expected[3]['title'] == 'Données Ingénieur'
    assert got[2]['total_score'] is None and expected[2]['total_score'] is None


def test_filtri_identici(db, js):
    assert js['filtered'] == _py(db, 'positions', '--status', 'new')
    assert js['company'] == _py(db, 'positions', '--company', 'Stripe')
    # …e il filtro company guarda l'AZIENDA: la #2 si chiama «Stripe
    # Integrations» ma l'azienda è Acme, quindi non deve comparire.
    assert [r['id'] for r in js['company']] == [3]


def test_dettaglio_identico_e_assente_null(db, js):
    assert js['detail'] == _py(db, 'position', '1')
    assert js['missing'] is None
    assert _py(db, 'position', '999999') is None


def test_dashboard_identica_chiave_per_chiave(db, js):
    expected = _py(db, 'dashboard')
    assert list(js['dashboard'].keys()) == list(expected.keys())
    assert js['dashboard'] == expected
    # Le due asimmetrie che il fixture esiste per catturare.
    assert expected['companies_by_verdict'] == {'GO': 1}, \
        "un verdict NULL non deve entrare nel conteggio"
    assert expected['positions_with_company_id'] == 2
