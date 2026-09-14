"""
Il cancello che sta fra il team e la casella di un recruiter. [JHT-CLOSER]

Il vincolo dell'operatore è uno solo e viene prima di tutto: **una candidatura
parte SOLO se l'utente l'ha chiesta**, e «l'ha chiesta» sono DUE condizioni —
il consenso generale nel config e il flag su quella posizione — entrambe
fail-closed, assente = disattivato.

Questi test non provano che il gate «funziona»: provano che **rifiuta**. La
domanda che pongono a ogni caso è quella che conta, «esiste un percorso in cui
il team si candida da solo?», e ogni risposta affermativa qui è un P0 anche col
resto della suite verde.

Il caso (c) — entrambe le condizioni presenti → passa — è l'unico che dimostra
che il cancello non è semplicemente murato. Senza di lui i primi due
passerebbero anche con un `return False` in cima al modulo.

Eseguire con: pytest tests/test_apply_gate.py -v
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
START_AGENT = REPO_ROOT / ".launcher" / "start-agent.sh"

sys.path.insert(0, str(SKILLS_DIR))

from apply_gate import (  # noqa: E402
    AUTO_APPLY_MODES,
    USER_REQUEST_ORIGINS,
    apply_verdict,
    consent_verdict,
    position_verdict,
)


# ── Impalcature ──────────────────────────────────────────────────────────────


CONSENT_ON = {
    "version": 1,
    "active_provider": "claude",
    "providers": {},
    "workspace": "~/.jht",
    "applications": {"auto_apply": {"enabled": True, "max_per_day": 3, "mode": "authorised"}},
}


def write_config(tmp_path: Path, payload) -> Path:
    p = tmp_path / "jht.config.json"
    p.write_text(payload if isinstance(payload, str) else json.dumps(payload))
    return p


def make_db(tmp_path: Path, rows=(), applications=()) -> str:
    """Le due tabelle che il gate legge, ridotte alle colonne che gli servono.

    Deliberatamente NON passa da `ensure_schema`: il gate deve poter essere
    letto senza tirarsi dietro l'intero schema, e un test che ricostruisse il
    DB vero misurerebbe `_db.py` invece del cancello.

    `applications` c'è perché il gate la interroga davvero: una candidatura già
    partita si riconosce da due lati, e i due lati divergono (#186). Un'ombra
    più stretta del lettore farebbe fallire i test per il motivo sbagliato.
    """
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE positions (id INTEGER PRIMARY KEY, status TEXT, "
        "apply_requested INTEGER DEFAULT 0, apply_requested_at TIMESTAMP, "
        "apply_requested_by TEXT)"
    )
    conn.execute(
        "CREATE TABLE applications (id INTEGER PRIMARY KEY, "
        "position_id INTEGER UNIQUE, applied INTEGER DEFAULT 0, applied_via TEXT)"
    )
    conn.executemany(
        "INSERT INTO positions (id, status, apply_requested, apply_requested_at, "
        "apply_requested_by) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.executemany(
        "INSERT INTO applications (position_id, applied, applied_via) VALUES (?, ?, ?)",
        applications,
    )
    conn.commit()
    conn.close()
    return str(path)


AUTHORISED_ROW = (1, "ready", 1, "2026-09-12 10:00:00", "user_web")
UNFLAGGED_ROW = (2, "ready", 0, None, None)


# ── (a) config assente → cancello chiuso ─────────────────────────────────────


def test_a_config_assente_chiude(tmp_path):
    v = consent_verdict(path=tmp_path / "does-not-exist.json")
    assert not v.allowed
    assert v.reason == "config_missing"


def test_a_config_illeggibile_chiude(tmp_path):
    v = consent_verdict(path=write_config(tmp_path, "{ not json at all"))
    assert not v.allowed
    assert v.reason == "config_malformed"


def test_a_config_senza_blocco_applications_chiude(tmp_path):
    cfg = {k: v for k, v in CONSENT_ON.items() if k != "applications"}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert not v.allowed
    assert v.reason == "consent_absent"


def test_a_blocco_presente_ma_enabled_false_chiude(tmp_path):
    cfg = dict(CONSENT_ON)
    cfg["applications"] = {"auto_apply": {"enabled": False, "max_per_day": 3, "mode": "authorised"}}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert not v.allowed
    assert v.reason == "consent_disabled"


@pytest.mark.parametrize("enabled", ["true", "yes", 1, "1", [], {}])
def test_a_enabled_verosimile_non_e_un_consenso(tmp_path, enabled):
    """`enabled` deve essere il booleano `True`, non qualcosa che gli somiglia.

    Un consenso dedotto da una stringa non è un consenso: chi scrive `"true"` a
    mano in un JSON sta facendo un errore di battitura, e interpretarlo a suo
    favore significa spedire una lettera che non ha autorizzato.
    """
    cfg = dict(CONSENT_ON)
    cfg["applications"] = {"auto_apply": {"enabled": enabled, "max_per_day": 3}}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert not v.allowed
    assert v.reason == "consent_disabled"


def test_a_mode_sconosciuto_chiude(tmp_path):
    cfg = dict(CONSENT_ON)
    cfg["applications"] = {"auto_apply": {"enabled": True, "max_per_day": 3, "mode": "yolo"}}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert not v.allowed
    assert v.reason == "consent_mode_unknown"


@pytest.mark.parametrize("cap", [0, -1, True, False, "3", "abc", 1.5, [], {}])
def test_a_tetto_non_valido_chiude(tmp_path, cap):
    """Un tetto assurdo chiude: assente o null è «nessun tetto», tutto il resto non si indovina.

    `True` è nel parametro apposta: in Python è un `int` e passerebbe un
    `isinstance` scritto senza pensarci, autorizzando UNA candidatura al giorno
    per un errore di battitura — il modo silenzioso di sbagliare.
    """
    cfg = dict(CONSENT_ON)
    cfg["applications"] = {"auto_apply": {"enabled": True, "max_per_day": cap}}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert not v.allowed
    assert v.reason == "consent_cap_invalid"


def test_a_consenso_valido_apre_e_dice_il_modo(tmp_path):
    v = consent_verdict(path=write_config(tmp_path, CONSENT_ON))
    assert v.allowed
    assert v.reason == "consent_granted"
    assert v.context["mode"] == "authorised"
    assert v.context["max_per_day"] == 3


def test_a_il_modo_di_consegna_e_authorised(tmp_path):
    """Il default di consegna è `authorised`, non `dry_run`.

    Decisione dell'operatore del 2026-09-12: il flag per-posizione È
    l'autorizzazione a inviare, non la richiesta di un secondo click. Se un
    domani questo test diventa rosso perché il default è tornato a `dry_run`,
    la modifica sta rimettendo un bottone che l'operatore ha tolto.
    """
    cfg = dict(CONSENT_ON)
    cfg["applications"] = {"auto_apply": {"enabled": True, "max_per_day": 3}}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert v.allowed
    assert v.context["mode"] == "authorised"
    assert set(AUTO_APPLY_MODES) == {"authorised", "dry_run"}


# ── (b) consenso c'è, posizione non flaggata → rifiuto ───────────────────────


def test_b_posizione_non_flaggata_rifiutata(tmp_path):
    db = make_db(tmp_path, [AUTHORISED_ROW, UNFLAGGED_ROW])
    v = apply_verdict(2, config=CONSENT_ON, db_path=db)
    assert not v.allowed
    assert v.reason == "position_not_authorised"


def test_b_posizione_inesistente_rifiutata(tmp_path):
    db = make_db(tmp_path, [AUTHORISED_ROW])
    v = apply_verdict(999, config=CONSENT_ON, db_path=db)
    assert not v.allowed
    assert v.reason == "position_not_found"


def test_b_flag_acceso_senza_istante_rifiutato(tmp_path):
    """Un'autorizzazione senza data non si distingue da una scrittura vecchia."""
    db = make_db(tmp_path, [(3, "ready", 1, None, "user_web")])
    v = apply_verdict(3, config=CONSENT_ON, db_path=db)
    assert not v.allowed
    assert v.reason == "authorisation_undated"


@pytest.mark.parametrize("who", [None, "", "agent_closer", "capitano", "system", "user"])
def test_b_flag_acceso_da_non_utente_rifiutato(tmp_path, who):
    """Regola #186 applicata al verso dell'autorizzazione.

    Dal cloud si prende l'AZIONE dell'utente, mai lo stato generico. Un flag
    acceso da un processo — `agent_closer` in testa — è esattamente il percorso
    che non deve esistere: il team che si autorizza da solo.

    `"user"` è nella lista di proposito: somiglia abbastanza a un canale valido
    da passare un controllo scritto con `startswith`.
    """
    db = make_db(tmp_path, [(4, "ready", 1, "2026-09-12 10:00:00", who)])
    v = apply_verdict(4, config=CONSENT_ON, db_path=db)
    assert not v.allowed
    assert v.reason == "authorisation_not_from_user"


@pytest.mark.parametrize("status", ["applied", "response"])
def test_b_una_candidatura_gia_partita_non_si_rispedisce(tmp_path, status):
    """Il difetto trovato rivedendo la fase C il 2026-09-12.

    Il flag NON si spegne quando la candidatura parte: resta acceso e lo stato
    passa ad `applied`. Se a fermare il secondo invio fosse solo il checkpoint
    di `apply_flow` — che vive in `.cache/`, cioè dove un wipe passa — una
    posizione già inviata col flag ancora acceso sarebbe una seconda lettera
    allo stesso recruiter. Il guard che `apply_flow` ha nel recorder gira DOPO
    il click, quando la candidatura è già partita.

    `response` è nella lista accanto ad `applied` perché è la progressione
    dell'invio, non il suo contrario: hanno gia' risposto, quindi era partita.
    """
    db = make_db(tmp_path, [(9, status, 1, "2026-09-12 10:00:00", "user_web")])
    v = apply_verdict(9, config=CONSENT_ON, db_path=db)
    assert not v.allowed, v.log_line()
    assert v.reason == "already_submitted"


def test_b_una_candidatura_gia_registrata_non_si_rispedisce(tmp_path):
    """Il secondo lato, e non è una ridondanza.

    `positions.status` e `applications.applied` divergono davvero — è la classe
    di difetto di #186 — e qui basta che diverga uno perché la lettera parta
    due volte. Questa riga ha lo status ancora a `ready` e la candidatura già
    registrata: guardando solo lo stato, passerebbe.
    """
    db = make_db(
        tmp_path,
        [(10, "ready", 1, "2026-09-12 10:00:00", "user_web")],
        applications=[(10, 1, "agent_closer")],
    )
    v = apply_verdict(10, config=CONSENT_ON, db_path=db)
    assert not v.allowed, v.log_line()
    assert v.reason == "already_submitted"


def test_b_una_candidatura_non_ancora_inviata_non_blocca(tmp_path):
    """Il contrario del test sopra: una riga `applications` esiste quasi
    sempre (la crea lo SCRITTORE col CV) e con `applied = 0` non deve
    impedire niente. Senza questo, il rifiuto sarebbe un muro."""
    db = make_db(
        tmp_path,
        [(11, "ready", 1, "2026-09-12 10:00:00", "user_web")],
        applications=[(11, 0, None)],
    )
    v = apply_verdict(11, config=CONSENT_ON, db_path=db)
    assert v.allowed, v.log_line()


def test_b_colonne_assenti_rifiutano(tmp_path):
    """Un jobs.db di un'immagine vecchia non ha le colonne. Non è un caso da
    ricostruire con un default: è un no."""
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, status TEXT)")
    conn.execute(
        "CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER, "
        "applied INTEGER, applied_via TEXT)"
    )
    conn.execute("INSERT INTO positions (id, status) VALUES (1, 'ready')")
    conn.commit()
    conn.close()
    v = apply_verdict(1, config=CONSENT_ON, db_path=str(path))
    assert not v.allowed
    assert v.reason == "authorisation_unreadable"


