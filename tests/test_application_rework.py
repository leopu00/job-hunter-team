"""
A CV PDF that fails the layout check on an application never sent can be done again. [JHT-CV-REWORK]

Seen live (score > 95 on a box): applications written but never sent whose CV
PDF the layout check refuses. `jht positions request-cv` answered
ALREADY_APPLIED (status scored) or BAD_STATUS (status ready), the Scrittore's
queue only takes positions without an application, and the queue held them
as cv_pdf_layout_bad for ever. These tests pin the one rule the request, the
Scrittore's queue and the automatic request share, and that a sent
application is never reworked.

Synthetic only: a temporary JHT_HOME and jobs.db, synthetic PDFs.
Run with: pytest tests/test_application_rework.py -v
"""

from __future__ import annotations

import importlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
TESTS = ROOT / "tests"
for _path in (SKILLS, TESTS):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import apply_gate  # noqa: E402
import pdf_layout_check  # noqa: E402

# Taken at import, before the suite's autouse pass replaces it (tests/conftest.py).
REAL_ANALYZE = pdf_layout_check.analyze
POPPLER = all(shutil.which(tool) for tool in ("pdftotext", "pdffonts", "pdftoppm", "pdfinfo"))
needs_poppler = pytest.mark.skipif(not POPPLER and not os.environ.get("CI"), reason="poppler-utils not installed")
PASS_FIXTURE = str(TESTS / "fixtures" / "pdf_layout_pass")


@pytest.fixture
def box(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    import _db

    _db = importlib.reload(_db)
    conn = _db.get_db()
    _db.ensure_schema(conn)
    cv_dir = tmp_path / "cv"
    cv_dir.mkdir()
    for pid, status in ((1170, "scored"), (1833, "ready"), (42, "applied")):
        conn.execute(
            "INSERT INTO positions (id, title, company, status, write_requested) "
            "VALUES (?, 'Synthetic role', 'Synthetic company', ?, 0)",
            (pid, status),
        )
        conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?, 96)", (pid,))
        pdf = cv_dir / f"{pid}.pdf"
        pdf.write_bytes(b"%PDF-1.4 synthetic placeholder")
        conn.execute(
            "INSERT INTO applications (position_id, status, cv_path, cv_pdf_path, applied) "
            "VALUES (?, 'ready', '/synthetic/cv.md', ?, 0)",
            (pid, str(pdf)),
        )
    conn.execute("UPDATE applications SET applied = 1, applied_via = 'agent_closer' WHERE position_id = 42")
    conn.commit()
    yield conn, tmp_path
    conn.close()


def _layout(monkeypatch, report):
    def analyze(_path, **_kw):
        if isinstance(report, Exception):
            raise report
        return report

    monkeypatch.setattr(pdf_layout_check, "analyze", analyze)


BAD = {"ok": False, "reasons": ["narrow_text"]}
GOOD = {"ok": True, "reasons": []}


# ── the rule ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("pid", [1170, 1833])
def test_an_unsent_application_with_a_bad_cv_layout_may_be_reworked(box, monkeypatch, pid):
    conn, home = box
    _layout(monkeypatch, BAD)
    import application_rework

    for manual in (True, False):
        assert application_rework.rework_verdict(conn, pid, manual=manual, jht_home=home) == {
            "allowed": True, "reason": "cv_pdf_layout_bad"
        }


def test_a_sent_application_is_never_reworked(box, monkeypatch):
    conn, home = box
    _layout(monkeypatch, BAD)
    import application_rework

    verdict = application_rework.rework_verdict(conn, 42, manual=True, jht_home=home)
    assert verdict == {"allowed": False, "reason": "already_sent"}


@pytest.mark.parametrize("state", ["send_started", "send_outcome_unknown", "receipt_incomplete", "sent"])
def test_an_email_send_that_started_is_never_reworked(box, monkeypatch, state):
    conn, home = box
    _layout(monkeypatch, BAD)
    import _db
    import application_rework

    _db._migrate_email_application_attempts(conn)
    conn.execute(
        "INSERT INTO email_application_attempts (position_id, idempotency_key, state, message_id, "
        "recipients_json, body_sha256, attachments_json, send_started_at) VALUES (1833, 'k', ?, 'm', '[]', 'h', '[]', "
        "strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        (state,),
    )
    conn.commit()
    assert application_rework.rework_verdict(conn, 1833, manual=True, jht_home=home)["reason"] == "send_started"


