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


@pytest.mark.parametrize("cap", [0, -1, True, "3", 1.5, None])
def test_a_tetto_non_valido_chiude(tmp_path, cap):
    """Un tetto assente o assurdo non è un tetto.

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
