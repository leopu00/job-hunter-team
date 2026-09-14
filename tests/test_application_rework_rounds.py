"""
The automatic CV rework is bounded, claimed, and never rewrites what went out. [JHT-CV-REWORK-ROUNDS]

master-2's review of the queue's CV rework request (14/09): the automatic
request replaced the user's cover letter request and turned a request the user
switched off back on (M1); a CV that never passes looped between the queue
and the Scrittore with nobody claiming the rework (M2); and a PDF recorded
after the application went out replaced the one the employer has (M3).

Synthetic only: a temporary JHT_HOME and jobs.db, placeholder PDFs, a fake
layout check, no Telegram.

Run with: pytest tests/test_application_rework_rounds.py -v
"""

from __future__ import annotations

import importlib
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
if str(SKILLS) not in sys.path:
    sys.path.insert(0, str(SKILLS))

import apply_gate  # noqa: E402
import application_rework as rework  # noqa: E402
import pdf_layout_check  # noqa: E402

BAD = {"ok": False, "reasons": ["narrow_text"]}
GOOD = {"ok": True, "reasons": []}
PID = 1833


@pytest.fixture
def box(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    import _db

    _db = importlib.reload(_db)
    conn = _db.get_db()
    _db.ensure_schema(conn)
    (tmp_path / "cv").mkdir()
    conn.execute(
        "INSERT INTO positions (id, title, company, url, status, write_requested, apply_requested, "
        "apply_requested_at, apply_requested_by) VALUES (?, 'Synthetic role', 'Synthetic company', "
        "'https://jobs.example.com/1833', 'ready', 0, 1, '2026-09-14T09:00:00Z', 'user_web')",
        (PID,),
    )
    conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?, 96)", (PID,))
    pdf = tmp_path / "cv" / "1833-a.pdf"
    pdf.write_bytes(b"%PDF-1.4 synthetic round a")
    conn.execute(
        "INSERT INTO applications (position_id, status, cv_path, cv_pdf_path, applied) "
        "VALUES (?, 'ready', '/synthetic/cv.md', ?, 0)",
        (PID, str(pdf)),
    )
    conn.commit()
    monkeypatch.setattr(pdf_layout_check, "analyze", lambda _p, **_: BAD)
    notices = []
    yield conn, tmp_path, notices
    conn.close()


def auto(home, notices, **kw):
    return rework.request_cv_rework(
        PID, jht_home=home, db_path=str(home / "jobs.db"),
        notifier=lambda pid, sha: notices.append((pid, sha)), **kw,
    )


def flag(conn):
    return tuple(conn.execute(
        "SELECT write_requested, write_request_kind FROM positions WHERE id = ?", (PID,)
    ).fetchone())


def scrittore_done(conn, home, name):
    """The Scrittore renders a new PDF and clears the request (write_request.py --mode off)."""
    pdf = home / "cv" / f"1833-{name}.pdf"
    pdf.write_bytes(f"%PDF-1.4 synthetic round {name}".encode())
    conn.execute("UPDATE applications SET cv_pdf_path = ? WHERE position_id = ?", (str(pdf), PID))
    conn.execute("UPDATE positions SET write_requested = 0, write_request_kind = NULL WHERE id = ?", (PID,))
    conn.commit()


# ── M1 · the user's own requests ─────────────────────────────────────────────


def test_a_request_switched_off_is_not_switched_on_again_for_the_same_pdf(box):
    conn, home, notices = box
    assert auto(home, notices)["status"] == "requested"
    conn.execute("UPDATE positions SET write_requested = 0, write_request_kind = NULL WHERE id = ?", (PID,))
    conn.commit()

    again = auto(home, notices)

    assert again == {"status": "not_needed", "reason": "cv_rework_already_tried"}
    assert flag(conn) == (0, None)


def test_a_cover_letter_request_is_kept(box):
    conn, home, notices = box
    conn.execute("UPDATE positions SET write_requested = 1, write_request_kind = 'cover_letter' WHERE id = ?", (PID,))
    conn.commit()

    assert auto(home, notices) == {"status": "not_needed", "reason": "write_request_pending"}
    assert flag(conn) == (1, "cover_letter")


# ── M2 · bounded rounds, one notice ──────────────────────────────────────────


