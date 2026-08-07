"""Test dello standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]).

Origine: 2026-07-29. Con tutti e cinque i worker a `throttle=3600s` e zero
posizioni prodotte, il weekly è salito da 98% a 100% in un'ora (~2 punti/ora a
pipeline ferma) e il team è rimasto bloccato quattro giorni e mezzo. La spesa
residua erano i ruoli CORE e i tre bridge; le skill esistenti (`freeze_team`,
`soft_pause_team`) escludono esattamente quei ruoli. Lo standby li ferma tutti
SENZA perdere la sveglia: i bridge continuano a leggere la quota (gratis) e
smettono di parlare.

Mappa sui sette test di accettazione del ticket
`docs/internal/roadmap/2026-07-29-ticket-team-standby-zero-spend.md` — il
comportamento completo richiederebbe un container, un provider e tmux; qui si
verifica la logica dietro i seam (come test_burn_intent/test_stepcap_watchdog):

  1. Spesa azzerata      → ogni sorgente di turni LLM è gatata: send dei tre
                           bridge (funzionale+sorgente), watchdog agenti,
                           dottore, stepcap.
  2. Niente tmux         → il chokepoint jht_tmux_send del sentinel rifiuta
                           senza nemmeno invocare tmux; heartbeat ritorna
                           prima di gather_state; pacing salta il tick.
  3. Campionamento vivo  → il gate del sentinel sta SOLO nel chokepoint di
                           scrittura: il path fetch→write_jsonl non consulta
                           lo standby (asserzioni sul sorgente).
  4. Risveglio           → wake_on.weekly_below: sotto soglia il flag va via e
                           [RIPRENDI] parte verso TUTTE le sessioni entro il
                           tick stesso.
  5. Crash del bridge    → lo stato vive nel flag: un modulo bridge caricato
                           FRESCO (= respawn) riprende il ruolo di sveglia.
  6. Ordine flag/msg     → il recorder di send asserisce che il flag è GIÀ
                           stato rimosso quando parte il primo [RIPRENDI].
  7. `halted` vince      → con .team-halted.flag l'uscita rimuove il flag di
                           standby ma NON manda nessun [RIPRENDI].

Eseguire:
    pytest tests/test_team_standby.py -v
"""

import importlib.util
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
LAUNCHER_DIR = REPO_ROOT / ".launcher"
CLI_DIR = REPO_ROOT / "cli" / "src"

sys.path.insert(0, str(SKILLS_DIR))
import standby as sb_module            # noqa: E402
import soft_pause_team as sp_module    # noqa: E402


