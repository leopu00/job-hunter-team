"""
[JHT-CHAT-UNIFY] `pending_user_messages` smette di essere solo la coda di
notifiche agente→utente e diventa lo storico della conversazione, condiviso
fra videogioco e web.

Il cambio è di DUE colonne — `author` e `chat_ts` — ma tocca il pezzo di
schema su cui poggiano tre cose diverse: la chat web, la corsia di sync
(`cli/src/lib/chat-sync.js`) e la lettura diretta di better-sqlite3 dalle
route Next. Quello che questi test proteggono:

* un DB NUOVO le ha subito (il DDL base), non solo dopo che una migrazione
  ha ripassato — è lo stesso identico bug del 2026-07-25 su `positions`,
  che si manifestava come `no such column` nella route web al primo avvio;
* un DB VECCHIO le acquista senza perdere le righe che aveva, e con
  `author='agent'` su tutto lo storico: un messaggio senza autore
  scomparirebbe dalla chat, che ordina i turni proprio per quello;
* la migrazione è idempotente (gira a ogni `ensure_schema`).

Eseguire con: pytest tests/test_chat_turns_schema.py -v
"""

import os
import sqlite3
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

# Lo schema di `pending_user_messages` PRIMA di questo lavoro (mig 010 +
# colonne successive), scritto a mano perché serve proprio a simulare un
# jobs.db più vecchio del codice.
LEGACY_TABLE = """
CREATE TABLE pending_user_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'notification',
    related_position_id INTEGER,
    delivered_via TEXT,
    delivered_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    user_reply TEXT,
    user_reply_at TIMESTAMP,
    agent_seen_reply_at TIMESTAMP,
    cloud_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

ENSURE = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
conn.close()
"""


def ensure_schema_on(db_path):
    """Esegue ensure_schema in un interprete separato: `_db` risolve DB_PATH
    all'import, quindi in-process il primo test lo fisserebbe per tutti."""
    r = subprocess.run(
        [sys.executable, '-c', ENSURE.format(skills=SKILLS_DIR)],
        capture_output=True, text=True, env={**os.environ, 'JHT_DB': str(db_path)},
    )
    assert r.returncode == 0, r.stderr
    return str(db_path)


def columns(db_path, table='pending_user_messages'):
    conn = sqlite3.connect(db_path)
    try:
        return {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
    finally:
        conn.close()


@pytest.mark.parametrize('column', ['author', 'chat_ts'])
def test_db_nuovo_ha_le_colonne_della_conversazione(tmp_path, column):
    db = ensure_schema_on(tmp_path / 'jobs.db')
    assert column in columns(db), (
        f"'{column}' manca su un jobs.db appena creato: la route web apre "
        "SQLite diretta e prenderebbe 'no such column' al primo avvio"
    )


def test_il_default_e_agent(tmp_path):
    """Una riga inserita senza autore è dell'agente: è il comportamento
    storico della tabella (coda di notifiche) e non deve cambiare."""
    db = ensure_schema_on(tmp_path / 'jobs.db')
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body) VALUES ('capitano', 'ciao')")
        conn.commit()
        row = conn.execute(
            "SELECT author, chat_ts FROM pending_user_messages").fetchone()
        assert row[0] == 'agent'
        # NULL = "non ancora specchiato in chat.jsonl": è la guardia che fa
        # partire il mirror verso la chat del gioco.
        assert row[1] is None
    finally:
        conn.close()


def test_un_turno_utente_si_scrive(tmp_path):
    """La riga che prima non poteva esistere: un messaggio dell'utente come
    turno a sé, non come `user_reply` appesa a un messaggio dell'agente."""
    db = ensure_schema_on(tmp_path / 'jobs.db')
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, author, chat_ts) "
            "VALUES ('capitano', 'che ore sono?', 'user', 1753790000.5)")
        conn.commit()
        assert conn.execute(
            "SELECT body FROM pending_user_messages WHERE author = 'user'"
        ).fetchone()[0] == 'che ore sono?'
    finally:
        conn.close()


def test_db_vecchio_si_aggiorna_senza_perdere_i_messaggi(tmp_path):
    """Un jobs.db con la tabella nella forma precedente: le due colonne
    arrivano, e le righe che c'erano restano — con autore 'agent', perché
    erano tutte notifiche del team."""
    db = tmp_path / 'jobs.db'
    conn = sqlite3.connect(db)
    try:
        conn.executescript(LEGACY_TABLE)
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, user_reply) "
            "VALUES ('mentor', 'vecchia notifica', 'vecchia risposta')")
        conn.commit()
    finally:
        conn.close()

    ensure_schema_on(db)

    assert {'author', 'chat_ts'} <= columns(db)
    conn = sqlite3.connect(db)
    try:
        row = conn.execute(
            "SELECT body, author, chat_ts, user_reply FROM pending_user_messages"
        ).fetchone()
        assert row[0] == 'vecchia notifica'
        assert row[1] == 'agent'
        assert row[2] is None
        # La vecchia reply non si perde: la chat web continua a mostrarla.
        assert row[3] == 'vecchia risposta'
    finally:
        conn.close()


def test_migrazione_idempotente(tmp_path):
    """`ensure_schema` gira a ogni apertura: il secondo giro non deve né
    fallire né cambiare lo schema."""
    db = ensure_schema_on(tmp_path / 'jobs.db')
    before = columns(db)
    ensure_schema_on(db)
    assert columns(db) == before


def test_indice_dei_turni_da_specchiare(tmp_path):
    """Il mirror cerca 'i turni non ancora in chat.jsonl' a ogni giro veloce
    del daemon (~5s): senza indice sarebbe una scansione della tabella."""
    db = ensure_schema_on(tmp_path / 'jobs.db')
    conn = sqlite3.connect(db)
    try:
        names = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='pending_user_messages'")
        }
    finally:
        conn.close()
    assert 'idx_pending_messages_unmirrored' in names
    # E il verso opposto: l'ingest chiede "di questi ts, quali ho gia'?" a
    # ogni giro in cui chat.jsonl si muove, ed e' la guardia che impedisce di
    # reimportare due volte lo stesso turno.
    assert 'idx_pending_messages_mirrored' in names