def test_a_cv_that_never_passes_gets_two_rounds_then_one_notice(box):
    conn, home, notices = box
    assert auto(home, notices)["status"] == "requested"
    scrittore_done(conn, home, "b")
    assert auto(home, notices)["status"] == "requested"
    scrittore_done(conn, home, "c")

    third = auto(home, notices)
    fourth = auto(home, notices)
    scrittore_done(conn, home, "d")
    fifth = auto(home, notices)

    assert third == fourth == fifth == {"status": "not_needed", "reason": "cv_rework_exhausted"}
    assert flag(conn) == (0, None)
    assert len(notices) == 1 and notices[0][0] == PID
    assert rework._ledger(conn, PID)["rounds"] == 2


def test_a_notice_that_failed_is_sent_at_the_next_read(box):
    conn, home, notices = box
    for name in ("b", "c"):
        auto(home, notices)
        scrittore_done(conn, home, name)

    def broken(pid, sha):
        raise RuntimeError("telegram down")

    failed = rework.request_cv_rework(PID, jht_home=home, db_path=str(home / "jobs.db"), notifier=broken)
    assert failed == {"status": "not_needed", "reason": "cv_rework_exhausted"}
    assert auto(home, notices)["reason"] == "cv_rework_exhausted"
    assert len(notices) == 1


def test_the_exhausted_notice_carries_no_profile_value_or_page_text(box, monkeypatch):
    _conn, home, _notices = box
    calls = []
    monkeypatch.setattr(rework.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or subprocess.CompletedProcess(cmd, 0, "1 via=web", ""))
    monkeypatch.setenv("JHT_NOTIFY_USER_BIN", str(ROOT / "agents" / "_tools" / "jht-notify-user"))

    rework._notify_exhausted(PID, "ab" * 32)

    command = calls[0]
    assert command[command.index("--source-id") + 1] == f"closer-cv-rework-exhausted:{PID}:{'ab' * 6}"
    text = command[-1]
    assert "#1833" in text and "cv_rework_exhausted" in text
    assert "Synthetic" not in text and "example.com" not in text


def test_the_manual_request_is_not_bounded(box):
    conn, home, notices = box
    for name in ("b", "c"):
        auto(home, notices)
        scrittore_done(conn, home, name)
    assert auto(home, notices)["reason"] == "cv_rework_exhausted"

    assert auto(home, notices, manual=True)["status"] == "requested"


def test_two_scrittori_claim_one_rework_once(box):
    conn, home, notices = box
    auto(home, notices)
    db = str(home / "jobs.db")

    first = rework.claim_cv_rework(PID, agent="scrittore-1", db_path=db)
    second = rework.claim_cv_rework(PID, agent="scrittore-2", db_path=db)
    again = rework.claim_cv_rework(PID, agent="scrittore-1", db_path=db)

    assert (first["claimed"], second["claimed"], second["by"], again["claimed"]) == (True, False, "scrittore-1", True)


def test_a_claim_ends_with_its_request_or_its_ttl(box):
    conn, home, notices = box
    auto(home, notices)
    db = str(home / "jobs.db")
    assert rework.claim_cv_rework(PID, agent="scrittore-1", db_path=db)["claimed"]

    stale = (datetime.now(timezone.utc) - rework.CLAIM_TTL - timedelta(minutes=1)).isoformat()
    conn.execute(f"UPDATE {rework.LEDGER_TABLE} SET claimed_at = ?", (stale,))
    conn.commit()
    assert rework.claim_cv_rework(PID, agent="scrittore-2", db_path=db)["claimed"]

    conn.execute("UPDATE positions SET write_requested_at = '2099-01-01 00:00:00.000' WHERE id = ?", (PID,))
    conn.commit()  # the user asked again: scrittore-2's claim was for the old request
    assert rework.claim_cv_rework(PID, agent="scrittore-3", db_path=db)["claimed"]

    scrittore_done(conn, home, "b")
    assert rework.claim_cv_rework(PID, agent="scrittore-1", db_path=db)["reason"] == "no_request"
    auto(home, notices)  # a new round starts unclaimed
    assert rework.claim_cv_rework(PID, agent="scrittore-1", db_path=db)["claimed"]