def test_b_db_assente_rifiuta(tmp_path):
    v = position_verdict(1, db_path=str(tmp_path / "nowhere" / "jobs.db"))
    assert not v.allowed
    assert v.reason in ("db_unavailable", "authorisation_unreadable")


# ── I due cancelli sono AND, non OR ──────────────────────────────────────────


def test_posizione_autorizzata_senza_consenso_non_basta(tmp_path):
    """Il caso che dimostra che le due condizioni sono in AND.

    È il percorso più insidioso: la posizione è flaggata per davvero
    dall'utente, e un gate scritto come OR — o come «basta il flag, il consenso
    l'ha già dato spawnando» — lascerebbe partire la candidatura di un utente
    che l'auto-apply non l'ha mai acceso.
    """
    db = make_db(tmp_path, [AUTHORISED_ROW])
    cfg = {k: v for k, v in CONSENT_ON.items() if k != "applications"}
    v = apply_verdict(1, config=cfg, db_path=db)
    assert not v.allowed
    assert v.reason == "consent_absent"
    # Il rifiuto porta con sé la posizione: un `consent_*` con un position_id
    # accanto dice che QUALCOSA ha spawnato il CLOSER lo stesso.
    assert v.context["position_id"] == 1


# ── (c) entrambe presenti → passa ────────────────────────────────────────────


