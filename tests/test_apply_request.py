"""
`jht apply request|cancel`: il primo writer del flag per l'origine user_local.
[JHT-CLOSER]

Scoperto al deploy sulla VPS dell'operatore: il gate accettava `user_web` e
`user_local`, ma nessun programma scriveva né l'una né l'altra. Un cancello
senza una porta che l'utente possa aprire è chiuso per sempre.

La scrittura è irreversibile nel senso che conta: con il consenso acceso, il
flag È l'invio. Questi test chiedono quindi due cose: che il writer rifiuti
tutto ciò che il gate non accetterebbe (e con lo STESSO modulo della regola),
e che ciò che accetta apra davvero la coda del CLOSER — e che il ritiro la
richiuda.

Eseguire con: pytest tests/test_apply_request.py -v
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS = REPO_ROOT / "shared" / "skills"
RULE = REPO_ROOT / "shared" / "cloud" / "apply-request-rule.json"
sys.path.insert(0, str(SKILLS))

import apply_gate  # noqa: E402

CONSENT = {"applications": {"auto_apply": {"enabled": True, "max_per_day": 3, "mode": "authorised"}}}


@pytest.fixture()
def box(tmp_path):
    """Un box sintetico con lo schema vero (ensure_schema), fuori dal DB utente."""
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_DB": str(tmp_path / "jobs.db")}
    (tmp_path / "jht.config.json").write_text(json.dumps(CONSENT))
    cv = tmp_path / "cv.pdf"
    cv.write_bytes(b"%PDF-1.4 synthetic")
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import _db; c=_db.get_db(); _db.ensure_schema(c); c.close()",
        ],
        cwd=SKILLS,
        env=env,
        check=True,
    )
    conn = sqlite3.connect(tmp_path / "jobs.db")
    rows = [
        (1, "Synthetic role", "Synthetic company", "https://jobs.ashbyhq.com/x/1", "ready"),
        (2, "In review", "Synthetic company", "https://jobs.ashbyhq.com/x/2", "review"),
        (3, "Already sent", "Synthetic company", "https://jobs.ashbyhq.com/x/3", "applied"),
        (4, "Row says sent", "Synthetic company", "https://jobs.ashbyhq.com/x/4", "ready"),
    ]
    conn.executemany("INSERT INTO positions (id, title, company, url, status) VALUES (?,?,?,?,?)", rows)
    conn.execute("INSERT INTO applications (position_id, cv_pdf_path) VALUES (1, ?)", (str(cv),))
    conn.execute("INSERT INTO applications (position_id, cv_pdf_path, applied, applied_via) VALUES (4, ?, 1, 'user_manual')", (str(cv),))
    conn.commit()
    conn.close()
    return tmp_path, env


def run(box, *args):
    home, env = box
    r = subprocess.run(
        [sys.executable, str(SKILLS / "apply_request.py"), *map(str, args)],
        capture_output=True,
        text=True,
        env=env,
    )
    return r.returncode, json.loads(r.stdout.strip().splitlines()[-1])


def row(box, pid):
    conn = sqlite3.connect(box[0] / "jobs.db")
    try:
        return conn.execute(
            "SELECT apply_requested, apply_requested_at, apply_requested_by, updated_at "
            "FROM positions WHERE id = ?",
            (pid,),
        ).fetchone()
    finally:
        conn.close()


def queue(box):
    home, _ = box
    return apply_gate.application_queue(
        config_path=home / "jht.config.json", db_path=str(home / "jobs.db"), jht_home=home
    )


# ── Una regola sola ──────────────────────────────────────────────────────────


def test_il_gate_legge_la_regola_dal_file_condiviso():
    rule = json.loads(RULE.read_text())
    assert apply_gate.RULE_ERROR == ""
    assert apply_gate.AUTHORISABLE_STATUS == rule["authorisable_status"] == "ready"
    assert list(apply_gate.USER_REQUEST_ORIGINS) == rule["user_request_origins"]
    assert list(apply_gate.POST_SUBMISSION_STATES) == rule["post_submission_states"]


@pytest.mark.parametrize("content", [None, "{ broken", '{"authorisable_status": "", "post_submission_states": [], "user_request_origins": []}'])
def test_una_regola_illeggibile_chiude_tutto(tmp_path, content):
    path = tmp_path / "rule.json"
    if content is not None:
        path.write_text(content)
    status, states, origins, error = apply_gate._load_rule(path)
    assert error, "una regola rotta deve dirlo, non sembrare vuota"
    assert status is None and states == () and origins == ()


def test_con_la_regola_rotta_il_writer_rifiuta(box, monkeypatch):
    conn = sqlite3.connect(box[0] / "jobs.db")
    monkeypatch.setattr(apply_gate, "RULE_ERROR", "FileNotFoundError: gone")
    v = apply_gate.toggle_verdict(1, True, conn)
    conn.close()
    assert not v.allowed and v.reason == "rule_unavailable"


# ── request ──────────────────────────────────────────────────────────────────


def test_show_non_scrive_niente(box):
    code, out = run(box, "show", 1)
    assert code == 0 and out["ok"]
    assert out["title"] == "Synthetic role" and out["url"].startswith("https://")
    assert row(box, 1)[0] in (0, None)


@pytest.mark.parametrize(
    "pid,reason",
    [(2, "position_not_ready"), (3, "already_submitted"), (4, "already_submitted"), (99, "position_not_found")],
)
def test_request_rifiuta_cio_che_il_gate_non_accetterebbe(box, pid, reason):
    code, out = run(box, "request", pid)
    assert code == 1
    assert out["reason"] == reason
    if pid != 99:
        assert row(box, pid)[0] in (0, None), "un rifiuto ha scritto il flag"


def test_request_scrive_user_local_e_apre_la_coda(box):
    assert not queue(box)["ready"]
    before = row(box, 1)[3]
    code, out = run(box, "request", 1)
    assert code == 0 and out["ok"], out
    flag, at, by, updated = row(box, 1)
    assert flag == 1 and by == "user_local" and at and at.endswith("Z")
    assert updated != before, "updated_at non si e' mosso: il push non vedra' mai il flag"
    q = queue(box)
    assert q["ready"], q
    assert [p["position_id"] for p in q["positions"]] == [1]
    assert out["queue"]["ready"] is True
    # Il flag scritto dalla CLI e' uno che il gate accetta per l'invio.
    assert apply_gate.apply_verdict(
        1, config_path=box[0] / "jht.config.json", db_path=str(box[0] / "jobs.db")
    ).allowed


def test_una_nuova_request_avanza_sempre_l_istante(box):
    """Anche se l'orologio e' indietro rispetto all'ultima autorizzazione (skew,
    un flag arrivato dal cloud con un orologio avanti): la ri-autorizzazione
    deve essere PIU' RECENTE, o la coda non rimette in fila una posizione ferma."""
    conn = sqlite3.connect(box[0] / "jobs.db")
    conn.execute("UPDATE positions SET apply_requested_at = '2999-01-01T00:00:00.000Z' WHERE id = 1")
    conn.commit()
    conn.close()
    run(box, "request", 1)
    second = row(box, 1)[1]
    assert apply_gate._parse_instant(second) > apply_gate._parse_instant("2999-01-01T00:00:00.000Z")


