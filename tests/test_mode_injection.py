"""Test dell'iniezione della modalità nel messaggio periodico ([MODE-INJECTION-HOURLY-PROMPT]).

Origine: 2026-07-30. L'11/07 l'utente mette un team in manutenzione
(`stop_search: true`); il 12/07 l'ordine è vivo (uno spawn Scout risulta
soppresso citandolo); il 13/07, dopo un refresh di contesto, l'ordine sparisce —
e per **18 giorni** il team lavora in modalità normale, 183 posizioni sorgente e
weekly al 100% due volte, finché l'utente non lo riemette a mano il 29/07.
Le tre difese esistenti dipendevano tutte da qualcuno che si ricordasse di
LEGGERE: C-18 (obbligo di prompt, cancellato dal refresh), la bacheca
`team_directives` (vuota), il `[RESUME]` del Dottore (che è un agente e può
saltare il giro).

Mappa sui sei test di accettazione del ticket
`docs/internal/roadmap/2026-07-30-ticket-mode-injection-hourly-prompt.md` — il
comportamento completo richiederebbe un container, un provider e tmux; qui si
verifica la logica dietro le cuciture (come test_team_standby/test_stepcap_watchdog):

  1. Sopravvive al refresh → un modulo bridge caricato FRESCO (= respawn, stato
                             azzerato) rimette la sezione nel primo battito, e
                             il `[RESUME]` del Dottore la rilegge da disco.
  2. Il file vince        → la sezione dichiara `care` (dal 2026-08-03 il
                             valore legacy `maintenance` è canonicalizzato,
                             restando visibile nel banner) e chiude con «vince
                             questa»; e il bridge smette di ORDINARE lo spawn
                             Scout che contraddirebbe `stop_search`.
  3. Cambio a caldo       → riscrivendo il JSON fra due battiti, il secondo
                             messaggio porta i valori nuovi (lettura da disco,
                             nessun riavvio).
  4. `search` esplicito   → senza file di manutenzione la sezione c'è e dice
                             `MODE: search`; mai assente, in nessun ramo.
  5. Bacheca inclusa      → una direttiva scritta dal vero `team_directives.py`
                             compare nell'iniezione successiva.
  6. Regressione 18 gg    → 432 battiti (18 giorni) con l'ordine attivo: la
                             sezione c'è in TUTTI, e lo spawn Scout non viene
                             mai ordinato.

Eseguire:
    pytest tests/test_mode_injection.py -v
"""

import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
LAUNCHER_DIR = REPO_ROOT / ".launcher"
SKILL_DIR = REPO_ROOT / "agents" / "_skills" / "session-refresh"

T0 = datetime(2026, 7, 11, 9, 0, tzinfo=timezone.utc)   # il giorno dell'ordine


