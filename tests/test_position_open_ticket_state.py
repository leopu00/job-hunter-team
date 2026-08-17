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

import os
import sqlite3
import subprocess
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


def test_rescore_ticket_has_one_active_request_but_keeps_resolved_history(box):
    box.execute(
        "INSERT INTO position_tickets (position_id, request_text, kind, status) "
        "VALUES (5, 'rivaluta', 'rescore', 'open')"
    )
    box.commit()

    with pytest.raises(sqlite3.IntegrityError):
        box.execute(
            "INSERT INTO position_tickets "
            "(position_id, request_text, kind, status) "
            "VALUES (5, 'duplicato', 'rescore', 'assigned')"
        )
    box.rollback()

    box.execute(
        "UPDATE position_tickets SET status = 'resolved' "
        "WHERE position_id = 5 AND kind = 'rescore'"
    )
    box.execute(
        "INSERT INTO position_tickets (position_id, request_text, kind, status) "
        "VALUES (5, 'rivaluta ancora', 'rescore', 'open')"
    )
    box.commit()
    assert box.execute(
        "SELECT COUNT(*) FROM position_tickets "
        "WHERE position_id = 5 AND kind = 'rescore'"
    ).fetchone()[0] == 2


def test_schema_upgrade_sanitizes_legacy_active_rescores_without_data_loss(
    box,
):
    """Un DB pre-O-70 poteva già usare liberamente ``kind=rescore``."""
    import _db

    box.execute("DROP INDEX idx_position_tickets_active_rescore")
    legacy_rows = [
        (
            "richiesta open più vecchia",
            "open",
            None,
            "risposta open conservata",
            401,
            "2026-01-01 08:00:00",
            None,
        ),
        (
            "richiesta assegnata",
            "assigned",
            "SCORER",
            "risposta assigned conservata",
            402,
            "2026-01-02 08:00:00",
            "2026-01-02 09:00:00",
        ),
        (
            "seconda richiesta assegnata",
            "assigned",
            "SCORER-2",
            None,
            403,
            "2026-01-03 08:00:00",
            "2026-01-03 09:00:00",
        ),
    ]
    box.executemany(
        "INSERT INTO position_tickets "
        "(position_id, request_text, kind, status, assigned_agent, "
        " response_text, cloud_id, created_at, assigned_at) "
        "VALUES (5, ?, 'rescore', ?, ?, ?, ?, ?, ?)",
        legacy_rows,
    )
    box.commit()

    before = [
        tuple(row)
        for row in box.execute(
            "SELECT id, request_text, assigned_agent, response_text, cloud_id, "
            "created_at, assigned_at FROM position_tickets "
            "WHERE kind = 'rescore' ORDER BY id"
        )
    ]

    _db.ensure_schema(box)

    after = [
        tuple(row)
        for row in box.execute(
            "SELECT id, request_text, assigned_agent, response_text, cloud_id, "
            "created_at, assigned_at FROM position_tickets "
            "WHERE kind = 'rescore' ORDER BY id"
        )
    ]
    assert after == before, "la sanatoria non deve perdere o riscrivere contenuto"

    rows = box.execute(
        "SELECT request_text, status, resolved_at FROM position_tickets "
        "WHERE kind = 'rescore' ORDER BY id"
    ).fetchall()
    assert [(row["request_text"], row["status"]) for row in rows] == [
        ("richiesta open più vecchia", "resolved"),
        ("richiesta assegnata", "assigned"),
        ("seconda richiesta assegnata", "resolved"),
    ]
    assert rows[0]["resolved_at"] is not None
    assert rows[1]["resolved_at"] is None
    assert rows[2]["resolved_at"] is not None
    assert box.execute(
        "SELECT COUNT(*) FROM sqlite_master "
        "WHERE type = 'index' AND name = 'idx_position_tickets_active_rescore'"
    ).fetchone()[0] == 1

    with pytest.raises(sqlite3.IntegrityError):
        box.execute(
            "INSERT INTO position_tickets "
            "(position_id, request_text, kind, status) "
            "VALUES (5, 'nuovo duplicato', 'rescore', 'open')"
        )
    box.rollback()