def _load(name: str, path: Path):
    """Import per path (i nomi con `-` non sono importabili normalmente)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _src(path: Path) -> str:
    return path.read_text(encoding="utf-8")


T0 = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)

# Il sentinel-bridge si carica UNA volta (import pesante ma idempotente:
# mkdir logs, loader di format_time/bridge_message). I test che simulano il
# respawn ne caricano una seconda istanza fresca.
sentinel = _load("sentinel_bridge_under_test", LAUNCHER_DIR / "sentinel-bridge.py")
heartbeat = _load("heartbeat_bridge_under_test", LAUNCHER_DIR / "heartbeat-bridge.py")
pacing = _load("pacing_bridge_under_test", LAUNCHER_DIR / "pacing-bridge.py")
stepcap = _load("stepcap_watchdog_under_test", LAUNCHER_DIR / "stepcap-watchdog.py")


@pytest.fixture
def sb(tmp_path, monkeypatch):
    """`standby` puntato a una home usa-e-getta, con send/tmux neutralizzati.

    I path sono costanti di modulo risolte all'import: si riassegnano qui
    (stesso schema della fixture `bi` di test_burn_intent). `_send` e
    `_list_sessions` sono sostituiti da recorder: il PRIMO asserisce anche
    l'ordine obbligato del risveglio (flag GIÀ rimosso quando si parla).
    """
    sb_module.STANDBY_FLAG = tmp_path / ".team-standby.flag"
    sb_module.STANDBY_LOG = tmp_path / "logs" / "standby.jsonl"
    sb_module.HALTED_FLAG = tmp_path / ".team-halted.flag"
    sb_module.SENTINEL_JSONL = tmp_path / "logs" / "sentinel-data.jsonl"
    sb_module._SENT = []            # recorder condiviso coi test

    def fake_send(session, message):
        assert not sb_module.STANDBY_FLAG.exists(), (
            "ordine violato: [RIPRENDI] inviato col flag di standby ancora "
            "presente — il watchdog risilenzierebbe gli agenti appena svegli")
        sb_module._SENT.append((session, message))
        return True

    monkeypatch.setattr(sb_module, "_send", fake_send)
    monkeypatch.setattr(
        sb_module, "_list_sessions",
        lambda: ["CAPITANO", "ASSISTENTE", "SENTINELLA", "SENTINELLA-WORKER",
                 "DOCTOR-WATCHDOG", "SCOUT-1", "ANALISTA-1"])
    return sb_module


def _events(sb):
    if not sb.STANDBY_LOG.exists():
        return []
    return [json.loads(l) for l in
            sb.STANDBY_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]


# ── Lifecycle del flag (stesso precedente di .burn-intent.flag) ──────────

def test_enter_requires_an_exit_condition(sb):
    """Uno standby senza condizione di uscita non si scrive."""
    with pytest.raises(ValueError):
        sb.enter(reason="weekly esaurito", now=T0)
    assert not sb.STANDBY_FLAG.exists()


def test_cli_on_without_exit_condition_refuses(sb, capsys):
    rc = sb.main(["on", "--reason", "weekly esaurito"])
    assert rc != 0
    assert not sb.STANDBY_FLAG.exists()
    assert "condizione di uscita" in capsys.readouterr().err


def test_enter_with_wake_on_weekly(sb):
    payload = sb.enter(reason="weekly quota exhausted",
                       wake_on_weekly=100, now=T0)
    assert payload["wake_on"] == {"weekly_below": 100.0}
    assert payload["since"] == int(T0.timestamp())
    assert sb.is_active(now=T0) is True
    assert sb.status(now=T0)["state"] == "active"


def test_enter_with_until_expires_on_its_own(sb):
    """`until` passato → i lettori NON restano muti anche se chi doveva
    rimuovere il flag è morto: la sveglia resta pendente, il silenzio no."""
    sb.enter(reason="pausa notturna", until=(T0 + timedelta(hours=8)), now=T0)
    assert sb.is_active(now=T0 + timedelta(hours=7)) is True
    assert sb.is_active(now=T0 + timedelta(hours=9)) is False
    assert sb.status(now=T0 + timedelta(hours=9))["state"] == "expired"


def test_enter_refuses_an_until_in_the_past(sb):
    with pytest.raises(ValueError):
        sb.enter(until=(T0 - timedelta(hours=1)), now=T0)


def test_malformed_flag_is_not_a_standby(sb):
    sb.STANDBY_FLAG.parent.mkdir(parents=True, exist_ok=True)
    sb.STANDBY_FLAG.write_text("questo non è JSON", encoding="utf-8")
    assert sb.is_active(now=T0) is False
    assert sb.status(now=T0)["state"] == "invalid"


def test_flag_without_exit_condition_is_not_honored(sb):
    """Il flag scritto a mano senza until/wake_on è il file dimenticato-acceso:
    non vale come standby (fail-closed nella direzione di burn_intent)."""
    sb.STANDBY_FLAG.parent.mkdir(parents=True, exist_ok=True)
    sb.STANDBY_FLAG.write_text(json.dumps({"since": 1, "reason": "x"}),
                               encoding="utf-8")
    assert sb.is_active(now=T0) is False
    assert sb.status(now=T0)["state"] == "invalid"


# ── Risveglio (test di accettazione 4, 6, 7) ─────────────────────────────

def test_should_wake_on_weekly_below(sb):
    sb.enter(wake_on_weekly=100, now=T0)
    assert sb.should_wake(weekly_usage=100, now=T0) == (False, None)
    wake, why = sb.should_wake(weekly_usage=97, now=T0)
    assert wake is True and "97" in why
    # Senza il dato la condizione non è verificabile: niente sveglia al buio.
    assert sb.should_wake(weekly_usage=None, now=T0) == (False, None)


def test_should_wake_on_until(sb):
    sb.enter(until=(T0 + timedelta(hours=2)), now=T0)
    assert sb.should_wake(now=T0 + timedelta(hours=1))[0] is False
    wake, why = sb.should_wake(now=T0 + timedelta(hours=3))
    assert wake is True and "until" in why


def test_wake_removes_flag_before_any_message(sb):
    """Accettazione 6: l'ordine è flag via, POI [RIPRENDI] — l'asserzione vive
    nel recorder di `_send` (fixture), che esplode se l'ordine è invertito."""
    sb.enter(wake_on_weekly=100, now=T0)
    res = sb.wake("weekly 97% sotto la soglia 100%", weekly_usage=97, now=T0)
    assert res["removed"] is True and res["halted"] is False
    assert not sb.STANDBY_FLAG.exists()
    assert res["resumed"] == len(sb._SENT) == 5   # 7 sessioni − 2 NEVER_MESSAGE


