"""O-15 — il giudizio sulle posizioni funziona senza cloud.

Prima di questo lavoro `position_feedback` esisteva solo su Supabase: a cloud
spento il comando non rispondeva «nessun giudizio», rispondeva ERRORE. Chi usa
il prodotto senza sincronizzare non poteva esprimere un giudizio, il che
contraddice la promessa local-first.

⚠️ Il cloud qui è IRRAGGIUNGIBILE, non disabilitato da configurazione. È la
lezione di P-07: con una config che dice «cloud spento» si prova solo il ramo
che qualcuno ha già previsto, e non si distingue «funziona offline» da «ha
trovato la rete e non se n'è accorto nessuno». Qui la config dichiara un cloud
ATTIVO che punta a un indirizzo che non risponde — cioè la condizione di un
utente col box acceso e la rete giù.
"""

from __future__ import annotations

import importlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


@pytest.fixture()
def box(tmp_path, monkeypatch):
    """Un jobs.db vero con una posizione, e un cloud che non risponde."""
    db_path = tmp_path / "jobs.db"
    monkeypatch.setenv("JHT_DB_PATH", str(db_path))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))

    import _db
    importlib.reload(_db)
    conn = _db.get_db()
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, company, title, url) "
        "VALUES (77, 'Lumon', 'Frontend Engineer', 'https://example.invalid/77')"
    )
    conn.commit()
    conn.close()

    # Cloud ACCESO ma irraggiungibile: `.invalid` non si risolve mai (RFC 2606),
    # quindi la chiamata fallisce come una rete giù, non come un ramo saltato.
    (tmp_path / "cloud.json").write_text(json.dumps({
        "enabled": True,
        "base_url": "https://box-offline.invalid",
        "token": "test-token",
    }), encoding="utf-8")
    return tmp_path


def _fresh(module_name: str):
    module = importlib.import_module(module_name)
    return importlib.reload(module)


def test_recording_succeeds_with_the_cloud_unreachable(box):
    record = _fresh("feedback_record")
    out = record.record("77", "like", reason="stack combacia")

    assert out["ok"] is True, out
    assert out["source"] == "local"
    # Il cloud non ha preso, e lo dice — senza far fallire il comando.
    assert out["cloud_synced"] is False
    # E ci ha PROVATO davvero: se qui comparisse 'cloud-disabled' vorrebbe
    # dire che la config ha spento la corsia prima della rete, e allora il
    # test proverebbe il ramo già previsto invece della rete giù — cioè
    # esattamente la trappola di P-07.
    assert "cloud-disabled" not in str(out["cloud_error"])
    assert "network" in str(out["cloud_error"])


def test_the_judgement_is_really_in_the_local_database(box):
    record = _fresh("feedback_record")
    record.record("77", "star", score=5, direction="more_like_this")

    conn = sqlite3.connect(box / "jobs.db")
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT action, score, direction FROM position_feedback WHERE position_id = 77"
    ).fetchall()
    conn.close()
    assert len(rows) == 1
    assert rows[0]["action"] == "star"
    assert rows[0]["score"] == 5
    assert rows[0]["direction"] == "more_like_this"


def test_reading_answers_from_local_with_the_cloud_unreachable(box):
    record = _fresh("feedback_record")
    record.record("77", "dislike", reason="troppo senior")

    query = _fresh("feedback_query")
    out = query.check_position("77")

    assert out["ok"] is True
    assert out["source"] == "local"
    assert out["latest_action"] == "dislike"
    assert out["count"] == 1


def test_clear_is_an_event_and_the_latest_one_wins(box):
    record = _fresh("feedback_record")
    record.record("77", "like")
    record.record("77", "clear")

    query = _fresh("feedback_query")
    out = query.check_position("77")
    # 'clear' non cancella la storia: resta leggibile che un voto c'era.
    assert out["latest_action"] == "clear"
    assert out["count"] == 2


def test_a_missing_position_fails_instead_of_pretending(box):
    record = _fresh("feedback_record")
    out = record.record("9999", "like")
    assert out["ok"] is False
    assert "not found" in out["error"]


def test_a_database_older_than_the_code_still_records(box):
    """La finestra fra aggiornamento del CLI e prima migrazione.

    È il difetto trovato su O-16: un jobs.db senza la tabella nuova faceva
    esplodere l'INSERT. Qui la tabella viene creata al volo, perché un utente
    non deve perdere un'azione per l'ordine in cui due cose si incontrano.
    """
    conn = sqlite3.connect(box / "jobs.db")
    conn.execute("DROP TABLE position_feedback")
    conn.commit()
    conn.close()

    record = _fresh("feedback_record")
    out = record.record("77", "like")
    assert out["ok"] is True, out

    conn = sqlite3.connect(box / "jobs.db")
    assert conn.execute(
        "SELECT COUNT(*) FROM position_feedback"
    ).fetchone()[0] == 1
    conn.close()