def _next_for_scrittore(home, agent, unmeasurable=False):
    code = (
        "import sys, json, pdf_layout_check\n"
        "report = json.loads(sys.argv[1])\n"
        "def analyze(p, **k):\n"
        "    if report is None: raise pdf_layout_check.CheckError('poppler gone')\n"
        "    return report\n"
        "pdf_layout_check.analyze = analyze\n"
        "import db_query\n"
        "sys.argv = ['db_query.py', 'next-for-scrittore', '--json']\n"
        "db_query.main()\n"
    )
    env = {**os.environ, "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db"), "JHT_AGENT_NAME": agent,
           "PYTHONPATH": str(SKILLS)}
    done = subprocess.run([sys.executable, "-c", code, json.dumps(None if unmeasurable else BAD)], capture_output=True, text=True,
                          env=env, cwd=str(SKILLS), timeout=60)
    assert done.returncode == 0, done.stderr
    return [row["id"] for row in json.loads(done.stdout.strip().splitlines()[-1])["rows"]]


def test_the_scrittore_queue_hides_a_rework_claimed_by_another(box):
    conn, home, notices = box
    auto(home, notices)
    assert _next_for_scrittore(home, "scrittore-2") == [PID]
    assert rework.claim_cv_rework(PID, agent="scrittore-1", db_path=str(home / "jobs.db"))["claimed"]

    assert _next_for_scrittore(home, "scrittore-2") == []
    assert _next_for_scrittore(home, "scrittore-1") == [PID]


def test_an_unmeasurable_cv_leaves_the_queues_request_out_of_the_scrittores_list(box):
    conn, home, notices = box
    auto(home, notices)
    assert _next_for_scrittore(home, "scrittore-1", unmeasurable=True) == []
    conn.execute("UPDATE positions SET write_requested_at = '2099-01-01 00:00:00.000' WHERE id = ?", (PID,))
    conn.commit()  # the user's own request: the manual rule keeps it
    assert _next_for_scrittore(home, "scrittore-1", unmeasurable=True) == [PID]


def test_a_held_position_is_answered_without_the_write_lock(box):
    conn, home, notices = box
    assert auto(home, notices)["status"] == "requested"
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("UPDATE positions SET updated_at = updated_at WHERE id = ?", (PID,))
    started = time.monotonic()

    again = auto(home, notices)

    assert time.monotonic() - started < 5
    assert again == {"status": "already_requested", "reason": "cv_pdf_layout_bad"}
    conn.rollback()


def test_the_claim_cli_exits_3_when_taken(box):
    conn, home, notices = box
    auto(home, notices)
    env = {**os.environ, "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db")}
    run = lambda name: subprocess.run(  # noqa: E731
        [sys.executable, str(SKILLS / "application_rework.py"), "claim", str(PID), "--agent", name],
        capture_output=True, text=True, env=env, timeout=60,
    )
    assert run("scrittore-1").returncode == 0
    taken = run("scrittore-2")
    assert taken.returncode == 3 and json.loads(taken.stdout)["by"] == "scrittore-1"


def test_a_flag_the_queue_turned_on_keeps_the_automatic_rule(box):
    conn, home, notices = box
    auto(home, notices)
    assert rework.automatic_flag(conn, PID)
    conn.execute("UPDATE positions SET write_requested_at = '2099-01-01 00:00:00.000' WHERE id = ?", (PID,))
    conn.commit()
    assert not rework.automatic_flag(conn, PID)  # the user's own request took over


# ── the queue (apply_gate) ───────────────────────────────────────────────────


def _queue(conn, home):
    (home / "jht.config.json").write_text(json.dumps(
        {"applications": {"auto_apply": {"enabled": True, "mode": "authorised"}}}
    ))
    return apply_gate.application_queue(config_path=home / "jht.config.json", conn=conn, jht_home=home)


def test_the_queue_holds_an_exhausted_rework_by_its_own_reason(box, monkeypatch):
    conn, home, notices = box
    monkeypatch.setattr(rework, "_notify_exhausted", lambda pid, sha: notices.append(pid))
    for name in ("b", "c"):
        assert _queue(conn, home)["cv_rework"][0]["status"] == "requested"
        scrittore_done(conn, home, name)

    q = _queue(conn, home)

    assert q["held"] == [{"position_id": PID, "reason": "cv_rework_exhausted"}]
    assert notices == [PID]


def test_the_queue_never_waits_on_its_callers_write(box):
    conn, home, _notices = box
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("UPDATE positions SET updated_at = updated_at WHERE id = ?", (PID,))
    started = time.monotonic()

    q = _queue(conn, home)

    assert time.monotonic() - started < 5
    assert q["cv_rework"] == [{"position_id": PID, "status": "not_needed", "reason": "cv_rework_deferred"}]
    conn.rollback()