def test_wake_reaches_the_core_roles_with_riprendi(sb):
    """Accettazione 4: il [RIPRENDI] arriva a TUTTI i ruoli, core inclusi —
    ma mai alle sessioni che non sono agenti LLM in chat."""
    sb.enter(wake_on_weekly=100, now=T0)
    sb.wake("reset weekly", weekly_usage=3, now=T0)
    sessions = {s for s, _ in sb._SENT}
    assert {"CAPITANO", "ASSISTENTE", "SENTINELLA", "SCOUT-1"} <= sessions
    assert "SENTINELLA-WORKER" not in sessions
    assert "DOCTOR-WATCHDOG" not in sessions
    assert all("[RIPRENDI]" in m for _, m in sb._SENT)


def test_wake_with_halted_does_not_restart_the_team(sb):
    """Accettazione 7: lo stop dell'utente vince — flag di standby rimosso,
    nessun [RIPRENDI], e l'esito resta scritto nel log."""
    sb.enter(wake_on_weekly=100, now=T0)
    sb.HALTED_FLAG.write_text("", encoding="utf-8")
    res = sb.wake("reset weekly", weekly_usage=3, now=T0)
    assert res["removed"] is True and res["halted"] is True
    assert res["resumed"] == 0 and sb._SENT == []
    assert not sb.STANDBY_FLAG.exists()
    exits = [e for e in _events(sb) if e["event"] == "exit"]
    assert exits and exits[-1]["halted"] is True


def test_wake_without_flag_is_a_noop(sb):
    res = sb.wake("niente da fare", now=T0)
    assert res["removed"] is False and sb._SENT == []
    assert _events(sb) == []


def test_standby_uses_its_own_flag_not_halted(sb):
    """Semantiche diverse, file diversi: lo standby non tocca .team-halted."""
    assert sb.STANDBY_FLAG.name == ".team-standby.flag"
    assert sb.HALTED_FLAG.name == ".team-halted.flag"
    sb.enter(wake_on_weekly=100, now=T0)
    assert not sb.HALTED_FLAG.exists()


# ── Osservabilità: logs/standby.jsonl ────────────────────────────────────

