"""Test del watchdog che riprende gli agenti fermi sul cap di step.

Copre i sei test di accettazione del ticket
`docs/internal/roadmap/2026-07-28-ticket-stepcap-throttle-resume.md`:

  1. rilevazione entro due giri;
  2. nessun falso positivo (marcatore nello scrollback / pane in movimento);
  3. il throttle è rispettato (fra `throttled` e `resumed` passa `throttle_sec`);
  4. la ripresa funziona davvero (il pane cambia hash entro un giro);
  5. backoff — quattro stalli consecutivi finiscono in `escalated`, senza un
     quarto `resumed`;
  6. gate — con `.team-halted.flag` uno stallo produce `detected` ma mai `resumed`.

Il watchdog gira su tmux, ma la sua logica è isolata dietro tre seam
(`list_sessions`, `capture_pane`, `send_resume`): i test guidano un orologio
esplicito e un pane finto, quindi un giro da 60s si verifica in millisecondi.
Il TRASPORTO (buffer tmux, mai `send-keys` col testo inline) ha un test suo che
registra l'argv passato a tmux.

Eseguire:
    pytest tests/test_stepcap_watchdog.py -v
"""

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_watchdog():
    path = REPO_ROOT / ".launcher" / "stepcap-watchdog.py"
    spec = importlib.util.spec_from_file_location("stepcap_watchdog", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_throttle_config():
    path = REPO_ROOT / "shared" / "skills" / "throttle-config.py"
    spec = importlib.util.spec_from_file_location("throttle_config_ref", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


wd = _load_watchdog()
throttle_config = _load_throttle_config()

# Un martedì a mezzogiorno UTC: orario "dentro finestra" per il team 24/7 di
# default, e fuori dalla finestra 00:00-00:01 usata dal test del gate orario.
T0 = datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc).timestamp()

CAP_MARKER = "Max number of steps reached"


def stall_pane(tag="1"):
    """Pane di un agente fermo sul cap: il marcatore è in fondo."""
    return (
        "> sto cercando offerte (giro %s)\n"
        "  tool: web_search ...\n"
        "\n"
        "Max number of steps reached: 100\n"
        "Send another message to continue where it left off.\n"
        "\n"
        "╭──────────────────────────────────────────╮\n"
        "│ >                                        │\n"
        "╰──────────────────────────────────────────╯\n" % tag
    )


class FakeTmux:
    """Sessioni tmux finte: pane in memoria + registrazione delle riprese."""

    def __init__(self, sessions, resume_moves_pane=True):
        self.panes = dict(sessions)
        self.created = {name: "1000" for name in sessions}
        self.resumes = []
        self.resume_moves_pane = resume_moves_pane

    def install(self, monkeypatch):
        monkeypatch.setattr(wd, "list_sessions",
                            lambda: [(n, self.created[n]) for n in self.panes])
        monkeypatch.setattr(wd, "capture_pane", lambda s: self.panes.get(s))
        monkeypatch.setattr(wd, "send_resume", self._send)
        return self

    def _send(self, session, agent, message):
        self.resumes.append({"session": session, "agent": agent, "msg": message})
        if self.resume_moves_pane:
            # Una ripresa che entra davvero muove il pane: l'agente riparte.
            self.panes[session] += "\n> [DA @SISTEMA] ripresa #%d\n" % len(self.resumes)
        return True


@pytest.fixture
def home(tmp_path, monkeypatch):
    """JHT_HOME isolato + i punti che toccherebbero la macchina neutralizzati."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_STEPCAP_MARKERS", raising=False)
    # I moduli condivisi sono cachati dopo il primo import (in produzione
    # JHT_HOME non cambia mai); qui ogni test ha una home diversa, e
    # `throttle-config.py` risolve il path del config all'import.
    wd._MODULE_CACHE.clear()
    # Tetto RAM: fuori dal container non è misurabile in modo utile.
    monkeypatch.setattr(wd, "_host_agent_cap", lambda: None)
    # Nessun DB → produzione non misurabile: il contatore non si azzera mai da
    # solo, che è la condizione peggiore (e quella che vogliamo testare).
    monkeypatch.setattr(wd, "produced_count", lambda agent: None)
    monkeypatch.setattr(wd, "notify_captain", lambda msg: CAPTAIN_MSGS.append(msg) or True)
    CAPTAIN_MSGS.clear()
    # Un heartbeat per giro renderebbe illeggibili le asserzioni sugli eventi.
    monkeypatch.setattr(wd, "HEARTBEAT_SEC", 10 ** 9)
    monkeypatch.setattr(wd, "MARKER_TAIL_LINES", 10)
    return tmp_path


CAPTAIN_MSGS = []


def events(kind=None):
    """Eventi dal log. Senza argomenti esclude il `heartbeat` (che è rumore di
    fondo voluto: serve a dire che il watchdog è vivo, non che è successo
    qualcosa). `events("heartbeat")` lo chiede esplicitamente."""
    path = wd.event_log_path()
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if kind is None and rec.get("event") == "heartbeat":
            continue
        if kind is None or rec.get("event") == kind:
            out.append(rec)
    return out


def drive_to_stall(fake, start, pane=None):
    """Due giri identici = stallo confermato. Ritorna il tempo del 2° giro."""
    if pane is not None:
        for name in fake.panes:
            fake.panes[name] = pane
    wd.tick(now=start)
    wd.tick(now=start + 60)
    return start + 60


# ── Test 1 — rilevazione ─────────────────────────────────────────────────
def test_1_detected_entro_due_giri(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)

    wd.tick(now=T0)
    assert events("detected") == [], "un solo giro non basta: serve un hash da confrontare"

    wd.tick(now=T0 + 60)
    detected = events("detected")
    assert len(detected) == 1
    assert detected[0]["agent"] == "scout-3"
    assert detected[0]["session"] == "SCOUT-3"
    assert detected[0]["marker"] == CAP_MARKER
    assert detected[0]["consecutive"] == 1
    assert fake.resumes == [], "la ripresa arriva DOPO il throttle, non subito"


def test_1b_lo_stallo_e_seguito_dal_throttle(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    drive_to_stall(fake, T0)

    throttled = events("throttled")
    assert len(throttled) == 1
    assert throttled[0]["throttle_sec"] in throttle_config.THROTTLE_LADDER

    state = json.loads((home / "state" / "throttle-scout-3.json").read_text())
    assert set(state) == {"agent", "id", "until", "started", "applied_sec"}, \
        "il formato è quello di agents/_tools/jht-throttle, non uno nuovo"
    assert state["agent"] == "scout-3"
    assert state["id"].startswith("stepcap-")
    assert state["until"] - state["started"] == state["applied_sec"]
    assert state["applied_sec"] == throttled[0]["throttle_sec"]


# ── Test 1c — lo stallo SENZA marcatore ──────────────────────────────────
# Il 2026-07-30 quattro VPS riportavano `stalled: 0` in contemporanea mentre i
# loro worker erano fermi da ore: la rilevazione richiedeva un marcatore, e i
# marcatori esistono solo per Kimi. Turno abortito su 429, riga appesa nel
# composer, attesa di una sveglia soppressa — nessuno di questi stampa niente.
IDLE_PANE = (
    "● Coda vuota. Resto in attesa del prossimo batch.\n"
    "\n"
    "╭──────────────────────────────────────────╮\n"
    "│ >                                        │\n"
    "╰──────────────────────────────────────────╯\n"
)


def test_1c_pane_immobile_senza_marcatore_e_uno_stallo(home, monkeypatch):
    """Nessun marcatore, ma il pane non si muove per IDLE_STALL_ROUNDS giri."""
    monkeypatch.setattr(wd, "IDLE_STALL_ROUNDS", 5)
    fake = FakeTmux({"SCORER-2": IDLE_PANE}).install(monkeypatch)
    for i in range(5):
        wd.tick(now=T0 + i * 60)
        assert events("detected") == [], "scattato al giro %d, troppo presto" % i
    wd.tick(now=T0 + 5 * 60)
    det = events("detected")
    assert len(det) == 1
    assert "immobile" in det[0]["marker"]


def test_1d_il_pane_che_si_muove_azzera_il_contatore(home, monkeypatch):
    """Una riga nuova a metà strada rimette il conteggio a zero: sta lavorando."""
    monkeypatch.setattr(wd, "IDLE_STALL_ROUNDS", 5)
    fake = FakeTmux({"SCORER-2": IDLE_PANE}).install(monkeypatch)
    for i in range(4):
        wd.tick(now=T0 + i * 60)
    fake.panes["SCORER-2"] += "● preso #918 dalla coda\n"
    for i in range(4, 9):
        wd.tick(now=T0 + i * 60)
    assert events("detected") == []


def test_1e_fuori_finestra_limmobilita_non_e_uno_stallo(home, monkeypatch):
    """Con un halt attivo il fermo è l'ordine, non il guasto: nessun detected."""
    monkeypatch.setattr(wd, "IDLE_STALL_ROUNDS", 3)
    (home / "logs").mkdir(parents=True, exist_ok=True)
    (home / "logs" / "daily-halt.flag").write_text("{}", encoding="utf-8")
    FakeTmux({"SCORER-2": IDLE_PANE}).install(monkeypatch)
    for i in range(8):
        wd.tick(now=T0 + i * 60)
    assert events("detected") == []


# ── Test 2 — nessun falso positivo ───────────────────────────────────────
def test_2a_agente_che_lavora_non_genera_eventi(home, monkeypatch):
    """Il marcatore c'è (ciclo precedente) ma il pane si muove: sta lavorando."""
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    for i in range(6):
        fake.panes["SCOUT-3"] += "  tool: fetch(%d) ...\n" % i
        wd.tick(now=T0 + i * 60)
    assert events() == []


def test_2b_marcatore_solo_nello_scrollback_non_basta(home, monkeypatch):
    """Pane IMMOBILE ma marcatore fuori dalle ultime righe non vuote.

    È il caso descritto nel ticket: il marcatore resta nello scrollback anche
    dopo la ripresa. Trovarlo non basta — deve essere in coda.
    """
    pane = stall_pane() + "".join("  riga di lavoro %d\n" % i for i in range(14))
    FakeTmux({"SCOUT-3": pane}).install(monkeypatch)
    wd.tick(now=T0)
    wd.tick(now=T0 + 60)
    wd.tick(now=T0 + 120)
    assert events() == []


def test_2c_dopo_la_ripresa_il_marcatore_resta_nello_scrollback(home, monkeypatch):
    """Il caso del ticket: agente RIPARTITO, marcatore ancora visibile in coda.

    Se bastasse trovarlo, ogni giro successivo alla ripresa genererebbe un
    nuovo nudge — un watchdog trasformato in generatore di burn.
    """
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)                       # resumed
    assert len(fake.resumes) == 1

    # L'agente lavora: il pane si muove, ma il marcatore è ancora lì sopra —
    # dentro la finestra di coda, cioè proprio dove la sola ricerca del testo
    # lo troverebbe.
    for i in range(3):
        fake.panes["SCOUT-3"] += "  tool: fetch(%d) ...\n" % i
        wd.tick(now=t + sec + (i + 1) * 60)
        assert wd.find_marker(wd.pane_tail(fake.panes["SCOUT-3"])) == CAP_MARKER

    assert len(events("detected")) == 1, "nessuna nuova rilevazione dopo la ripresa"
    assert len(fake.resumes) == 1, "nessun secondo nudge"
    assert events("resume_failed") == []


