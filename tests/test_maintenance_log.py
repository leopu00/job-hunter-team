"""Test dello storico dei controlli di manutenzione.

Due cose da garantire:

1. **Lo storico non si sovrascrive** — `last_checked` tiene solo l'ultima
   data, qui ogni controllo lascia una riga, anche quello che non ha
   cambiato niente (sapere che una posizione è stata guardata è metà del
   punto).

2. **L'incerto non si butta** — un controllo che non è riuscito a stabilire
   se l'offerta è aperta NON può chiuderla. Non sapere non è sapere che è
   scaduta, e una posizione chiusa per dubbio è un'occasione persa in
   silenzio. La skill `recheck-liveness` lo prescrive già a parole; questi
   test verificano che ora lo impedisca il codice.

Eseguire:
    pytest tests/test_maintenance_log.py -v
"""

import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
sys.path.insert(0, SKILLS_DIR)

import maintenance_log as ml  # noqa: E402


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.execute("""
        CREATE TABLE maintenance_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            by_agent TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            outcome TEXT NOT NULL,
            field TEXT, before TEXT, after TEXT,
            evidence_kind TEXT, evidence_url TEXT, evidence_code INTEGER,
            evidence_hash TEXT, duration_ms INTEGER
        )""")
    yield c
    c.close()


# ── La regola che protegge il portafoglio ────────────────────────────────

class TestUncertainNeverCloses:

    @pytest.mark.parametrize("outcome", ml.INCONCLUSIVE_OUTCOMES)
    def test_cannot_close_is_open(self, outcome):
        with pytest.raises(ml.MaintenanceError):
            ml.check_closing_write("is_open", "false", outcome)

    @pytest.mark.parametrize("outcome", ml.INCONCLUSIVE_OUTCOMES)
    @pytest.mark.parametrize("status", ["excluded", "expired"])
    def test_cannot_exclude(self, outcome, status):
        with pytest.raises(ml.MaintenanceError):
            ml.check_closing_write("status", status, outcome)

    def test_confirmed_closed_may_close(self):
        """Quando la prova c'è, chiudere è giusto e deve passare."""
        ml.check_closing_write("is_open", "false", "confirmed_closed")
        ml.check_closing_write("status", "expired", "confirmed_closed")

    def test_uncertain_may_still_update_other_fields(self):
        """Il divieto è solo sulla chiusura: il resto del lavoro passa."""
        ml.check_closing_write("office_lat", "41.9", "inconclusive")
        ml.check_closing_write("notes", "irraggiungibile", "unreachable")

    def test_reopening_is_never_blocked(self):
        """Riaprire non perde niente: non va mai ostacolato."""
        ml.check_closing_write("is_open", "true", "inconclusive")

    def test_closing_blocked_end_to_end(self, conn):
        """Il divieto vale anche sul percorso reale, dal diff."""
        with pytest.raises(ml.MaintenanceError):
            ml.record_diffs(conn, "position", 5, "liveness_check",
                            [("is_open", 1, "false")], outcome="inconclusive")
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 0


# ── Lo storico ───────────────────────────────────────────────────────────

class TestHistory:

    def test_check_that_changed_nothing_is_still_recorded(self, conn):
        """Un controllo senza modifiche è comunque un controllo avvenuto."""
        n = ml.record_diffs(conn, "position", 42, "liveness_check", [],
                            outcome="confirmed_open", by_agent="scout-1")
        assert n == 1
        assert conn.execute(
            "SELECT outcome FROM maintenance_events").fetchone()[0] == "confirmed_open"

    def test_one_row_per_changed_field(self, conn):
        diffs = [("is_open", 1, 0), ("status", "ready", "expired")]
        n = ml.record_diffs(conn, "position", 7, "liveness_check", diffs,
                            outcome="confirmed_closed", by_agent="analista-1")
        assert n == 2
        rows = conn.execute(
            "SELECT field, before, after FROM maintenance_events "
            "ORDER BY field").fetchall()
        assert rows == [("is_open", "1", "0"), ("status", "ready", "expired")]

    def test_history_accumulates_instead_of_overwriting(self, conn):
        """È la differenza con `last_checked`, che tiene solo l'ultimo giro."""
        for _ in range(3):
            ml.record_diffs(conn, "position", 9, "liveness_check", [],
                            outcome="confirmed_open")
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 3

    def test_none_stays_none(self, conn):
        """`None` non deve diventare la stringa 'None': è un valore assente."""
        ml.record(conn, "position", 1, "geocode", "updated", field="office_lat",
                  before=None, after=41.9)
        row = conn.execute(
            "SELECT before, after FROM maintenance_events").fetchone()
        assert row == (None, "41.9")

    def test_invalid_action_refused_before_write(self, conn):
        with pytest.raises(ml.MaintenanceError):
            ml.record(conn, "position", 1, "inventata", "unchanged")
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 0

    def test_no_commit_inside_record(self, conn):
        """Il controllo dev'essere annullabile con la modifica che descrive."""
        ml.record(conn, "position", 1, "geocode", "unchanged")
        conn.rollback()
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 0

    def test_evidence_is_optional(self, conn):
        """I dati della fonte aiutano a capire, non sono un obbligo."""
        ml.record(conn, "position", 1, "liveness_check", "confirmed_open")
        ml.record(conn, "position", 1, "liveness_check", "confirmed_open",
                  evidence={"kind": "http", "url": "https://x.test", "code": 200})
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 2


class TestDeriveOutcome:

    def test_changed_is_updated(self):
        assert ml.derive_outcome([("is_open", 1, 0)]) == "updated"

    def test_nothing_changed_is_unchanged(self):
        assert ml.derive_outcome([]) == "unchanged"


class TestUnverifiedStreak:
    """Distinguere "mai guardata" da "non riusciamo mai a leggerla"."""

    def test_counts_consecutive_inconclusive(self, conn):
        for outcome in ("confirmed_open", "inconclusive", "unreachable"):
            ml.record(conn, "position", 3, "liveness_check", outcome)
        assert ml.unverified_streak(conn, 3) == 2

    def test_resets_after_a_conclusive_check(self, conn):
        for outcome in ("inconclusive", "inconclusive", "confirmed_open"):
            ml.record(conn, "position", 4, "liveness_check", outcome)
        assert ml.unverified_streak(conn, 4) == 0

    def test_zero_when_never_checked(self, conn):
        assert ml.unverified_streak(conn, 99) == 0

    def test_ignores_other_actions(self, conn):
        """Un geocoding fallito non dice niente sulla liveness dell'annuncio."""
        ml.record(conn, "position", 5, "geocode", "failed")
        assert ml.unverified_streak(conn, 5) == 0
