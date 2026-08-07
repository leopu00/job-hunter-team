"""
Contratto del limite sulle code `next-for-*` di db_query.py.

Perché esiste (audit 2026-07-30, `docs/internal/roadmap/2026-07-30-db-audit-
observations.md`): nessuna coda aveva un limite, quindi UNA invocazione
riversava l'intero backlog nel contesto di un agente — misurato col codice vero
a 2.000 posizioni, `next-for-geocode-missing` stampava 1.375 righe ≈ 19.500
token, e a 20.000 posizioni 13.741 righe ≈ 195.000 token, più di una finestra
di contesto.

Cosa proteggono questi test — nell'ordine in cui contano:
  1. il limite di default c'è, su OGNI coda (anche su quelle aggiunte domani:
     `test_ogni_coda_accetta_il_limite` le percorre tutte);
  2. il limite è un DEFAULT e non un tetto — `--limit N` lo alza, `--all` e
     `--limit 0` lo tolgono del tutto;
  3. **il totale in coda resta visibile anche quando il limite taglia**, sia
     nel testo sia in JSON. È la parte che rende il limite accettabile: un
     tetto silenzioso nasconderebbe il backlog, cioè lo stesso difetto noto di
     `recent-activity` (elenca chi produce, e chi è fermo sparisce);
  4. le code che hanno argomenti propri (`next-for-recheck-weekly`) non si
     rompono, e una coda spenta dalla policy resta distinguibile da una vuota.

Eseguire con: pytest tests/test_db_query_limits.py -v
"""

import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')
POLICY = os.path.join(SKILLS_DIR, 'enrichment_policy.py')

# Il default vive nel codice: se qualcuno lo cambia, i test lo seguono invece
# di mentire su un 20 scritto a mano qui.
sys.path.insert(0, SKILLS_DIR)
from db_query import DEFAULT_QUEUE_LIMIT  # noqa: E402

# Tutte le code esposte dalla CLI. La lista è esplicita di proposito: una coda
# nuova che non compare qui non viene coperta, e il test sul sorgente in fondo
# fa cadere il caso in cui venga registrata scavalcando il limite.
QUEUES = [
    'next-for-analista',
    'next-for-scorer',
    'next-for-scrittore',
    'next-for-critico',
    'next-for-geocoding',
    'next-for-recheck',
    'next-for-categorize',
    'next-for-salary-precise',
    'next-for-recheck-due',
    'next-for-recheck-weekly',
    'next-for-geocode-missing',
    'next-for-logo-missing',
    'next-for-harvest',
    'next-for-calibration',
]

# Seed in un interprete SEPARATO (stessa ragione di tests/test_db_query_json.py:
# `_db.DB_PATH` è risolto all'import, quindi importarlo qui incollerebbe tutti i
# test al database del primo). Le quantità sono scelte per superare il default:
# 50 `new` e 45 `checked` con score, cioè code più lunghe di 20.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
for i in range({new}):
    conn.execute(
        "INSERT INTO positions (title, company, status, source) VALUES (?,?,?,?)",
        ('Backend Engineer %02d' % i, 'Acme %02d' % i, 'new', 'linkedin'))
for i in range({scored}):
    cur = conn.execute(
        "INSERT INTO positions (title, company, status, source) VALUES (?,?,?,?)",
        ('Data Engineer %02d' % i, 'Beta %02d' % i, 'scored', 'greenhouse'))
    pid = cur.lastrowid
    conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)",
                 (pid, 80))
    conn.execute("INSERT INTO companies (name, logo_fetched) VALUES (?,0)",
                 ('Beta %02d' % i,))
    conn.execute(
        "UPDATE positions SET company_id = (SELECT id FROM companies WHERE name=?) "
        "WHERE id = ?", ('Beta %02d' % i, pid))
