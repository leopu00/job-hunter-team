"""O-33 — la ricreazione di `position_user_notes` non perde note.

La chiave primaria passa da `(position_id)` a `(position_id, origin)` perché
quando la stessa nota diverge fra box e sito si tengono ENTRAMBI i testi. In
SQLite quello significa ricreare la tabella, e ricreare significa poter
perdere righe.

⚠️ Questi test girano CON RIGHE DENTRO. Una migrazione provata su tabella
vuota non prova la copia, che è l'unica parte capace di perdere qualcosa: il
verde direbbe solo che il DDL è sintatticamente corretto.
"""

from __future__ import annotations

import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

OLD_SHAPE = """
CREATE TABLE positions (id INTEGER PRIMARY KEY);
CREATE TABLE position_user_notes (
    position_id INTEGER PRIMARY KEY,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import _db
    return importlib.reload(_db)


def _old_db_with_notes(_db, notes):
    conn = _db.get_db()
    conn.row_factory = sqlite3.Row
    conn.executescript(OLD_SHAPE)
    for pid, body in notes:
        conn.execute("INSERT INTO positions (id) VALUES (?)", (pid,))
        conn.execute(
            "INSERT INTO position_user_notes (position_id, body) VALUES (?, ?)",
            (pid, body),
        )
    conn.commit()
    return conn


def test_existing_notes_survive_the_recreation(db):
    """Il caso che decide se la migrazione si può eseguire."""
    notes = [(1, "il recruiter è Anna"), (2, "chiedere della RAL")]
    conn = _old_db_with_notes(db, notes)

    db._migrate_position_user_notes_origin(conn)

    rows = conn.execute(
        "SELECT position_id, origin, body FROM position_user_notes ORDER BY position_id"
    ).fetchall()
    assert len(rows) == 2, "la migrazione ha perso una nota"
    assert [r["body"] for r in rows] == [b for _, b in notes]
    # Le note che c'erano prima potevano nascere solo sul box.
    assert {r["origin"] for r in rows} == {"box"}


def test_the_new_key_allows_two_notes_for_one_position(db):
    conn = _old_db_with_notes(db, [(1, "scritta dal box")])
    db._migrate_position_user_notes_origin(conn)

    conn.execute(
        "INSERT INTO position_user_notes (position_id, origin, body) "
        "VALUES (1, 'web', 'scritta dal sito')"
    )
    conn.commit()

    rows = conn.execute(
        "SELECT origin, body FROM position_user_notes WHERE position_id = 1"
    ).fetchall()
    assert len(rows) == 2, "le due origini non convivono: 'tieni entrambe' non regge"
    assert {r["origin"] for r in rows} == {"box", "web"}


def test_running_it_twice_changes_nothing(db):
    conn = _old_db_with_notes(db, [(1, "una nota")])
    db._migrate_position_user_notes_origin(conn)
    db._migrate_position_user_notes_origin(conn)

    rows = conn.execute("SELECT body FROM position_user_notes").fetchall()
    assert len(rows) == 1
    assert rows[0]["body"] == "una nota"


def test_it_refuses_to_drop_when_the_count_does_not_match(db, monkeypatch):
    """Se la copia perde righe, la vecchia tabella resta dov'è.

    Si sabota la copia — un vincolo che rifiuta una delle due righe — e si
    verifica che la migrazione si fermi con un errore INVECE di droppare.
    È la differenza fra una migrazione che fallisce e una nota che sparisce.
    """
    conn = _old_db_with_notes(db, [(1, "prima"), (2, "seconda")])

    real_execute = conn.execute

    def sabotaged(sql, *args):
        if sql.strip().startswith("INSERT INTO position_user_notes_new"):
            # Copia una riga sola: la condizione che la verifica deve vedere.
            return real_execute(
                "INSERT INTO position_user_notes_new "
                "(position_id, origin, body) "
                "SELECT position_id, 'box', body FROM position_user_notes LIMIT 1"
            )
        return real_execute(sql, *args)

    monkeypatch.setattr(conn, "execute", sabotaged)

    with pytest.raises(RuntimeError) as err:
        db._migrate_position_user_notes_origin(conn)
    assert "aborted" in str(err.value)
    assert "Nothing was dropped" in str(err.value)

    monkeypatch.undo()
    # La tabella originale è ancora lì, con entrambe le note.
    rows = conn.execute("SELECT body FROM position_user_notes").fetchall()
    assert len(rows) == 2, "ha droppato la vecchia tabella nonostante l'errore"


def test_a_fresh_database_gets_the_new_shape_directly(db):
    conn = db.get_db()
    conn.row_factory = sqlite3.Row
    db.ensure_schema(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(position_user_notes)")}
    assert "origin" in cols
