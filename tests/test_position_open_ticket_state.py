"""O-31 — una posizione con un ticket senza risposta lo mostra come stato.

Due proprietà, e la seconda è quella che il vice ha chiesto di verificare:

 1. «senza risposta» include `assigned`, non solo `open`. Che un agente ci
    stia lavorando non significa che l'utente abbia avuto la risposta;
 2. alla CHIUSURA lo stato torna quello della posizione, e non resta appeso.
    È il caso «non consegnato» al contrario, e sarebbe il difetto peggiore
    dei due: una posizione che dice per sempre di avere un ticket aperto.

La seconda è gratis solo perché il flag è DERIVATO dai ticket a ogni lettura
invece di essere salvato sulla posizione. Il test lo fissa comunque: se un
giorno qualcuno lo materializzasse in una colonna, è qui che lo scopre.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

# La stessa sotto-query che usa web/lib/local-queries.ts. Se le due
# divergono, questo test smette di parlare della lista vera.
OPEN_TICKETS_SQL = """
SELECT (SELECT COUNT(*) FROM position_tickets t
          WHERE t.position_id = p.id
            AND t.status IN ('open','assigned')) AS open_tickets
  FROM positions p WHERE p.id = ?
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
        "VALUES (5, 'Lumon', 'Frontend', 'https://example.invalid/5', 'scored')"
    )
    conn.commit()
    return conn


def _pending(conn) -> int:
    return conn.execute(OPEN_TICKETS_SQL, (5,)).fetchone()["open_tickets"]


def test_no_ticket_means_the_position_shows_its_own_state(box):
    assert _pending(box) == 0


@pytest.mark.parametrize("status", ["open", "assigned"])
def test_an_unanswered_ticket_counts_including_assigned(box, status):
    """`assigned` è in lavorazione, non risposto: deve contare."""
    box.execute(
        "INSERT INTO position_tickets (position_id, request_text, status) "
        "VALUES (5, 'Puoi ricontrollare la RAL?', ?)",
        (status,),
    )
    box.commit()
    assert _pending(box) == 1


def test_a_resolved_ticket_does_not_count(box):
    box.execute(
        "INSERT INTO position_tickets (position_id, request_text, status) "
        "VALUES (5, 'gia risposto', 'resolved')"
    )
    box.commit()
    assert _pending(box) == 0


def test_closing_the_ticket_gives_the_position_its_state_back(box):
    """Il caso segnalato dal vice: niente stato appeso dopo la chiusura."""
    box.execute(
        "INSERT INTO position_tickets (position_id, request_text, status) "
        "VALUES (5, 'domanda', 'open')"
    )
    box.commit()
    assert _pending(box) == 1

    box.execute(
        "UPDATE position_tickets SET status = 'resolved', response_text = 'ecco' "
        "WHERE position_id = 5"
    )
    box.commit()

    assert _pending(box) == 0, "lo stato 'ticket' resta appeso dopo la chiusura"
    # …e la posizione ha ancora il suo stato, che è quello che deve tornare
    # a mostrare.
    assert box.execute(
        "SELECT status FROM positions WHERE id = 5"
    ).fetchone()["status"] == "scored"


def test_several_tickets_on_one_position_still_read_as_one_pending(box):
    for status in ("open", "assigned", "resolved"):
        box.execute(
            "INSERT INTO position_tickets (position_id, request_text, status) "
            "VALUES (5, 'x', ?)",
            (status,),
        )
    box.commit()
    # Alla lista serve sapere SE c'è qualcosa in sospeso, non quanti.
    assert _pending(box) >= 1


def test_the_query_matches_the_one_the_list_actually_runs():
    """Il test parla della lista vera solo se la sotto-query è la stessa."""
    src = (ROOT / "web/lib/local-queries.ts").read_text(encoding="utf-8")
    assert "FROM position_tickets t" in src
    assert "'open','assigned'" in src
    assert "AS open_tickets" in src