def test_2d_i_core_non_si_nudgeano_mai(home, monkeypatch):
    fake = FakeTmux({"CAPITANO": stall_pane(), "SENTINELLA": stall_pane(),
                     "DOTTORE": stall_pane()}).install(monkeypatch)
    for i in range(4):
        wd.tick(now=T0 + i * 60)
    assert events() == []
    assert fake.resumes == []


# ── Test 3 — il throttle è rispettato ────────────────────────────────────
def test_3_fra_throttled_e_resumed_passa_il_throttle(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    t = drive_to_stall(fake, T0)
    throttled = events("throttled")[0]
    sec = throttled["throttle_sec"]

    wd.tick(now=t + sec - 1)
    assert events("resumed") == [], "ripresa in anticipo sulla scadenza"
    assert fake.resumes == []

    wd.tick(now=t + sec)
    resumed = events("resumed")
    assert len(resumed) == 1
    assert resumed[0]["ts"] - throttled["ts"] >= sec
    assert len(fake.resumes) == 1


def test_3b_il_throttle_parte_dal_rung_corrente_dellagente(home, monkeypatch):
    """La durata viene dalla ladder, partendo dal gradino corrente in config."""
    (home / "config").mkdir(parents=True, exist_ok=True)
    (home / "config" / "throttle.json").write_text(
        json.dumps({"default": 0, "scout-3": 660}), encoding="utf-8")
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    drive_to_stall(fake, T0)
    assert events("throttled")[0]["throttle_sec"] == 660

    ladder = throttle_config.THROTTLE_LADDER
    assert wd.throttle_for("scout-3", 2) == ladder[ladder.index(660) + 1]
    assert wd.throttle_for("scout-3", 3) == ladder[ladder.index(660) + 2]
    # Il tetto della ladder non si sfonda.
    assert wd.throttle_for("scout-3", 99) == ladder[-1]


# ── Test 4 — la ripresa funziona davvero ─────────────────────────────────
def test_4_dopo_resumed_il_pane_cambia_hash(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)
    wd.tick(now=t + sec + 60)      # giro di verifica
    assert events("resume_failed") == []
    assert fake.resumes[0]["session"] == "SCOUT-3"
    assert "Continua da dove ti eri fermato" in fake.resumes[0]["msg"]
    assert "passa al successivo della coda" in fake.resumes[0]["msg"], \
        "senza la seconda frase l'agente riprende lo stesso ramo che l'ha bloccato"
    assert fake.resumes[0]["msg"].startswith("[DA @SISTEMA A @SCOUT-3]")


def test_4b_una_ripresa_che_non_entra_viene_detta(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane()},
                    resume_moves_pane=False).install(monkeypatch)
    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)
    wd.tick(now=t + sec + 60)
    assert len(events("resume_failed")) == 1, \
        "un paste che non entra deve essere visibile nel log, non silenzioso"