def _load(name: str, path: Path):
    """Import per path (i nomi con `-` non sono importabili normalmente)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _src(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _fresh_mode_banner(tag="mode_banner_under_test"):
    return _load(tag, SKILLS_DIR / "mode_banner.py")


# ── Fixture: una home usa-e-getta + un bridge caricato FRESCO ─────────────

@pytest.fixture
def home(tmp_path, monkeypatch):
    """`JHT_HOME` su una directory temporanea.

    `mode_banner` risolve i suoi path a OGNI chiamata da questa env var (è il
    seam del ticket: nessun path e nessuno stato cachato), quindi basta questa.
    `JHT_DB` viene tolta perché vincerebbe su `JHT_HOME` e punterebbe il DB
    dell'installazione di chi lancia i test.
    """
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_DB", raising=False)
    (tmp_path / "logs").mkdir(parents=True, exist_ok=True)
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    return tmp_path


@pytest.fixture
def mb(home):
    return _fresh_mode_banner()


def set_mode(home, orders=None, mode="maintenance"):
    """Scrive `profile/capitano-maintenance.json` nella forma REALE del file —
    quella che scrive la Console del Coordinatore del gioco (vps_backend.gd)."""
    payload = {"mode": mode}
    if orders is not None:
        payload["orders"] = orders
    path = home / "profile" / "capitano-maintenance.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    return path


def add_directive(home, body, kind="order"):
    """Aggiunge una direttiva col VERO scrittore della bacheca: così il test
    non ricopia lo schema e prova che il bridge legge quello che l'utente
    scrive davvero (`team_directives.py`, single-writer)."""
    env = dict(os.environ)
    env["JHT_HOME"] = str(home)
    env.pop("JHT_DB", None)
    r = subprocess.run(
        [sys.executable, "team_directives.py", "add", body, "--kind", kind,
         "--by", "user"],
        cwd=str(SKILLS_DIR), env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


class Bridge:
    """Un `heartbeat-bridge` caricato fresco, con tmux/DB/send neutralizzati.

    Caricarlo fresco NON è un dettaglio: le sue costanti di path si risolvono
    all'import, e un modulo nuovo è anche il modello del respawn (test 1/6).
    """

    def __init__(self, home, tag="heartbeat_under_test", sessions=()):
        self.home = home
        self.mod = _load(tag, LAUNCHER_DIR / "heartbeat-bridge.py")
        self.sent = []
        self.sessions = list(sessions)
        self.state = {"weekly": 40, "usage5h": 10, "status": "steady",
                      "work_phase": "ON", "q_analista": 0, "q_scorer": 0,
                      "tickets_open": 0, "top": None}
        m = self.mod
        m.gather_state = lambda: dict(self.state)
        m._live_sessions = lambda: list(self.sessions)
        m._send = self._send

    def _send(self, msg):
        self.sent.append(msg)
        return True

    def tick(self, now):
        self.mod.tick(now, send=True)
        return self.sent[-1] if self.sent else None

    def hourly(self, start, hours):
        """`hours` battiti consecutivi allo scoccare dell'ora. Ritorna la lista
        di (ora, messaggio-o-None) così un silenzio è ispezionabile."""
        out = []
        for i in range(hours):
            t = start + timedelta(hours=i)
            before = len(self.sent)
            self.mod.tick(t, send=True)
            out.append((t, self.sent[-1] if len(self.sent) > before else None))
        return out


MAINT_ORDERS = {
    "stop_search": True,
    "discard_expired_rotating": True,
    "cv_min_score": 90,
    "pre_check_liveness_for_cv": True,
}


# ── Invarianti della sezione (il cuore del ticket) ────────────────────────

def test_la_sezione_non_e_mai_vuota_e_chiude_dichiarando_chi_vince(mb):
    """Le due regole non negoziabili, su ogni combinazione di stato."""
    for setup in (lambda: None,
                  lambda: set_mode(mb._home(), MAINT_ORDERS),
                  lambda: set_mode(mb._home(), {}, mode="maintenance"),
                  lambda: set_mode(mb._home(), MAINT_ORDERS, mode="strano")):
        setup()
        text = mb.banner()
        assert text.startswith(mb.HEADER)
        assert text.endswith(mb.FOOTER)
        assert "THIS SECTION WINS" in text
        assert "MODE:" in text


def test_la_sezione_e_una_riga_sola(mb):
    """`jht-tmux-send` fa `tmux send-keys -l`: un newline verrebbe digitato come
    Enter e il messaggio partirebbe a metà."""
    set_mode(mb._home(), dict(MAINT_ORDERS, note="riga\ncon\nnewline"))
    add_directive(mb._home(), "prima riga\nseconda riga")
    one = mb.line()
    assert "\n" not in one and "\r" not in one
    # La forma multi-riga esiste per un umano, e resta multi-riga.
    assert "\n" in mb.banner(multiline=True)


def test_un_file_illeggibile_non_diventa_modalita_normale(mb):
    """Il caso peggiore dell'ambiguità silenzio=default: se il file c'è ma non
    si legge, dire `normal` cancellerebbe un ordine dell'utente."""
    (mb._home() / "profile" / "capitano-maintenance.json").write_text(
        "{questo non è JSON", encoding="utf-8")
    snap = mb.snapshot()
    assert snap["mode"] == mb.MODE_UNKNOWN
    assert snap["maintenance_exists"] and not snap["maintenance_readable"]
    text = mb.banner(snap=snap)
    assert "MODE: unknown" in text and "ACTIVE ORDER" in text
    assert mb.has_standing_orders(snap) is True


def test_gli_ordini_scritti_a_mano_arrivano_comunque(mb):
    """Il file lo scrive anche l'operatore: una chiave che il codice non conosce
    (`search_priority`, le priorità, le esclusioni) resta un ordine da riferire,
    non da nascondere."""
    set_mode(mb._home(), {
        "stop_search": False,
        "search_priority": "secondary",
        "priorita": ["recheck vive score>=70", "geocoding uffici", "logo"],
        "esclusioni": "solo se la posizione è certamente morta",
    })
    text = mb.banner()
    assert "search_priority: secondary" in text
    assert "geocoding uffici" in text
    assert "esclusioni: solo se la posizione è certamente morta" in text
    # Le chiavi note portano la loro CONSEGUENZA, non solo il valore.
    assert "stop_search: false" in text and "remaining budget" in text