def test_transitions_are_logged(sb, monkeypatch):
    monkeypatch.setattr(sb, "_load_sibling", lambda n, f: None)  # no tmux reale
    sb.activate(reason="weekly quota exhausted", wake_on_weekly=100)
    sb.wake("weekly 42% sotto la soglia 100%", weekly_usage=42, now=T0)
    events = [e["event"] for e in _events(sb)]
    assert events == ["enter", "exit"]
    exit_rec = _events(sb)[-1]
    assert exit_rec["weekly_usage"] == 42
    assert isinstance(exit_rec["standby_s"], int)
    assert exit_rec["agents_resumed"] == 5


def test_activate_writes_the_flag_before_pausing(sb, monkeypatch):
    """Ordine di INGRESSO: flag prima, pausa poi — fra i due un tick di bridge
    non deve poter svegliare nessuno (il flag li ha già zittiti)."""
    order = []

    class FakeSoftPause:
        @staticmethod
        def pause_all(include_core=False, reason=""):
            assert sb.STANDBY_FLAG.exists(), (
                "pausa partita PRIMA del flag: un tick fra i due passi "
                "rimetterebbe in moto il team")
            order.append(("pause", include_core))
            return (["CAPITANO", "SENTINELLA", "SCOUT-1"], [])

    monkeypatch.setattr(sb, "_load_sibling", lambda n, f: FakeSoftPause)
    res = sb.activate(reason="weekly quota exhausted", wake_on_weekly=100)
    assert order == [("pause", True)]      # core INCLUSI, mai freeze
    assert res["agents_paused"] == ["CAPITANO", "SENTINELLA", "SCOUT-1"]
    enter_rec = [e for e in _events(sb) if e["event"] == "enter"][-1]
    assert enter_rec["agents_paused"] == 3


# ── soft_pause_team --include-core ───────────────────────────────────────

def test_soft_pause_default_behavior_unchanged(monkeypatch):
    """La forma storica (FATAL usage) resta byte-identica: stessi esclusi,
    stessi testi."""
    sent = []
    monkeypatch.setattr(sp_module, "list_sessions",
                        lambda: ["CAPITANO", "ASSISTENTE", "SENTINELLA",
                                 "SENTINELLA-WORKER", "SCOUT-1"])
    monkeypatch.setattr(sp_module, "send_message",
                        lambda s, m: sent.append((s, m)) or True)
    paused, skipped = sp_module.pause_all()
    assert set(paused) == {"CAPITANO", "SCOUT-1"}
    assert set(skipped) == {"SENTINELLA", "ASSISTENTE", "SENTINELLA-WORKER"}
    by_session = dict(sent)
    assert "Monitoraggio usage rotto" in by_session["SCOUT-1"]
    assert "[PAUSA TEAM]" in by_session["CAPITANO"]


def test_soft_pause_include_core_reaches_the_spenders(monkeypatch):
    """--include-core: la pausa arriva ai ruoli che SPENDONO (i core), con i
    testi dello standby; restano fuori solo le sessioni non-LLM."""
    sent = []
    monkeypatch.setattr(sp_module, "list_sessions",
                        lambda: ["CAPITANO", "ASSISTENTE", "SENTINELLA",
                                 "SENTINELLA-WORKER", "DOCTOR-WATCHDOG",
                                 "SCOUT-1"])
    monkeypatch.setattr(sp_module, "send_message",
                        lambda s, m: sent.append((s, m)) or True)
    paused, skipped = sp_module.pause_all(include_core=True, reason="weekly al muro")
    assert set(paused) == {"CAPITANO", "ASSISTENTE", "SENTINELLA", "SCOUT-1"}
    assert set(skipped) == {"SENTINELLA-WORKER", "DOCTOR-WATCHDOG"}
    by_session = dict(sent)
    for msg in by_session.values():
        assert "[STANDBY]" in msg and "[RIPRENDI]" in msg
        assert "weekly al muro" in msg
    # La Sentinella deve sapere che il silenzio dei bridge NON è un guasto.
    assert "NON è un guasto" in by_session["SENTINELLA"]
    assert "NON fare fallback" in by_session["SENTINELLA"]