def test_4c_il_messaggio_passa_dai_buffer_tmux_non_da_send_keys(home, monkeypatch):
    """Il trasporto: file + load-buffer + paste-buffer. `send-keys` porta solo
    l'Enter — col testo inline il quoting salterebbe al primo apice."""
    calls = []

    def fake_tmux(*args, **kwargs):
        calls.append(args)
        return ""

    monkeypatch.setattr(wd, "_tmux", fake_tmux)
    monkeypatch.setenv("JHT_STEPCAP_PASTE_SETTLE", "0")
    message = "[DA @SISTEMA A @SCOUT-3] Continua: l'ultimo task è \"fermo\"; chiudilo."

    assert wd.send_resume("SCOUT-3", "scout-3", message) is True

    verbs = [c[0] for c in calls]
    assert "load-buffer" in verbs and "paste-buffer" in verbs
    for call in calls:
        if call[0] == "send-keys":
            assert message not in call, "il testo non deve MAI passare da send-keys"
            assert call[-1] in ("Enter", "C-s")
    buffer_file = home / "state" / "stepcap-msg-scout-3.txt"
    assert buffer_file.read_text(encoding="utf-8") == message


# ── Test 5 — backoff ─────────────────────────────────────────────────────
def test_5_quattro_stalli_consecutivi_finiscono_in_escalated(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane("1")}).install(monkeypatch)
    now = T0
    for round_no in range(1, 5):
        # Ogni stallo ha un pane diverso dal precedente (l'agente ha ripreso e
        # si è rifermato): il confronto di hash resta significativo.
        now = drive_to_stall(fake, now, pane=stall_pane(str(round_no)))
        if round_no == 4:
            break
        sec = events("throttled")[-1]["throttle_sec"]
        now = now + sec
        wd.tick(now=now)            # resumed
        now += 60
        wd.tick(now=now)            # verifica post-ripresa
        now += 60

    detected = events("detected")
    assert [d["consecutive"] for d in detected] == [1, 2, 3, 4]

    durations = [t["throttle_sec"] for t in events("throttled")]
    assert len(durations) == 3, "al quarto stallo non si applica più un throttle"
    assert durations == sorted(durations) and len(set(durations)) == 3, \
        "ogni stallo sale di un gradino della ladder"
    ladder = throttle_config.THROTTLE_LADDER
    assert all(d in ladder for d in durations)

    assert len(events("resumed")) == 3, "nessun quarto resumed"
    assert len(fake.resumes) == 3
    escalated = events("escalated")
    assert len(escalated) == 1 and escalated[0]["consecutive"] == 4
    assert any("NON lo riprendo più" in m for m in CAPTAIN_MSGS), \
        "l'escalation deve arrivare al Capitano, non solo al log"
    assert sum(1 for m in CAPTAIN_MSGS if "scout-3" in m) == 2, \
        "un avviso al 3° stallo (segnale) + uno al 4° (escalation)"

    # Dopo l'escalation il watchdog non tocca più l'agente.
    wd.tick(now=now + 60)
    wd.tick(now=now + 120)
    assert len(events("resumed")) == 3
    assert len(events("escalated")) == 1