def test_request_dopo_un_blocco_rimette_la_posizione_in_coda(box):
    home = box[0]
    cp = apply_gate.checkpoint_path(1, home)
    cp.parent.mkdir(parents=True)
    cp.write_text(json.dumps({"state": "blocked_human", "updated_at": "2026-01-01T00:00:00+00:00"}))
    assert not queue(box)["ready"]
    code, _ = run(box, "request", 1)
    assert code == 0
    assert queue(box)["ready"], "la ri-autorizzazione dell'utente non rimette in coda la posizione ferma"


# ── cancel ───────────────────────────────────────────────────────────────────


def test_cancel_richiude_la_coda(box):
    run(box, "request", 1)
    assert queue(box)["ready"]
    code, out = run(box, "cancel", 1)
    assert code == 0 and out["reason"] == "withdrawn"
    flag, at, by, _ = row(box, 1)
    assert flag == 0 and by is None and at
    assert not queue(box)["ready"]


def test_cancel_senza_autorizzazione_non_scrive(box):
    before = row(box, 1)
    code, out = run(box, "cancel", 1)
    assert code == 0 and out["reason"] == "not_authorised"
    assert row(box, 1) == before


def test_cancel_dopo_l_invio_e_rifiutato(box):
    code, out = run(box, "cancel", 3)
    assert code == 1 and out["reason"] == "already_submitted"