def test_una_bacheca_non_leggibile_non_e_una_bacheca_vuota(mb):
    """Nessun jobs.db → «non leggibili». Dire "nessuna" senza aver potuto
    guardare è la bugia che questo modulo esiste per non raccontare."""
    assert not (mb._home() / "jobs.db").exists()
    snap = mb.snapshot()
    assert snap["directives_readable"] is False
    assert "unreadable" in mb.banner(snap=snap)


def test_i_freni_attivi_finiscono_nella_sezione(mb):
    (mb._home() / "logs" / "daily-halt.flag").write_text("x", encoding="utf-8")
    (mb._home() / ".team-halted.flag").write_text("x", encoding="utf-8")
    text = mb.banner()
    assert "ACTIVE BRAKES:" in text
    assert "daily-halt" in text and "team-halted" in text
    # Un freno NON è un ordine dell'utente: non basta a rompere il silenzio.
    assert mb.has_standing_orders() is False


def test_la_deroga_di_spesa_si_legge_dal_modulo_esistente(mb):
    """La scadenza di `.burn-intent.flag` ha UNA sola implementazione
    (`burn_intent.status`): qui si verifica che venga riusata, non ricopiata."""
    bi = _load("burn_intent_ref", SKILLS_DIR / "burn_intent.py")
    bi.INTENT_FLAG = mb._home() / ".burn-intent.flag"
    bi.AUDIT_LOG = mb._home() / "logs" / "burn-intent.jsonl"
    bi.grant(hours=2, reason="test")
    assert any(f["name"] == "burn-intent" for f in mb.read_flags())
    bi.revoke()
    assert not any(f["name"] == "burn-intent" for f in mb.read_flags())


# ── Accettazione 1 — sopravvive al refresh ───────────────────────────────

def test_1_un_bridge_appena_nato_rimette_l_ordine_nel_primo_battito(home):
    """La sessione del Capitano è stata ricreata (contesto pulito) e anche il
    bridge è nuovo: nessuno ha stato in memoria, e l'ordine arriva comunque —
    entro un battito, senza interventi umani."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, tag="heartbeat_reborn", sessions=["CAPITANO", "ANALISTA-1"])
    msg = b.tick(T0 + timedelta(days=2, hours=3))
    assert msg is not None, "il primo battito dopo il refresh non ha detto nulla"
    assert "MODE: care" in msg
    assert "THIS SECTION WINS" in msg


def test_1b_il_resume_del_dottore_porta_la_stessa_sezione_in_7_lingue():
    """Doppio canale: il bridge copre il tempo, il `[RESUME]` copre l'istante
    del refresh. E la skill esiste in 7 lingue: se la sezione entra solo
    nell'italiano, sei team su sette restano scoperti."""
    for path in sorted(SKILL_DIR.glob("SKILL*.md")):
        src = _src(path)
        assert "mode_banner.py line" in src, f"{path.name} non legge la modalità"
        # Letta da disco NEL momento del resume, e accodata al messaggio.
        assert '"$ROLE" = "capitano"' in src, f"{path.name}: non è per il Capitano"
        assert "$MODE\"" in src, f"{path.name}: la sezione non entra nel [RESUME]"
    assert len(list(SKILL_DIR.glob("SKILL*.md"))) == 7


def test_1c_i_worker_non_ricevono_l_iniezione():
    """Per costruzione: nel resume la sezione è dietro il gate sul ruolo, e il
    bridge parla solo al Capitano."""
    src = _src(SKILL_DIR / "SKILL.md")
    guard = src.index('if [ "$ROLE" = "capitano" ]')
    assert guard < src.index("$MODE\"")
    hb = _src(LAUNCHER_DIR / "heartbeat-bridge.py")
    assert 'TARGET = os.environ.get("JHT_HEARTBEAT_SESSION", "CAPITANO")' in hb


# ── Accettazione 2 — il file vince sul contesto ──────────────────────────