def test_5b_il_contatore_si_azzera_solo_se_lagente_produce(home, monkeypatch):
    produced = {"n": 4}
    monkeypatch.setattr(wd, "produced_count", lambda agent: produced["n"])
    fake = FakeTmux({"SCOUT-3": stall_pane("1")}).install(monkeypatch)

    now = drive_to_stall(fake, T0, pane=stall_pane("1"))
    assert events("detected")[-1]["consecutive"] == 1

    # Secondo stallo SENZA produzione: il contatore sale.
    sec = events("throttled")[-1]["throttle_sec"]
    now += sec
    wd.tick(now=now)
    now += 60
    wd.tick(now=now)
    now = drive_to_stall(fake, now + 60, pane=stall_pane("2"))
    assert events("detected")[-1]["consecutive"] == 2

    # Terzo stallo DOPO una riga prodotta: riparte da 1.
    produced["n"] = 5
    sec = events("throttled")[-1]["throttle_sec"]
    now += sec
    wd.tick(now=now)
    now += 60
    wd.tick(now=now)
    now = drive_to_stall(fake, now + 60, pane=stall_pane("3"))
    assert events("detected")[-1]["consecutive"] == 1, \
        "produrre azzera il contatore; ripartire e rifermarsi no"


def test_5c_un_respawn_azzera_il_contatore(home, monkeypatch):
    fake = FakeTmux({"SCOUT-3": stall_pane("1")}).install(monkeypatch)
    now = drive_to_stall(fake, T0)
    sec = events("throttled")[-1]["throttle_sec"]
    wd.tick(now=now + sec)
    wd.tick(now=now + sec + 60)

    # Il Capitano respawna l'agente: sessione nuova, altra istanza.
    fake.created["SCOUT-3"] = "2000"
    now = drive_to_stall(fake, now + sec + 120, pane=stall_pane("2"))
    assert events("detected")[-1]["consecutive"] == 1


