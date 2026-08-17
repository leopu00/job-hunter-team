"""
L'esito di una candidatura si scrive come l'invio: intero, o non si scrive.

Perché esiste (#187): in produzione ci sono **8 posizioni in stato `response`**
e `applications.response` **NULL su tutte e 428 le righe**. Sappiamo otto volte
CHE una risposta è arrivata e nessuna volta COSA diceva.

La causa non era un errore di chi scriveva, era l'asimmetria del comando:
`db_update.py application --applied` esegue tre statement in una transazione
(la riga `applications`, `positions.status`, l'event-log), mentre `--response`
scriveva **solo la colonna**. Le due metà venivano da due comandi che non
sapevano l'uno dell'altro.

Cosa proteggono questi test:
  1. che un esito muova la posizione e lasci traccia nell'event-log, come fa
     l'invio;
  2. che `--response-at` da solo venga RIFIUTATO: un istante senza esito è
     esattamente la riga muta che stiamo riparando;
  3. che un esito su una candidatura mai inviata venga rifiutato — `response`
     è la progressione post-invio, non uno stato alternativo;
  4. che la guardia anti-downgrade non blocchi più la progressione legittima:
     prima di questo ticket `--status response` su una posizione `applied`
     veniva respinto, cioè la progressione dichiarata dallo schema era
     irraggiungibile dalla CLI.

Eseguire con: pytest tests/test_application_outcome_symmetry.py -v
"""

import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_UPDATE = os.path.join(SKILLS_DIR, 'db_update.py')

_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
# #1 candidatura inviata · #2 posizione mai candidata
for title, company, status in (
    ('Backend Engineer', 'Acme SpA', 'applied'),
    ('Data Engineer', 'Beta Srl', 'ready'),
):
    conn.execute(
        "INSERT INTO positions (title, company, status, source) VALUES (?,?,?,?)",
        (title, company, status, 'linkedin'))
conn.execute(
    "INSERT INTO applications (position_id, status, applied, applied_at, applied_via) "
    "VALUES (1, 'applied', 1, datetime('now', '-5 days'), 'linkedin')")
conn.execute(
    "INSERT INTO applications (position_id, status, applied) VALUES (2, 'ready', 0)")
conn.commit()
conn.close()
"""

_READ = """
import json, sys
sys.path.insert(0, {skills!r})
from _db import get_db
conn = get_db()
app = conn.execute(
    "SELECT status, applied, response, response_at, interview_round "
    "FROM applications WHERE position_id = ?", ({pid},)).fetchone()
pos = conn.execute("SELECT status, last_actor FROM positions WHERE id = ?",
                   ({pid},)).fetchone()
trans = conn.execute(
    "SELECT from_state, to_state, by_agent FROM position_state_transitions "
    "WHERE position_id = ? ORDER BY id", ({pid},)).fetchall()
print(json.dumps({{
    'app': dict(app) if app else None,
    'pos': dict(pos) if pos else None,
    'transitions': [dict(t) for t in trans],
}}))
conn.close()
"""


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / 'jobs.db')
    seed = subprocess.run(
        [sys.executable, '-c', _SEED.format(skills=SKILLS_DIR)],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': path},
    )
    assert seed.returncode == 0, f"seed fallito:\n{seed.stderr}"
    return path


def update(db_path, *args):
    return subprocess.run(
        [sys.executable, DB_UPDATE, 'application', *args],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path}, cwd=REPO_ROOT,
    )


def state(db_path, position_id):
    import json
    out = subprocess.run(
        [sys.executable, '-c', _READ.format(skills=SKILLS_DIR, pid=position_id)],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path},
    )
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_un_esito_muove_posizione_e_event_log(db):
    result = update(db, '1', '--response', 'rejected', '--response-at', 'now')
    assert result.returncode == 0, result.stderr

    after = state(db, 1)
    assert after['app']['response'] == 'rejected'
    assert after['app']['response_at'], "response_at non materializzato"
    assert after['app']['status'] == 'response'
    # La metà che prima restava indietro.
    assert after['pos']['status'] == 'response'
    assert after['pos']['last_actor']
    assert [(t['from_state'], t['to_state']) for t in after['transitions']] == [
        ('applied', 'response')
    ]


def test_response_at_da_solo_e_rifiutato(db):
    """L'istante senza l'esito è la riga muta che ha prodotto le 8 in produzione."""
    result = update(db, '1', '--response-at', 'now')
    assert result.returncode == 1
    assert 'RESPONSE REJECTED' in result.stderr

    after = state(db, 1)
    assert after['app']['response'] is None
    assert after['app']['response_at'] is None, (
        "ha scritto l'istante dopo aver rifiutato l'esito"
    )
    assert after['pos']['status'] == 'applied'
    assert after['transitions'] == []


def test_un_esito_senza_invio_e_rifiutato(db):
    result = update(db, '2', '--response', 'rejected')
    assert result.returncode == 1
    assert 'not marked as sent' in result.stderr

    after = state(db, 2)
    assert after['app']['response'] is None
    assert after['pos']['status'] == 'ready'


def test_invio_ed_esito_nello_stesso_comando_finiscono_su_response(db):
    """`response` è la progressione dell'invio, non un'alternativa."""
    result = update(
        db, '2', '--applied', 'true', '--applied-via', 'linkedin',
        '--response', 'interview', '--interview-round', '1',
    )
    assert result.returncode == 0, result.stderr

    after = state(db, 2)
    assert after['app']['applied'] == 1
    assert after['app']['response'] == 'interview'
    assert after['app']['interview_round'] == 1
    assert after['pos']['status'] == 'response', (
        "l'invio ha sovrascritto l'esito: lo stato finale deve essere il più avanti"
    )
    assert [t['to_state'] for t in after['transitions']] == ['response']


def test_la_guardia_anti_downgrade_non_blocca_piu_la_progressione(db):
    """La regressione vera: prima, `--status response` su una applied era respinto.

    La progressione `applied → response` è dichiarata dallo schema (e dalla
    migrazione 072 lato cloud, che la chiama l'unica ammessa dopo l'invio) ma
    la guardia anti-downgrade la trattava come un cambio di stato qualsiasi:
    era irraggiungibile dalla CLI, e questo è il motivo per cui nessuno l'ha
    mai scritta per intero.
    """
    result = update(db, '1', '--status', 'response', '--response', 'interview')
    assert result.returncode == 0, result.stderr
    assert 'REJECTED' not in result.stderr

    after = state(db, 1)
    assert after['app']['status'] == 'response'
    assert after['pos']['status'] == 'response'


def test_un_downgrade_vero_resta_rifiutato(db):
    """La clausola falsa della guardia: quello che proteggeva deve restare protetto."""
    result = update(db, '1', '--status', 'draft')
    assert result.returncode == 1
    assert 'APPLIED STATUS CHANGE REJECTED' in result.stderr

    after = state(db, 1)
    assert after['app']['status'] == 'applied'
    assert after['pos']['status'] == 'applied'


def test_ripetere_lo_stesso_esito_non_duplica_la_transizione(db):
    for _ in range(2):
        assert update(db, '1', '--response', 'rejected').returncode == 0
    after = state(db, 1)
    assert len(after['transitions']) == 1, (
        f"event-log duplicato: {after['transitions']}"
    )