def test_the_queue_does_not_ask_for_a_rework_its_checkpoint_holds(box):
    conn, home, _notices = box
    path = apply_gate.checkpoint_path(PID, home)
    path.parent.mkdir(parents=True, exist_ok=True)
    state = sorted(apply_gate.HELD_CHECKPOINT_STATES)[0]
    path.write_text(json.dumps({"state": state, "updated_at": "2099-01-01T00:00:00Z"}))

    q = _queue(conn, home)

    assert "cv_rework" not in q
    assert flag(conn) == (0, None)


def test_a_measured_verdict_is_remembered_by_content_and_check(box, monkeypatch):
    _conn, home, _notices = box
    calls = []
    check = lambda _p, **_: calls.append(1) or BAD  # noqa: E731
    monkeypatch.setattr(pdf_layout_check, "analyze", check)
    pdf = home / "cv" / "1833-a.pdf"

    assert apply_gate.cv_layout_hold(pdf) == apply_gate.cv_layout_hold(pdf) == "cv_pdf_layout_bad"
    assert len(calls) == 1
    pdf.write_bytes(b"%PDF-1.4 rendered again")
    monkeypatch.setattr(pdf_layout_check, "analyze", lambda _p, **_: calls.append(1) or GOOD)
    assert apply_gate.cv_layout_hold(pdf) == ""
    assert len(calls) == 2

    def gone(_p, **_):
        calls.append(1)
        raise pdf_layout_check.CheckError("poppler gone")

    monkeypatch.setattr(pdf_layout_check, "analyze", gone)
    pdf.write_bytes(b"%PDF-1.4 unmeasured")
    assert apply_gate.cv_layout_hold(pdf) == apply_gate.cv_layout_hold(pdf) == "cv_pdf_check_unavailable"
    assert len(calls) == 4  # an unmeasured CV is measured again every time


# ── M3 · the CV that went out stays in the record ────────────────────────────


def _db_update(home, *args):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db")}
    return subprocess.run([sys.executable, str(SKILLS / "db_update.py"), "application", str(PID), *args],
                          capture_output=True, text=True, env=env, timeout=60)


def _cv_pdf(conn):
    return conn.execute("SELECT cv_pdf_path FROM applications WHERE position_id = ?", (PID,)).fetchone()[0]


def test_an_unsent_application_takes_its_new_cv(box):
    conn, home, _notices = box
    done = _db_update(home, "--cv-pdf-path", "/synthetic/new.pdf")
    assert done.returncode == 0, done.stderr
    assert _cv_pdf(conn) == "/synthetic/new.pdf"


@pytest.mark.parametrize("started", ["applied", "email", "browser"])
def test_a_sent_application_keeps_its_cv(box, started):
    conn, home, _notices = box
    before = _cv_pdf(conn)
    if started == "applied":
        conn.execute("UPDATE applications SET applied = 1, applied_via = 'agent_closer' WHERE position_id = ?", (PID,))
    elif started == "email":
        import _db

        _db._migrate_email_application_attempts(conn)
        columns = [c[1] for c in conn.execute("PRAGMA table_info(email_application_attempts)")]
        values = {"position_id": PID, "state": "send_started"}
        for column in columns:
            if column not in values and column != "id":
                values[column] = "synthetic"
        conn.execute(
            f"INSERT INTO email_application_attempts ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
            list(values.values()),
        )
    else:
        path = apply_gate.checkpoint_path(PID, home)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"state": "submitting", "submit_started": True}))
    conn.commit()

    for field in ("--cv-pdf-path", "--cv-path"):
        done = _db_update(home, field, "/synthetic/after-send.pdf")
        assert done.returncode == 1 and "CV UPDATE REJECTED" in done.stderr

    assert _cv_pdf(conn) == before


def test_a_send_that_lands_between_the_check_and_the_write_still_wins(box, monkeypatch):
    conn, home, _notices = box
    conn.execute("UPDATE applications SET applied = 1, applied_via = 'agent_closer' WHERE position_id = ?", (PID,))
    conn.commit()
    before = _cv_pdf(conn)
    code = (
        "import sys, application_rework;"
        "application_rework.sent_blocker = lambda *a, **k: '';"
        "import db_update;"
        f"sys.argv = ['db_update.py', 'application', '{PID}', '--cv-pdf-path', '/synthetic/race.pdf'];"
        "db_update.main()"
    )
    env = {**os.environ, "JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db"), "PYTHONPATH": str(SKILLS)}
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=60)

    assert done.returncode == 1 and "CV UPDATE REJECTED" in done.stderr
    assert _cv_pdf(conn) == before
