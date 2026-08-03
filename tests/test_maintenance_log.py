"""Test del log di evidenza della manutenzione.

Il difetto da cui nasce: `last_checked` & co. sono stato last-write-wins, quindi
un agente che scrive il timestamp senza lavorare è indistinguibile da uno che
ha lavorato. Questi test coprono la sola cosa che rende diverso il nuovo
percorso — **un esito che afferma una verifica non si può scrivere senza una
prova**, e un no-op resta contabilizzato come tale invece di sparire.

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


HTTP_OK = {"kind": "http", "url": "https://example.test/job/1", "code": 200,
           "hash": "a" * 64}
HTTP_404 = {"kind": "http", "url": "https://example.test/job/1", "code": 404}
NO_EVIDENCE = {"kind": None, "url": None, "code": None, "hash": None}


@pytest.fixture
def conn():
    """DB in memoria con la sola tabella sotto test."""
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


# ── Il cuore: nessuna verifica senza prova ───────────────────────────────

class TestEvidenceRequired:

    @pytest.mark.parametrize("outcome", ml.OUTCOMES_REQUIRING_EVIDENCE)
    def test_claim_without_evidence_is_refused(self, outcome):
        """Anche `unchanged` va provato: è l'esito più comodo da falsificare."""
        with pytest.raises(ml.EvidenceError):
            ml.validate("liveness_check", outcome, NO_EVIDENCE)

    def test_unreachable_needs_nothing(self):
        """Il fallimento non afferma niente, quindi non deve provare niente."""
        ml.validate("liveness_check", "unreachable", NO_EVIDENCE)
        ml.validate("liveness_check", "skipped", NO_EVIDENCE)
        ml.validate("liveness_check", "failed", NO_EVIDENCE)

    def test_prose_is_not_evidence(self):
        """`manual` non è ri-derivabile: nessun terzo può ricalcolarlo."""
        with pytest.raises(ml.EvidenceError):
            ml.validate("liveness_check", "confirmed_open",
                        {"kind": "manual", "url": "ho guardato", "code": 200})

    def test_url_without_status_is_not_evidence(self):
        with pytest.raises(ml.EvidenceError):
            ml.validate("liveness_check", "confirmed_open",
                        {"kind": "http", "url": "https://x.test", "code": None})

    def test_http_ok_passes(self):
        ml.validate("liveness_check", "confirmed_open", HTTP_OK)


class TestOutcomeStatusCoherence:
    """Un esito che contraddice il proprio status è una prova contro sé stesso."""

    def test_confirmed_open_with_404_refused(self):
        with pytest.raises(ml.EvidenceError):
            ml.validate("liveness_check", "confirmed_open", HTTP_404)

    def test_confirmed_closed_with_200_refused(self):
        with pytest.raises(ml.EvidenceError):
            ml.validate("liveness_check", "confirmed_closed", HTTP_OK)

    def test_confirmed_closed_with_404_passes(self):
        ml.validate("liveness_check", "confirmed_closed", HTTP_404)


class TestJudgementActions:
    """Per uno score non esiste una URL da interrogare: la prova è l'artefatto."""

    def test_rescore_needs_hash_not_url(self):
        with pytest.raises(ml.EvidenceError):
            ml.validate("rescore", "updated", NO_EVIDENCE)
        ml.validate("rescore", "updated", {"kind": "manual", "hash": "b" * 64})

    def test_http_evidence_not_required_for_judgement(self):
        """Un hash basta: pretendere uno status HTTP renderebbe la regola falsa."""
        ml.validate("exclude", "unchanged", {"hash": "c" * 64})


class TestDeriveOutcome:
    """Senza prova non si deduce mai un esito che afferma qualcosa."""

    def test_diff_with_evidence_is_updated(self):
        assert ml.derive_outcome(
            "liveness_check", [("is_open", 1, 0)], HTTP_404) == "updated"

    def test_no_diff_with_evidence_is_unchanged(self):
        assert ml.derive_outcome("liveness_check", [], HTTP_OK) == "unchanged"

    def test_without_evidence_everything_is_skipped(self):
        assert ml.derive_outcome("liveness_check", [], NO_EVIDENCE) == "skipped"
        assert ml.derive_outcome(
            "liveness_check", [("is_open", 1, 0)], NO_EVIDENCE) == "skipped"


class TestVerifiedClaim:
    """`office_verified` è una promessa fatta a chi legge la dashboard."""

    def test_true_without_evidence_refused(self):
        with pytest.raises(ml.EvidenceError):
            ml.check_verified_claim("office_verified", "true", NO_EVIDENCE)

    def test_true_with_404_refused(self):
        """Una pagina che non risponde non verifica un indirizzo."""
        with pytest.raises(ml.EvidenceError):
            ml.check_verified_claim("office_verified", "true", HTTP_404)

    def test_true_with_200_passes(self):
        ml.check_verified_claim("office_verified", "true", HTTP_OK)

    def test_false_needs_nothing(self):
        """Dichiarare NON verificato non è un'affermazione da provare."""
        ml.check_verified_claim("office_verified", "false", NO_EVIDENCE)

    def test_other_fields_untouched(self):
        ml.check_verified_claim("office_geocoded", "true", NO_EVIDENCE)


class TestRecord:

    def test_no_diff_still_writes_one_row(self, conn):
        """Il no-op è il dato: se non lo scrivessimo sparirebbe, come oggi."""
        n = ml.record_diffs(conn, "position", 42, "liveness_check", [],
                            evidence=HTTP_OK, by_agent="scout-1")
        assert n == 1
        row = conn.execute(
            "SELECT outcome, field, evidence_code FROM maintenance_events"
        ).fetchone()
        assert row == ("unchanged", None, 200)

    def test_one_row_per_changed_field(self, conn):
        diffs = [("is_open", 1, 0), ("status", "ready", "excluded")]
        n = ml.record_diffs(conn, "position", 7, "liveness_check", diffs,
                            evidence=HTTP_404, by_agent="analista-1")
        assert n == 2
        rows = conn.execute(
            "SELECT field, before, after, outcome FROM maintenance_events "
            "ORDER BY field").fetchall()
        assert rows == [("is_open", "1", "0", "updated"),
                        ("status", "ready", "excluded", "updated")]

    def test_invalid_action_refused_before_write(self, conn):
        with pytest.raises(ml.EvidenceError):
            ml.record(conn, "position", 1, "inventata", "unchanged",
                      evidence=HTTP_OK)
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 0

    def test_none_stays_none(self, conn):
        """`None` non deve diventare la stringa 'None': è un valore assente."""
        ml.record(conn, "position", 1, "geocode", "updated", field="office_lat",
                  before=None, after=41.9, evidence=HTTP_OK)
        row = conn.execute(
            "SELECT before, after FROM maintenance_events").fetchone()
        assert row[0] is None
        assert row[1] == "41.9"

    def test_no_commit_inside_record(self, conn):
        """L'evento deve poter essere annullato con la modifica che descrive."""
        ml.record(conn, "position", 1, "geocode", "unchanged", evidence=HTTP_OK)
        conn.rollback()
        assert conn.execute(
            "SELECT COUNT(*) FROM maintenance_events").fetchone()[0] == 0
