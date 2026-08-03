"""
Le code delle modalità RACCOLTO e CALIBRAZIONE, e il freno della modalità
RISPARMIO (contratto modalità 2026-08: search|harvest|care|calibration|saving
in `profile/capitano-maintenance.json`, chiave "mode"; assenza = search).

Perché esistono — i numeri misurati sulle 4 VPS reali il 30/07: su ~4.500
posizioni, ~990 hanno score >= 75 ma solo ~330 hanno un CV. Si trova molto più
di quanto si raccoglie: `next-for-harvest` è la coda dell'ultimo metro. E il
feedback dell'utente (48 esclusioni + 25 ticket sulla sola VPS leone) esiste
ma non riorienta nulla: `next-for-calibration` è la coda dell'ascolto.

Cosa proteggono questi test:
  1. harvest: il filtro è quello DICHIARATO (score alto, senza application,
     viva, non scaduta, solo status 'scored') e l'ordine è score DESC;
  2. calibration: "consumato" è un criterio ESPLICITO (watermark su file,
     avanza solo con `calibration-consume`) — senza, la coda non si svuota
     mai; e un watermark corrotto ri-presenta tutto, mai il contrario;
  3. saving: `mode: saving` spegne l'enrichment autonomo A CODICE senza
     toccare enrichment-policy.json (uscendo dalla modalità la policy di
     prima torna a valere da sola); un mode illeggibile NON degrada a search;
  4. [SCORE-INTEGRITY-NO-UPSTREAM-FILTER]: la calibrazione riordina le
     priorità, non filtra l'ingresso — il vincolo resta scritto nel sorgente.

Eseguire con: pytest tests/test_mode_queues.py -v
"""

import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')

# Seed in un interprete SEPARATO (come tests/test_db_query_limits.py:
# `_db.DB_PATH` è risolto all'import). Timestamp ESPLICITI sul feedback, così
# l'ordine cronologico e il taglio del watermark sono deterministici.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)

def pos(title, status, score=None, app=False, is_open=1, expires=None,
        excl_at=None, excl_reason=None, excl_note=None):
    cur = conn.execute(
        "INSERT INTO positions (title, company, status, is_open, expires_at,"
        " user_excluded_at, user_excluded_reason, user_excluded_note)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (title, 'Acme ' + title, status, is_open, expires,
         excl_at, excl_reason, excl_note))
    pid = cur.lastrowid
    if score is not None:
        conn.execute(
            "INSERT INTO scores (position_id, total_score) VALUES (?,?)",
            (pid, score))
    if app:
        conn.execute(
            "INSERT INTO applications (position_id, status) VALUES (?, ?)",
            (pid, 'ready'))
    return pid

pos('Top90',     'scored', 90)
pos('Mid82',     'scored', 82)
pos('Edge75',    'scored', 75)
pos('Below74',   'scored', 74)
pos('HasCV88',   'ready',  88, app=True)
pos('Closed85',  'scored', 85, is_open=0)
pos('Expired91', 'scored', 91, expires='2026-01-01')
pos('Excl95',    'excluded', 95,
    excl_at='2026-08-01 10:00:00', excl_reason='company')
tid = pos('Ticketed', 'scored', 60)
pos('Excl2', 'excluded', 55,
    excl_at='2026-08-02 12:00:00', excl_reason='other', excl_note='sede sbagliata')
conn.execute(
    "INSERT INTO position_tickets (position_id, request_text, created_at)"
    " VALUES (?,?,?)",
    (tid, 'controlla se accettano full remote', '2026-08-02 09:30:00'))
conn.commit()
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


def run(db_path, *args):
    return subprocess.run(
        [sys.executable, DB_QUERY, *args],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path},
        cwd=REPO_ROOT,
    )


def payload(result):
    assert result.returncode == 0, result.stderr
    lines = [ln for ln in result.stdout.strip().split('\n') if ln.strip()]
    assert len(lines) == 1, f"attese 1 riga, trovate {len(lines)}"
    return json.loads(lines[0])


def _mode_file(db_path):
    profile = os.path.join(os.path.dirname(db_path), 'profile')
    os.makedirs(profile, exist_ok=True)
    return os.path.join(profile, 'capitano-maintenance.json')


def _watermark_file(db_path):
    return os.path.join(os.path.dirname(db_path), 'profile',
                        'calibration-watermark.json')


# ── 1. Harvest: filtro dichiarato, ordine dichiarato ────────────────────

def test_harvest_solo_scored_vive_senza_cv_sopra_soglia(db):
    """CV già scritto, chiusa, scaduta, esclusa e sotto-soglia restano fuori:
    la coda è ESATTAMENTE «già pagata, ancora da raccogliere»."""
    d = payload(run(db, 'next-for-harvest', '--json'))
    assert [r['title'] for r in d['rows']] == ['Top90', 'Mid82', 'Edge75']
    assert d['total'] == 3


def test_harvest_ordine_score_decrescente(db):
    d = payload(run(db, 'next-for-harvest', '--json'))
    scores = [r['total_score'] for r in d['rows']]
    assert scores == sorted(scores, reverse=True) == [90, 82, 75]


def test_harvest_min_score_override(db):
    """La soglia (default 75, la leva del burn weekly) è un default esplicito:
    --min-score la sposta e il sotto-soglia entra."""
    d = payload(run(db, 'next-for-harvest', '--min-score', '50', '--json'))
    assert 'Below74' in [r['title'] for r in d['rows']]
    assert 'Ticketed' in [r['title'] for r in d['rows']]  # score 60
    out = run(db, 'next-for-harvest').stdout
    assert 'score >= 75' in out


# ── 2. Calibration: il criterio di "consumato" è il watermark ───────────