def test_c_consenso_e_flag_insieme_passano(tmp_path):
    db = make_db(tmp_path, [AUTHORISED_ROW])
    v = apply_verdict(1, config=CONSENT_ON, db_path=db)
    assert v.allowed, v.log_line()
    assert v.reason == "apply_allowed"
    assert v.context["by"] == "user_web"
    assert v.context["mode"] == "authorised"


@pytest.mark.parametrize("origin", USER_REQUEST_ORIGINS)
def test_c_entrambi_i_canali_utente_passano(tmp_path, origin):
    """Web e desktop sono due modi in cui la STESSA persona autorizza."""
    db = make_db(tmp_path, [(7, "ready", 1, "2026-09-12 10:00:00", origin)])
    v = apply_verdict(7, config=CONSENT_ON, db_path=db)
    assert v.allowed, v.log_line()


# ── Il rifiuto parla ─────────────────────────────────────────────────────────


def test_ogni_rifiuto_lascia_una_riga_leggibile(tmp_path):
    """Il sintomo di un cancello scritto male è il silenzio: «non ha inviato
    niente» e «non ha nemmeno provato» si somigliano troppo in un log."""
    db = make_db(tmp_path, [UNFLAGGED_ROW])
    for verdict in (
        consent_verdict(path=tmp_path / "missing.json"),
        apply_verdict(2, config=CONSENT_ON, db_path=db),
    ):
        line = verdict.log_line()
        assert line.startswith("[apply-gate] DENY ")
        assert verdict.reason in line
        assert len(verdict.detail) > 20, "un rifiuto senza spiegazione è un silenzio"


# ── La CLI, che è quella che usa il launcher ─────────────────────────────────


def run_cli(*args, **kw):
    return subprocess.run(
        [sys.executable, str(SKILLS_DIR / "apply_gate.py"), *args],
        capture_output=True,
        text=True,
        **kw,
    )


def test_cli_consent_esce_1_senza_config(tmp_path):
    r = run_cli("consent", "--config", str(tmp_path / "missing.json"))
    assert r.returncode == 1
    assert "config_missing" in r.stderr
    assert r.stdout == "", "un rifiuto non deve sporcare stdout"


def test_cli_consent_esce_0_col_consenso(tmp_path):
    r = run_cli("consent", "--config", str(write_config(tmp_path, CONSENT_ON)))
    assert r.returncode == 0, r.stderr
    assert "consent_granted" in r.stdout


def test_cli_position_json_e_leggibile_da_una_macchina(tmp_path):
    db = make_db(tmp_path, [AUTHORISED_ROW, UNFLAGGED_ROW])
    cfg = str(write_config(tmp_path, CONSENT_ON))
    ok = run_cli("position", "1", "--config", cfg, "--db", db, "--json")
    no = run_cli("position", "2", "--config", cfg, "--db", db, "--json")
    assert ok.returncode == 0 and json.loads(ok.stdout)["allowed"] is True
    assert no.returncode == 1 and json.loads(no.stdout)["reason"] == "position_not_authorised"