def test_2_il_file_vince_e_lo_dice(home):
    """Il Capitano ha un contesto che dice «modalità normale»; il file dice
    manutenzione. Il messaggio deve dichiarare la modalità E l'ordine di
    precedenza — altrimenti il Capitano risolve il conflitto a favore di quello
    che ha in testa, che è esattamente quello che è successo il 13/07."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, sessions=["CAPITANO", "ANALISTA-1"])
    msg = b.tick(T0)
    assert "MODE: care" in msg
    assert "NO Scouts" in msg
    assert "cv_min_score: 90" in msg
    assert msg.rstrip().endswith(
        "files are the source of truth, and a context refresh may have cleared "
        "your context.")


def test_2b_senza_modalita_il_bridge_ordina_lo_spawn_scout(home):
    """Il comportamento storico, invariato: nessuno Scout attivo = sourcing
    fermo → ORDINE di spawn (C-05). È il ramo che il test 2c deve spegnere."""
    b = Bridge(home, sessions=["CAPITANO", "ANALISTA-1"])
    msg = b.tick(T0)
    assert "il sourcing è FERMO" in msg and "spawna 1 Scout ORA" in msg
    assert "MODE: search" in msg


def test_2c_in_stop_search_il_bridge_non_ordina_piu_uno_spawn_scout(home):
    """Il conflitto che rendeva il fix a metà: un processo deterministico che
    ORDINA uno spawn Scout mentre la sezione, nello stesso messaggio, dice
    `stop_search: true`. In manutenzione la coda `new` vuota è lo stato VOLUTO
    (C-18 sospende C-05/C-05c), quindi l'ordine non parte."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, sessions=["CAPITANO", "ANALISTA-1"])
    msg = b.tick(T0)
    assert "spawna 1 Scout" not in msg
    assert "il sourcing è FERMO" not in msg
    assert "MODE: care" in msg


def test_2d_un_file_illeggibile_non_autorizza_lo_spawn(home):
    """Direzione sicura: se il file c'è ma non si legge, potrebbe dire
    `stop_search` — non si ordina uno spawn al buio, e la sezione dice di
    aprirlo."""
    (home / "profile" / "capitano-maintenance.json").write_text(
        "{rotto", encoding="utf-8")
    b = Bridge(home, sessions=["CAPITANO"])
    msg = b.tick(T0)
    assert "spawna 1 Scout" not in msg
    assert "MODE: unknown" in msg


def test_2e_con_stop_search_false_il_sourcing_resta_governato(home):
    """`stop_search: false` in manutenzione (il caso reale del 29/07) non
    sospende C-05: il sourcing è consentito col budget che avanza."""
    set_mode(home, {"stop_search": False, "search_priority": "secondary"})
    b = Bridge(home, sessions=["CAPITANO"])
    msg = b.tick(T0)
    assert "spawna 1 Scout ORA" in msg
    assert "search_priority: secondary" in msg


# ── Accettazione 3 — cambio a caldo ─────────────────────────────────────