def test_never_message_sets_are_in_sync():
    """standby.py e soft_pause_team.py devono concordare su chi non è un
    agente LLM in chat (documentazione eseguibile, come NEVER_YIELDS)."""
    assert sb_module.NEVER_MESSAGE == sp_module.NEVER_MESSAGE


# ── Sentinel-bridge: tace, campiona, sveglia (accettazione 1-5) ──────────

@pytest.fixture
def bridge(sb):
    sentinel._STANDBY_MOD = sb
    yield sentinel
    sentinel._STANDBY_MOD = None


class _NoTmux:
    """Un `subprocess` che ESPLODE se toccato: prova che il send non parte."""
    @staticmethod
    def run(*a, **k):
        raise AssertionError("subprocess invocato durante lo standby")


def test_sentinel_send_chokepoint_refuses_in_standby(bridge, sb, monkeypatch):
    """Accettazione 2: in standby jht_tmux_send rifiuta senza nemmeno
    invocare tmux — nessun pane riceve input dal bridge."""
    sb.enter(wake_on_weekly=100, now=T0)
    monkeypatch.setattr(bridge, "subprocess", _NoTmux)
    assert bridge.jht_tmux_send("SENTINELLA", "[BRIDGE TICK] x") is False
    assert bridge.jht_tmux_send("CAPITANO", "[HEARTBEAT] x") is False


def test_sentinel_send_reopens_after_wake(bridge, sb, monkeypatch):
    class OkRun:
        returncode = 0

    monkeypatch.setattr(bridge, "subprocess",
                        type("S", (), {"run": staticmethod(lambda *a, **k: OkRun())}))
    sb.enter(wake_on_weekly=100, now=T0)
    assert bridge.jht_tmux_send("SENTINELLA", "x") is False
    sb.wake("reset", weekly_usage=1, now=T0)     # flag via → guard aperto
    assert bridge.jht_tmux_send("SENTINELLA", "x") is True


def test_sentinel_wake_step_wakes_within_one_tick(bridge, sb):
    """Accettazione 4: al primo tick col weekly sotto soglia il flag va via e
    il [RIPRENDI] parte — entro il tick stesso, non a quello dopo."""
    sb.enter(wake_on_weekly=100, now=T0)
    bridge._standby_step({"weekly_usage": 100})
    assert sb.STANDBY_FLAG.exists() and sb._SENT == []
    bridge._standby_step({"weekly_usage": 97})
    assert not sb.STANDBY_FLAG.exists()
    assert {s for s, _ in sb._SENT} >= {"CAPITANO", "SENTINELLA", "SCOUT-1"}
    checks = [e for e in _events(sb) if e["event"] == "wake_check"]
    assert [c["wake"] for c in checks] == [False, True]
    assert checks[0]["weekly_usage"] == 100


def test_sentinel_wake_step_survives_a_bridge_respawn(sb):
    """Accettazione 5: lo stato vive nel flag, non nel processo. Un modulo
    caricato FRESCO (= bridge respawnato dall'agent-watchdog) resta in standby
    e conserva la funzione di sveglia."""
    sb.enter(wake_on_weekly=100, now=T0)
    reborn = _load("sentinel_bridge_reborn", LAUNCHER_DIR / "sentinel-bridge.py")
    reborn._STANDBY_MOD = sb
    reborn._standby_step({"weekly_usage": 100})   # ancora sopra soglia
    assert sb.STANDBY_FLAG.exists(), "il respawn ha annullato lo standby"
    assert reborn._standby_active() is True
    reborn._standby_step({"weekly_usage": 42})    # quota tornata
    assert not sb.STANDBY_FLAG.exists()
    assert any("[RIPRENDI]" in m for _, m in sb._SENT)