def test_cli_position_senza_id_esce_2(tmp_path):
    """Uso errato ≠ rifiuto: chi invoca da shell deve poterli distinguere."""
    r = run_cli("position", "--config", str(write_config(tmp_path, CONSENT_ON)))
    assert r.returncode == 2


# ── Il seam del launcher ─────────────────────────────────────────────────────
#
# Il gate vive in Python ma chi lo applica per primo è uno script bash, e
# fra i due c'è un confine di linguaggio: nessun test Python del modulo si
# accorgerebbe mai che qualcuno ha tolto la chiamata da start-agent.sh.


def test_il_launcher_non_spawna_closer_senza_consenso(tmp_path):
    src = START_AGENT.read_text()
    assert 'if [ "$ROLE" = "closer" ]' in src, (
        "start-agent.sh non ha piu' il cancello del CLOSER: il consenso "
        "dell'utente non e' piu' una condizione dello spawn"
    )
    assert "apply_gate.py" in src
    assert 'python3 "$APPLY_GATE" consent' in src, (
        "il launcher non invoca piu' il gate: un vincolo non invocato non e' "
        "un vincolo"
    )


def test_il_cancello_del_launcher_precede_il_case_dei_ruoli(tmp_path):
    """Deve stare PRIMA di `get_agent_info`, o in fase D smette di parlare.

    Oggi `closer` non è nel case, quindi lo spawn fallirebbe comunque — ma con
    «unrecognized role», che è la ragione sbagliata. Quando il ruolo entrerà
    nel case (fase D) il rifiuto per mancanza di consenso deve restare quello
    che si legge nel log, e l'ordine è ciò che lo garantisce.
    """
    src = START_AGENT.read_text()
    assert src.index('if [ "$ROLE" = "closer" ]') < src.index(
        'AGENT_INFO=$(get_agent_info "$ROLE")'
    )


def test_il_launcher_rifiuta_anche_senza_il_modulo(tmp_path):
    """Fail-closed sull'infrastruttura: niente modulo → niente spawn."""
    src = START_AGENT.read_text()
    assert '[ ! -f "$APPLY_GATE" ]' in src
    # Il ramo di indisponibilita' deve uscire 1, non proseguire.
    head = src[src.index('if [ "$ROLE" = "closer" ]') :]
    head = head[: head.index("\nAGENT_INFO=")]
    assert head.count("exit 1") >= 2, (
        "un percorso del cancello prosegue invece di uscire: un gate che non "
        "sa rispondere deve rispondere no"
    )


# ── La coda: la domanda che si fanno il Capitano e il CLOSER ─────────────────
#
# `application_queue` decide DUE cose irreversibili in due posti diversi: se
# un agente nasce (Capitano) e quale form si apre (CLOSER). Questi test
# chiedono la stessa cosa dei precedenti — esiste un percorso in cui parte
# qualcosa che l'utente non ha chiesto? — più una seconda, che è sua: esiste un
# percorso in cui la coda si dice pronta per una posizione su cui il flusso si è
# già fermato? Quello è il giro a vuoto (Capitano che rispawna a ogni tick) e il
# tentativo cieco (CLOSER che rilancia un captcha) insieme.

from apply_gate import application_queue, checkpoint_path, daily_cap_verdict  # noqa: E402


def make_queue_db(tmp_path: Path, positions=(), applications=()) -> str:
    """Le colonne che la coda legge: stato, flag, URL, PDF, invio di oggi."""
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE positions (id INTEGER PRIMARY KEY, status TEXT, url TEXT, "
        "apply_requested INTEGER DEFAULT 0, apply_requested_at TIMESTAMP, "
        "apply_requested_by TEXT)"
    )
    conn.execute(
        "CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE, "
        "cv_pdf_path TEXT, applied INTEGER DEFAULT 0, applied_via TEXT, applied_at TIMESTAMP)"
    )
    conn.executemany(
        "INSERT INTO positions (id, status, url, apply_requested, apply_requested_at, "
        "apply_requested_by) VALUES (?, ?, ?, ?, ?, ?)",
        positions,
    )
    conn.executemany(
        "INSERT INTO applications (position_id, cv_pdf_path, applied, applied_via, applied_at) "
        "VALUES (?, ?, ?, ?, ?)",
        applications,
    )
    conn.commit()
    conn.close()
    return str(path)


def cv_file(tmp_path: Path, name="cv.pdf") -> str:
    p = tmp_path / name
    p.write_bytes(b"%PDF-1.4 test")
    return str(p)


def queue(tmp_path, db, config=CONSENT_ON):
    return application_queue(
        config_path=write_config(tmp_path, config), db_path=db, jht_home=tmp_path
    )


URL = "https://jobs.ashbyhq.com/example/123"
ASKED = "2026-09-12T10:00:00Z"


def authorised(pid=1, status="ready", asked=ASKED, by="user_web", url=URL):
    return (pid, status, url, 1, asked, by)


def write_checkpoint(tmp_path, pid, state, updated_at):
    p = checkpoint_path(pid, tmp_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"position_id": pid, "state": state, "updated_at": updated_at}))