conn.commit()
conn.close()
"""

NEW_POSITIONS = 50      # coda next-for-analista
SCORED_POSITIONS = 45   # code recheck-weekly / logo-missing / categorize


def _seed(tmp_path, new, scored):
    path = str(tmp_path / 'jobs.db')
    seed = subprocess.run(
        [sys.executable, '-c',
         _SEED.format(skills=SKILLS_DIR, new=new, scored=scored)],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': path},
    )
    assert seed.returncode == 0, f"seed fallito:\n{seed.stderr}"
    return path


@pytest.fixture
def db(tmp_path):
    """DB reale (schema `_db.ensure_schema`) con code più lunghe del default."""
    return _seed(tmp_path, NEW_POSITIONS, SCORED_POSITIONS)


@pytest.fixture
def db_corto(tmp_path):
    """Il caso di tutti i giorni sulle code on-demand: meno del default."""
    return _seed(tmp_path, 3, 0)


def run(db_path, *args):
    return subprocess.run(
        [sys.executable, DB_QUERY, *args],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path},
        cwd=REPO_ROOT,
    )


def policy(db_path, *args):
    return subprocess.run(
        [sys.executable, POLICY, *args],
        capture_output=True, text=True,
        env={**os.environ, 'JHT_DB': db_path},
        cwd=REPO_ROOT,
    )


def rows_printed(out):
    """Righe-posizione dell'uscita umana (`  #12 Azienda  Titolo`)."""
    return [ln for ln in out.splitlines() if ln.strip().startswith('#')]


def payload(result):
    """`--json` = UNA riga JSON, come per gli altri comandi di lettura."""
    assert result.returncode == 0, result.stderr
    lines = [ln for ln in result.stdout.strip().split('\n') if ln.strip()]
    assert len(lines) == 1, f"attese 1 riga, trovate {len(lines)}: {lines[:3]}"
    return json.loads(lines[0])


# ── 1. Il default c'è ────────────────────────────────────────────────────

def test_senza_limite_la_coda_si_ferma_al_default(db):
    """Il difetto originale in una riga: senza `--limit` uscivano TUTTE."""
    out = run(db, 'next-for-analista').stdout
    assert len(rows_printed(out)) == DEFAULT_QUEUE_LIMIT


def test_il_default_non_tocca_una_coda_piu_corta(db_corto):
    """Una coda da 3 resta da 3, con l'intestazione di sempre: il default non
    deve farsi sentire dove non c'è niente da tagliare."""
    out = run(db_corto, 'next-for-analista').stdout
    assert len(rows_printed(out)) == 3
    assert '(3):' in out
    assert 'showing' not in out


@pytest.mark.parametrize('queue', QUEUES)
def test_ogni_coda_accetta_il_limite(db, queue):
    """Nessuna coda deve restare fuori dal contratto — nemmeno quelle che oggi
    sono vuote per costruzione (on-demand) o gated dalla policy."""
    for args in ([queue], [queue, '--limit', '5'], [queue, '--all'],
                 [queue, '--limit', '0'], [queue, '--json']):
        r = run(db, *args)
        assert r.returncode == 0, f"{args} → rc {r.returncode}\n{r.stderr}"


# ── 2. Il limite è un default, non un tetto ─────────────────────────────

def test_limite_esplicito_rispettato(db):
    assert len(rows_printed(run(db, 'next-for-analista', '--limit', '7').stdout)) == 7


@pytest.mark.parametrize('senza_limite', [['--all'], ['--limit', '0']])
def test_senza_limite_esce_tutta_la_coda(db, senza_limite):
    """L'agente che sa perché gli serve tutto deve poterlo chiedere."""
    out = run(db, 'next-for-analista', *senza_limite).stdout
    assert len(rows_printed(out)) == NEW_POSITIONS


def test_limite_alzato_oltre_la_coda_non_moltiplica_le_righe(db):
    out = run(db, 'next-for-analista', '--limit', '500').stdout
    assert len(rows_printed(out)) == NEW_POSITIONS


# ── 3. Il totale resta visibile anche quando il limite taglia ───────────

def test_il_totale_e_dichiarato_quando_il_limite_taglia(db):
    """La parte che rende il limite accettabile: il backlog non sparisce."""
    out = run(db, 'next-for-analista', '--limit', '5').stdout
    assert f"showing 5 of {NEW_POSITIONS}" in out
    assert f"{NEW_POSITIONS - 5} more in the queue" in out


