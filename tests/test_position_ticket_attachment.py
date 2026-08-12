"""Allegato ticket: stesso effetto su CLI, web e payload del desktop.

I byte viaggiano sui trasporti già esistenti; ciò che deve restare identico è
il riferimento persistito in ``request_text``. Questo test esegue il payload
Python realmente iniettato dal desktop, non una sua copia, e sorveglia il
wiring upload → ticket della scena Godot.
"""

import base64
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
PAYLOAD = ROOT / "game" / "scripts" / "backend" / "payloads" / "ticket.py"
SECTION_PANEL = ROOT / "game" / "scripts" / "ui" / "section_panel.gd"
BACKEND_BUS = ROOT / "game" / "scripts" / "backend" / "backend_bus.gd"
PROJECT = ROOT / "game" / "project.godot"
MARKER = "[FILE ALLEGATI]"

sys.path.insert(0, str(SKILLS))
import _db


@pytest.fixture()
def database(tmp_path):
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company) VALUES (77, 'Role', 'Company')"
    )
    conn.commit()
    conn.close()
    return path


def run_desktop_payload(database: Path, attachment: str):
    source = PAYLOAD.read_text(encoding="utf-8").replace(
        "sys.path.insert(0, '/app/shared/skills')",
        f"sys.path.insert(0, {str(SKILLS)!r})",
    )
    rendered = source % (
        base64.b64encode(b"Leggi il documento").decode(),
        base64.b64encode(attachment.encode()).decode(),
        77,
    )
    result = subprocess.run(
        [sys.executable, "-c", rendered],
        env={**os.environ, "JHT_DB": str(database)},
        capture_output=True,
        text=True,
        timeout=10,
    )
    rows = [json.loads(line) for line in result.stdout.splitlines()
            if line.startswith("{")]
    assert result.returncode == 0, result.stderr
    assert len(rows) == 1, result.stdout
    return rows[0]


def test_payload_desktop_persiste_lo_stesso_protocollo(database):
    result = run_desktop_payload(
        database, "/jht_user/allegati/brief_operativo.pdf"
    )

    assert result["ok"] is True
    conn = sqlite3.connect(database)
    request = conn.execute(
        "SELECT request_text FROM position_tickets WHERE position_id = 77"
    ).fetchone()[0]
    conn.close()
    assert request == (
        "Leggi il documento\n\n"
        f"{MARKER}\n/jht_user/allegati/brief_operativo.pdf"
    )


def test_payload_desktop_rifiuta_path_arbitrario_senza_ticket(database):
    result = run_desktop_payload(database, "/jht_user/allegati/../segreto.pdf")

    assert result == {"ok": False, "error": "invalid attachment path"}
    conn = sqlite3.connect(database)
    count = conn.execute("SELECT COUNT(*) FROM position_tickets").fetchone()[0]
    conn.close()
    assert count == 0


def test_ui_desktop_apre_ticket_solo_dopo_upload_riuscito():
    panel = SECTION_PANEL.read_text(encoding="utf-8")
    bus = BACKEND_BUS.read_text(encoding="utf-8")
    worker = bus.split("func publish_document_upload", 1)[1].split(
        "\nfunc ", 1
    )[0]
    submit = panel.split("var submit := func() -> void:", 1)[1].split(
        "\t_ticket_send.pressed.connect", 1
    )[0]

    assert "pid, txt, _ticket_attachment_local_path" in submit
    assert "_active_document_upload" in bus
    assert '_begin_document_upload({"kind": "ticket"' in bus
    assert "if not ok:" in worker
    assert "publish_document_upload" in bus
    assert "document_uploaded.connect" not in bus
    assert "document_uploaded.connect(_on_ticket_document_uploaded)" not in panel
    assert 'BackendBus="*res://scripts/backend/backend_bus.gd"' in PROJECT.read_text(
        encoding="utf-8"
    )


def test_desktop_ha_oracolo_esecutivo_per_overlap_upload():
    matrix = (ROOT / "game" / "tools" / "test-matrix.txt").read_text(
        encoding="utf-8"
    )
    assert "ticket_attachment_overlap|run|gate|any|" in matrix
    assert "TICKET-ATTACHMENT-OVERLAP PASS" in matrix


def test_label_desktop_pari_in_sette_lingue():
    files = [ROOT / "game" / "scripts" / "ui_strings.gd"] + [
        ROOT / "game" / "scripts" / "i18n" / f"ui_{locale}.gd"
        for locale in ("en", "es", "fr", "de", "hu", "pt")
    ]
    for path in files:
        source = path.read_text(encoding="utf-8")
        for key in (
            "pos.ticket_attach",
            "pos.ticket_attached",
            "pos.ticket_uploading",
            "pos.ticket_upload_in_progress",
            "vps.ticket.invalid_attachment",
        ):
            assert source.count(f'"{key}":') == 1, f"{path.name}: {key}"