def test_coda_senza_consenso_non_e_pronta_anche_con_posizioni_autorizzate(tmp_path):
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    cfg = {**CONSENT_ON, "applications": {"auto_apply": {"enabled": False}}}
    q = queue(tmp_path, db, cfg)
    assert not q["ready"]
    assert q["reason"] == "consent_disabled"
    assert q["positions"] == []


def test_coda_pronta_con_consenso_flag_url_e_cv(tmp_path):
    cv = cv_file(tmp_path)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv, 0, None, None)])
    q = queue(tmp_path, db)
    assert q["ready"], q
    assert q["reason"] == "queue_ready"
    assert q["positions"] == [{"position_id": 1, "url": URL, "cv_pdf_path": cv}]
    assert q["remaining_today"] == 3


def test_coda_prende_solo_ready_flaggate_da_un_utente(tmp_path):
    cv = cv_file(tmp_path)
    db = make_queue_db(
        tmp_path,
        [
            (1, "ready", URL, 0, None, None),                  # non flaggata
            authorised(2, status="review"),                    # il Critico non ha votato
            authorised(3, by="agent_closer"),                  # flag acceso da un processo
            authorised(4, asked=None),                         # flag senza istante
        ],
        [(pid, cv, 0, None, None) for pid in (1, 2, 3, 4)],
    )
    q = queue(tmp_path, db)
    assert not q["ready"]
    assert q["reason"] == "queue_empty"
    held = {h["position_id"]: h["reason"] for h in q["held"]}
    assert held == {3: "authorisation_not_from_user", 4: "authorisation_undated"}


def test_coda_non_ripropone_una_candidatura_gia_partita(tmp_path):
    cv = cv_file(tmp_path)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv, 1, "user_manual", "2026-09-12 11:00:00")])
    q = queue(tmp_path, db)
    assert not q["ready"]
    assert q["held"] == [{"position_id": 1, "reason": "already_submitted"}]


def test_coda_trattiene_senza_url_o_senza_pdf(tmp_path):
    db = make_queue_db(
        tmp_path,
        [authorised(1, url=""), authorised(2)],
        [(1, cv_file(tmp_path), 0, None, None), (2, str(tmp_path / "missing.pdf"), 0, None, None)],
    )
    q = queue(tmp_path, db)
    assert not q["ready"]
    assert {h["reason"] for h in q["held"]} == {"url_missing", "cv_pdf_missing"}


@pytest.mark.parametrize("state", ["blocked_human", "dry_run"])
def test_un_flusso_fermo_tiene_la_posizione_fuori_dalla_coda(tmp_path, state):
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    write_checkpoint(tmp_path, 1, state, "2026-09-12T12:00:00+00:00")
    q = queue(tmp_path, db)
    assert not q["ready"], "la coda ripropone una posizione su cui il flusso si e' gia' fermato"
    assert q["held"] == [{"position_id": 1, "reason": f"checkpoint_{state}"}]


def test_una_nuova_autorizzazione_dopo_il_blocco_la_rimette_in_coda(tmp_path):
    db = make_queue_db(
        tmp_path,
        [authorised(asked="2026-09-12T13:00:00Z")],
        [(1, cv_file(tmp_path), 0, None, None)],
    )
    write_checkpoint(tmp_path, 1, "blocked_human", "2026-09-12T12:00:00+00:00")
    q = queue(tmp_path, db)
    assert q["ready"], q
    assert [p["position_id"] for p in q["positions"]] == [1]


def test_checkpoint_illeggibile_trattiene(tmp_path):
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    p = checkpoint_path(1, tmp_path)
    p.parent.mkdir(parents=True)
    p.write_text("{ broken")
    q = queue(tmp_path, db)
    assert not q["ready"]
    assert q["held"] == [{"position_id": 1, "reason": "checkpoint_unreadable"}]


def test_un_checkpoint_in_corso_non_trattiene(tmp_path):
    """Un crash a metà compilazione deve riprendere, non restare fermo."""
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    write_checkpoint(tmp_path, 1, "fill", "2026-09-12T12:00:00+00:00")
    assert queue(tmp_path, db)["ready"]


def test_tetto_giornaliero_chiude_la_coda(tmp_path):
    cv = cv_file(tmp_path)
    cfg = {**CONSENT_ON, "applications": {"auto_apply": {"enabled": True, "max_per_day": 1}}}
    conn_rows = [authorised(1), (2, "applied", URL, 1, ASKED, "user_web")]
    db = make_queue_db(tmp_path, conn_rows, [(1, cv, 0, None, None)])
    c = sqlite3.connect(db)
    c.execute(
        "INSERT INTO applications (position_id, cv_pdf_path, applied, applied_via, applied_at) "
        "VALUES (2, ?, 1, 'agent_closer', datetime('now', 'localtime'))",
        (cv,),
    )
    c.commit()
    c.close()
    q = queue(tmp_path, db, cfg)
    assert not q["ready"]
    assert q["reason"] == "daily_cap_reached"
    assert q["sent_today"] == 1


def test_un_invio_a_mano_non_consuma_il_tetto_del_closer(tmp_path):
    cv = cv_file(tmp_path)
    cfg = {**CONSENT_ON, "applications": {"auto_apply": {"enabled": True, "max_per_day": 1}}}
    db = make_queue_db(tmp_path, [authorised(1), (2, "applied", URL, 0, None, None)], [(1, cv, 0, None, None)])
    c = sqlite3.connect(db)
    c.execute(
        "INSERT INTO applications (position_id, applied, applied_via, applied_at) "
        "VALUES (2, 1, 'user_manual', datetime('now', 'localtime'))"
    )
    c.commit()
    c.close()
    assert queue(tmp_path, db, cfg)["ready"]


