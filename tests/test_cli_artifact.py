"""Contratto di ``jht artifact``: byte giusti, exit code onesti.

Il pubblico di questi verbi è dichiarato in ``docs/guides/AI-AGENT-INTEGRATION.md``
ed è un agente, non una persona: legge l'exit code, non il testo. Un comando
che fallisce e esce 0 gli dice che è andato tutto bene — è già successo su
``jht download``, ed è la ragione per cui metà di questo file guarda solo
``returncode``.

I test girano SENZA container: ``runSkill`` ricade sulla copia in
``shared/skills/`` e ``JHT_ARTIFACT_ROOT`` sposta l'area dati in una cartella
temporanea. È lo stesso percorso che usa chi sviluppa da un checkout.
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JHT = ROOT / "cli" / "bin" / "jht.js"
PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\nstartxref\n0\n%%EOF\n"
SUBDIRS = ("cv", "allegati", "output", "critiche")


def big_pdf(payload_mb: int = 6) -> bytes:
    """Un PDF grande ma VALIDO: il riempimento sta prima di %%EOF, che deve
    restare negli ultimi 1024 byte. Con la zavorra in coda il file verrebbe
    respinto dall'attestazione, e il test misurerebbe il filtro invece del
    tetto del buffer."""
    return (b"%PDF-1.4\n" + b"\x00\xff" * (payload_mb * 512 * 1024)
            + b"\nstartxref\n0\n%%EOF\n")


def run_jht(*args, env=None, cwd=None):
    return subprocess.run(
        ["node", str(JHT), *args],
        cwd=str(cwd or ROOT),
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        timeout=30,
    )


@pytest.fixture()
def area(tmp_path):
    for name in SUBDIRS:
        (tmp_path / name).mkdir()
    (tmp_path / "cv" / "cv_42.pdf").write_bytes(PDF)
    (tmp_path / "output" / "lettera_7.md").write_text("# Lettera\ncorpo\n",
                                                      encoding="utf-8")
    return tmp_path


@pytest.fixture()
def env(area):
    # JHT_CONTAINER_NAME inesistente: anche su una macchina col container vero
    # acceso, il test deve provare SEMPRE lo stesso percorso.
    return {"JHT_ARTIFACT_ROOT": str(area), "JHT_CONTAINER_NAME": "jht-test-absent"}


@pytest.fixture()
def ticket_env(area, tmp_path):
    """DB e drop-zone isolati per il comando composto upload → ticket."""
    home = tmp_path / "home"
    home.mkdir()
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import _db
    conn = sqlite3.connect(home / "jobs.db")
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company) VALUES (42, 'Role', 'Company')"
    )
    conn.commit()
    conn.close()
    return {
        "JHT_HOME": str(home),
        "JHT_ARTIFACT_ROOT": str(area),
        "JHT_CONTAINER_NAME": "jht-test-absent",
    }


# ── fetch ──────────────────────────────────────────────────────────────────

def test_fetch_markdown_esce_zero_e_stampa_il_testo(env):
    r = run_jht("artifact", "fetch", "/jht_user/output/lettera_7.md",
                "--kind", "markdown", env=env)
    assert r.returncode == 0, r.stderr
    assert r.stdout == "# Lettera\ncorpo\n"


def test_fetch_su_file_scrive_i_byte_esatti(env, tmp_path):
    out = tmp_path / "scaricato.pdf"
    r = run_jht("artifact", "fetch", "/jht_user/cv/cv_42.pdf", "--kind", "pdf",
                "--out", str(out), env=env)
    assert r.returncode == 0, r.stderr
    assert out.read_bytes() == PDF


def test_fetch_json_e_leggibile_da_un_agente(env):
    r = run_jht("artifact", "fetch", "/jht_user/cv/cv_42.pdf", "--kind", "pdf",
                "--json", env=env)
    assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout)
    assert payload["ok"] and payload["bytes"] == len(PDF)
    assert payload["path"] == "/jht_user/cv/cv_42.pdf"


def test_fetch_di_un_pdf_non_riversa_binario_nel_terminale(env):
    """Senza --out né --json un PDF non ha una forma sensata da stampare: il
    comando lo dice e si ferma, invece di rendere illeggibile il terminale."""
    r = run_jht("artifact", "fetch", "/jht_user/cv/cv_42.pdf", "--kind", "pdf",
                env=env)
    assert r.returncode != 0
    assert r.stdout == ""
    assert "--out" in r.stderr


@pytest.mark.parametrize("path,kind", [
    ("/jht_user/cv/../../etc/passwd", "pdf"),
    ("/etc/passwd", "pdf"),
    ("/jht_user/cv/cv_42.pdf", "markdown"),
    ("/jht_user/cv/mai_scritto.pdf", "pdf"),
])
def test_fetch_rifiutato_non_esce_zero(env, path, kind):
    r = run_jht("artifact", "fetch", path, "--kind", kind, env=env)
    assert r.returncode != 0, f"{path} ({kind}) rifiutato ma con exit 0"
    assert r.stdout == "", "un rifiuto non deve stampare niente su stdout"


def test_fetch_rifiutato_non_lascia_il_file_di_destinazione(env, tmp_path):
    """Un --out creato a vuoto su un fetch fallito è peggio di nessun file:
    lo script che segue lo trova e lo crede buono."""
    out = tmp_path / "mai.pdf"
    r = run_jht("artifact", "fetch", "/etc/passwd", "--kind", "pdf",
                "--out", str(out), env=env)
    assert r.returncode != 0 and not out.exists()


def test_fetch_senza_kind_e_un_errore_di_uso(env):
    r = run_jht("artifact", "fetch", "/jht_user/cv/cv_42.pdf", env=env)
    assert r.returncode != 0


# ── upload ─────────────────────────────────────────────────────────────────

def test_upload_arriva_nella_drop_zone_byte_per_byte(env, area, tmp_path):
    src = tmp_path / "il mio cv.pdf"
    src.write_bytes(PDF)
    r = run_jht("artifact", "upload", str(src), env=env)
    assert r.returncode == 0, r.stderr
    assert (area / "allegati" / "il_mio_cv.pdf").read_bytes() == PDF
    assert "/jht_user/allegati/il_mio_cv.pdf" in r.stdout


def test_upload_json_dichiara_il_path_per_il_team(env, tmp_path):
    src = tmp_path / "cv.pdf"
    src.write_bytes(PDF)
    r = run_jht("artifact", "upload", str(src), "--json", env=env)
    assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout)
    assert payload["ok"] and payload["path"] == "/jht_user/allegati/cv.pdf"


def test_upload_di_un_binario_non_previsto_non_esce_zero(env, tmp_path):
    src = tmp_path / "script.js"
    src.write_text("console.log(1)\n", encoding="utf-8")
    r = run_jht("artifact", "upload", str(src), env=env)
    assert r.returncode != 0
    assert "extension" in r.stderr


def test_upload_di_un_file_inesistente_non_esce_zero(env, tmp_path):
    r = run_jht("artifact", "upload", str(tmp_path / "non_c_e.pdf"), env=env)
    assert r.returncode != 0


def test_upload_regge_un_file_grande(env, area, tmp_path):
    """Il tetto è 10 MB, che in base64 diventano ~13,4: sopra il maxBuffer di
    serie di Node. Senza il tetto alzato questo non sarebbe un file grande, ma
    un container che sembra rotto."""
    src = tmp_path / "grosso.pdf"
    body = big_pdf()
    src.write_bytes(body)
    r = run_jht("artifact", "upload", str(src), env=env)
    assert r.returncode == 0, r.stderr
    assert (area / "allegati" / "grosso.pdf").read_bytes() == body


def test_ticket_open_attach_usa_upload_e_registra_il_path(
        ticket_env, area, tmp_path):
    """L'effetto completo CLI: byte salvati e stesso path nel ticket reale."""
    src = tmp_path / "brief con spazi.pdf"
    src.write_bytes(PDF)

    r = run_jht(
        "ticket", "open", "42", "Confronta il brief con la posizione",
        "--attach", str(src), env=ticket_env,
    )

    assert r.returncode == 0, r.stderr
    saved = area / "allegati" / "brief_con_spazi.pdf"
    assert saved.read_bytes() == PDF
    db = sqlite3.connect(Path(ticket_env["JHT_HOME"]) / "jobs.db")
    request = db.execute(
        "SELECT request_text FROM position_tickets WHERE position_id = 42"
    ).fetchone()[0]
    db.close()
    assert request == (
        "Confronta il brief con la posizione\n\n"
        "[FILE ALLEGATI]\n/jht_user/allegati/brief_con_spazi.pdf"
    )