def test_calibration_elenca_esclusioni_e_ticket_in_ordine_cronologico(db):
    d = payload(run(db, 'next-for-calibration', '--json'))
    assert [(r['kind'], r['title']) for r in d['rows']] == [
        ('esclusione', 'Excl95'),      # 08-01 10:00
        ('ticket', 'Ticketed'),        # 08-02 09:30
        ('esclusione', 'Excl2'),       # 08-02 12:00
    ]
    # Il testo dell'utente viaggia nella riga: senza, la coda dice "quale
    # posizione" ma non "perché".
    assert d['rows'][0]['detail'] == 'company'
    assert d['rows'][2]['detail'] == 'other sede sbagliata'


def test_calibration_leggere_non_e_consumare(db):
    """La coda non si svuota leggendola: solo calibration-consume la avanza."""
    for _ in range(3):
        d = payload(run(db, 'next-for-calibration', '--json'))
        assert d['total'] == 3


def test_calibration_consume_svuota_la_coda(db):
    r = payload(run(db, 'calibration-consume'))
    assert r['advanced'] is True
    assert r['consumed_through'] == '2026-08-02 12:00:00'
    d = payload(run(db, 'next-for-calibration', '--json'))
    assert d['total'] == 0
    # Idempotente: un secondo consume senza feedback nuovo non avanza.
    r2 = payload(run(db, 'calibration-consume'))
    assert r2['advanced'] is False


def test_calibration_consume_through_parziale(db):
    """Chi ha letto una coda TRONCATA consuma solo fino all'ultima riga letta:
    il feedback non letto resta in coda."""
    r = payload(run(db, 'calibration-consume', '--through',
                    '2026-08-02 09:30:00'))
    assert r['advanced'] is True
    d = payload(run(db, 'next-for-calibration', '--json'))
    assert [r['title'] for r in d['rows']] == ['Excl2']


def test_calibration_watermark_corrotto_ripresenta_tutto(db):
    """Fail-direction dichiarata: un watermark rotto = epoch, cioè si
    RIPRESENTA tutto il feedback. Perderne in silenzio sarebbe il difetto
    peggiore per una coda di ascolto."""
    payload(run(db, 'calibration-consume'))
    with open(_watermark_file(db), 'w', encoding='utf-8') as f:
        f.write('garbage{')
    d = payload(run(db, 'next-for-calibration', '--json'))
    assert d['total'] == 3


def test_calibration_watermark_non_retrocede(db):
    payload(run(db, 'calibration-consume'))
    r = payload(run(db, 'calibration-consume', '--through',
                    '2026-08-01 00:00:00'))
    assert r['advanced'] is False
    assert r['consumed_through'] == '2026-08-02 12:00:00'


# ── 3. Saving: freno a codice, policy intatta ───────────────────────────

def test_saving_spegne_enrichment_senza_toccare_la_policy(db):
    with open(_mode_file(db), 'w', encoding='utf-8') as f:
        json.dump({'mode': 'saving'}, f)
    d = payload(run(db, 'next-for-geocode-missing', '--json'))
    assert d['enabled'] is False
    assert 'mode=saving' in run(db, 'next-for-logo-missing').stdout
    # La policy su disco NON è stata riscritta: togliendo la modalità tutto
    # torna com'era, senza un secondo interruttore da ricordare.
    assert not os.path.exists(os.path.join(os.path.dirname(db), 'profile',
                                           'enrichment-policy.json'))
    os.unlink(_mode_file(db))
    d2 = payload(run(db, 'next-for-geocode-missing', '--json'))
    assert d2['enabled'] is True


def test_saving_non_spegne_le_code_di_lettura(db):
    """harvest e calibration sono liste, non spesa: restano interrogabili."""
    with open(_mode_file(db), 'w', encoding='utf-8') as f:
        json.dump({'mode': 'saving'}, f)
    assert payload(run(db, 'next-for-harvest', '--json'))['enabled'] is True
    assert payload(run(db, 'next-for-calibration', '--json'))['enabled'] is True


def test_mode_illeggibile_non_degrada_a_search(db):
    """File mode presente ma rotto = enrichment sospeso (direzione sicura di
    mode_banner), MAI trattato come «nessun ordine»."""
    with open(_mode_file(db), 'w', encoding='utf-8') as f:
        f.write('garbage')
    d = payload(run(db, 'next-for-geocode-missing', '--json'))
    assert d['enabled'] is False


def test_mode_harvest_non_tocca_le_code_di_cura(db):
    """Le altre modalità non spengono nulla a codice: chi le applica è il
    Capitano assegnando le code, non un gate qui."""
    with open(_mode_file(db), 'w', encoding='utf-8') as f:
        json.dump({'mode': 'harvest'}, f)
    d = payload(run(db, 'next-for-geocode-missing', '--json'))
    assert d['enabled'] is True


# ── 4. Il vincolo di integrità resta scritto dove si legge ──────────────

def test_vincolo_no_upstream_filter_dichiarato_nel_sorgente():
    """[SCORE-INTEGRITY-NO-UPSTREAM-FILTER]: il feedback riordina le priorità,
    non filtra l'ingresso. Il vincolo deve restare nel sorgente accanto alla
    coda che potrebbe violarlo — sparisce da lì, sparisce dalle teste."""
    with open(DB_QUERY, encoding='utf-8') as f:
        src = f.read()
    assert src.count('SCORE-INTEGRITY-NO-UPSTREAM-FILTER') >= 2
    calibration_branch = src.split("elif role == 'calibration':")[1]
    assert 'SCORE-INTEGRITY-NO-UPSTREAM-FILTER' in \
        calibration_branch.split('elif role ==')[0].split('else:')[0]