def test_sentinel_wake_step_respects_halted(bridge, sb):
    """Accettazione 7 dal lato bridge: condizione soddisfatta + halted →
    flag via, zero messaggi."""
    sb.enter(wake_on_weekly=100, now=T0)
    sb.HALTED_FLAG.write_text("", encoding="utf-8")
    bridge._standby_step({"weekly_usage": 3})
    assert not sb.STANDBY_FLAG.exists()
    assert sb._SENT == []


def test_sentinel_removes_an_invalid_flag(bridge, sb):
    """Un flag senza condizione di uscita non resta lì a confondere stepcap e
    watchdog (che guardano l'esistenza): il bridge, proprietario del lifecycle,
    lo rimuove e lo scrive nel log."""
    sb.STANDBY_FLAG.parent.mkdir(parents=True, exist_ok=True)
    sb.STANDBY_FLAG.write_text(json.dumps({"since": 1}), encoding="utf-8")
    bridge._standby_step({"weekly_usage": 100})
    assert not sb.STANDBY_FLAG.exists()
    exits = [e for e in _events(sb) if e["event"] == "exit"]
    assert exits and "invalid" in exits[-1]["reason"]


def test_sentinel_sampling_is_not_gated_by_standby():
    """Accettazione 3, sul sorgente: il silenzio vive SOLO nel chokepoint
    jht_tmux_send; il path fetch→write_jsonl non consulta lo standby, quindi
    sentinel-data.jsonl continua a crescere per costruzione."""
    src = _src(LAUNCHER_DIR / "sentinel-bridge.py")
    fn = src[src.index("def jht_tmux_send"):]
    fn = fn[:fn.index("\ndef ")]
    assert "_standby_active()" in fn, "guard assente dal chokepoint tmux"
    body = src[src.index("        if parsed:"):src.index("write_jsonl(entry)")]
    assert "standby" not in body, (
        "il path del campionamento non deve dipendere dallo standby")


def test_sentinel_evaluates_the_wake_even_on_failed_fetch():
    """`until` non ha bisogno del weekly: la sveglia si valuta anche quando il
    fetch fallisce (il wake step sta PRIMA del ramo `if parsed:`)."""
    src = _src(LAUNCHER_DIR / "sentinel-bridge.py")
    assert src.index("_standby_step(parsed)") < src.index("        if parsed:")


# ── Pacing e heartbeat: sospensione totale, senza deroghe ────────────────

def test_pacing_standby_active_reads_the_flag(sb):
    pacing._STANDBY_MOD = sb
    try:
        assert pacing._standby_active() is False
        sb.enter(wake_on_weekly=100, now=T0)
        assert pacing._standby_active() is True
    finally:
        pacing._STANDBY_MOD = None


def test_pacing_skips_the_tick_before_any_other_gate():
    """Sorgente: il gate standby sta in testa al tick, PRIMA della lettura di
    burn-intent — e non è derogabile (`burn_intent` non compare nel ramo)."""
    src = _src(LAUNCHER_DIR / "pacing-bridge.py")
    gate = src.index("if _standby_active():")
    assert gate < src.index("burn_intent_on = _burn_intent_active()")
    branch = src[gate:src.index("continue", gate)]
    assert "burn_intent" not in branch
    assert "compute_tick" not in branch


def test_heartbeat_suppressed_in_standby_even_with_burn_intent(sb, monkeypatch):
    """Accettazione 1-2 lato heartbeat: in standby il battito non parte MAI —
    nemmeno con la deroga di spesa attiva (lo standby non è un automatismo di
    spesa: a weekly esaurito la deroga economica non compra niente)."""
    heartbeat._STANDBY_MOD = sb
    try:
        sb.enter(wake_on_weekly=100, now=T0)
        monkeypatch.setattr(heartbeat, "_burn_intent_active", lambda: True)
        monkeypatch.setattr(heartbeat, "gather_state", _NoTmux.run)
        monkeypatch.setattr(heartbeat, "_send", _NoTmux.run)
        heartbeat.tick(datetime(2026, 7, 29, 12, 0), send=True)  # non esplode
    finally:
        heartbeat._STANDBY_MOD = None