def test_ticket_open_attach_non_apre_il_ticket_se_upload_fallisce(
        ticket_env, tmp_path):
    src = tmp_path / "payload.exe"
    src.write_bytes(b"not allowed")

    r = run_jht(
        "ticket", "open", "42", "Analizza questo file",
        "--attach", str(src), env=ticket_env,
    )

    assert r.returncode != 0
    db = sqlite3.connect(Path(ticket_env["JHT_HOME"]) / "jobs.db")
    count = db.execute("SELECT COUNT(*) FROM position_tickets").fetchone()[0]
    db.close()
    assert count == 0


def test_fetch_regge_un_file_grande(env, area, tmp_path):
    body = big_pdf()
    (area / "cv" / "grosso.pdf").write_bytes(body)
    out = tmp_path / "tornato.pdf"
    r = run_jht("artifact", "fetch", "/jht_user/cv/grosso.pdf", "--kind", "pdf",
                "--out", str(out), env=env)
    assert r.returncode == 0, r.stderr
    assert out.read_bytes() == body


# ── roots ──────────────────────────────────────────────────────────────────

def test_roots_elenca_le_quattro_aree(env, area):
    r = run_jht("artifact", "roots", "--json", env=env)
    assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout)
    assert [Path(p).name for p in payload["roots"]] == list(SUBDIRS)