def test_cli_queue_esce_0_solo_se_qualcosa_puo_partire(tmp_path):
    cv = cv_file(tmp_path)
    cfg = str(write_config(tmp_path, CONSENT_ON))
    ready_db = make_queue_db(tmp_path, [authorised()], [(1, cv, 0, None, None)])
    env_home = {**os.environ, "JHT_HOME": str(tmp_path)}
    r = run_cli("queue", "--json", "--config", cfg, "--db", ready_db, env=env_home)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["positions"][0]["position_id"] == 1

    empty = tmp_path / "empty"
    empty.mkdir()
    empty_db = make_queue_db(empty, [], [])
    r = run_cli("queue", "--config", cfg, "--db", empty_db, env=env_home)
    assert r.returncode == 1
    assert "queue_empty" in r.stderr


def _write_form_stop(tmp_path, pid, request):
    p = checkpoint_path(pid, tmp_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"position_id": pid, "state": "blocked_human", "blocked_reason": "required_answer_missing",
                             "updated_at": "2026-09-12T12:00:00+00:00", "answer_request": request}))


@pytest.mark.parametrize(
    "request_fields, held",
    [
        ({"asked": False, "message_id": ""}, False),   # nobody asked: the CLOSER works it out
        ({"asked": True, "message_id": "9"}, True),    # asked: waits for the user's answer
        ({"message_id": "9"}, True),                   # checkpoint written before `asked`
        ({"asked": True, "message_id": ""}, True),     # marked asked: never released
        ({"message_id": ""}, True),                    # no mark at all: not provably unasked
        ({"asked": False, "message_id": "9"}, True),   # a row exists: it was asked
    ],
)
def test_una_domanda_di_form_mai_chiesta_non_trattiene_la_posizione(tmp_path, request_fields, held):
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    _write_form_stop(tmp_path, 1, {"source_id": "closer-answer:1:x", "payload": {"key": "why us"}, **request_fields})
    q = queue(tmp_path, db)
    if held:
        assert q["held"] == [{"position_id": 1, "reason": "checkpoint_blocked_human"}]
    else:
        assert q["ready"], q
        assert [p["position_id"] for p in q["positions"]] == [1]


# ── CV layout hold (pdf_layout_check) ───────────────────────────────────────

import pdf_layout_check  # noqa: E402

# Imported before the suite's autouse stub replaces it for each test.
REAL_ANALYZE = pdf_layout_check.analyze


@pytest.fixture
def layout_check_on(monkeypatch):
    monkeypatch.setattr(pdf_layout_check, "analyze", REAL_ANALYZE)
    return monkeypatch


def test_un_cv_non_misurabile_non_parte_mai(tmp_path, layout_check_on):
    # A placeholder PDF: poppler cannot measure it, and without poppler neither.
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    q = queue(tmp_path, db)
    assert not q["ready"]
    assert q["held"] == [{"position_id": 1, "reason": "cv_pdf_check_unavailable"}]


@pytest.mark.parametrize(
    "outcome, reason",
    [
        ({"ok": True, "reasons": []}, ""),
        ({"ok": False, "reasons": ["narrow_text"]}, "cv_pdf_layout_bad"),
        ({"ok": "yes"}, "cv_pdf_layout_bad"),
        (["not a report"], "cv_pdf_check_unavailable"),
        (pdf_layout_check.CheckError("pdftotext not found"), "cv_pdf_check_unavailable"),
        (RuntimeError("boom"), "cv_pdf_check_unavailable"),
    ],
)
def test_la_coda_trattiene_un_cv_dal_layout_rotto(tmp_path, layout_check_on, outcome, reason):
    def analyze(_path):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    layout_check_on.setattr(pdf_layout_check, "analyze", analyze)
    cv = cv_file(tmp_path)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv, 0, None, None)])
    q = queue(tmp_path, db)
    if reason:
        assert q["held"] == [{"position_id": 1, "reason": reason}]
    else:
        assert q["ready"] and q["positions"] == [{"position_id": 1, "url": URL, "cv_pdf_path": cv}]


def test_senza_il_modulo_di_controllo_nessun_cv_parte(tmp_path, layout_check_on):
    layout_check_on.setitem(sys.modules, "pdf_layout_check", None)
    layout_check_on.setitem(sys.modules, "shared.skills.pdf_layout_check", None)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    assert queue(tmp_path, db)["held"] == [{"position_id": 1, "reason": "cv_pdf_check_unavailable"}]


def test_un_cv_rigenerato_toglie_la_trattenuta_da_solo(tmp_path, layout_check_on):
    layout_check_on.setattr(
        pdf_layout_check, "analyze", lambda path: {"ok": b"full width" in Path(path).read_bytes(), "reasons": []}
    )
    cv = cv_file(tmp_path)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv, 0, None, None)])
    assert queue(tmp_path, db)["held"] == [{"position_id": 1, "reason": "cv_pdf_layout_bad"}]
    Path(cv).write_bytes(b"%PDF-1.4 full width")  # the Scrittore renders it again
    assert queue(tmp_path, db)["ready"]


