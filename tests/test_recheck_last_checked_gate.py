"""
Una posizione ricontrollata deve USCIRE dalla coda del recheck cadenzato.

Perché esiste ([RECHECK-MUST-UPDATE-LAST-CHECKED], osservato il 2026-07-30):
la posizione #58 è stata verificata alle 08:38 — terzo 404 consecutivo,
`is_open` messo a 0 — ed era ancora in testa a `next-for-recheck-weekly` alle
10:02. L'agente aveva scritto `last_open_check`, la coda gatava su
`last_checked`, e quella colonna era ferma al 04/06. Il lavoro era stato fatto,
la coda non lo sapeva, e la cadenza quindicinale era una promessa che nessun
dato manteneva.

Le due metà del fix, entrambe coperte qui:
  (a) la coda considera l'ultima verifica QUALUNQUE colonna la registri
      (`max(last_checked, last_open_check)`);
  (b) `db_update.py` fa avanzare `last_checked` quando gli si scrive la
      liveness, così la strada canonica non richiede di ricordarsi due flag.

La (c) — dirlo nel prompt — è come ci siamo arrivati: qui non c'è.

Eseguire con: pytest tests/test_recheck_last_checked_gate.py -v
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
DB_UPDATE = os.path.join(SKILLS_DIR, 'db_update.py')

# Seed in un interprete separato: `_db.DB_PATH` è risolto all'import, quindi
# importarlo qui incollerebbe i test al database del primo (stessa ragione di
# tests/test_db_query_limits.py).
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
rows = [
    # (titolo, last_checked, last_open_check)
    ('Mai verificata', None, None),
    ('Verificata a giugno', '2026-06-04 09:00:00', None),
    # Il caso #58: liveness scritta stamattina, `last_checked` fermo a giugno.
    ('Ricontrollata oggi', '2026-06-04 09:00:00', "datetime('now','localtime')"),
    # Lo specchio: `last_checked` fresco e `last_open_check` vecchio — la
    # posizione resta fuori dalla coda, perché conta la verifica PIÙ RECENTE.
    ('Checked oggi', "datetime('now','localtime')", '2026-06-04 09:00:00'),
]
for title, lc, loc in rows:
    cur = conn.execute(
        "INSERT INTO positions (title, company, status, source) VALUES (?,?,?,?)",
        (title, 'Acme', 'scored', 'linkedin'))
    pid = cur.lastrowid
    conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)",
                 (pid, 80))
    for col, val in (('last_checked', lc), ('last_open_check', loc)):
        if val is None:
            continue
        if val.startswith('datetime('):
            conn.execute(
                "UPDATE positions SET %s = %s WHERE id = ?" % (col, val), (pid,))
        else:
            conn.execute(
                "UPDATE positions SET %s = ? WHERE id = ?" % col, (val, pid))
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


def _run(db, *args):
    return subprocess.run([sys.executable, *args], capture_output=True,
                          text=True, env={**os.environ, 'JHT_DB': db})


def _queue_titles(db):
    out = _run(db, DB_QUERY, 'next-for-recheck-due', '--json')
    assert out.returncode == 0, out.stderr
    return [r['title'] for r in json.loads(out.stdout)['rows']]


def _row(db, title):
    """Lettura diretta: qui interessa cosa c'è NELLA colonna, non come la
    presenta la CLI."""
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute(
            "SELECT id, last_checked, last_open_check FROM positions "
            "WHERE title = ?", (title,)).fetchone()
    finally:
        conn.close()
    assert r is not None, f'posizione {title!r} non trovata'
    return r


def _id(db, title):
    return _row(db, title)['id']


# ── (a) la coda guarda l'ultima verifica, non una colonna sola ──────────

def test_a_position_rechecked_today_leaves_the_queue(db):
    """Il caso #58: `last_open_check` di stamattina basta a farla uscire."""
    assert 'Ricontrollata oggi' not in _queue_titles(db)


def test_a_position_checked_today_leaves_the_queue(db):
    """E lo specchio: vale la verifica PIÙ RECENTE, non l'ultima colonna."""
    assert 'Checked oggi' not in _queue_titles(db)


def test_a_stale_position_stays_in_the_queue(db):
    """Verificata a giugno e mai più: è esattamente il lavoro della cura."""
    assert 'Verificata a giugno' in _queue_titles(db)


def test_a_never_checked_position_is_still_queued(db):
    """Regressione sul COALESCE: nessuna data non deve diventare "fresca"."""
    assert 'Mai verificata' in _queue_titles(db)


def test_the_never_checked_come_before_the_stale(db):
    """A parità di score prima chi non è mai stato guardato."""
    titles = _queue_titles(db)
    assert titles.index('Mai verificata') < titles.index('Verificata a giugno')


# ── (b) scrivere la liveness È aver controllato la posizione ────────────

def test_writing_is_open_advances_last_checked(db):
    """Il gesto vero dell'incidente: si dichiara chiusa e basta."""
    pid = _id(db, 'Verificata a giugno')
    r = _run(db, DB_UPDATE, 'position', str(pid), '--is-open', 'false')
    assert r.returncode == 0, r.stderr
    assert _row(db, 'Verificata a giugno')['last_checked'] > '2026-06-04'
    assert 'Verificata a giugno' not in _queue_titles(db)


def test_last_open_check_carries_its_instant_over(db):
    """Due timestamp che raccontano lo stesso controllo non devono divergere."""
    pid = _id(db, 'Verificata a giugno')
    r = _run(db, DB_UPDATE, 'position', str(pid),
             '--last-open-check', '2026-07-30 08:38:00')
    assert r.returncode == 0, r.stderr
    assert _row(db, 'Verificata a giugno')['last_checked'] == '2026-07-30 08:38:00'


def test_an_explicit_last_checked_always_wins(db):
    """Si copre la dimenticanza, non si sovrascrive una decisione."""
    pid = _id(db, 'Verificata a giugno')
    r = _run(db, DB_UPDATE, 'position', str(pid), '--is-open', 'true',
             '--last-checked', '2026-07-01 12:00:00')
    assert r.returncode == 0, r.stderr
    assert _row(db, 'Verificata a giugno')['last_checked'] == '2026-07-01 12:00:00'


def test_an_update_without_liveness_leaves_last_checked_alone(db):
    """`last_checked` è la prova di un controllo, non di una scrittura
    qualsiasi: cambiare le note non è aver guardato l'annuncio."""
    pid = _id(db, 'Verificata a giugno')
    before = _row(db, 'Verificata a giugno')['last_checked']
    r = _run(db, DB_UPDATE, 'position', str(pid), '--notes', 'nota di servizio')
    assert r.returncode == 0, r.stderr
    assert _row(db, 'Verificata a giugno')['last_checked'] == before
