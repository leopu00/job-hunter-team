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


# ── Un flag nuovo sveglia il CLOSER vivo (ordine del 2026-09-14: flag delle 12:58Z mai visti) ──

def _answers_module():
    # Resolved per test: another suite may drop the module from sys.modules
    # ("a new process"), and apply_request imports whatever is there now.
    import importlib

    return importlib.import_module("application_answers")


@pytest.fixture()
def live(box, monkeypatch):
    aa = _answers_module()
    home, env = box
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_DB", str(home / "jobs.db"))
    monkeypatch.setattr(apply_gate, "_jht_home", lambda: home, raising=False)
    state = {"sessions": ["CLOSER-1"], "sent": []}
    monkeypatch.setattr(aa, "_closer_sessions", lambda: list(state["sessions"]))
    monkeypatch.setattr(aa, "_tmux_send", lambda session, text: state["sent"].append((session, text)) or True)
    return state


def _poll(box):
    """What the Telegram bridge does on every poll."""
    conn = sqlite3.connect(box[0] / "jobs.db")
    try:
        return _answers_module().wake_closer(conn, {})
    finally:
        conn.close()


def _set_flag(box, pid, at, by="user_web"):
    conn = sqlite3.connect(box[0] / "jobs.db")
    conn.execute(
        "UPDATE positions SET apply_requested = 1, apply_requested_at = ?, apply_requested_by = ? WHERE id = ?",
        (at, by, pid),
    )
    conn.commit()
    conn.close()


def _now_iso(**delta):
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) - timedelta(**delta)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def test_una_request_sveglia_il_closer_vivo_una_volta_sola(box, live):
    import apply_request

    out, code = apply_request.toggle(1, True)
    assert code == 0 and out["closer_woken"] is True
    assert len(live["sent"]) == 1
    session, text = live["sent"][0]
    assert session == "CLOSER-1" and text.startswith("[BRIDGE INFO] the user authorised position #1")
    assert "apply_gate.py queue" in text
    # The bridge poll finds it already announced: no second message.
    assert _poll(box) == [] and len(live["sent"]) == 1
    # A new authorisation is a new wake.
    apply_request.toggle(1, False)
    apply_request.toggle(1, True)
    assert len(live["sent"]) == 2


def test_senza_closer_vivo_niente_claim_e_il_poll_lo_sveglia_dopo(box, live):
    import apply_request

    live["sessions"] = []
    out, _ = apply_request.toggle(1, True)
    assert out["closer_woken"] is False and live["sent"] == []
    live["sessions"] = ["CLOSER-1"]
    woken = _poll(box)
    assert [w.reason for w in woken] == ["position_authorised"] and len(live["sent"]) == 1


def test_un_flag_dal_web_o_dal_cloud_sveglia_al_poll_del_bridge(box, live):
    _set_flag(box, 1, _now_iso(minutes=1), by="user_web")
    assert [w.key for w in _poll(box)][0].startswith("authorised:1:")
    assert len(live["sent"]) == 1


def test_con_la_coda_non_pronta_non_si_sveglia_e_non_si_brucia_la_sveglia(box, live):
    home, _ = box
    (home / "jht.config.json").write_text(json.dumps({"applications": {"auto_apply": {"enabled": False}}}))
    _set_flag(box, 1, _now_iso(minutes=1))
    assert _poll(box) == [] and live["sent"] == []
    (home / "jht.config.json").write_text(json.dumps(CONSENT))
    assert len(_poll(box)) == 1 and len(live["sent"]) == 1


def test_un_flag_vecchio_o_non_dell_utente_non_sveglia(box, live):
    _set_flag(box, 1, _now_iso(hours=25))
    assert _poll(box) == [] and live["sent"] == []
    _set_flag(box, 1, _now_iso(minutes=1), by="agent_closer")
    assert _poll(box) == [] and live["sent"] == []
    conn = sqlite3.connect(box[0] / "jobs.db")
    assert conn.execute("SELECT COUNT(*) FROM closer_wakes").fetchone() == (0,)
    conn.close()


def test_piu_flag_insieme_fanno_un_messaggio_solo(box, live):
    home, _ = box
    conn = sqlite3.connect(home / "jobs.db")
    for pid in (5, 6):
        conn.execute("INSERT INTO positions (id, title, company, url, status) VALUES (?, 'r', 'c', ?, 'ready')",
                     (pid, f"https://jobs.ashbyhq.com/x/{pid}"))
        conn.execute("INSERT INTO applications (position_id, cv_pdf_path) VALUES (?, ?)", (pid, str(home / "cv.pdf")))
    conn.commit()
    conn.close()
    for pid in (1, 5, 6):
        _set_flag(box, pid, _now_iso(minutes=1))
    assert len(_poll(box)) == 3
    assert len(live["sent"]) == 1 and "#1, #5, #6" in live["sent"][0][1]
