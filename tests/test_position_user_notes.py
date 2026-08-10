"""O-22 — il blocco note privato sopravvive a quello che gli passa sopra.

Tre proprietà, e la terza è quella per cui esiste una tabella separata invece
di una colonna:

 1. è PRIVATA: non tocca `positions.notes`, che è il campo degli agenti;
 2. è LOCALE: vive in SQLite, quindi funziona col cloud irraggiungibile;
 3. SOPRAVVIVE AI PUSH/RESTORE del box. `jht cloud restore` fa
    INSERT OR REPLACE su `positions` con un elenco esplicito di colonne: una
    colonna in più verrebbe azzerata a ogni restore, e un campo che perde
    quello che ci scrivi è peggio di un campo che non c'è.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

RESTORE_SQL = """
INSERT OR REPLACE INTO positions (
  id, title, company, url, source, status, found_at
) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
"""


@pytest.fixture()
def box(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import importlib
    import _db
    _db = importlib.reload(_db)
    conn = _db.get_db()
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, company, title, url, status) "
        "VALUES (7, 'Lumon', 'Frontend', 'https://example.invalid/7', 'scored')"
    )
    conn.execute(
        "INSERT INTO position_user_notes (position_id, body) VALUES (7, 'chiedere del team distribuito')"
    )
    conn.commit()
    return conn


def test_the_note_is_not_the_agents_field(box):
    """`positions.notes` resta degli agenti: mescolarle renderebbe
    irreversibile la scelta «privata»."""
    row = box.execute("SELECT notes FROM positions WHERE id = 7").fetchone()
    assert row["notes"] is None
    note = box.execute(
        "SELECT body FROM position_user_notes WHERE position_id = 7"
    ).fetchone()
    assert note["body"] == "chiedere del team distribuito"


def test_the_note_survives_a_cloud_restore(box):
    """Il caso che decide la forma del dato.

    Si simula ciò che fa `jht cloud restore`: INSERT OR REPLACE sulla riga
    della posizione. Con la nota su `positions` sparirebbe qui.
    """
    box.execute(RESTORE_SQL, (7, "Frontend", "Lumon",
                              "https://example.invalid/7", "linkedin", "applied"))
    box.commit()

    note = box.execute(
        "SELECT body FROM position_user_notes WHERE position_id = 7"
    ).fetchone()
    assert note is not None, "il restore ha cancellato la nota dell'utente"
    assert note["body"] == "chiedere del team distribuito"
    # …e la posizione è stata davvero sostituita, altrimenti il test non
    # starebbe provando niente.
    assert box.execute(
        "SELECT status FROM positions WHERE id = 7"
    ).fetchone()["status"] == "applied"


def test_one_note_per_position_the_last_one_wins(box):
    """Blocco note, non event-log: riscrivere sostituisce."""
    box.execute(
        "INSERT INTO position_user_notes (position_id, body) VALUES (7, 'seconda')"
        " ON CONFLICT(position_id) DO UPDATE SET body = excluded.body"
    )
    box.commit()
    rows = box.execute(
        "SELECT body FROM position_user_notes WHERE position_id = 7"
    ).fetchall()
    assert len(rows) == 1
    assert rows[0]["body"] == "seconda"


def test_the_migration_is_idempotent_and_additive(tmp_path, monkeypatch):
    """Un jobs.db più vecchio del codice non ha la tabella: si crea, e
    rieseguire non rompe niente (il difetto trovato su O-16)."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import importlib
    import _db
    _db = importlib.reload(_db)
    conn = _db.get_db()
    conn.row_factory = sqlite3.Row
    conn.executescript("CREATE TABLE positions (id INTEGER PRIMARY KEY);")

    _db._migrate_position_user_notes(conn)
    _db._migrate_position_user_notes(conn)

    conn.execute("INSERT INTO positions (id) VALUES (1)")
    conn.execute("INSERT INTO position_user_notes (position_id, body) VALUES (1, 'x')")
    conn.commit()
    assert conn.execute(
        "SELECT COUNT(*) AS n FROM position_user_notes"
    ).fetchone()["n"] == 1


def test_a_column_on_positions_would_have_been_wiped(box):
    """La prova del PERCHÉ, non solo del cosa.

    Si aggiunge davvero una colonna a `positions`, ci si scrive dentro, e si
    esegue lo stesso INSERT OR REPLACE del restore: la colonna torna NULL.
    È la forma che il ticket chiedeva di evitare, dimostrata invece che
    asserita — se un giorno il restore smettesse di cancellare, questo test
    lo direbbe e la tabella separata diventerebbe una scelta discutibile.
    """
    box.execute("ALTER TABLE positions ADD COLUMN user_note_demo TEXT")
    box.execute("UPDATE positions SET user_note_demo = 'la mia nota' WHERE id = 7")
    box.commit()

    box.execute(RESTORE_SQL, (7, "Frontend", "Lumon",
                              "https://example.invalid/7", "linkedin", "applied"))
    box.commit()

    wiped = box.execute(
        "SELECT user_note_demo FROM positions WHERE id = 7"
    ).fetchone()["user_note_demo"]
    assert wiped is None, (
        "il restore NON azzera più le colonne non elencate: la ragione per "
        "cui la nota vive in una tabella separata va rivista"
    )