def test_uno_stop_del_flusso_sul_cv_non_trattiene_un_cv_rigenerato(tmp_path, layout_check_on):
    layout_check_on.setattr(pdf_layout_check, "analyze", lambda _path: {"ok": True, "reasons": []})
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    for reason in ("cv_pdf_layout_bad", "cv_pdf_check_unavailable"):
        p = checkpoint_path(1, tmp_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"position_id": 1, "state": "blocked_human", "blocked_reason": reason,
                                 "updated_at": "2026-09-12T12:00:00+00:00"}))
        assert queue(tmp_path, db)["ready"], reason
    p.write_text(json.dumps({"position_id": 1, "state": "blocked_human", "blocked_reason": "captcha",
                             "updated_at": "2026-09-12T12:00:00+00:00"}))
    assert queue(tmp_path, db)["held"] == [{"position_id": 1, "reason": "checkpoint_blocked_human"}]


def test_la_coda_lascia_la_preview_del_cv_rotto_una_volta_per_file(tmp_path, layout_check_on):
    import apply_gate

    renders = []

    def render(pdf, png):
        renders.append(Path(pdf))
        png.write_bytes(b"\x89PNG synthetic")
        return png

    layout_check_on.setattr(pdf_layout_check, "analyze", lambda _path: {"ok": False, "reasons": ["narrow_text"]})
    layout_check_on.setattr(pdf_layout_check, "render_preview", render)
    cv = cv_file(tmp_path)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv, 0, None, None)])

    assert queue(tmp_path, db)["held"] == [{"position_id": 1, "reason": "cv_pdf_layout_bad"}]
    preview = apply_gate.cv_preview_path(1, tmp_path)
    assert preview == checkpoint_path(1, tmp_path).with_name("1.cv-page1.png")
    assert preview.read_bytes().startswith(b"\x89PNG") and preview.stat().st_mode & 0o077 == 0
    queue(tmp_path, db)
    assert len(renders) == 1  # up to date: not rendered again

    os.utime(cv, ns=(preview.stat().st_mtime_ns + 10**9,) * 2)  # a newer (still bad) CV
    queue(tmp_path, db)
    assert len(renders) == 2
    assert not list(preview.parent.glob(".*partial*"))


def test_una_preview_che_fallisce_non_cambia_la_trattenuta(tmp_path, layout_check_on):
    def render(_pdf, _png):
        raise pdf_layout_check.CheckError("pdftoppm not found")

    layout_check_on.setattr(pdf_layout_check, "analyze", lambda _path: {"ok": False, "reasons": ["narrow_text"]})
    layout_check_on.setattr(pdf_layout_check, "render_preview", render)
    db = make_queue_db(tmp_path, [authorised()], [(1, cv_file(tmp_path), 0, None, None)])
    assert queue(tmp_path, db)["held"] == [{"position_id": 1, "reason": "cv_pdf_layout_bad"}]



# ── tetto opzionale (ordine dell'operatore 2026-09-14: «non ci deve essere un massimo») ──


def _applied_by_closer(db, pids, cv):
    c = sqlite3.connect(db)
    for pid in pids:
        c.execute("INSERT INTO positions (id, status, url, apply_requested, apply_requested_at, apply_requested_by) "
                  "VALUES (?, 'applied', ?, 1, ?, 'user_web')", (pid, URL, ASKED))
        c.execute("INSERT INTO applications (position_id, cv_pdf_path, applied, applied_via, applied_at) "
                  "VALUES (?, ?, 1, 'agent_closer', datetime('now', 'localtime'))", (pid, cv))
    c.commit()
    c.close()


@pytest.mark.parametrize("auto", [{"enabled": True}, {"enabled": True, "max_per_day": None}])
def test_senza_tetto_la_coda_non_si_chiude_mai_per_il_numero(tmp_path, auto):
    cv = cv_file(tmp_path)
    cfg = {**CONSENT_ON, "applications": {"auto_apply": auto}}
    v = consent_verdict(path=write_config(tmp_path, cfg))
    assert v.allowed and v.context["max_per_day"] is None
    db = make_queue_db(tmp_path, [authorised(1)], [(1, cv, 0, None, None)])
    _applied_by_closer(db, range(100, 140), cv)  # 40 already sent today
    q = queue(tmp_path, db, cfg)
    assert q["ready"], q
    assert (q["max_per_day"], q["remaining_today"], q["sent_today"]) == (None, None, 40)
    cap = daily_cap_verdict(config_path=write_config(tmp_path, cfg), db_path=db)
    assert cap.allowed and (cap.context["max_per_day"], cap.context["remaining_today"]) == (None, None)


def test_un_tetto_configurato_resta_un_muro(tmp_path):
    cv = cv_file(tmp_path)
    cfg = {**CONSENT_ON, "applications": {"auto_apply": {"enabled": True, "max_per_day": 5}}}
    db = make_queue_db(tmp_path, [authorised(1)], [(1, cv, 0, None, None)])
    _applied_by_closer(db, range(100, 104), cv)
    q = queue(tmp_path, db, cfg)
    assert q["ready"] and (q["max_per_day"], q["remaining_today"]) == (5, 1)
    _applied_by_closer(db, [104], cv)
    q = queue(tmp_path, db, cfg)
    assert (q["ready"], q["reason"], q["remaining_today"]) == (False, "daily_cap_reached", 0)
    assert not daily_cap_verdict(config_path=write_config(tmp_path, cfg), db_path=db).allowed