@pytest.mark.parametrize(
    "checkpoint", [{"submit_started": True}, {"submit_started": False, "receipt": {"screenshot_path": "x"}}, "not json"]
)
def test_a_browser_submit_that_started_is_never_reworked(box, monkeypatch, checkpoint):
    conn, home = box
    _layout(monkeypatch, BAD)
    import application_rework

    path = apply_gate.checkpoint_path(1833, home)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(checkpoint if isinstance(checkpoint, str) else json.dumps(checkpoint))
    assert application_rework.rework_verdict(conn, 1833, manual=True, jht_home=home) == {
        "allowed": False, "reason": "submit_started"
    }


def test_a_cv_that_passes_is_not_reworked(box, monkeypatch):
    conn, home = box
    _layout(monkeypatch, GOOD)
    import application_rework

    assert application_rework.rework_verdict(conn, 1833, manual=True, jht_home=home) == {
        "allowed": False, "reason": "cv_layout_ok"
    }


def test_an_unmeasurable_cv_allows_only_the_users_own_request(box, monkeypatch):
    conn, home = box
    _layout(monkeypatch, pdf_layout_check.CheckError("pdftotext not found"))
    import application_rework

    assert application_rework.rework_verdict(conn, 1833, manual=True, jht_home=home)["allowed"] is True
    assert application_rework.rework_verdict(conn, 1833, manual=False, jht_home=home) == {
        "allowed": False, "reason": "cv_pdf_check_unavailable"
    }


def test_other_statuses_and_missing_pdfs_are_not_reworked(box, monkeypatch):
    conn, home = box
    _layout(monkeypatch, BAD)
    import application_rework

    conn.execute("UPDATE positions SET status = 'review' WHERE id = 1833")
    conn.execute("UPDATE applications SET cv_pdf_path = '/synthetic/missing.pdf' WHERE position_id = 1170")
    conn.commit()
    assert application_rework.rework_verdict(conn, 1833, manual=True, jht_home=home)["reason"] == "status_not_reworkable"
    assert application_rework.rework_verdict(conn, 1170, manual=True, jht_home=home)["reason"] == "cv_pdf_missing"


# ── the request (CLI / Telegram) and the Scrittore's queue, as subprocesses ──


def _run(home: Path, script: str, *args: str, real_check: bool) -> tuple[int, dict]:
    env = {**os.environ, "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db")}
    if real_check:
        # Drop the suite's pass so the CLI runs the real layout check.
        env["PYTHONPATH"] = os.pathsep.join(
            p for p in env.get("PYTHONPATH", "").split(os.pathsep) if p and p != PASS_FIXTURE
        )
    done = subprocess.run(
        [sys.executable, str(SKILLS / script), *args], capture_output=True, text=True, env=env, timeout=60
    )
    return done.returncode, json.loads(done.stdout.strip().splitlines()[-1])


def _bad_pdf(home: Path, pid: int) -> None:
    layout = importlib.import_module("test_pdf_layout_check")
    layout._base14_pdf(home / "cv" / f"{pid}.pdf")  # fonts not embedded: cv_pdf_layout_bad


@needs_poppler
@pytest.mark.parametrize("pid", [1170, 1833])
def test_request_cv_accepts_an_unsent_application_with_a_bad_cv(box, pid):
    conn, home = box
    _bad_pdf(home, pid)

    code, out = _run(home, "write_request.py", str(pid), real_check=True)

    assert code == 0, out
    assert (out["ok"], out["current"], out["kind"], out["rework"]) == (True, 1, "cv", True)
    # The authorisation and the status stay as they were.
    assert conn.execute("SELECT status FROM positions WHERE id = ?", (pid,)).fetchone()[0] in ("scored", "ready")


def test_request_cv_still_refuses_a_sent_application(box):
    conn, home = box
    conn.execute("UPDATE positions SET status = 'scored' WHERE id = 42")
    conn.commit()

    code, out = _run(home, "write_request.py", "42", real_check=True)

    assert code == 1
    assert (out["status_code"], out["rework_reason"]) == ("ALREADY_APPLIED", "already_sent")
    assert conn.execute("SELECT write_requested FROM positions WHERE id = 42").fetchone()[0] == 0


def test_request_cv_refuses_when_the_cv_passes(box):
    conn, home = box

    code, out = _run(home, "write_request.py", "1833", real_check=False)  # the suite's pass: the CV is fine

    assert code == 1
    assert (out["status_code"], out["rework_reason"]) == ("BAD_STATUS", "cv_layout_ok")