# ── Test 6 — gate ────────────────────────────────────────────────────────
@pytest.mark.parametrize("flag", [".team-halted.flag", "logs/daily-halt.flag",
                                  ".weekly-halt.flag"])
def test_6_con_un_halt_si_rileva_ma_non_si_riprende(home, monkeypatch, flag):
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    path = home / flag
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("halt", encoding="utf-8")

    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)
    wd.tick(now=t + sec + wd.GATE_RETRY_SEC)

    assert len(events("detected")) == 1
    assert events("resumed") == []
    assert fake.resumes == []
    gated = events("gated")
    assert gated and gated[0]["gate"] in ("team-halted", "daily-halt", "weekly-halt")


def test_6b_fuori_dalle_working_hours_non_si_riprende(home, monkeypatch):
    (home / "jht.config.json").write_text(json.dumps({
        "team": {"working_hours": {
            "timezone": "UTC",
            "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                         "start": "00:00", "end": "00:01"}],
        }}
    }), encoding="utf-8")
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)

    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)

    assert len(events("detected")) == 1
    assert events("resumed") == []
    assert events("gated")[0]["gate"] == "off-hours"


def test_6c_il_gate_non_e_una_rinuncia_alla_scadenza_si_riprende(home, monkeypatch):
    """Tolto l'halt, la ripresa avviene al ricontrollo successivo."""
    fake = FakeTmux({"SCOUT-3": stall_pane()}).install(monkeypatch)
    flag = home / ".team-halted.flag"
    flag.write_text("halt", encoding="utf-8")

    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)
    assert events("resumed") == []

    flag.unlink()
    wd.tick(now=t + sec + wd.GATE_RETRY_SEC)
    assert len(events("resumed")) == 1