def test_3_cambio_a_caldo_senza_riavviare_il_bridge(home):
    """La lettura è da disco a OGNI invio: riscrivere il JSON fra due battiti
    deve bastare. Se il bridge cachasse, un ordine revocato resterebbe in vigore
    fino al respawn."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, sessions=["CAPITANO", "ANALISTA-1"])
    first = b.tick(T0)
    assert "cv_min_score: 90" in first and "MODE: care" in first

    set_mode(home, {"stop_search": False, "cv_min_score": 75})
    second = b.tick(T0 + timedelta(hours=1))
    assert "cv_min_score: 75" in second and "cv_min_score: 90" not in second

    # Revoca: il file sparisce → il battito successivo dice `normal`, esplicito.
    (home / "profile" / "capitano-maintenance.json").unlink()
    third = b.tick(T0 + timedelta(hours=2))
    assert "MODE: search" in third


def test_3b_il_bridge_cacha_il_modulo_mai_lo_stato():
    """Sorgente: la sezione si compone dentro `tick`, e `_mode_section` rilegge
    a ogni giro. Il solo oggetto cachato è il MODULO (un exec per processo) —
    stesso patto di `_burn_intent_active` / `_standby_active`."""
    src = _src(LAUNCHER_DIR / "heartbeat-bridge.py")
    fn = src[src.index("def _mode_section"):]
    fn = fn[:fn.index("\ndef ")]
    assert "mod.snapshot()" in fn, "la sezione non viene ricomposta da disco"
    tick = src[src.index("def tick("):]
    assert "_mode_section()" in tick[:tick.index("\ndef ")]
    # Il banner non finisce nello stato persistito (sarebbe una cache).
    persisted = src[src.index("def _write_state"):]
    assert "banner" not in persisted[:persisted.index("\ndef ")]


# ── Accettazione 4 — `normal` esplicito, mai assente ────────────────────

def test_4_normal_si_inietta_uguale(home):
    """Senza file di manutenzione la sezione c'è e dice `normal`: l'assenza
    della sezione deve poter significare solo «bridge rotto»."""
    b = Bridge(home, sessions=["CAPITANO", "SCOUT-1"])
    msg = b.tick(T0)
    assert msg is not None
    assert "MODE: search" in msg and "THIS SECTION WINS" in msg


def test_4b_la_sezione_e_in_coda_a_ogni_ramo_del_nudge(home):
    """Ticket utente, sourcing fermo, worker caldo, backlog, rotazione: la
    sezione non dipende dal tema scelto."""
    cases = [
        ({"tickets_open": 2}, ["CAPITANO", "SCOUT-1"]),
        ({}, ["CAPITANO"]),                                    # sourcing fermo
        ({"top": ("SCOUT-1", 80, 0.0)}, ["CAPITANO", "SCOUT-1"]),
        ({"q_analista": 40}, ["CAPITANO", "SCOUT-1"]),
        ({}, ["CAPITANO", "SCOUT-1"]),                         # rotazione
    ]
    for i, (patch, sessions) in enumerate(cases):
        b = Bridge(home, tag=f"heartbeat_branch_{i}", sessions=sessions)
        b.state.update(patch)
        msg = b.tick(T0)          # 09:00 → hour%3 == 0, la rotazione parla
        assert msg is not None, f"caso {i}: nessun messaggio"
        assert "MODE: search" in msg, f"caso {i}: sezione assente"
        assert msg.rstrip().endswith("cleared your context."), f"caso {i}"


def test_4c_a_modalita_normale_l_ora_di_silenzio_resta_silenzio(home):
    """Il costo non cresce senza motivo: senza ordini in vigore la rotazione
    tace come prima (un'ora su tre)."""
    b = Bridge(home, sessions=["CAPITANO", "SCOUT-1"])
    silent = [t for t, m in b.hourly(T0.replace(hour=0), 24) if m is None]
    assert silent, "il battito non tace più nemmeno a modalità normale"


def test_4d_con_un_ordine_in_vigore_l_ora_di_silenzio_salta(home):
    """Il rovescio: un promemoria che non parte non è un promemoria. Con un
    ordine attivo il buco di silenzio non esiste, quindi «al peggio si perde
    per un'ora» è vero."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, sessions=["CAPITANO", "ANALISTA-1"])
    rounds = b.hourly(T0.replace(hour=0), 24)
    assert all(m is not None for _, m in rounds)
    assert all("MODE: care" in m for _, m in rounds)


def test_4e_i_gate_del_battito_restano_intatti(home):
    """La sezione non è una scusa per parlare a team fermo: standby, daily-halt
    e off-hours tacciono come prima (in standby parlare costa un turno di
    modello mentre il team è fermo di proposito)."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, sessions=["CAPITANO"])
    (home / "logs" / "daily-halt.flag").write_text("x", encoding="utf-8")
    b.tick(T0)
    assert b.sent == []
    (home / "logs" / "daily-halt.flag").unlink()
    (home / "logs" / "pacing-bridge-state.json").write_text(
        json.dumps({"work_phase": "OFF"}), encoding="utf-8")
    b.tick(T0)
    assert b.sent == []


def test_4f_un_mode_banner_non_caricabile_e_un_guasto_scritto(home, capsys):
    """Se il modulo non si carica la sezione manca — e allora il log deve dirlo:
    l'assenza della sezione significa «bridge rotto», e va potuto dimostrare."""
    b = Bridge(home, sessions=["CAPITANO", "SCOUT-1"])
    b.mod._mode_banner_mod = lambda: None
    msg = b.tick(T0)
    assert "MODALITÀ CORRENTE" not in msg
    assert "mode_banner non caricabile" in capsys.readouterr().out


# ── Accettazione 5 — la bacheca entra nell'iniezione ────────────────────

def test_5_una_direttiva_in_bacheca_compare_nell_iniezione_successiva(home):
    """La bacheca era la «fonte di verità da rileggere» e nessuno la leggeva.
    Ora la legge un processo."""
    b = Bridge(home, sessions=["CAPITANO", "SCOUT-1"])
    first = b.tick(T0)
    assert "ACTIVE DIRECTIVES" in first

    add_directive(home, "CV solo per posizioni 90+", kind="order")
    add_directive(home, "modalità mantenimento finché non dico il contrario",
                  kind="strategy")
    second = b.tick(T0 + timedelta(hours=1))
    assert "CV solo per posizioni 90+" in second
    assert "modalità mantenimento" in second
    assert "ACTIVE DIRECTIVES (2)" in second


def test_5b_una_direttiva_archiviata_esce_dall_iniezione(home, mb):
    add_directive(home, "vecchio ordine da ritirare")
    assert "vecchio ordine da ritirare" in mb.banner()
    env = dict(os.environ)
    env["JHT_HOME"] = str(home)
    env.pop("JHT_DB", None)
    r = subprocess.run([sys.executable, "team_directives.py", "archive", "1"],
                       cwd=str(SKILLS_DIR), env=env, capture_output=True,
                       text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "vecchio ordine da ritirare" not in mb.banner()
    assert "ACTIVE DIRECTIVES: none" in mb.banner()


def test_5c_una_bacheca_da_ordini_basta_a_rompere_il_silenzio(home):
    """Anche a modalità normale, una direttiva è un ordine dell'utente: se la
    rotazione tacesse, resterebbe in un file che nessuno legge."""
    add_directive(home, "niente CV questa settimana")
    b = Bridge(home, sessions=["CAPITANO", "SCOUT-1"])
    rounds = b.hourly(T0.replace(hour=0), 12)
    assert all(m is not None for _, m in rounds)
    assert all("niente CV questa settimana" in m for _, m in rounds)


def test_5d_la_bacheca_non_fa_crescere_il_messaggio_senza_limite(home, mb):
    """Il messaggio viene DIGITATO in una TUI: la sezione resta corta e dichiara
    quante direttive ha lasciato fuori."""
    for i in range(mb.MAX_DIRECTIVES + 3):
        add_directive(home, f"direttiva numero {i} " + "x" * 400)
    text = mb.banner()
    assert "(+3 on the board)" in text
    assert text.count("direttiva numero") == mb.MAX_DIRECTIVES
    assert "…" in text          # i corpi lunghi sono troncati


# ── Accettazione 6 — la regressione dei 18 giorni ───────────────────────

def test_6_diciotto_giorni_di_battiti_non_perdono_l_ordine(home):
    """Rigioca l'incidente: ordine l'11/07, refresh del contesto il 13/07, poi
    18 giorni. Ogni battito riporta l'ordine, e in nessuno di essi il bridge
    ordina lo spawn Scout — che è il verbo con cui i 18 giorni si sono
    materializzati (52 posizioni nuove il 13-14/07)."""
    set_mode(home, MAINT_ORDERS)

    # 11-12/07: l'ordine è vivo, il team lavora in manutenzione.
    b = Bridge(home, tag="heartbeat_before_refresh",
               sessions=["CAPITANO", "ANALISTA-1"])
    day1 = b.hourly(T0, 24)
    assert all(m is None or "MODE: care" in m for _, m in day1)

    # 13/07: refresh del contesto. Il Capitano riparte da zero e il bridge
    # stesso viene respawnato — nessuno dei due ricorda niente.
    after = Bridge(home, tag="heartbeat_after_refresh",
                   sessions=["CAPITANO", "ANALISTA-1"])
    rounds = after.hourly(T0 + timedelta(days=2), 18 * 24)

    assert len(rounds) == 432
    missing = [t for t, m in rounds if m is None]
    assert missing == [], f"{len(missing)} battiti muti: l'ordine si perde"
    without = [t for t, m in rounds if "MODE: care" not in m]
    assert without == [], f"{len(without)} battiti senza l'ordine"
    ordered_scout = [t for t, m in rounds if "spawna 1 Scout" in m]
    assert ordered_scout == [], (
        f"lo spawn Scout è stato ordinato {len(ordered_scout)} volte in "
        f"manutenzione: è così che sono nate le 183 posizioni")
    # E ogni singolo messaggio porta l'ordine di precedenza, non solo il primo.
    assert all(m.rstrip().endswith("cleared your context.") for _, m in rounds)


def test_6b_revocare_l_ordine_a_giorni_di_distanza_vale_subito(home):
    """L'altra metà della regressione: quando l'utente toglie la manutenzione,
    il team non deve restare in manutenzione per altri 18 giorni."""
    set_mode(home, MAINT_ORDERS)
    b = Bridge(home, sessions=["CAPITANO", "ANALISTA-1"])
    b.hourly(T0, 48)
    assert "MODE: care" in b.sent[-1]
    (home / "profile" / "capitano-maintenance.json").unlink()
    b.tick(T0 + timedelta(hours=48))
    assert "MODE: search" in b.sent[-1]