@needs_poppler
def test_the_scrittore_queue_lists_the_rework_and_forgets_it_once_the_cv_passes(box):
    conn, home = box
    _bad_pdf(home, 1833)
    assert _run(home, "write_request.py", "1833", real_check=True)[0] == 0
    # A dashboard request pulled from the cloud on a CV that passes: flagged, never queued.
    conn.execute(
        "UPDATE positions SET write_requested = 1, write_request_kind = 'cv', "
        "write_requested_at = '2026-09-14 09:00:00.000' WHERE id = 1170"
    )
    conn.execute("UPDATE positions SET status = 'scored', write_requested = 1 WHERE id = 42")
    conn.commit()

    code, queue = _run(home, "db_query.py", "next-for-scrittore", "--json", real_check=True)

    assert code == 0, queue
    placeholder_unmeasurable = [r for r in queue["rows"] if r["id"] == 1170]
    assert [r for r in queue["rows"] if r["id"] == 1833] == [
        {"id": 1833, "title": "Synthetic role", "company": "Synthetic company", "total_score": 96, "request_kind": "cv_rework"}
    ]
    # 1170's placeholder cannot be measured: the user's request is kept (manual rule).
    assert [r["request_kind"] for r in placeholder_unmeasurable] == ["cv_rework"]
    assert all(r["id"] != 42 for r in queue["rows"])
    assert queue["total"] == 2

    code, passing = _run(home, "db_query.py", "next-for-scrittore", "--json", real_check=False)
    assert [r["id"] for r in passing["rows"]] == []


# ── the automatic request (used by apply_gate.application_queue) ─────────────


def test_the_automatic_request_turns_the_flag_on_once(box, monkeypatch):
    conn, home = box
    _layout(monkeypatch, BAD)
    import application_rework

    first = application_rework.request_cv_rework(1833, jht_home=home, db_path=str(home / "jobs.db"))
    at = conn.execute("SELECT write_requested_at FROM positions WHERE id = 1833").fetchone()[0]
    again = application_rework.request_cv_rework(1833, jht_home=home, db_path=str(home / "jobs.db"))

    assert first == {"status": "requested", "reason": "cv_pdf_layout_bad"}
    assert again == {"status": "already_requested", "reason": "cv_pdf_layout_bad"}
    row = conn.execute(
        "SELECT write_requested, write_request_kind, write_requested_at, status FROM positions WHERE id = 1833"
    ).fetchone()
    assert tuple(row) == (1, "cv", at, "ready")


@pytest.mark.parametrize(
    "pid, report, reason",
    [
        (42, BAD, "already_sent"),
        (1833, GOOD, "cv_layout_ok"),
        (1833, pdf_layout_check.CheckError("pdftotext not found"), "cv_pdf_check_unavailable"),
    ],
)
def test_the_automatic_request_never_touches_what_it_must_not(box, monkeypatch, pid, report, reason):
    conn, home = box
    _layout(monkeypatch, report)
    import application_rework

    out = application_rework.request_cv_rework(pid, jht_home=home, db_path=str(home / "jobs.db"))

    assert out == {"status": "not_needed", "reason": reason}
    assert conn.execute("SELECT write_requested FROM positions WHERE id = ?", (pid,)).fetchone()[0] == 0


def test_the_automatic_request_never_raises(box, monkeypatch):
    conn, home = box
    import application_rework

    out = application_rework.request_cv_rework(1833, jht_home=home, db_path=str(home / "no-dir" / "jobs.db"))

    assert out == {"status": "not_needed", "reason": "cv_rework_unavailable"}


def test_the_automatic_request_never_replaces_a_pending_cover_letter(box, monkeypatch):
    conn, home = box
    _layout(monkeypatch, BAD)
    conn.execute("UPDATE positions SET write_requested = 1, write_request_kind = 'cover_letter' WHERE id = 1833")
    conn.commit()
    import application_rework

    automatic = application_rework.request_cv_rework(1833, jht_home=home, db_path=str(home / "jobs.db"))
    kept = conn.execute("SELECT write_requested, write_request_kind FROM positions WHERE id = 1833").fetchone()
    manual = application_rework.request_cv_rework(1833, jht_home=home, db_path=str(home / "jobs.db"), manual=True)

    assert automatic == {"status": "not_needed", "reason": "write_request_pending"}
    assert tuple(kept) == (1, "cover_letter")
    assert manual == {"status": "requested", "reason": "cv_pdf_layout_bad"}