def test_heartbeat_gate_precedes_burn_intent_in_source():
    src = _src(LAUNCHER_DIR / "heartbeat-bridge.py")
    assert src.index("if _standby_active():") \
        < src.index("burn_intent_on = _burn_intent_active()")


# ── Watchdog: niente nudge, ma la sveglia resta sorvegliata ──────────────

def test_stepcap_gates_resume_on_standby(sb, tmp_path, monkeypatch):
    """Accettazione 1 lato stepcap: col flag presente nessuna ripresa — il
    gate risponde `team-standby` prima di ogni altra valutazione."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    (tmp_path / ".team-standby.flag").write_text(
        json.dumps({"since": 1, "wake_on": {"weekly_below": 100}}),
        encoding="utf-8")
    assert stepcap.resume_gate(T0.timestamp()) == "team-standby"


def test_agent_watchdog_keeps_bridge_supervision_during_standby():
    """Accettazione 5, l'altra metà: durante lo standby l'agent-watchdog NON
    respawna/refresha AGENTI ma continua a sorvegliare i BRIDGE — un bridge
    morto e non rispawnato sarebbe uno standby eterno."""
    src = _src(LAUNCHER_DIR / "agent-watchdog.sh")
    # Il gate NON è più `[ -e <flag> ]` ma il predicato unico `standby_active`
    # ([STANDBY-EXPIRY-IGNORED-BY-RESPAWNERS]): un flag scaduto non è standby.
    m = re.search(r'if standby_active; then(.*?)\n    continue', src, re.S)
    assert m, "gate standby assente dal loop dell'agent-watchdog"
    branch = m.group(1)
    assert "maybe_respawn_bridges" in branch, "la sveglia resta senza respawn"
    assert "ensure_agent" not in branch
    assert "maybe_refresh_sentinella" not in branch
    # E il gate standby è DISTINTO da quello halted (semantiche diverse).
    assert 'TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"' in src


def test_doctor_watchdog_gates_on_standby():
    src = _src(LAUNCHER_DIR / "doctor-watchdog.sh")
    assert 'TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"' in src
    assert '[ -e "$TEAM_STANDBY_FLAG" ]' in src


def test_doctor_watchdog_waits_for_provider_credentials_before_spawning():
    """Una prima installazione salva active_provider prima di completare OAuth:
    Doctor/Mantenitore devono restare sospesi come gli agenti user-facing."""
    src = _src(LAUNCHER_DIR / "doctor-watchdog.sh")
    loop = src.index("while true; do")
    gate = src.index("if ! config_ready; then", loop)
    maint_spawn = src.index('mout=$(bash "$MAINT_SPAWNER"', loop)
    doctor_spawn = src.index('out=$(bash "$SPAWNER"', loop)
    assert gate < maint_spawn
    assert gate < doctor_spawn
    for provider, marker in (
        ("kimi", ".kimi/credentials/kimi-code.json"),
        ("claude", ".claude/.credentials.json"),
        ("anthropic", ".claude/.credentials.json"),
        ("codex", ".codex/auth.json"),
        ("openai", ".codex/auth.json"),
    ):
        assert repr(provider) in src
        assert marker in src


# ── CLI: jht standby on|off|status (forma di burn.js) ────────────────────

def test_cli_standby_command_is_registered():
    src = _src(CLI_DIR / "program.js")
    assert "registerStandbyCommand" in src
    cmd = _src(CLI_DIR / "commands" / "standby.js")
    for needle in ("standby", "status", "on", "off",
                   "--until <iso>", "--wake-on-weekly [pct]"):
        assert needle in cmd
    # La regola vale anche lato JS, prima di toccare il container.
    assert "condizione di uscita non si scrive" in cmd
