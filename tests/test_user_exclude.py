"""
Contratto di `user_exclude.py` — l'utente scarta una posizione.

Perché conta più di una UPDATE qualsiasi: `status='excluded'` è ciò che fa
uscire una posizione dalle code agenti, quindi un bug qui o brucia token su
annunci che l'utente ha già scartato, o nasconde posizioni che voleva tenere.
Ed è reversibile solo finché `user_excluded_prev_status` resta intatto.

La stessa logica esiste in TypeScript dentro
`web/app/api/positions/[legacyId]/user-exclude/route.ts`. Questi test coprono
la copia Python (quella che usano CLI e agenti); l'allineamento fra le due è
debito dichiarato in [JHT-CLI-AGENT-PARITY].

Eseguire con: pytest tests/test_user_exclude.py -v
"""

import json
import os
import sqlite3
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SKILL = os.path.join(SKILLS_DIR, 'user_exclude.py')

# Interprete separato: `_db` risolve DB_PATH una volta sola all'import, quindi
# una fixture in-process legherebbe tutti i test al tmp_path del primo.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db(); ensure_schema(conn)
conn.execute("INSERT INTO positions (title, company, status) VALUES ('Backend', 'Acme', 'scored')")
conn.execute("INSERT INTO positions (title, company, status) VALUES ('Data Eng', 'Beta', 'new')")
conn.commit(); conn.close()
"""


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / 'jobs.db')
    seed = subprocess.run(
        [sys.executable, '-c', _SEED.format(skills=SKILLS_DIR)],
        capture_output=True, text=True, env={**os.environ, 'JHT_DB': path},
    )
    assert seed.returncode == 0, seed.stderr
    return path


def run(db_path, *args):
    return subprocess.run(
        [sys.executable, SKILL, *args], capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path}, cwd=REPO_ROOT,
    )


def payload(result):
    return json.loads(result.stdout.strip())


def row(db_path, position_id=1):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return dict(conn.execute(
            "SELECT status, user_excluded_reason, user_excluded_note, "
            "user_excluded_prev_status, last_actor FROM positions WHERE id = ?",
            (position_id,)).fetchone())
    finally:
        conn.close()


def transitions(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            "SELECT from_state, to_state, by_agent, notes "
            "FROM position_state_transitions ORDER BY id")]
    finally:
        conn.close()


def test_exclude_sposta_lo_stato_e_ricorda_da_dove(db):
    r = run(db, 'exclude', '1', '--reason', 'wrong_stack')
    assert r.returncode == 0, r.stderr
    assert payload(r)['ok'] is True

    after = row(db)
    assert after['status'] == 'excluded'
    assert after['user_excluded_reason'] == 'wrong_stack'
    assert after['user_excluded_prev_status'] == 'scored'
    # last_actor='user': l'esclusione è una decisione dell'utente, e la
    # dashboard la attribuisce da questa colonna.
    assert after['last_actor'] == 'user'


def test_restore_riporta_esattamente_allo_stato_precedente(db):
    run(db, 'exclude', '2', '--reason', 'company')   # partiva da 'new'
    r = run(db, 'restore', '2')
    assert r.returncode == 0
    after = row(db, 2)
    assert after['status'] == 'new', "deve tornare a 'new', non al default 'scored'"
    assert after['user_excluded_reason'] is None
    assert after['user_excluded_prev_status'] is None


def test_riescludere_non_perde_lo_stato_originale(db):
    """Il bug che questo previene: la seconda esclusione salverebbe
    prev_status='excluded', e il restore riporterebbe la posizione a
    'excluded' — cioè non la ripristinerebbe mai più."""
    run(db, 'exclude', '1', '--reason', 'closed')
    run(db, 'exclude', '1', '--reason', 'company')
    assert row(db)['user_excluded_prev_status'] == 'scored'
    run(db, 'restore', '1')
    assert row(db)['status'] == 'scored'


def test_levent_log_registra_solo_i_movimenti_veri(db):
    run(db, 'exclude', '1', '--reason', 'closed')
    run(db, 'exclude', '1', '--reason', 'company')   # non è una transizione
    t = transitions(db)
    assert len(t) == 1, f"attesa 1 transizione, trovate {len(t)}"
    assert t[0]['from_state'] == 'scored' and t[0]['to_state'] == 'excluded'
    assert t[0]['by_agent'] == 'user'
    assert t[0]['notes'] == 'closed'

    run(db, 'restore', '1')
    run(db, 'restore', '1')                          # nemmeno questa
    t = transitions(db)
    assert len(t) == 2
    assert t[1]['from_state'] == 'excluded' and t[1]['to_state'] == 'scored'


def test_other_senza_nota_passa_ora(db):
    """JHT-T05: «altro» non obbliga più a scrivere: la nota è facoltativa."""
    r = run(db, 'exclude', '1', '--reason', 'other')
    assert r.returncode == 0
    assert row(db)['user_excluded_note'] is None


def test_la_nota_oltre_200_caratteri_e_rifiutata_e_il_db_non_si_tocca(db):
    r = run(db, 'exclude', '1', '--reason', 'other', '--note', 'x' * 201)
    assert r.returncode == 1 and 'note longer than 200' in payload(r)['error']
    assert row(db)['status'] == 'scored'


def test_la_nota_si_ripulisce_dai_caratteri_di_controllo(db):
    run(db, 'exclude', '1', '--reason', 'other', '--note', "sede\u202e  sba\nglia\u200bta")
    assert row(db)['user_excluded_note'] == 'sede sba gliata'


def test_other_con_nota_passa_e_la_conserva(db):
    r = run(db, 'exclude', '1', '--reason', 'other', '--note', "sede sbagliata")
    assert r.returncode == 0
    assert row(db)['user_excluded_note'] == 'sede sbagliata'


def test_causa_non_valida_e_rifiutata_da_argparse(db):
    r = run(db, 'exclude', '1', '--reason', 'inventata')
    assert r.returncode == 2, "argparse deve fermarla prima di toccare il DB"
    assert row(db)['status'] == 'scored'


def test_posizione_inesistente_fallisce_pulito(db):
    r = run(db, 'exclude', '999', '--reason', 'closed')
    assert r.returncode == 1
    assert payload(r)['ok'] is False
    assert '999' in payload(r)['error']


@pytest.mark.parametrize('reason', [
    'too_senior', 'too_junior', 'wrong_location', 'salary_low', 'wrong_stack',
    'company', 'scam_or_gone', 'closed', 'already_applied', 'other',
])
def test_tutte_le_cause_del_vocabolario_sono_accettate(db, reason):
    """Se la UI offre una causa che qui viene rifiutata, l'utente esclude dal
    browser e non può più farlo dal CLI."""
    assert run(db, 'exclude', '1', '--reason', reason).returncode == 0
    assert row(db)['user_excluded_reason'] == reason


@pytest.mark.parametrize('reason', ['not_interested', 'mismatch', 'conditions'])
def test_le_cause_del_vecchio_elenco_non_si_scrivono_piu(db, reason):
    r = run(db, 'exclude', '1', '--reason', reason)
    assert r.returncode == 2, "argparse la ferma prima di toccare il DB"


def test_la_route_web_legge_lo_stesso_vocabolario_del_cli():
    """Un solo elenco: `shared/feedback-reasons.json`, letto dalla route e dal
    CLI. Una route che tornasse ad avere il suo elenco lo farebbe divergere."""
    route = os.path.join(REPO_ROOT, 'web', 'app', 'api', 'positions',
                         '[legacyId]', 'user-exclude', 'route.ts')
    if not os.path.exists(route):
        pytest.skip('route web non presente in questo checkout')
    src = open(route, encoding='utf-8').read()
    assert 'feedback-reasons' in src
    assert 'VALID_REASONS = new Set([' not in src