def test_tetto_non_valido_chiude_anche_coda_e_prenotazione(tmp_path):
    import apply_gate

    cv = cv_file(tmp_path)
    cfg = {**CONSENT_ON, "applications": {"auto_apply": {"enabled": True, "max_per_day": "abc"}}}
    db = make_queue_db(tmp_path, [authorised(1)], [(1, cv, 0, None, None)])
    q = queue(tmp_path, db, cfg)
    assert (q["ready"], q["reason"], q["positions"]) == (False, "consent_cap_invalid", [])
    slot = apply_gate.reserve_daily_slot(1, "email", config_path=write_config(tmp_path, cfg), db_path=db)
    assert (slot.allowed, slot.reason) == (False, "consent_cap_invalid")


# ── un CV bocciato chiede da solo di essere rifatto (application_rework, HQ-BACKEND-2) ──


@pytest.fixture
def rework_box(tmp_path, layout_check_on):
    import _db

    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    cv = tmp_path / "cv-1.pdf"
    cv.write_bytes(b"%PDF-1.4 squeezed")
    conn.execute(
        "INSERT INTO positions (id, title, company, url, status, apply_requested, apply_requested_at, apply_requested_by) "
        "VALUES (1, 'Synthetic role', 'Synthetic company', ?, 'ready', 1, ?, 'user_web')",
        (URL, ASKED),
    )
    conn.execute("INSERT INTO applications (position_id, cv_path, cv_pdf_path, applied) VALUES (1, '/synthetic/cv.md', ?, 0)", (str(cv),))
    conn.commit()
    conn.close()
    return tmp_path, str(db), cv, layout_check_on


def _flag(db):
    conn = sqlite3.connect(db)
    try:
        return conn.execute("SELECT write_requested, write_request_kind FROM positions WHERE id = 1").fetchone()
    finally:
        conn.close()


def test_un_cv_bocciato_accende_la_richiesta_allo_scrittore_una_volta(rework_box):
    home, db, cv, mp = rework_box
    mp.setattr(pdf_layout_check, "analyze", lambda path, **_: {"ok": b"full width" in Path(path).read_bytes(), "reasons": []})
    mp.setattr(pdf_layout_check, "render_preview", lambda pdf, png: png.write_bytes(b"png") and png)

    q = queue(home, db)
    assert q["held"] == [{"position_id": 1, "reason": "cv_pdf_layout_bad"}]
    assert q["cv_rework"] == [{"position_id": 1, "status": "requested", "reason": "cv_pdf_layout_bad"}]
    assert _flag(db) == (1, "cv")
    assert queue(home, db)["cv_rework"][0]["status"] == "already_requested"

    cv.write_bytes(b"%PDF-1.4 full width")  # the Scrittore renders it again
    q = queue(home, db)
    assert q["ready"] and "cv_rework" not in q


def test_nessuna_richiesta_se_il_controllo_non_e_disponibile(rework_box):
    home, db, _cv, mp = rework_box
    mp.setattr(pdf_layout_check, "analyze", lambda _p, **_: (_ for _ in ()).throw(pdf_layout_check.CheckError("no poppler")))
    q = queue(home, db)
    assert q["held"] == [{"position_id": 1, "reason": "cv_pdf_check_unavailable"}]
    assert "cv_rework" not in q and _flag(db)[0] == 0


def test_mai_una_richiesta_su_una_candidatura_con_invio_iniziato(rework_box):
    home, db, _cv, mp = rework_box
    mp.setattr(pdf_layout_check, "analyze", lambda _p, **_: {"ok": False, "reasons": ["narrow_text"]})
    p = checkpoint_path(1, home)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"position_id": 1, "state": "submit", "submit_started": True, "updated_at": ASKED}))
    q = queue(home, db)
    assert q["cv_rework"] == [{"position_id": 1, "status": "not_needed", "reason": "submit_started"}]
    assert _flag(db)[0] == 0


def test_senza_il_modulo_la_trattenuta_resta_e_niente_si_rompe(rework_box):
    home, db, _cv, mp = rework_box
    mp.setattr(pdf_layout_check, "analyze", lambda _p, **_: {"ok": False, "reasons": ["narrow_text"]})
    mp.setitem(sys.modules, "application_rework", None)
    mp.setitem(sys.modules, "shared.skills.application_rework", None)
    q = queue(home, db)
    assert q["held"] == [{"position_id": 1, "reason": "cv_pdf_layout_bad"}]
    assert q["cv_rework"] == [{"position_id": 1, "status": "not_needed", "reason": "cv_rework_unavailable"}]
    assert _flag(db)[0] == 0


def test_la_richiesta_automatica_non_e_mai_manuale(rework_box):
    # The queue saw a bad layout, then the check became unmeasurable before the
    # request re-read it: only a manual request may go on without a measure.
    home, db, _cv, mp = rework_box
    calls = []

    def analyze(_p, **_):
        calls.append(1)
        if len(calls) == 1:
            return {"ok": False, "reasons": ["narrow_text"]}
        raise pdf_layout_check.CheckError("poppler gone")

    mp.setattr(pdf_layout_check, "analyze", analyze)
    mp.setattr(pdf_layout_check, "render_preview", lambda pdf, png: png.write_bytes(b"png") and png)
    q = queue(home, db)
    assert q["cv_rework"] == [{"position_id": 1, "status": "not_needed", "reason": "cv_pdf_check_unavailable"}]
    assert _flag(db)[0] == 0