def test_rescore_ticket_resolves_only_after_the_score_effect(box, tmp_path):
    """Rifiuto → db_insert rescore reale → effetto avanzato → resolve."""
    db_path = box.execute("PRAGMA database_list").fetchone()[2]
    box.execute(
        "INSERT INTO scores (position_id, total_score, scored_at) "
        "VALUES (5, 60, '2000-01-01 00:00:00')"
    )
    ticket_id = box.execute(
        "INSERT INTO position_tickets "
        "(position_id, request_text, kind, status, assigned_agent, created_at) "
        "VALUES (5, 'rivaluta', 'rescore', 'assigned', 'SCORER', "
        "        '2000-01-02 00:00:00')"
    ).lastrowid
    box.commit()

    env = {
        **os.environ,
        "JHT_DB": db_path,
        "JHT_HOME": str(tmp_path),
    }
    ticket_cli = ROOT / "shared" / "skills" / "ticket.py"
    db_insert_cli = ROOT / "shared" / "skills" / "db_insert.py"

    premature = subprocess.run(
        [sys.executable, str(ticket_cli), "resolve", str(ticket_id),
         "--response", "Rivalutazione completata"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert premature.returncode == 1
    assert "rescore effect not verified" in premature.stderr
    still_assigned = box.execute(
        "SELECT status, response_text FROM position_tickets WHERE id = ?",
        (ticket_id,),
    ).fetchone()
    assert tuple(still_assigned) == ("assigned", None)

    profile_dir = tmp_path / "profile"
    profile_dir.mkdir(exist_ok=True)
    (profile_dir / "candidate_profile.yml").write_text(
        'name: "Synthetic Test"\ntarget_role: "Backend Developer"\n',
        encoding="utf-8",
    )
    scored = subprocess.run(
        [
            sys.executable,
            str(db_insert_cli),
            "score",
            "--position-id", "5",
            "--total", "80",
            "--stack", "30",
            "--remote", "20",
            "--salary", "15",
            "--experience", "5",
            "--strategic", "10",
            "--scored-by", "scorer-test",
            "--action", "rescore",
            "--outcome", "updated",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert scored.returncode == 0, scored.stdout + scored.stderr
    new_score = box.execute(
        "SELECT total_score, scored_at, "
        "       julianday(scored_at) > julianday('2000-01-02 00:00:00') "
        "FROM scores WHERE position_id = 5"
    ).fetchone()
    assert tuple(new_score)[0] == 80
    assert tuple(new_score)[2] == 1

    completed = subprocess.run(
        [sys.executable, str(ticket_cli), "resolve", str(ticket_id),
         "--response", "Rivalutazione completata"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    resolved = box.execute(
        "SELECT status, response_text FROM position_tickets WHERE id = ?",
        (ticket_id,),
    ).fetchone()
    assert tuple(resolved) == ("resolved", "Rivalutazione completata")


def test_cloud_migration_sanitizes_legacy_rescores_before_unique_index():
    migration = (
        ROOT / "supabase" / "migrations" / "071_rescore_ticket_dedup.sql"
    ).read_text(encoding="utf-8")
    update_at = migration.index("UPDATE position_tickets AS ticket")
    index_at = migration.index("CREATE UNIQUE INDEX")

    assert update_at < index_at
    assert "PARTITION BY user_id, position_legacy_id, kind" in migration
    assert "CASE status WHEN 'assigned' THEN 0 ELSE 1 END" in migration
    assert "ranked.active_rank > 1" in migration
    assert "SET status = 'resolved'" in migration
    assert "DELETE FROM POSITION_TICKETS" not in migration.upper()


def test_ticket_cli_exposes_rescore_kind_for_captain_routing(box):
    import ticket

    box.execute(
        "INSERT INTO position_tickets (position_id, request_text, kind, status) "
        "VALUES (5, 'rivaluta', 'rescore', 'open')"
    )
    box.commit()
    row = box.execute(
        "SELECT * FROM position_tickets WHERE position_id = 5"
    ).fetchone()

    assert "kind=rescore" in ticket._fmt(row)


def test_ticket_skill_compone_allegato_senza_nuovo_storage(box):
    import ticket

    ticket_id = ticket.open_ticket(
        box,
        5,
        "Verifica i requisiti nel documento",
        attachment_path="/jht_user/allegati/requisiti.pdf",
    )
    request = box.execute(
        "SELECT request_text FROM position_tickets WHERE id = ?", (ticket_id,)
    ).fetchone()[0]

    assert request == (
        "Verifica i requisiti nel documento\n\n"
        "[FILE ALLEGATI]\n/jht_user/allegati/requisiti.pdf"
    )


def test_ticket_skill_rifiuta_un_path_non_restituito_dal_trasporto(box):
    import ticket

    with pytest.raises(ValueError, match="invalid attachment path"):
        ticket.open_ticket(
            box, 5, "Leggi", attachment_path="/jht_user/allegati/../segreto.pdf"
        )
    assert box.execute("SELECT COUNT(*) FROM position_tickets").fetchone()[0] == 0


def test_the_query_matches_the_one_the_list_actually_runs():
    """Il test parla della lista vera solo se la sotto-query è la stessa."""
    src = (ROOT / "web/lib/local-queries.ts").read_text(encoding="utf-8")
    assert "FROM position_tickets t" in src
    assert "'open','assigned'" in src
    assert "AS open_tickets" in src