def test_6d_il_tetto_di_sessioni_saturo_blocca_la_ripresa(home, monkeypatch):
    monkeypatch.setattr(wd, "_host_agent_cap", lambda: 1)
    fake = FakeTmux({"SCOUT-3": stall_pane(), "ANALISTA-1": "> lavoro\n",
                     "SCORER-1": "> lavoro\n"}).install(monkeypatch)
    t = drive_to_stall(fake, T0)
    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)
    assert events("resumed") == []
    assert events("gated")[0]["gate"] == "session-cap"


# ── Marcatori per provider ───────────────────────────────────────────────
def test_marcatori_estendibili_per_provider_senza_toccare_il_codice(home, monkeypatch):
    (home / "config").mkdir(parents=True, exist_ok=True)
    (home / "config" / "stepcap-markers.txt").write_text(
        "# marcatore osservato su un altro provider\n"
        "Step budget exhausted for this turn\n", encoding="utf-8")
    pane = ("> lavoro\n"
            "Step budget exhausted for this turn\n"
            "> \n")
    fake = FakeTmux({"ANALISTA-2": pane}).install(monkeypatch)
    drive_to_stall(fake, T0)
    detected = events("detected")
    assert len(detected) == 1
    assert detected[0]["marker"] == "Step budget exhausted for this turn"


def test_la_tabella_dei_marcatori_e_per_provider(home):
    assert "kimi" in wd.STEP_CAP_MARKERS
    assert CAP_MARKER in wd.STEP_CAP_MARKERS["kimi"]
    assert CAP_MARKER in wd.markers()


# ── Osservabilità: il log deve poter dire se il watchdog è vivo ──────────
def test_il_battito_tiene_fresco_il_log_anche_senza_stalli(home, monkeypatch):
    monkeypatch.setattr(wd, "HEARTBEAT_SEC", 900)
    FakeTmux({"SCOUT-3": "> lavoro normale\n"}).install(monkeypatch)

    wd.tick(now=T0)
    beats = events("heartbeat")
    assert len(beats) == 1 and beats[0]["watched"] == 1

    wd.tick(now=T0 + 60)
    assert len(events("heartbeat")) == 1, "un battito ogni HEARTBEAT_SEC, non a ogni giro"

    wd.tick(now=T0 + 901)
    assert len(events("heartbeat")) == 2


def test_health_distingue_watchdog_vivo_da_watchdog_fermo(home, monkeypatch):
    monkeypatch.setattr(wd, "MAX_LOG_AGE_SEC", 2700)
    assert wd.health(now=T0)["ok"] is False, "file assente = mai scritto"
    assert wd.health(now=T0)["exists"] is False

    monkeypatch.setattr(wd, "HEARTBEAT_SEC", 900)
    FakeTmux({"SCOUT-3": "> lavoro\n"}).install(monkeypatch)
    wd.tick(now=T0)

    fresh = wd.health(now=T0 + 60)
    assert fresh["ok"] is True and fresh["last_event"] == "heartbeat"

    stale = wd.health(now=T0 + 4000)
    assert stale["ok"] is False
    assert "processo vivo ma funzione ferma" in stale["reason"]


def test_health_cli_esce_1_quando_il_log_e_stantio(home, monkeypatch, capsys):
    assert wd.main(["--health"]) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is False


# ── Sessioni sorvegliate ─────────────────────────────────────────────────
@pytest.mark.parametrize("name,expected", [
    ("SCOUT-3", True), ("ANALISTA-1", True), ("SCORER-2", True),
    ("SCRITTORE-1", True), ("CRITICO-S12", True), ("scout-10", True),
    ("CAPITANO", False), ("SENTINELLA", False), ("SENTINELLA-WORKER", False),
    ("ASSISTENTE", False), ("MENTOR", False), ("DOTTORE", False),
    ("DOCTOR-WATCHDOG", False), ("MANTENITORE", False), ("bash", False),
])
def test_solo_i_worker_sono_sorvegliati(name, expected):
    assert wd.is_worker_session(name) is expected
