"""
Contratto `--json` di db_query.py.

Perché esiste: JHT punta a essere guidabile da agenti LLM oltre che da umani
(`docs/guides/AI-AGENT-INTEGRATION.md`, "one CLI surface for humans, AI agents
and the Desktop launcher"). Un agente che legge le tabelle incolonnate di
db_query.py deve estrarre i campi a regex, e ogni ritocco di larghezza colonna
gli rompe il parsing sotto i piedi. `--json` è la seconda uscita.

Cosa proteggono questi test:
  1. che l'output sia JSON valido su UNA riga, senza decorazioni intorno;
  2. che "non trovato" sia `null`, distinguibile da un oggetto vuoto;
  3. che l'output umano NON cambi quando il flag è assente — la ragione per cui
     il flag è stato aggiunto come ramo separato invece che riscrivendo i print.

Eseguire con: pytest tests/test_db_query_json.py -v
"""

import json
import os
import sqlite3
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')


# Lo schema si costruisce in un interprete SEPARATO, non importando `_db` qui.
# Motivo: `_db.DB_PATH` è risolto una sola volta, al momento dell'import
# (`DB_PATH = _resolve_db_path()`). Importandolo dentro la fixture, il primo
# test fissa il path e tutti i successivi scrivono nel DB del primo — che nel
# frattempo pytest ha già cancellato con la sua tmp_path. Costa un processo per
# test, e in cambio ogni test ha davvero il suo database.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
conn.execute(
    "INSERT INTO positions (title, company, status, source, location) VALUES (?,?,?,?,?)",
    ('Backend Engineer', 'Acme SpA', 'scored', 'linkedin', 'Milano'))
conn.execute(
    "INSERT INTO positions (title, company, status, source) VALUES (?,?,?,?)",
    ('Data Engineer', 'Beta Srl', 'new', 'greenhouse'))
conn.execute("INSERT INTO scores (position_id, total_score) VALUES (1, 82)")
conn.commit()
conn.close()
"""


@pytest.fixture
def db(tmp_path):
    """DB con lo schema reale (_db.ensure_schema) e due posizioni note."""
    path = str(tmp_path / 'jobs.db')
    seed = subprocess.run(
        [sys.executable, '-c', _SEED.format(skills=SKILLS_DIR)],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': path},
    )
    assert seed.returncode == 0, f"seed fallito:\n{seed.stderr}"
    return path


def run(db_path, *args):
    return subprocess.run(
        [sys.executable, DB_QUERY, *args],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path},
        cwd=REPO_ROOT,
    )


def parse(result):
    """Il contratto è UNA riga JSON: se ce ne sono due, il flag ha stampato
    anche qualcos'altro e il chiamante non può fidarsi di json.loads()."""
    assert result.returncode == 0, result.stderr
    lines = [ln for ln in result.stdout.strip().split('\n') if ln.strip()]
    assert len(lines) == 1, f"attese 1 riga, trovate {len(lines)}: {lines[:3]}"
    return json.loads(lines[0])


READ_COMMANDS = [
    (['positions'], list),
    (['companies'], list),
    (['dashboard'], dict),
    (['stats'], dict),
    (['recent-activity'], list),
]


@pytest.mark.parametrize('args,expected_type', READ_COMMANDS)
def test_json_e_una_riga_del_tipo_giusto(db, args, expected_type):
    payload = parse(run(db, *args, '--json'))
    assert isinstance(payload, expected_type)


def test_positions_riporta_le_colonne_del_db(db):
    rows = parse(run(db, 'positions', '--json'))
    assert len(rows) == 2
    first = rows[0]
    # Ordinamento per score DESC: la posizione con 82 viene prima.
    assert first['id'] == 1
    assert first['title'] == 'Backend Engineer'
    assert first['total_score'] == 82
    assert first['location'] == 'Milano'


def test_i_filtri_valgono_anche_in_json(db):
    rows = parse(run(db, 'positions', '--status', 'new', '--json'))
    assert [r['title'] for r in rows] == ['Data Engineer']


def test_lista_vuota_e_un_array_vuoto_non_una_frase(db):
    rows = parse(run(db, 'positions', '--status', 'applied', '--json'))
    assert rows == []


def test_dettaglio_assente_e_null(db):
    """`null` e non `{}`: chi legge deve distinguere "non c'è" da "vuoto"."""
    assert parse(run(db, 'position', '999', '--json')) is None
    assert parse(run(db, 'company', 'Inesistente', '--json')) is None


def test_dettaglio_posizione_porta_score_e_campi(db):
    row = parse(run(db, 'position', '1', '--json'))
    assert row['id'] == 1
    assert row['company'] == 'Acme SpA'
    assert row['total_score'] == 82


def test_dashboard_espone_gli_aggregati_della_vista_umana(db):
    d = parse(run(db, 'dashboard', '--json'))
    assert d['total'] == 2
    assert d['by_status'] == {'new': 1, 'scored': 1}
    assert [t['id'] for t in d['top_scores']] == [1]
    assert d['positions_with_company_id'] == 0


def test_stats_riporta_i_conteggi_e_lo_schema(db):
    d = parse(run(db, 'stats', '--json'))
    assert d['positions'] == 2 and d['scores'] == 1
    assert isinstance(d['schema_version'], int) and d['schema_version'] > 0


@pytest.mark.parametrize('args', [
    ['positions'], ['companies'], ['dashboard'], ['stats'], ['recent-activity'],
])
def test_senza_flag_luscita_resta_umana(db, args):
    """Il ramo JSON è additivo. Se un giorno qualcuno lo rende il default,
    questo test cade prima che lo scoprano gli agenti in produzione."""
    out = run(db, *args).stdout
    assert out.strip(), f"{args} non ha stampato nulla"
    with pytest.raises(json.JSONDecodeError):
        json.loads(out.strip().split('\n')[0])
