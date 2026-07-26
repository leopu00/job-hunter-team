"""
`ensure_schema()` deve lasciare uno schema COMPLETO in una sola chiamata.

Il bug che questi test bloccano (trovato il 2026-07-25, scritto il fix nello
stesso giro): dentro `ensure_schema` le migrazioni giravano PRIMA delle
`CREATE TABLE IF NOT EXISTS`. Su un database esistente è l'ordine giusto —
alterano tabelle già presenti. Su un database NUOVO, invece, non trovavano
niente da alterare: `PRAGMA table_info` tornava vuoto, ogni migrazione si
saltava, e subito dopo il DDL base creava `positions` senza le colonne che
solo le migrazioni aggiungono.

Risultato: un jobs.db appena creato era incompleto fino alla chiamata
*successiva* di ensure_schema, in un altro processo. Chi scriveva subito su
quelle colonne senza passare da qui — la route web apre SQLite diretta con
better-sqlite3 — prendeva `no such column` al primo avvio.

Eseguire con: pytest tests/test_db_schema_complete.py -v
"""

import os
import sqlite3
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

# Colonne che NON stanno nel DDL base: esistono solo perché una migrazione le
# aggiunge. Sono esattamente quelle che il bug lasciava fuori.
MIGRATION_ADDED = [
    'user_excluded_reason', 'user_excluded_note', 'user_excluded_at',
    'user_excluded_prev_status',
    'write_requested', 'geocode_requested', 'recheck_requested',
    'role_family', 'role_family_proposed', 'jd_summary',
]

_ONE_CALL = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)          # UNA volta sola: è il punto del test
conn.close()
"""


def build(tmp_path, script, module_dir=SKILLS_DIR):
    """Crea il DB in un interprete separato: `_db` risolve DB_PATH all'import,
    quindi in-process il primo test fisserebbe il path per tutti."""
    path = str(tmp_path / 'jobs.db')
    r = subprocess.run(
        [sys.executable, '-c', script.format(skills=module_dir)],
        capture_output=True, text=True, env={**os.environ, 'JHT_DB': path},
    )
    assert r.returncode == 0, r.stderr
    return path


def columns(db_path, table='positions'):
    conn = sqlite3.connect(db_path)
    try:
        return {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
    finally:
        conn.close()


@pytest.mark.parametrize('column', MIGRATION_ADDED)
def test_db_nuovo_ha_le_colonne_delle_migrazioni(tmp_path, column):
    assert column in columns(build(tmp_path, _ONE_CALL)), (
        f"'{column}' manca dopo un solo ensure_schema su un DB nuovo: "
        "le migrazioni stanno girando prima che le tabelle esistano"
    )


def test_una_seconda_chiamata_non_cambia_nulla(tmp_path):
    """Idempotenza: se il secondo giro aggiungesse ancora qualcosa, vorrebbe
    dire che una chiamata sola continua a non bastare."""
    db = build(tmp_path, _ONE_CALL)
    before = columns(db)
    subprocess.run(
        [sys.executable, '-c', _ONE_CALL.format(skills=SKILLS_DIR)],
        capture_output=True, text=True, env={**os.environ, 'JHT_DB': db},
        check=True,
    )
    assert columns(db) == before


def test_scrivere_subito_dopo_la_creazione_funziona(tmp_path):
    """Il caso reale che falliva: creare il DB e usarlo nello stesso momento,
    senza un secondo processo che 'ripari' lo schema per caso."""
    db = build(tmp_path, _ONE_CALL)
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "INSERT INTO positions (title, company, status) VALUES ('T', 'C', 'scored')")
        conn.execute(
            "UPDATE positions SET user_excluded_reason = 'closed', "
            "user_excluded_prev_status = 'scored' WHERE id = 1")
        conn.commit()
        assert conn.execute(
            "SELECT user_excluded_reason FROM positions WHERE id = 1"
        ).fetchone()[0] == 'closed'
    finally:
        conn.close()


def test_un_db_di_giugno_si_aggiorna_senza_perdere_dati(tmp_path):
    """Regressione dall'altro lato: spostare le migrazioni non deve rompere
    l'upgrade di un database creato da una versione precedente. Il DB si
    costruisce col `_db.py` di quel commit, non a mano — uno schema scritto a
    mano non è mai fedele abbastanza per essere una prova."""
    old_src = subprocess.run(
        ['git', 'show', '50d804009:shared/skills/_db.py'],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if old_src.returncode != 0:
        pytest.skip('commit di riferimento non presente in questo checkout')

    old_dir = tmp_path / 'old'
    old_dir.mkdir()
    (old_dir / '_db.py').write_text(old_src.stdout, encoding='utf-8')

    db = build(tmp_path, """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db(); ensure_schema(conn)
conn.execute("INSERT INTO positions (title, company, status) VALUES ('Vecchia','Legacy','scored')")
conn.commit(); conn.close()
""", module_dir=str(old_dir))

    assert not any(c.startswith('user_excluded') for c in columns(db)), \
        'il DB di partenza non è davvero vecchio: il test non proverebbe nulla'

    subprocess.run(
        [sys.executable, '-c', _ONE_CALL.format(skills=SKILLS_DIR)],
        capture_output=True, text=True, env={**os.environ, 'JHT_DB': db}, check=True,
    )

    cols = columns(db)
    for c in MIGRATION_ADDED:
        assert c in cols, f"'{c}' non aggiunta durante l'upgrade"

    conn = sqlite3.connect(db)
    try:
        assert conn.execute('SELECT title FROM positions').fetchone()[0] == 'Vecchia'
    finally:
        conn.close()