def test_senza_taglio_l_intestazione_resta_quella_di_prima(db):
    """Se non c'è niente di nascosto non si annuncia un taglio: l'uscita
    storica `(N)` non cambia per chi già la leggeva."""
    out = run(db, 'next-for-analista', '--all').stdout
    assert f"({NEW_POSITIONS}):" in out
    assert 'showing' not in out
    assert 'in coda' not in out


def test_il_totale_viaggia_anche_in_json(db):
    d = payload(run(db, 'next-for-analista', '--limit', '3', '--json'))
    assert d['queue'] == 'analista'
    assert d['total'] == NEW_POSITIONS
    assert d['shown'] == 3
    assert d['limit'] == 3
    assert len(d['rows']) == 3


def test_json_senza_limite_dichiara_limite_nullo(db):
    d = payload(run(db, 'next-for-analista', '--all', '--json'))
    assert d['limit'] is None
    assert d['total'] == d['shown'] == NEW_POSITIONS


def test_le_righe_json_non_perdono_il_conteggio_interno(db):
    """`_total` è un dettaglio della query, non un campo del contratto."""
    d = payload(run(db, 'next-for-analista', '--limit', '2', '--json'))
    for row in d['rows']:
        assert '_total' not in row
    assert d['rows'][0]['title'] == 'Backend Engineer 00'


def test_coda_vuota_e_zero_non_una_frase(db):
    d = payload(run(db, 'next-for-scrittore', '--json'))
    assert d['enabled'] is True   # vuota, non spenta
    assert d['total'] == 0 and d['rows'] == []
    assert 'none' in run(db, 'next-for-scrittore').stdout.lower()


def test_il_totale_di_una_coda_aggregata_conta_le_aziende(db):
    """`next-for-logo-missing` raggruppa per azienda: il totale deve essere il
    numero di AZIENDE in coda, non di posizioni (regressione da GROUP BY)."""
    d = payload(run(db, 'next-for-logo-missing', '--limit', '2', '--json'))
    assert d['total'] == SCORED_POSITIONS  # una company per posizione scorata
    assert d['shown'] == 2


# ── 4. Le code con argomenti propri, e quelle spente dalla policy ───────

def test_recheck_weekly_conserva_i_suoi_argomenti(db):
    """`--min-score` e `--older-than-days` continuano a filtrare, e il limite
    si applica DOPO di loro, non al posto loro."""
    out = run(db, 'next-for-recheck-weekly', '--min-score', '90',
              '--older-than-days', '1').stdout
    assert 'none' in out.lower(), out

    d = payload(run(db, 'next-for-recheck-weekly', '--min-score', '70',
                    '--older-than-days', '1', '--limit', '4', '--json'))
    assert d['total'] == SCORED_POSITIONS
    assert d['shown'] == 4


def test_recheck_weekly_senza_limite_usa_il_default(db):
    out = run(db, 'next-for-recheck-weekly', '--older-than-days', '1').stdout
    assert len(rows_printed(out)) == DEFAULT_QUEUE_LIMIT
    assert f"showing {DEFAULT_QUEUE_LIMIT} of {SCORED_POSITIONS}" in out


def test_coda_spenta_dalla_policy_resta_distinguibile_da_una_vuota(db):
    """Coda OFF ≠ coda vuota: chi legge il JSON deve poterle separare."""
    assert policy(db, 'set', 'logo.enabled', 'false').returncode == 0
    d = payload(run(db, 'next-for-logo-missing', '--json'))
    assert d['enabled'] is False
    assert d['total'] == 0 and d['rows'] == []
    assert 'OFF' in run(db, 'next-for-logo-missing').stdout


# ── 5. Guardia sul sorgente: una coda nuova non può nascere senza limite ─

def test_nessuna_coda_registrata_scavalcando_il_limite():
    """Le code passano tutte da `queue_parser()`, che aggiunge
    `--limit/--all/--json`. Un `sub.add_parser('next-for-…')` diretto
    ricreerebbe il difetto del 2026-07-30 su una coda sola, in silenzio."""
    with open(DB_QUERY, encoding='utf-8') as f:
        src = f.read()
    assert "sub.add_parser('next-for-" not in src
    for queue in QUEUES:
        assert f"queue_parser('{queue}')" in src, f"{queue} non passa da queue_parser"
