"""Contratto di ``shared/skills/artifact.py``: cosa può uscire dall'area dati.

Il path di un documento arriva da ``cv_path``/``cl_path`` nel jobs.db, che gli
agenti riempiono partendo da roba raccolta in rete: è una stringa non fidata
che nomina un file. La skill è il punto in cui quella stringa viene giudicata,
quindi qui si prova il rifiuto, non il caso felice.

Fino all'08/10 una parte di questo file confrontava la skill col payload del
gioco Godot (``game/scripts/backend/payloads/artifact.py``), su ogni input
ostile: la skill non poteva mai accettare ciò che il client rifiutava. Godot è
abbandonato: quei test sono stati tolti con lui, e la skill resta l'unico
giudice.
"""

import base64
import importlib.util
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "shared" / "skills" / "artifact.py"
PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\nstartxref\n0\n%%EOF\n"


def load_skill():
    spec = importlib.util.spec_from_file_location("jht_artifact", SKILL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


artifact = load_skill()


@pytest.fixture()
def area(tmp_path, monkeypatch):
    """Un'area dati sintetica con le quattro cartelle vere e un documento per
    tipo. `JHT_ARTIFACT_ROOT` è il solo modo di provare la skill senza un
    container: /jht_user non esiste sulla macchina che esegue i test."""
    for name in artifact.SUBDIRS:
        (tmp_path / name).mkdir()
    (tmp_path / "cv" / "cv_42.pdf").write_bytes(PDF)
    (tmp_path / "output" / "lettera_7.md").write_text("# Lettera\n", encoding="utf-8")
    monkeypatch.setenv("JHT_ARTIFACT_ROOT", str(tmp_path))
    return tmp_path


# ── il caso felice, senza il quale i rifiuti non provano niente ────────────

def test_fetch_legge_un_pdf_prodotto_dal_team(area):
    out = artifact.fetch("/jht_user/cv/cv_42.pdf", "pdf")
    assert out["ok"] and base64.b64decode(out["b64"]) == PDF
    assert out["bytes"] == len(PDF)


def test_fetch_legge_un_markdown(area):
    out = artifact.fetch("/jht_user/output/lettera_7.md", "markdown")
    assert out["ok"] and base64.b64decode(out["b64"]) == b"# Lettera\n"


def test_fetch_su_file_assente_distingue_il_motivo(area):
    """"non trovato" e "non valido" sono due risposte diverse: la prima dice
    all'utente che il team non ha ancora scritto quel documento, la seconda che
    ha chiesto qualcosa che non gli spetta."""
    out = artifact.fetch("/jht_user/cv/cv_999.pdf", "pdf")
    assert not out["ok"] and out["error"] == "file not found"


# ── i rifiuti ──────────────────────────────────────────────────────────────

# Ogni riga: (etichetta, path, kind). Nessuna deve superare il filtro.
DENIED = [
    ("traversal esplicito", "/jht_user/cv/../../etc/passwd", "pdf"),
    ("traversal mascherato", "/jht_user/cv/../cv/cv_42.pdf", "pdf"),
    ("componente punto", "/jht_user/cv/./cv_42.pdf", "pdf"),
    ("slash doppio", "/jht_user/cv//cv_42.pdf", "pdf"),
    ("fuori dalle root", "/etc/passwd", "pdf"),
    ("root simile ma diversa", "/jht_user/cvx/cv_42.pdf", "pdf"),
    ("radice senza file", "/jht_user/cv/", "pdf"),
    ("path relativo", "jht_user/cv/cv_42.pdf", "pdf"),
    ("kind non dichiarato", "/jht_user/cv/cv_42.pdf", ""),
    ("kind incoerente col suffisso", "/jht_user/cv/cv_42.pdf", "markdown"),
    ("doppia estensione in coda", "/jht_user/cv/payload.exe.pdf", "pdf"),
    ("doppia estensione in testa", "/jht_user/cv/payload.pdf.exe", "pdf"),
    ("nome vuoto prima del suffisso", "/jht_user/cv/.pdf", "pdf"),
    ("spazio in testa", " /jht_user/cv/cv_42.pdf", "pdf"),
    ("spazio in coda", "/jht_user/cv/cv_42.pdf ", "pdf"),
    ("separatore Windows", "/jht_user/cv/sub\\cv_42.pdf", "pdf"),
    ("stringa vuota", "", "pdf"),
]


@pytest.mark.parametrize("label,path,kind", DENIED, ids=[d[0] for d in DENIED])
def test_fetch_rifiuta_input_ostile(area, label, path, kind):
    out = artifact.fetch(path, kind)
    assert not out["ok"], f"{label}: accettato"
    assert "b64" not in out, f"{label}: rifiutato ma con byte allegati"


def test_fetch_rifiuta_il_byte_nul(area):
    """Fuori dalla tabella condivisa: un NUL non attraversa argv, quindi il
    payload del desktop non lo riceve mai per quella strada e confrontarli
    sarebbe un confronto finto. Qui la chiamata è diretta e il filtro deve
    esserci lo stesso."""
    assert not artifact.fetch("/jht_user/cv/cv\0_42.pdf", "pdf")["ok"]


def test_fetch_non_segue_un_symlink_fuori_dall_area(area, tmp_path):
    """Il controllo del path e l'apertura devono essere lo stesso gesto: fra
    un realpath e un open c'è una finestra in cui una directory può diventare
    un symlink. openat + O_NOFOLLOW la chiude."""
    outside = tmp_path.parent / "segreto.pdf"
    outside.write_bytes(PDF)
    os.symlink(outside, area / "cv" / "esca.pdf")
    out = artifact.fetch("/jht_user/cv/esca.pdf", "pdf")
    assert not out["ok"] and "b64" not in out


def test_fetch_non_segue_un_symlink_di_cartella(area, tmp_path):
    """Stessa finestra, un livello più su: la cartella intermedia."""
    outside = tmp_path.parent / "fuori"
    outside.mkdir(exist_ok=True)
    (outside / "cv_1.pdf").write_bytes(PDF)
    os.symlink(outside, area / "cv" / "sub")
    assert not artifact.fetch("/jht_user/cv/sub/cv_1.pdf", "pdf")["ok"]


def test_fetch_rifiuta_una_directory(area):
    (area / "cv" / "finta.pdf").mkdir()
    assert not artifact.fetch("/jht_user/cv/finta.pdf", "pdf")["ok"]


def test_fetch_rifiuta_un_pdf_che_non_e_un_pdf(area):
    """Il tipo dichiarato non basta: i byte devono confermarlo prima che il
    client li scriva sull'host con un nome che finisce per .pdf."""
    (area / "cv" / "falso.pdf").write_bytes(b"MZ\x90\x00 not a pdf at all\n")
    assert not artifact.fetch("/jht_user/cv/falso.pdf", "pdf")["ok"]


def test_fetch_rifiuta_un_pdf_con_solo_il_magic(area):
    (area / "cv" / "prefisso.pdf").write_bytes(b"%PDF-1.4\n" + b"x" * 4096)
    assert not artifact.fetch("/jht_user/cv/prefisso.pdf", "pdf")["ok"]


def test_fetch_rifiuta_oltre_il_tetto(area, monkeypatch):
    monkeypatch.setattr(artifact, "MAX_BYTES", 32)
    (area / "cv" / "grosso.pdf").write_bytes(PDF + b"x" * 64)
    out = artifact.fetch("/jht_user/cv/grosso.pdf", "pdf")
    assert not out["ok"] and "10 MB" in out["error"]


# ── upload ─────────────────────────────────────────────────────────────────

def test_upload_scrive_nella_drop_zone(area):
    out = artifact.upload("cv.pdf", PDF)
    assert out["ok"] and out["path"] == "/jht_user/allegati/cv.pdf"
    assert (area / "allegati" / "cv.pdf").read_bytes() == PDF


def test_upload_torna_sempre_il_path_del_container(area):
    """Il path che torna finisce nel jobs.db e nei prompt degli agenti, che
    vivono nel container: deve essere in forma container anche quando la skill
    ha scritto altrove (host, test)."""
    assert artifact.upload("cv.pdf", PDF)["path"].startswith("/jht_user/")


@pytest.mark.parametrize("path", [
    "/jht_user/allegati/cv.pdf",
    "/jht_user/allegati/brief_con_spazi.docx",
    "/jht_user/allegati/data.csv",
])
def test_path_upload_canonico_puo_essere_allegato(path):
    assert artifact.is_uploaded_document_path(path)


@pytest.mark.parametrize("path", [
    "/jht_user/cv/cv.pdf",
    "/jht_user/allegati/../cv/cv.pdf",
    "/jht_user/allegati/sub/cv.pdf",
    "/jht_user/allegati/payload.exe",
    "/jht_user/allegati/nome con spazi.pdf",
    " /jht_user/allegati/cv.pdf",
])
def test_path_allegato_non_puo_uscire_dal_trasporto(path):
    assert not artifact.is_uploaded_document_path(path)


@pytest.mark.parametrize("name", ["script.js", "binario.exe", "senza_estensione",
                                  "archivio.tar.gz", ".bashrc"])
def test_upload_rifiuta_estensioni_fuori_elenco(area, name):
    assert not artifact.upload(name, b"x")["ok"]


def test_upload_rifiuta_un_file_vuoto(area):
    assert not artifact.upload("cv.pdf", b"")["ok"]


def test_upload_rifiuta_oltre_il_tetto(area, monkeypatch):
    monkeypatch.setattr(artifact, "MAX_BYTES", 8)
    assert not artifact.upload("cv.pdf", b"x" * 16)["ok"]


@pytest.mark.parametrize("raw,expected", [
    ("../../etc/passwd", "passwd"),
    ("/assoluto/cv.pdf", "cv.pdf"),
    ("nome con spazi.pdf", "nome_con_spazi.pdf"),
    # Un carattere non ASCII vale UN underscore, non uno per byte: il nome
    # resta leggibile e la lunghezza non esplode sui titoli accentati.
    ("curriculum vitæ.pdf", "curriculum_vit_.pdf"),
    ("...pdf", "pdf"),
])
def test_upload_normalizza_il_nome(raw, expected):
    """Il nome arriva dall'utente e finisce in un path: traversal e caratteri
    fuori da [A-Za-z0-9._-] non ci passano. Stessa igiene di
    `VpsBackend._safe_filename` e della route web."""
    assert artifact.safe_filename(raw) == expected


def test_upload_non_scrive_attraverso_un_symlink(area, tmp_path):
    """Ricaricare un documento sovrascrive quello omonimo — è il gesto che
    l'utente si aspetta — ma mai seguendo un link piazzato nella drop-zone:
    scriverebbe fuori dall'area dati."""
    outside = tmp_path.parent / "vittima.pdf"
    outside.write_bytes(b"originale")
    os.symlink(outside, area / "allegati" / "cv.pdf")
    assert not artifact.upload("cv.pdf", PDF)["ok"]
    assert outside.read_bytes() == b"originale"


def test_upload_non_segue_la_directory_allegati_symlink(area, tmp_path):
    """O_NOFOLLOW sul solo file finale non basta: anche la directory della
    drop-zone deve essere aperta rispetto alla root già attestata."""
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (area / "allegati").rmdir()
    os.symlink(outside, area / "allegati")

    out = artifact.upload("boundary.pdf", PDF)

    assert not out["ok"]
    assert not (outside / "boundary.pdf").exists()
