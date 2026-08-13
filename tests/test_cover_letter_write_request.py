"""O-82 — cover letter sulla coda Writer-on-demand già durevole."""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


@pytest.fixture()
def box(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import _db

    _db = importlib.reload(_db)
    conn = _db.get_db()
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions "
        "(id, title, company, status, write_requested, write_request_kind) "
        "VALUES (7, 'Synthetic role', 'Synthetic company', 'ready', 0, NULL)"
    )
    conn.execute(
        "INSERT INTO scores (position_id, total_score) VALUES (7, 80)"
    )
    conn.execute(
        "INSERT INTO applications "
        "(position_id, cv_path, cv_pdf_path, cl_path, cl_pdf_path) "
        "VALUES (7, '/synthetic/cv.md', '/synthetic/cv.pdf', "
        "'/synthetic/old-cl.md', '/synthetic/old-cl.pdf')"
    )
    conn.commit()
    yield conn, tmp_path
    conn.close()


def _request(tmp_path: Path, mode: str = "on") -> dict:
    env = {**os.environ, "JHT_HOME": str(tmp_path)}
    run = subprocess.run(
        [
            sys.executable,
            str(SKILLS / "write_request.py"),
            "7",
            "--mode",
            mode,
            "--kind",
            "cover_letter",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stderr or run.stdout
    return json.loads(run.stdout)


def test_cover_letter_request_is_deduplicated_in_the_existing_writer_queue(box):
    conn, home = box
    first = _request(home)
    assert first["current"] == 1
    assert first["kind"] == "cover_letter"
    first_at = conn.execute(
        "SELECT write_requested_at FROM positions WHERE id = 7"
    ).fetchone()[0]

    duplicate = _request(home)
    assert duplicate["current"] == 1
    assert conn.execute(
        "SELECT write_requested_at FROM positions WHERE id = 7"
    ).fetchone()[0] == first_at

    env = {**os.environ, "JHT_HOME": str(home)}
    queue = subprocess.run(
        [sys.executable, str(SKILLS / "db_query.py"),
         "next-for-scrittore", "--json"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert queue.returncode == 0, queue.stderr
    payload = json.loads(queue.stdout)
    assert payload["total"] == 1
    assert payload["rows"][0]["id"] == 7
    assert payload["rows"][0]["total_score"] == 80
    assert payload["rows"][0]["request_kind"] == "cover_letter"
    human_queue = subprocess.run(
        [sys.executable, str(SKILLS / "db_query.py"),
         "next-for-scrittore"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert human_queue.returncode == 0, human_queue.stderr
    assert "[request_kind=cover_letter]" in human_queue.stdout


def test_only_a_changed_cover_letter_effect_closes_the_request(box):
    conn, home = box
    _request(home)
    requested_at = conn.execute(
        "SELECT write_requested_at FROM positions WHERE id = 7"
    ).fetchone()[0]

    # Un ACK/no-op non è un effetto: la richiesta resta visibile.
    conn.execute(
        "UPDATE applications SET cl_path = cl_path WHERE position_id = 7"
    )
    conn.commit()
    assert conn.execute(
        "SELECT write_requested FROM positions WHERE id = 7"
    ).fetchone()[0] == 1

    # Il nuovo artefatto e la chiusura del flag vivono nella stessa transazione.
    conn.execute(
        "UPDATE applications SET cl_path = '/synthetic/new-cl.md' "
        "WHERE position_id = 7"
    )
    conn.commit()
    position = conn.execute(
        "SELECT write_requested, write_requested_at, write_request_kind "
        "FROM positions WHERE id = 7"
    ).fetchone()
    assert position[0] == 0
    assert position[1] > requested_at
    assert position[2] is None
    application = conn.execute(
        "SELECT cv_path, cv_pdf_path, cl_path, cl_pdf_path "
        "FROM applications WHERE position_id = 7"
    ).fetchone()
    assert tuple(application) == (
        "/synthetic/cv.md",
        "/synthetic/cv.pdf",
        "/synthetic/new-cl.md",
        "/synthetic/old-cl.pdf",
    )


def test_cover_letter_requires_an_existing_application(box):
    conn, home = box
    conn.execute("DELETE FROM applications WHERE position_id = 7")
    conn.commit()
    env = {**os.environ, "JHT_HOME": str(home)}
    run = subprocess.run(
        [sys.executable, str(SKILLS / "write_request.py"), "7",
         "--kind", "cover_letter"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert run.returncode == 1
    assert json.loads(run.stdout)["status_code"] == "APPLICATION_REQUIRED"
    state = conn.execute(
        "SELECT write_requested, write_request_kind FROM positions WHERE id = 7"
    ).fetchone()
    assert tuple(state) == (0, None)
