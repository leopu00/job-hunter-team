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
    source = SECTION_PANEL.read_text(encoding="utf-8")
    worker = source.split("func _on_ticket_document_uploaded", 1)[1].split(
        "\nfunc ", 1
    )[0]
    submit = source.split("var submit := func() -> void:", 1)[1].split(
        "\t_ticket_send.pressed.connect", 1
    )[0]

    assert "BackendBus.upload_user_document(_ticket_attachment_local_path)" in submit
    assert "BackendBus.create_position_ticket(pid, txt)" in submit
    assert "if not ok:" in worker
    create_at = worker.index("BackendBus.create_position_ticket(")
    guard_at = worker.index("if not ok:")
    assert guard_at < create_at
    assert "_ticket_pending_text, remote_path" in worker


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
            "vps.ticket.invalid_attachment",
        ):
            assert source.count(f'"{key}":') == 1, f"{path.name}: {key}"
