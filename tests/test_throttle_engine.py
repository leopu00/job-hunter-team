"""Test del motore che possiede i timer del throttle (fuori dagli agenti).

Copre i sei test di accettazione del ticket
`docs/internal/roadmap/2026-07-30-ticket-throttle-engine-external.md`:

  1. il timer sopravvive alla MORTE DELL'AGENTE — la sveglia arriva comunque;
  2. il timer sopravvive al RIAVVIO DEL MOTORE — `until` è su disco, non in RAM;
  3. l'ACK MANCATO è un'escalation: `NOTIFIED` fermo oltre soglia è la prova che
     l'agente ha ricevuto la sveglia e non ha risposto (il controllo vive nello
     `stepcap-watchdog`, che è il watchdog del progresso);
  4. cambiare il RITMO non tocca l'agente: la config si rilegge quando si arma
     il timer, quindi morde al ciclo successivo e non altera quello in corso;
  5. la sveglia è ROBUSTA: passa dal sender protetto (che recupera l'Enter
     perso con Space+Enter e verifica che il composer si sia svuotato), e un
     pane occupato non la fa perdere in silenzio;
  6. BURN-INTENT: in deroga i valori sotto il floor passano, senza deroga il
     motore applica floor + ladder — e gli agenti non cambiano di una riga.

Come nei test dello `stepcap-watchdog`, tutto passa da tre cuciture
(`live_sessions`, `send_wakeup`, `notify_captain`) e da un orologio esplicito:
un'attesa di 11 minuti si verifica in millisecondi, senza container né tmux.
Unica eccezione voluta, il test 5b: lì si guida il vero `jht-tmux-send` con un
`tmux` finto sul PATH, perché il recupero dell'Enter perso vive dentro QUEL
file e testarlo attraverso un mock non proverebbe niente.

Eseguire:
    pytest tests/test_throttle_engine.py -v
"""

import importlib.util
import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fake_tmux import FakeTmux

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
SENDER = REPO_ROOT / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_engine(name="throttle_engine_under_test"):
    """Un'istanza FRESCA del motore. Ri-caricarlo è come rispawnarlo: nessuno
    stato in memoria sopravvive, ed è precisamente ciò che il test 2 verifica."""
    return _load(name, SKILLS_DIR / "throttle_engine.py")


def _load_watchdog():
    return _load("stepcap_watchdog_under_test",
                 REPO_ROOT / ".launcher" / "stepcap-watchdog.py")


eng = _load_engine()
# La cucitura `send_wakeup` è spenta in tutti i test tranne quello sul
# trasporto: qui si tiene l'originale per poterla chiamare per davvero.
_REAL_SEND_WAKEUP = eng.send_wakeup

# Un martedì a mezzogiorno UTC: dentro la finestra del team 24/7 di default, e
# fuori dalla finestra 00:00-00:01 usata dal test del gate orario.
T0 = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc).timestamp()

SENT = []
CAPTAIN_MSGS = []


@pytest.fixture
def home(tmp_path, monkeypatch):
    """JHT_HOME isolato + le cuciture che toccherebbero la macchina spente."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    # I moduli condivisi sono cachati dopo il primo import (in produzione
    # JHT_HOME non cambia mai); qui ogni test ha una home diversa, e
    # `throttle-config.py` risolve i path del config all'import.
    eng._MODULE_CACHE.clear()
    SENT.clear()
    CAPTAIN_MSGS.clear()
    # Fuori dal container tmux non c'è: `None` = «non so quali sessioni ci
    # sono», e il motore non pota nulla. Qui diciamo che l'agente esiste.
    monkeypatch.setattr(eng, "live_sessions", lambda: None)
    monkeypatch.setattr(eng, "send_wakeup", _record_wakeup)
    monkeypatch.setattr(eng, "notify_captain",
                        lambda msg: CAPTAIN_MSGS.append(msg) or True)
    monkeypatch.setattr(eng, "HEARTBEAT_SEC", 10 ** 9)
    return tmp_path


def _record_wakeup(session, agent, message, rc=0):
    SENT.append({"session": session, "agent": agent, "msg": message})
    return rc


def _wakeup_returning(rc):
    """Cucitura che simula un esito preciso di `jht-tmux-send`."""
    def _send(session, agent, message):
        return _record_wakeup(session, agent, message, rc=rc)
    return _send


def events(kind=None, module=None):
    """Eventi dal log del motore. Senza argomenti esclude lo `heartbeat`, che è
    rumore di fondo voluto (dice che il motore è vivo, non che è successo
    qualcosa)."""
    mod = module or eng
    path = mod.event_log_path()
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


def flag(agent, module=None):
    return (module or eng).get_flag(agent)


def set_config(home_dir: Path, **agents):
    """Scrive `config/throttle.json` come fa la skill del Capitano."""
    payload = {"default": 0}
    payload.update(agents)
    (home_dir / "config").mkdir(parents=True, exist_ok=True)
    (home_dir / "config" / "throttle.json").write_text(
        json.dumps(payload), encoding="utf-8")


# ── Test 1 — il timer sopravvive alla morte dell'agente ──────────────────
def test_1_la_sveglia_arriva_anche_se_lagente_e_morto(home):
    """L'agente registra e SPARISCE. Nessun processo suo tiene il tempo.

    È il guasto del 2026-07-30: `jht-throttle … &` dentro un comando ucciso dal
    timeout della tool call, il figlio detached morto col parent, 2h15m di
    stallo. Qui non c'è nessun figlio da uccidere.
    """
    set_config(home, **{"scout-3": 660})
    res = eng.register("scout-3", now=T0)
    assert res == {"agent": "scout-3", "armed": True, "applied_sec": 660,
                   "until": int(T0 + 660)}
    assert flag("scout-3")["state"] == eng.IN_THROTTLE

    # L'agente è morto: nessun ack, nessun processo, nessuno che aspetta.
    eng.tick(now=T0 + 659)
    assert SENT == [], "sveglia in anticipo sulla scadenza"
    assert flag("scout-3")["state"] == eng.IN_THROTTLE

    eng.tick(now=T0 + 660)
    assert len(SENT) == 1
    assert SENT[0]["session"] == "SCOUT-3"
    notified = events("notified")
    assert len(notified) == 1 and notified[0]["agent"] == "scout-3"
    assert notified[0]["waited_sec"] >= 660
    assert flag("scout-3")["state"] == eng.NOTIFIED
    assert flag("scout-3")["until"] is None, \
        "il timer è scaduto: lasciarlo armato rimanderebbe una seconda sveglia"


def test_1b_registrarsi_non_avvia_nessun_processo(home, monkeypatch):
    """La registrazione non forka, non dorme, non attende: è il punto del
    ticket. Se ci scappasse un subprocess tornerebbe a esistere qualcosa che
    può morire col parent."""
    def _boom(*args, **kwargs):
        raise AssertionError("register ha lanciato un processo: %r" % (args,))

    monkeypatch.setattr(eng.subprocess, "run", _boom)
    res = eng.register("scout-3", now=T0)
    assert res["armed"] is True


def test_1c_una_sessione_sparita_non_lascia_un_timer_orfano(home, monkeypatch):
    monkeypatch.setattr(eng, "live_sessions", lambda: {"CAPITANO"})
    eng.register("scout-9", now=T0)
    eng.tick(now=T0 + 400)
    assert SENT == []
    assert flag("scout-9") == {}, "il flag di un agente che non esiste più va via"
    assert events("session_gone")


# ── Test 2 — il timer sopravvive al riavvio del motore ───────────────────
def test_2_un_respawn_del_motore_non_perde_la_scadenza(home, monkeypatch):
    """Kill del daemon a metà attesa: dopo il respawn la sveglia arriva
    all'ora ORIGINALE. `until` è un timestamp assoluto su disco — non c'è
    nessun timer in memoria da ri-armare, ed è per questo che non si perde.
    """
    set_config(home, **{"scorer-1": 1020})
    armed = eng.register("scorer-1", now=T0)
    eng.tick(now=T0 + 300)
    assert SENT == []

    # ── kill -9 al daemon, poi pid1 lo rispawna ──
    fresh = _load_engine("throttle_engine_respawned")
    monkeypatch.setattr(fresh, "live_sessions", lambda: None)
    monkeypatch.setattr(fresh, "send_wakeup", _record_wakeup)
    monkeypatch.setattr(fresh, "notify_captain",
                        lambda msg: CAPTAIN_MSGS.append(msg) or True)
    monkeypatch.setattr(fresh, "HEARTBEAT_SEC", 10 ** 9)
    fresh._MODULE_CACHE.clear()

    assert fresh.get_flag("scorer-1")["until"] == armed["until"], \
        "il motore nuovo deve trovare la scadenza di quello morto"
    fresh.tick(now=T0 + 1019)
    assert SENT == [], "il respawn non deve anticipare la scadenza"
    fresh.tick(now=T0 + 1020)
    assert len(SENT) == 1 and SENT[0]["agent"] == "scorer-1"
    assert fresh.get_flag("scorer-1")["state"] == fresh.NOTIFIED


def test_2b_un_flag_senza_scadenza_non_tiene_fermo_lagente(home):
    """File troncato o toccato a mano: meglio liberare l'agente che tenerlo in
    pausa su un timer che non esiste."""
    eng.write_flags({"agents": {"scout-1": {"state": eng.IN_THROTTLE,
                                            "since": int(T0), "until": None,
                                            "timer_armed_at": int(T0)}}})
    eng.tick(now=T0 + 60)
    assert flag("scout-1")["state"] == eng.ACTIVE
    assert events("flag_repaired")


# ── Test 3 — ack mancato = escalation (nello stepcap-watchdog) ───────────
@pytest.fixture
def watchdog(home, monkeypatch):
    """Lo `stepcap-watchdog` con la sola cucitura che serve qui accesa."""
    wd = _load_watchdog()
    wd._MODULE_CACHE.clear()
    monkeypatch.setattr(wd, "list_sessions", lambda: [])
    monkeypatch.setattr(wd, "notify_captain",
                        lambda msg: CAPTAIN_MSGS.append(msg) or True)
    monkeypatch.setattr(wd, "HEARTBEAT_SEC", 10 ** 9)
    return wd


def _notified_since(agent, ts, session=None):
    eng.write_flags({"agents": {agent: {
        "state": eng.NOTIFIED, "since": int(ts), "until": None,
        "timer_armed_at": None, "session": session or agent.upper()}}})


def test_3_un_ack_che_non_arriva_diventa_unescalation(watchdog, home):
    """La sveglia è partita e l'agente non ha firmato: NON è «forse idle»."""
    wd = watchdog
    _notified_since("analista-1", T0)
    limit = eng.NOTIFIED_ACK_MAX_SEC

    wd.tick(now=T0 + limit - 1)
    assert [e for e in _wd_events(wd) if e["event"] == "notified_no_ack"] == [], \
        "sotto soglia non c'è nessuna prova: un ack può ancora arrivare"
    assert CAPTAIN_MSGS == []

    wd.tick(now=T0 + limit)
    stuck = [e for e in _wd_events(wd) if e["event"] == "notified_no_ack"]
    assert len(stuck) == 1
    assert stuck[0]["agent"] == "analista-1"
    assert stuck[0]["waiting_sec"] >= limit
    assert stuck[0]["threshold_sec"] == int(limit)
    assert any("still has not acknowledged" in m for m in CAPTAIN_MSGS), \
        "l'escalation deve arrivare al Capitano, non solo al log"
    assert any("blocked" in m for m in CAPTAIN_MSGS), \
        "il senso del segnale è distinguere bloccato da idle: va detto"


def test_3b_lack_dellagente_chiude_il_caso(watchdog, home):
    wd = watchdog
    _notified_since("analista-1", T0)
    res = eng.ack("analista-1", now=T0 + 5)
    assert res["ok"] is True and res["state"] == eng.ACTIVE
    assert res["previous"] == eng.NOTIFIED and res["ack_delay_sec"] == 5

    wd.tick(now=T0 + eng.NOTIFIED_ACK_MAX_SEC + 60)
    assert [e for e in _wd_events(wd) if e["event"] == "notified_no_ack"] == []
    assert CAPTAIN_MSGS == []


def test_3c_lescalation_non_si_ripete_a_ogni_giro(watchdog, home):
    wd = watchdog
    _notified_since("analista-1", T0)
    limit = eng.NOTIFIED_ACK_MAX_SEC
    wd.tick(now=T0 + limit)
    wd.tick(now=T0 + limit + 60)
    wd.tick(now=T0 + limit + 120)
    assert len([e for e in _wd_events(wd)
                if e["event"] == "notified_no_ack"]) == 3, \
        "il log tiene traccia di ogni giro: è la misura di quanto dura"
    assert len(CAPTAIN_MSGS) == 1, "al Capitano una volta, non a ogni giro"


def test_3d_un_ack_anticipato_viene_rifiutato(home):
    """Se l'agente potesse chiudere il flag quando vuole, il throttle
    tornerebbe a essere una cosa che decide lui."""
    set_config(home, **{"scout-1": 660})
    eng.register("scout-1", now=T0)
    res = eng.ack("scout-1", now=T0 + 100)
    assert res["ok"] is False
    assert res["reason"] == "still_in_throttle"
    assert res["remaining_sec"] == 560
    assert flag("scout-1")["state"] == eng.IN_THROTTLE
    assert events("ack_refused")


def test_3e_chi_ha_atteso_in_proprio_puo_firmare_da_solo(home):
    """Lo shim `jht-throttle` attende in-turn e poi firma: è ciò che evita una
    sveglia mandata a un agente già ripartito. Ammesso SOLO a scadenza passata."""
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    res = eng.ack("scout-1", now=T0 + 300)
    assert res["ok"] is True and res["previous"] == eng.IN_THROTTLE
    eng.tick(now=T0 + 301)
    assert SENT == [], "un agente che ha già firmato non va svegliato"


def _wd_events(wd):
    path = wd.event_log_path()
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines()
            if ln.strip()]


# ── Test 4 — cambio ritmo senza toccare l'agente ─────────────────────────
def test_4_il_nuovo_ritmo_morde_al_ciclo_successivo(home):
    """`throttle-set` a metà attesa: il ciclo in corso NON cambia, il prossimo
    sì. Nessun messaggio all'agente, nessuna rilettura da parte sua."""
    set_config(home, **{"scout-1": 660})
    first = eng.register("scout-1", now=T0)
    assert first["applied_sec"] == 660

    # Il Capitano cambia il ritmo mentre l'agente aspetta.
    tc = _load("throttle_config_for_set", SKILLS_DIR / "throttle-config.py")
    tc.set_agent("scout-1", 1380)

    assert flag("scout-1")["until"] == int(T0 + 660), \
        "il ciclo in corso ha già il suo until: toccarlo sarebbe una sorpresa"
    assert flag("scout-1")["applied_sec"] == 660
    eng.tick(now=T0 + 659)
    assert SENT == []
    eng.tick(now=T0 + 660)
    assert len(SENT) == 1
    eng.ack("scout-1", now=T0 + 661)

    # Ciclo successivo: il valore nuovo, senza che nessuno l'abbia avvisato.
    eng._MODULE_CACHE.clear()
    second = eng.register("scout-1", now=T0 + 700)
    assert second["applied_sec"] == 1380
    assert second["until"] == int(T0 + 700 + 1380)


def test_4b_lagente_non_passa_e_non_vede_nessun_numero(home):
    """La chiamata dell'agente è `throttle <me>`: nessun secondo, in entrata e
    in uscita. La durata la risolve il motore leggendo la config."""
    set_config(home, **{"scorer-2": 780})
    res = eng.register("scorer-2", now=T0)
    assert res["applied_sec"] == 780
    # Un numero chiesto a mano non scavalca il floor del worker: passa comunque
    # da `effective()`, che è dove floor e ladder vivono.
    assert eng.effective_seconds("scorer-2", 120) == 300
    assert eng.effective_seconds("capitano", 0) == 0, \
        "il core interattivo non ha floor: deve restare reattivo per l'utente"


# ── Test 5 — la notifica è robusta ───────────────────────────────────────
def test_5a_la_sveglia_passa_dal_sender_protetto_mai_da_send_keys(home,
                                                                 monkeypatch):
    """Il trasporto: `jht-tmux-send`, che verifica il submit. `send-keys` nudo
    lascia il testo appeso nel prompt e rende il pane finto-occupato per tutti
    (vedi [TMUX-SEND-LOST-ENTER-ON-CLAUDE])."""
    calls = []

    class _Res:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(argv, *args, **kwargs):
        calls.append(list(argv))
        return _Res()

    # the engine runs the transport through `_transport_run` (it does not kill it at the deadline any more)
    monkeypatch.setattr(eng, "_transport_run", fake_run)
    rc = _REAL_SEND_WAKEUP("SCOUT-3", "scout-3", eng.wake_message("scout-3"))

    assert rc == 0
    assert len(calls) == 1
    assert calls[0][0].endswith("jht-tmux-send")
    assert calls[0][1] == "SCOUT-3"
    assert Path(calls[0][0]).name != "tmux", "il motore non parla a tmux da sé"
    assert "send-keys" not in calls[0]


def test_5a2_il_testo_della_sveglia_chiede_lack_come_primo_comando(home):
    msg = eng.wake_message("scout-3")
    assert msg.startswith("[DA @SISTEMA A @SCOUT-3]")
    assert "throttle-ack scout-3" in msg
    assert "FIRST command" in msg
    # Senza la seconda metà il risveglio finisce in un ACK e poi in attesa di
    # ordini: un falso «coda vuota» che inganna il coordinatore.
    assert "resume where you left off" in msg


@pytest.mark.skipif(os.name != "posix", reason="lo sender è uno script bash")
def test_5b_un_prompt_con_testo_pendente_riceve_comunque_la_sveglia(tmp_path,
                                                                   monkeypatch):
    """Il caso del ticket, sul codice VERO: il primo Enter non viene
    processato e il testo resta nel composer. Il sender lo rileva e ritenta
    solo Enter, senza alterare il draft. Il finto emula load-buffer/paste-buffer
    e il composer di una TUI reale: senza il secondo submit la sveglia resta
    pendente, senza un falso verde del vecchio send-keys inline.
    """
    # il primo Enter non viene processato, il secondo si
    tmux = FakeTmux(tmp_path / "fake", {"SCOUT-3": {"submit": "needs_retry"}})
    env = tmux.env(tmp_path)
    message = ("[DA @SISTEMA A @SCOUT-3] [RIPRENDI] La tua pausa è finita. "
               "PRIMO comando: `throttle-ack scout-3`.")
    res = subprocess.run([str(SENDER), "SCOUT-3", message], env=env,
                         capture_output=True, text=True, timeout=180)

    calls = tmux.calls_text()
    assert "load-buffer" in calls and "paste-buffer" in calls
    assert "send-keys -t =SCOUT-3: Enter" in calls, "the Enter names its session exactly, like paste and capture"
    assert calls.count("send-keys -t =SCOUT-3: Enter") >= 2
    assert "Space" not in calls, "un retry non deve cambiare il draft con un carattere estraneo"
    assert res.returncode == 0, (
        "la sveglia va consegnata comunque: rc=%d\n%s"
        % (res.returncode, res.stderr))
    # Controprova del contratto P23: il testo passa solo dal buffer e i tasti
    # nudi restano Enter (eventualmente C-s per Kimi), mai send-keys inline.
    for line in calls.splitlines():
        if line.startswith("send-keys"):
            assert "-l" not in line
            assert line.split()[-1] in ("Enter", "C-s"), line


def test_5c_un_pane_occupato_non_fa_perdere_la_sveglia(home, monkeypatch):
    """`jht-tmux-send` rc=4 = TUI occupata ma VIVA. Si riprova più tardi: la
    sveglia non si perde e l'agente non viene rimpiazzato."""
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    monkeypatch.setattr(eng, "send_wakeup", _wakeup_returning(4))
    eng.tick(now=T0 + 300)
    assert flag("scout-1")["state"] == eng.IN_THROTTLE, \
        "occupato ≠ notificato: il flag non deve avanzare"
    assert flag("scout-1")["notify_attempts"] == 1
    failed = events("notify_failed")
    assert len(failed) == 1 and failed[0]["rc"] == 4

    # Al ritentativo il pane è libero: consegnata.
    monkeypatch.setattr(eng, "send_wakeup", _record_wakeup)
    eng.tick(now=T0 + 300 + eng.NOTIFY_RETRY_SEC)
    assert flag("scout-1")["state"] == eng.NOTIFIED
    assert len(events("notified")) == 1


def test_5d_una_sveglia_non_consegnabile_finisce_al_capitano_non_nel_silenzio(
        home, monkeypatch):
    """rc=5 = testo appeso nel composer: è un caso da Dottore. Il motore
    ritenta un numero BOUNDED di volte, poi lo dice e rallenta — non smette."""
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    monkeypatch.setattr(eng, "send_wakeup", _wakeup_returning(5))

    now = T0 + 300
    for _ in range(eng.MAX_NOTIFY_ATTEMPTS):
        eng.tick(now=now)
        now = float(flag("scout-1")["until"])

    assert len(events("notify_failed")) == eng.MAX_NOTIFY_ATTEMPTS
    gave_up = events("notify_gave_up")
    assert len(gave_up) == 1 and gave_up[0]["rc"] == 5
    assert any("I cannot wake scout-1" in m for m in CAPTAIN_MSGS)
    assert flag("scout-1")["state"] == eng.IN_THROTTLE, \
        "non si dichiara notificato un agente che non è stato raggiunto"
    # Rallenta ma non abbandona: al ricontrollo successivo riprova.
    assert flag("scout-1")["until"] == int(now)
    monkeypatch.setattr(eng, "send_wakeup", _record_wakeup)
    eng.tick(now=now)
    assert flag("scout-1")["state"] == eng.NOTIFIED


def test_5e_uno_schermo_letto_come_menu_rc3_lo_dice_con_la_causa_vera_e_riprova_prima(home, monkeypatch):
    """rc=3 = il sender legge lo schermo come menu/login/permesso e non digita niente. Un team reale (02/11): sveglia
    entrata dopo 25 minuti, e il messaggio al Capitano parlava di «testo appeso» da ricreare. Ora: l'evento nomina la
    causa (parola chiusa, mai il testo dello schermo), il messaggio manda a GUARDARE lo schermo e a non ricreare, e dopo la
    rinuncia si riprova dopo NOTIFY_BLOCKED_RETRY_SEC, non dopo un quarto d'ora."""
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    monkeypatch.setattr(eng, "send_wakeup", _wakeup_returning(3))
    now = T0 + 300
    for _ in range(eng.MAX_NOTIFY_ATTEMPTS):
        eng.tick(now=now)
        now = float(flag("scout-1")["until"])
    failed = events("notify_failed")
    assert len(failed) == eng.MAX_NOTIFY_ATTEMPTS and all(e["screen"] == "menu_login_or_permission" for e in failed)
    gave_up = events("notify_gave_up")
    assert len(gave_up) == 1 and gave_up[0]["rc"] == 3 and gave_up[0]["retry_sec"] == int(eng.NOTIFY_BLOCKED_RETRY_SEC)
    message = next(m for m in CAPTAIN_MSGS if "I cannot wake scout-1" in m)
    assert "reads its screen as a menu" in message and "capture-pane" in message and "do not recreate" in message
    assert "text stuck in its prompt" not in message
    assert now - (T0 + 300 + (eng.MAX_NOTIFY_ATTEMPTS - 1) * eng.NOTIFY_RETRY_SEC) == eng.NOTIFY_BLOCKED_RETRY_SEC
    # rc=5 keeps the old message and the old pace
    set_config(home, **{"scout-2": 300})
    eng.register("scout-2", now=T0)
    monkeypatch.setattr(eng, "send_wakeup", _wakeup_returning(5))
    later = T0 + 300
    for _ in range(eng.MAX_NOTIFY_ATTEMPTS):
        eng.tick(now=later)
        later = float(flag("scout-2")["until"])
    other = [e for e in events("notify_gave_up") if e["agent"] == "scout-2"]
    assert len(other) == 1 and other[0]["retry_sec"] == int(eng.GATE_RETRY_SEC) and "screen" not in other[0]


# ── Test 6 — burn-intent: la deroga passa dal motore, non dagli agenti ───
@pytest.fixture
def burn(home):
    """`burn_intent` puntato alla home del test (i path sono costanti di
    modulo risolte all'import)."""
    bi = _load("burn_intent_under_test", SKILLS_DIR / "burn_intent.py")
    bi.INTENT_FLAG = home / ".burn-intent.flag"
    bi.AUDIT_LOG = home / "logs" / "burn-intent.jsonl"
    return bi


def test_6_senza_deroga_il_motore_applica_floor_e_ladder(home):
    set_config(home, **{"scout-1": 60, "analista-1": 0})
    assert eng.register("scout-1", now=T0)["applied_sec"] == 300, \
        "worker floor 5min: `60` non esiste per un worker"
    assert eng.register("analista-1", now=T0)["applied_sec"] == 300, \
        "`0` su un worker è il marathon: il floor non lo consente"


def test_6b_in_deroga_i_valori_sotto_il_floor_passano(home, burn, monkeypatch):
    """Con la deroga attiva il numero chiesto vale così com'è. È una decisione
    economica dell'utente sulla velocità, e vive in `effective()` — il motore
    la applica, gli agenti non la conoscono."""
    # Deroga concessa ADESSO, non a T0: `effective()` chiede a `burn_intent`
    # se la deroga è viva usando l'orologio di sistema, mentre `now=T0` governa
    # solo il timer. Ancorare la concessione a T0 rende il test verde o rosso
    # a seconda dell'ora in cui gira.
    burn.grant(hours=5, reason="stanotte spremete")
    set_config(home, **{"scout-1": 60})
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_burn", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)

    res = eng.register("scout-1", now=T0)
    assert res["applied_sec"] == 60, "in deroga niente floor, niente ladder"
    assert res["until"] == int(T0 + 60)


def test_6c_alla_scadenza_della_deroga_il_freno_torna_da_solo(home, burn,
                                                             monkeypatch):
    # Scaduta rispetto all'orologio di sistema, che è quello che `effective()`
    # consulta: concessa sei ore fa per cinque.
    past = datetime.now(timezone.utc) - timedelta(hours=6)
    burn.grant(hours=5, now=past)
    set_config(home, **{"scout-1": 60})
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_expired", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)

    assert eng.register("scout-1", now=T0)["applied_sec"] == 300


def test_6d_la_chiamata_dellagente_e_identica_nei_due_casi(home, burn,
                                                           monkeypatch):
    """«Gli agenti non cambiano di una riga»: la deroga non compare né negli
    argomenti né nel risultato che l'agente vede — solo nella durata."""
    set_config(home, **{"scout-1": 60})
    plain = eng.register("scout-1", now=T0)
    assert set(plain) == {"agent", "armed", "applied_sec", "until"}

    burn.grant(hours=2)
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_same_call", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)
    derogated = eng.register("scout-1", now=T0)

    assert set(derogated) == set(plain)
    assert derogated["applied_sec"] != plain["applied_sec"]


def test_6e_nel_burst_la_pausa_dopo_una_posizione_non_supera_il_gradino_piu_basso(home, burn, monkeypatch):
    """«A tutta» (burst): il Capitano o il floor tengono lo Scout a 300 s e la squadra faceva una posizione ogni
    cinque o sei minuti. La deroga che dice `pace_cap_sec` mette un tetto alla pausa che il motore arma."""
    set_config(home, **{"scout-1": 300})
    burn.grant(hours=2, reason="burst until 23:00", pace_cap_sec=60)
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_burst_cap", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)

    res = eng.register("scout-1", reason="post-position", now=T0)
    assert res["applied_sec"] == 60 and res["until"] == int(T0 + 60)
    assert eng.register("scout-1", seconds=300, reason="post-position", now=T0)["applied_sec"] == 60


# ── Gate di sicurezza: svegliare è spendere ──────────────────────────────
@pytest.mark.parametrize("flag_path", [".team-halted.flag", ".team-standby.flag",
                                       "logs/daily-halt.flag",
                                       ".weekly-halt.flag"])
def test_con_un_halt_la_sveglia_non_parte_e_non_si_perde(home, flag_path):
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    path = home / flag_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("halt", encoding="utf-8")

    eng.tick(now=T0 + 300)
    assert SENT == []
    gated = events("gated")
    assert gated and gated[0]["gate"] in ("team-halted", "team-standby",
                                          "daily-halt", "weekly-halt")
    assert flag("scout-1")["state"] == eng.IN_THROTTLE

    # Il gate non è una rinuncia: tolto il freno, la sveglia parte.
    path.unlink()
    eng.tick(now=T0 + 300 + eng.GATE_RETRY_SEC)
    assert len(SENT) == 1
    assert flag("scout-1")["state"] == eng.NOTIFIED


def test_daily_halt_chiude_la_race_di_un_wake_gia_consegnato(home):
    """Il flag puo' nascere fra `notified` e il primo `throttle-ack`.

    In quel varco il gate del daemon non basta piu': e' l'ack lato agente che
    deve rifiutare ACTIVE, tacere col Capitano e rimettere il timer in attesa.
    """
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    eng.tick(now=T0 + 300)
    assert flag("scout-1")["state"] == eng.NOTIFIED

    halt = home / "logs" / "daily-halt.flag"
    halt.parent.mkdir(parents=True, exist_ok=True)
    halt.write_text("{}", encoding="utf-8")
    res = eng.ack("scout-1", now=T0 + 301)

    assert res == {
        "agent": "scout-1", "ok": False, "state": eng.IN_THROTTLE,
        "previous": eng.NOTIFIED,
        "remaining_sec": int(max(eng.GATE_RETRY_SEC,
                                  eng.DAILY_HALT_RETRY_SEC)),
        "reason": "daily-halt",
    }
    assert flag("scout-1")["state"] == eng.IN_THROTTLE
    assert events("ack_suppressed")[0]["gate"] == "daily-halt"
    assert SENT and len(SENT) == 1, "l'ack non deve produrre un secondo wake"


def test_ack_daily_halt_non_perde_la_ripartenza(home):
    halt = home / "logs" / "daily-halt.flag"
    halt.parent.mkdir(parents=True, exist_ok=True)
    halt.write_text("{}", encoding="utf-8")
    res = eng.ack("analista-2", now=T0)
    assert res["reason"] == "daily-halt"
    retry_at = flag("analista-2")["until"]

    halt.unlink()
    eng.tick(now=retry_at)
    assert SENT[-1]["agent"] == "analista-2"
    assert flag("analista-2")["state"] == eng.NOTIFIED


def test_fuori_dalle_working_hours_non_si_sveglia(home):
    (home / "jht.config.json").write_text(json.dumps({
        "team": {"working_hours": {
            "timezone": "UTC",
            "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                         "start": "00:00", "end": "00:01"}],
        }}
    }), encoding="utf-8")
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    eng.tick(now=T0 + 300)
    assert SENT == []
    assert events("gated")[0]["gate"] == "off-hours"


def test_working_hours_assenti_significa_nessuna_restrizione(home):
    """`working_hours: null` = 24/7, non «sempre fuori orario»."""
    (home / "jht.config.json").write_text(
        json.dumps({"team": {"working_hours": None}}), encoding="utf-8")
    set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=T0)
    eng.tick(now=T0 + 300)
    assert len(SENT) == 1
    assert events("gated") == []


# ── Compat con chi scrive ancora il vecchio state file ───────────────────
def test_il_gate_pre_task_vede_anche_il_throttle_pre_armato_dallo_stagger(home):
    """`spawn_stagger.py` e `stepcap-watchdog.py` scrivono ancora
    `state/throttle-<agente>.json`: se `check` non lo leggesse, quei due
    meccanismi smetterebbero di gatare gli agenti senza dirlo a nessuno."""
    state_dir = home / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "throttle-scout-7.json").write_text(json.dumps({
        "agent": "scout-7", "id": "stagger-1", "until": int(T0 + 240),
        "started": int(T0), "applied_sec": 240}), encoding="utf-8")

    assert eng.pending_until("scout-7", now=T0) == T0 + 240
    assert eng.pending_until("scout-7", now=T0 + 241) is None


def test_pending_until_prende_la_scadenza_piu_lontana(home):
    set_config(home, **{"scout-7": 300})
    eng.register("scout-7", now=T0)
    (home / "state" / "throttle-scout-7.json").write_text(json.dumps({
        "agent": "scout-7", "until": int(T0 + 900)}), encoding="utf-8")
    assert eng.pending_until("scout-7", now=T0) == T0 + 900


# ── Il log storico delle pause non si spegne ─────────────────────────────
def _pause_events(module=None):
    path = (module or eng).pause_log_path()
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines()
            if ln.strip()]


def test_il_motore_alimenta_ancora_il_log_storico_delle_pause(home):
    """`logs/throttle-events.jsonl` lo scriveva `throttle.py`, che ora non viene
    più invocato — ma lo leggono il chart per agente e il `pacing-bridge`, che dai
    record `start`/`checkpoint` ricava la CADENZA con cui il Capitano calibra la
    durata. Smettere di scriverlo avrebbe spento quel segnale in silenzio."""
    set_config(home, **{"scout-1": 660})
    eng.register("scout-1", now=T0, reason="post-batch")
    eng.tick(now=T0 + 660)
    eng.ack("scout-1", now=T0 + 665)

    rows = _pause_events()
    assert [r["event"] for r in rows] == ["start", "end"]
    start, end = rows
    assert start["agent"] == "scout-1" and start["applied_sec"] == 660
    assert start["source"] == "config"
    assert isinstance(start["ts_unix"], float)
    assert end["id"] == start["id"], "start ed end della stessa pausa devono legarsi"
    assert end["actual_sleep_sec"] == 665.0


def test_un_throttle_a_zero_resta_un_checkpoint_nel_log(home):
    """Con durata 0 non c'è pausa, ma c'è un battito: è quello che il pacing
    conta per sapere quante volte l'ora un agente arriva a fine unità."""
    set_config(home, **{"capitano": 0})
    eng.register("capitano", now=T0, reason="fra due cicli")
    rows = _pause_events()
    assert len(rows) == 1
    assert rows[0]["event"] == "checkpoint"
    assert rows[0]["requested_sec"] == 0
    assert rows[0]["agent"] == "capitano"


# ── Osservabilità ────────────────────────────────────────────────────────
def test_il_battito_dice_se_il_motore_e_vivo_anche_senza_throttle(home,
                                                                 monkeypatch):
    monkeypatch.setattr(eng, "HEARTBEAT_SEC", 900)
    eng.tick(now=T0)
    beats = events("heartbeat")
    assert len(beats) == 1 and beats[0]["tracked"] == 0

    eng.tick(now=T0 + 60)
    assert len(events("heartbeat")) == 1, "un battito ogni HEARTBEAT_SEC"
    eng.tick(now=T0 + 901)
    assert len(events("heartbeat")) == 2


def test_health_distingue_motore_vivo_da_motore_fermo(home, monkeypatch):
    assert eng.health(now=T0)["ok"] is False, "file assente = mai scritto"
    assert eng.health(now=T0)["exists"] is False

    monkeypatch.setattr(eng, "HEARTBEAT_SEC", 900)
    monkeypatch.setattr(eng, "MAX_LOG_AGE_SEC", 2700)
    eng.tick(now=T0)
    assert eng.health(now=T0 + 60)["ok"] is True

    stale = eng.health(now=T0 + 4000)
    assert stale["ok"] is False
    assert "process alive but function stalled" in stale["reason"]


def test_health_cli_esce_1_quando_il_log_e_stantio(home, capsys):
    assert eng.main(["--health"]) == 1
    assert json.loads(capsys.readouterr().out)["ok"] is False


# ── pid1 avvia il motore accanto ai bridge (asserzione sul SORGENTE) ─────
def test_pid1_avvia_il_motore_e_lo_rispawna():
    """Il daemon NON deve essere figlio della shell di un agente: è il difetto
    da eliminare. L'unico modo di verificarlo senza container è leggere pid1."""
    src = (REPO_ROOT / "cli" / "src" / "commands" / "pid1.js") \
        .read_text(encoding="utf-8")
    assert "'/app/shared/skills/throttle_engine.py'" in src
    assert "startThrottleEngine();" in src
    assert "throttle-engine respawn after crash" in src
    assert "throttleEngineChild.kill(sig)" in src
    # Un boot del container respawna ogni agente: i flag di prima non
    # descrivono più nessuno, e tenerli manderebbe sveglie a raffica su agenti
    # appena nati. Il respawn del SOLO daemon non passa da qui — là i timer
    # devono sopravvivere, ed è il punto del motore.
    assert "'throttle-flags.json'" in src
    cleanup = src.index("async function cleanupStaleBridgeState()")
    assert src.index("'throttle-flags.json'") > cleanup, \
        "la pulizia va nel cleanup di boot, non in un percorso caldo"


def test_il_canary_dei_processi_attende_il_motore():
    """Se muore, nessun agente in pausa viene più svegliato: la sua morte non
    può essere invisibile come quella del suo predecessore."""
    src = (SKILLS_DIR / "process_health.py").read_text(encoding="utf-8")
    assert '("throttle-engine",    "throttle_engine.py",    "pid1-child")' in src


# ── Gli shim non tengono più il tempo (asserzione sul SORGENTE) ──────────
@pytest.mark.parametrize("tool", ["jht-throttle", "jht-throttle-wait",
                                  "jht-throttle-check"])
def test_gli_shim_passano_dal_motore(tool):
    src = (REPO_ROOT / "agents" / "_tools" / tool).read_text(encoding="utf-8")
    assert "throttle_engine.py" in src, "%s non chiama il motore" % tool
    assert "throttle.py" not in src.replace("throttle_engine.py", ""), \
        "%s deve smettere di forkare il vecchio sleeper" % tool


def test_lo_stdout_dei_comandi_letti_dagli_shim_e_solo_il_valore(tmp_path):
    """Gli shim leggono `until` in una command substitution: una riga di log su
    stdout finirebbe DENTRO il valore, e bash confronterebbe una frase con un
    intero (osservato: `[: integer expected`). La diagnostica va su stderr."""
    env = dict(os.environ)
    env["JHT_HOME"] = str(tmp_path)
    (tmp_path / "config").mkdir(parents=True, exist_ok=True)
    (tmp_path / "config" / "throttle.json").write_text(
        json.dumps({"default": 0, "scout-1": 660}), encoding="utf-8")

    def run(*cmd):
        res = subprocess.run(
            ["python3", str(SKILLS_DIR / "throttle_engine.py")] + list(cmd),
            env=env, capture_output=True, text=True, timeout=60)
        assert res.returncode == 0, res.stderr
        return res

    armed = run("register", "scout-1", "--print", "until")
    assert int(armed.stdout.strip()) > 0
    assert "[throttle-engine]" not in armed.stdout
    assert "[throttle-engine]" in armed.stderr, \
        "la diagnostica non deve sparire: deve solo cambiare flusso"

    read_back = run("status", "scout-1", "--print", "until")
    assert read_back.stdout.strip() == armed.stdout.strip()
    assert "[throttle-engine]" not in read_back.stdout


@pytest.mark.skipif(os.name != "posix", reason="i tool sono script bash")
def test_i_tool_bash_parlano_col_motore_e_non_bloccano(tmp_path):
    """I tre comandi che un agente digita, eseguiti per davvero.

    `throttle` deve tornare in un lampo: è il motivo per cui nessun timeout di
    tool call può più ucciderlo. `throttle-ack` deve rifiutare un ack anticipato,
    e `jht-throttle-check` deve continuare a gatare come prima.
    """
    tools = REPO_ROOT / "agents" / "_tools"
    env = dict(os.environ)
    env["JHT_HOME"] = str(tmp_path)
    (tmp_path / "config").mkdir(parents=True, exist_ok=True)
    (tmp_path / "config" / "throttle.json").write_text(
        json.dumps({"default": 0, "scout-1": 660}), encoding="utf-8")

    t0 = time.monotonic()
    armed = subprocess.run([str(tools / "throttle"), "scout-1", "--reason", "post-batch"],
                           env=env, capture_output=True, text=True, timeout=60)
    elapsed = time.monotonic() - t0
    assert armed.returncode == 0, armed.stderr
    assert "THROTTLE_ARMED agent=scout-1 applied_sec=660" in armed.stdout
    assert elapsed < 15, ("throttle ha atteso %.1fs: deve tornare subito, "
                          "altrimenti il timeout della tool call torna a poterlo "
                          "uccidere" % elapsed)

    refused = subprocess.run([str(tools / "throttle-ack"), "scout-1"], env=env,
                             capture_output=True, text=True, timeout=60)
    assert refused.returncode == 1
    assert "ACK_REFUSED" in refused.stderr

    gate = subprocess.run([str(tools / "jht-throttle-check"), "scout-1"], env=env,
                          capture_output=True, text=True, timeout=60)
    assert gate.returncode == 1
    assert "STILL_THROTTLED" in gate.stderr

    # Scaduto: l'attesa in proprio è finita, la firma passa e il flag si chiude.
    flags = json.loads((tmp_path / "state" / "throttle-flags.json")
                       .read_text(encoding="utf-8"))
    flags["agents"]["scout-1"]["until"] = 0
    (tmp_path / "state" / "throttle-flags.json").write_text(
        json.dumps(flags), encoding="utf-8")
    signed = subprocess.run([str(tools / "throttle-ack"), "scout-1"], env=env,
                            capture_output=True, text=True, timeout=60)
    assert signed.returncode == 0
    assert "ACTIVE" in signed.stdout
    done = subprocess.run([str(tools / "jht-throttle-wait"), "scout-1"], env=env,
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, "senza pausa pendente il wait esce subito"


def test_jht_throttle_non_forka_piu_un_figlio_detached():
    """Il figlio detached è il difetto: moriva col parent e nessuno svegliava
    l'agente. Se ricomparisse, il guasto del 2026-07-30 tornerebbe con lui."""
    src = (REPO_ROOT / "agents" / "_tools" / "jht-throttle") \
        .read_text(encoding="utf-8")
    assert "&amp;" not in src
    assert "< /dev/null &" not in src
    assert "rm -f \"$STATE_FILE\"" not in src, \
        "cancellare il flag all'uscita è ciò che faceva perdere i throttle"


# ── Pausa breve con lavoro chiesto dall'utente (27/09) ────────────────────
# Su una VPS l'ANALISTA-1 era a 780 s anche con 120 geocoding chiesti in coda:
# 41 s di lavoro e 13 minuti di pausa per ogni coordinata. Con richieste
# dell'utente in attesa la pausa scende a 60 s; a coda vuota resta il freno
# del Capitano, che serve per i giri a vuoto.
def _jobs_db(home_dir: Path, monkeypatch, **flags):
    """Un jobs.db vero con UNA posizione e i flag di richiesta dati."""
    db = home_dir / "jobs.db"
    monkeypatch.setenv("JHT_DB", str(db))
    # Il motore importa db_query, che importa `_db` per nome: un `_db` già in
    # sys.modules (un altro file di test lo lega al SUO database) conterebbe
    # le richieste nel db sbagliato. In produzione `throttle` è un processo a sé.
    import sys
    monkeypatch.delitem(sys.modules, "_db", raising=False)
    seed = subprocess.run(
        ["python3", "-c",
         "import sys; sys.path.insert(0, %r); "
         "from _db import get_db, ensure_schema; c = get_db(); ensure_schema(c); "
         "c.execute(\"INSERT INTO positions (title, company, status) VALUES ('Engineer', 'Acme', 'scored')\"); "
         "c.commit()" % str(SKILLS_DIR)],
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(home_dir)},
        capture_output=True, text=True, timeout=60)
    assert seed.returncode == 0, seed.stderr
    if flags:
        import sqlite3
        conn = sqlite3.connect(db)
        conn.execute("UPDATE positions SET %s WHERE id = 1"
                     % ", ".join("%s = %r" % kv for kv in flags.items()))
        conn.commit()
        conn.close()
    return db


def test_user_requests_waiting_shorten_the_analyst_pause(home, monkeypatch):
    set_config(home, **{"analista-1": 780})
    _jobs_db(home, monkeypatch, geocode_requested=1,
             geocode_requested_at="2026-09-27 14:54:03")
    res = eng.register("analista-1", reason="post-geocode", now=T0)
    assert res["applied_sec"] == eng.USER_WORK_PAUSE_SEC == 60
    assert res["until"] == int(T0) + 60
    assert res["shortened_from"] == 780
    assert res["user_requests_waiting"] == {"next-for-geocoding": 1}
    armed = events("armed")[-1]
    assert armed["applied_sec"] == 60 and armed["shortened_from"] == 780


def test_an_empty_user_queue_keeps_the_captains_pause(home, monkeypatch):
    # Il freno per i giri a vuoto non si tocca: niente richieste, 780 s.
    set_config(home, **{"analista-1": 780})
    _jobs_db(home, monkeypatch, geocode_requested=0,
             geocode_requested_at="2026-09-27 14:54:03", office_geocoded=1)
    res = eng.register("analista-1", reason="queue-empty", now=T0)
    assert res["applied_sec"] == 780
    assert "shortened_from" not in res
    assert "shortened_from" not in events("armed")[-1]


def test_only_the_analyst_serves_user_requests(home, monkeypatch):
    # Una richiesta dell'utente non è lavoro dello Scout: la sua pausa resta.
    set_config(home, **{"scout-2": 660})
    _jobs_db(home, monkeypatch, geocode_requested=1,
             geocode_requested_at="2026-09-27 14:54:03")
    assert eng.register("scout-2", now=T0)["applied_sec"] == 660


def test_an_unreadable_db_keeps_the_brake(home, monkeypatch):
    # Senza una risposta certa sulla coda si tiene la pausa del Capitano.
    set_config(home, **{"analista-1": 780})
    bad = home / "jobs.db"
    bad.write_text("not a database", encoding="utf-8")
    monkeypatch.setenv("JHT_DB", str(bad))
    import sys
    monkeypatch.delitem(sys.modules, "_db", raising=False)
    assert eng.register("analista-1", now=T0)["applied_sec"] == 780


def test_a_shorter_captains_pause_is_not_lengthened(home, monkeypatch):
    # Il minimo fra i due: 60 s è un tetto, non un valore imposto.
    set_config(home, **{"analista-1": 0})
    _jobs_db(home, monkeypatch, geocode_requested=1,
             geocode_requested_at="2026-09-27 14:54:03")
    monkeypatch.setattr(eng, "effective_seconds", lambda agent, requested=None: 30)
    assert eng.register("analista-1", now=T0)["applied_sec"] == 30


# ── Lo SCOUT che non ha inserito niente (27/09) ──────────────────────────
# Su una VPS lo SCOUT smaltiva una lista di annunci già visti: 16-36 s per un
# duplicato, poi 660 s di pausa. La regola è in pause-rules.json, la stessa che
# legge l'harness API (agent-harness/runtime/tests/pause-rules.test.ts).
def _utc(ts: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts))


def _inserted(db: Path, agent: str, at: float):
    """La transizione None → 'new' che db_insert.py scrive per un INSERT."""
    import sqlite3
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO position_state_transitions "
                 "(position_id, from_state, to_state, by_agent, notes, ts) "
                 "VALUES (1, NULL, 'new', ?, 'initial INSERT', ?)",
                 (agent, _utc(at)))
    conn.commit()
    conn.close()


def _unit(agent: str, start: float, reason: str) -> dict:
    """Una pausa del Capitano, il risveglio, poi la pausa dopo l'unità."""
    eng.tick(now=start)
    eng.ack(agent, now=start + 1)
    return eng.register(agent, reason=reason, now=start + 30)


def test_a_scout_unit_that_inserted_nothing_pauses_short(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    _jobs_db(home, monkeypatch)
    rules = json.loads((REPO_ROOT / "agents" / "_skills" / "throttle"
                        / "pause-rules.json").read_text(encoding="utf-8"))
    # the first pause after the boot: nothing to count from, the brake
    assert eng.register("scout-2", now=T0)["applied_sec"] == 660
    res = _unit("scout-2", T0 + 660, "post-dedup-skip")
    assert res["applied_sec"] == rules["short_pause_sec"] == 60
    assert res["shortened_from"] == 660 and res["empty_unit"] == 1
    armed = events("armed")[-1]
    assert armed["applied_sec"] == 60 and armed["empty_unit"] == 1


def test_a_scout_unit_that_inserted_keeps_the_captains_pause(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    db = _jobs_db(home, monkeypatch)
    eng.register("scout-2", now=T0)
    _unit("scout-2", T0 + 660, "post-dedup-skip")
    # the next unit inserts: a real unit of work, the Capitano's pause
    eng.tick(now=T0 + 720)
    eng.ack("scout-2", now=T0 + 721)
    _inserted(db, "scout-2", T0 + 740)
    res = eng.register("scout-2", reason="post-insert", now=T0 + 750)
    assert res["applied_sec"] == 660 and "shortened_from" not in res
    assert flag("scout-2")["empty_streak"] == 0


def test_another_scouts_insert_does_not_count(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    db = _jobs_db(home, monkeypatch)
    eng.register("scout-2", now=T0)
    eng.tick(now=T0 + 660)
    eng.ack("scout-2", now=T0 + 661)
    _inserted(db, "scout-1", T0 + 670)
    assert eng.register("scout-2", now=T0 + 690)["applied_sec"] == 60


def test_after_max_streak_short_pauses_the_brake_comes_back(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    _jobs_db(home, monkeypatch)
    rules = json.loads((REPO_ROOT / "agents" / "_skills" / "throttle"
                        / "pause-rules.json").read_text(encoding="utf-8"))
    cap = rules["empty_unit"]["max_streak"]
    assert cap == eng.EMPTY_UNIT_MAX_STREAK == 10
    eng.register("scout-2", now=T0)
    start = T0 + 660
    applied = []
    for _ in range(cap + 1):
        res = _unit("scout-2", start, "post-dedup-skip")
        applied.append(res["applied_sec"])
        start += 30 + res["applied_sec"]
    assert applied == [60] * cap + [660]
    # and the count starts again after the Capitano's pause
    assert _unit("scout-2", start, "post-dedup-skip")["applied_sec"] == 60


def _long_unit(agent: str, start: float, seconds: float, reason: str = "post-position") -> dict:
    """A pause of the Capitano, the wake-up, a unit that lasts `seconds`, the pause after it."""
    eng.tick(now=start)
    eng.ack(agent, now=start + 1)
    return eng.register(agent, reason=reason, now=start + 1 + seconds)


def test_an_empty_unit_that_took_minutes_keeps_the_captains_pause(home, monkeypatch):
    """The short pause is for a check of seconds. A Scout that searched for five minutes and inserted nothing spent
    budget: waiting 60 s after it, again and again, left the pacing nowhere (a night run: ~39 % of the usage)."""
    set_config(home, **{"scout-2": 660})
    _jobs_db(home, monkeypatch)
    limit = eng.EMPTY_UNIT_MAX_UNIT_SEC
    assert limit == 120
    eng.register("scout-2", now=T0)
    res = _long_unit("scout-2", T0 + 660, 300)
    assert res["applied_sec"] == 660 and res["empty_unit_long_sec"] == 300 and "shortened_from" not in res
    assert flag("scout-2")["empty_streak"] == 0
    # the edge: the limit itself is still a check, one second more is not
    res = _long_unit("scout-2", T0 + 5000, limit)
    assert res["applied_sec"] == 60 and res["empty_unit"] == 1
    res = _long_unit("scout-2", T0 + 9000, limit + 1)
    assert res["applied_sec"] == 660 and res["empty_unit_long_sec"] == limit + 1


def test_a_short_empty_unit_after_a_long_one_gets_the_short_pause_again(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    _jobs_db(home, monkeypatch)
    eng.register("scout-2", now=T0)
    assert _long_unit("scout-2", T0 + 660, 20)["applied_sec"] == 60
    assert _long_unit("scout-2", T0 + 800, 400)["applied_sec"] == 660
    assert _long_unit("scout-2", T0 + 2000, 20)["applied_sec"] == 60


def test_an_empty_unit_is_a_scout_rule_only(home, monkeypatch):
    # L'ANALISTA che non inserisce posizioni è la norma, non un'unità vuota.
    set_config(home, **{"analista-1": 780})
    _jobs_db(home, monkeypatch)
    eng.register("analista-1", now=T0)
    assert _unit("analista-1", T0 + 780, "post-check")["applied_sec"] == 780


def test_an_unreadable_db_keeps_the_scouts_brake(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    bad = home / "jobs.db"
    bad.write_text("not a database", encoding="utf-8")
    monkeypatch.setenv("JHT_DB", str(bad))
    import sys
    monkeypatch.delitem(sys.modules, "_db", raising=False)
    eng.register("scout-2", now=T0)
    assert _unit("scout-2", T0 + 660, "post-dedup-skip")["applied_sec"] == 660


# ── Nel recupero dopo un congelamento la pausa del Capitano non si accorcia (22/10) ──
# Su un team di prova uno SCOUT rimesso in piedi dopo il freeze ha preso il 69% del consumo a
# 2,76 %/h: le sue unità vuote accorciavano a 60 s la pausa di 2460 s che il
# Capitano gli aveva dato come freno. La regola è `keep_captains_pause` in
# pause-rules.json; i segnali sono la traccia di un congelamento
# (freeze_marker.py) e il report del pacing-bridge.
def _freeze_marker():
    return _load("freeze_marker_under_test", SKILLS_DIR / "freeze_marker.py")


def _pacing_report(home: Path, team, target):
    (home / "logs").mkdir(parents=True, exist_ok=True)
    (home / "logs" / "pacing-bridge-state.json").write_text(
        json.dumps({"last_report": {"vel_team": team, "vel_target": target}}),
        encoding="utf-8")


def _empty_scout_unit(home, monkeypatch):
    set_config(home, **{"scout-2": 660})
    _jobs_db(home, monkeypatch)
    eng.register("scout-2", now=T0)
    return _unit("scout-2", T0 + 660, "post-dedup-skip")


def test_the_rule_names_both_signals_and_the_engine_reads_them():
    rules = json.loads((REPO_ROOT / "agents" / "_skills" / "throttle"
                        / "pause-rules.json").read_text(encoding="utf-8"))
    keep = rules["empty_unit"]["keep_captains_pause"]
    assert keep == {"after_freeze_sec": 7200, "over_pace_pct_h": 1.0}
    assert eng.RECOVERY_AFTER_FREEZE_SEC == 7200 and eng.OVER_PACE_PCT_H == 1.0


def test_after_a_freeze_an_empty_unit_keeps_the_captains_pause(home, monkeypatch):
    _freeze_marker().mark("freeze", now=T0 + 600)
    res = _empty_scout_unit(home, monkeypatch)
    assert res["applied_sec"] == 660
    assert res["empty_unit_kept"] == "after-freeze"
    assert "shortened_from" not in res
    assert events("armed")[-1]["empty_unit_kept"] == "after-freeze"
    assert flag("scout-2")["empty_streak"] == 0


def test_once_the_recovery_window_is_over_the_empty_unit_shortens_again(home, monkeypatch):
    _freeze_marker().mark("freeze", now=T0 + 660 + 30 - eng.RECOVERY_AFTER_FREEZE_SEC - 1)
    res = _empty_scout_unit(home, monkeypatch)
    assert res["applied_sec"] == 60 and res["shortened_from"] == 660
    assert "empty_unit_kept" not in res


def test_a_team_over_its_target_pace_keeps_the_captains_pause(home, monkeypatch):
    _pacing_report(home, team=3.5, target=1.4)
    res = _empty_scout_unit(home, monkeypatch)
    assert res["applied_sec"] == 660 and res["empty_unit_kept"] == "over-pace"


def test_a_team_within_the_tolerance_of_its_target_still_shortens(home, monkeypatch):
    _pacing_report(home, team=2.4, target=1.4)  # exactly the tolerance above: not over
    assert _empty_scout_unit(home, monkeypatch)["applied_sec"] == 60


@pytest.mark.parametrize("content", [None, "not json", "[]", '{"last_report": {"vel_team": "x"}}'])
def test_no_signal_or_an_unreadable_one_is_the_rule_as_before(home, monkeypatch, content):
    if content is not None:
        (home / "logs").mkdir(parents=True, exist_ok=True)
        (home / "logs" / "pacing-bridge-state.json").write_text(content, encoding="utf-8")
        (home / "state").mkdir(parents=True, exist_ok=True)
        (home / "state" / "last-freeze.json").write_text(content, encoding="utf-8")
    assert _empty_scout_unit(home, monkeypatch)["applied_sec"] == 60


def test_the_users_burn_intent_lifts_the_hold(home, burn, monkeypatch):
    burn.grant(hours=5, reason="stanotte spremete")
    _freeze_marker().mark("freeze", now=T0 + 600)
    _pacing_report(home, team=3.5, target=1.4)
    set_config(home, **{"scout-2": 660})
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_burn_hold", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)
    _jobs_db(home, monkeypatch)
    # in burn intent the floor and the ladder are off: 660 stays 660, 60 is allowed
    eng.register("scout-2", now=T0)
    res = _unit("scout-2", T0 + 660, "post-dedup-skip")
    assert res["applied_sec"] == 60 and "empty_unit_kept" not in res


def test_a_hold_does_not_touch_the_other_rules(home, monkeypatch):
    # the user's requests waiting for the Analista still shorten: not a Scout empty unit
    _freeze_marker().mark("freeze", now=T0 + 600)
    set_config(home, **{"analista-1": 780})
    _jobs_db(home, monkeypatch, geocode_requested=1,
             geocode_requested_at="2026-09-27 14:54:03")
    res = eng.register("analista-1", now=T0)
    assert res["applied_sec"] == 60 and res["shortened_from"] == 780


def test_freeze_team_and_the_fatal_soft_pause_leave_the_marker(home, monkeypatch):
    monkeypatch.syspath_prepend(str(SKILLS_DIR))
    fm = _freeze_marker()
    assert fm.seconds_since(now=T0) is None
    ft = _load("freeze_team_under_test", SKILLS_DIR / "freeze_team.py")
    monkeypatch.setattr(ft, "list_sessions", lambda: ["SCOUT-2", "CAPITANO"])
    monkeypatch.setattr(ft, "send_esc", lambda s: True)
    ft.main()
    assert fm.seconds_since() is not None and fm.seconds_since() < 60
    fm.marker_path().unlink()
    sp = _load("soft_pause_team_under_test", SKILLS_DIR / "soft_pause_team.py")
    monkeypatch.setattr(sp, "list_sessions", lambda: ["SCOUT-2", "CAPITANO"])
    monkeypatch.setattr(sp, "send_message", lambda s, m: True)
    sp.pause_all(include_core=True)  # the zero-spend standby is not a freeze
    assert fm.seconds_since() is None
    sp.pause_all()
    assert fm.seconds_since() is not None
    # nothing frozen, nothing marked
    fm.marker_path().unlink()
    monkeypatch.setattr(ft, "list_sessions", lambda: [])
    with pytest.raises(SystemExit):
        ft.main()
    assert fm.seconds_since() is None


# ── Un wait orfano non si prende la sveglia (27/09) ──────────────────────
# Su una VPS l'ANALISTA-1 ha armato 300 s, ha ricevuto un ordine a metà pausa
# e, nel turno che ne è seguito, ha lanciato `jht-throttle-check ||
# jht-throttle-wait` e ha chiuso il turno. Il wait è rimasto vivo in background
# e alla scadenza ha firmato lui il risveglio (acked, self_resumed): stato
# ACTIVE, nessun [RIPRENDI] al pane, e l'agente al prompt ad aspettare una
# notifica che non sarebbe arrivata. Nessun agente in coda lo vedeva.
@pytest.mark.skipif(os.name != "posix", reason="i tool sono script bash")
@pytest.mark.parametrize("shim", ["jht-throttle-wait", "jht-throttle"])
def test_an_orphan_wait_does_not_take_the_wake_up(home, shim):
    tools = REPO_ROOT / "agents" / "_tools"
    env = {**os.environ, "JHT_HOME": str(home)}
    now = time.time()
    if shim == "jht-throttle-wait":
        eng.register("analista-1", seconds=300, reason="post-geocode", now=now)
        # La pausa è quasi finita quando parte il wait (qui: fra un secondo).
        state = eng.read_flags()
        state["agents"]["analista-1"]["until"] = int(now) + 1
        eng.write_flags(state)
        cmd = [str(tools / shim), "analista-1"]
    else:
        # Un secondo, non 300: l'esenzione dal floor esiste per questo.
        (home / "config").mkdir(parents=True, exist_ok=True)
        (home / "config" / "throttle-floor-exempt.txt").write_text("analista-1\n", encoding="utf-8")
        cmd = [str(tools / shim), "1", "--agent", "analista-1"]
    done = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr

    # Il turno dell'agente è già chiuso: chi lo sveglia è il motore, al giro dopo.
    assert flag("analista-1")["state"] != eng.ACTIVE, \
        "lo shim ha firmato la sveglia al posto dell'agente"
    eng.tick(now=time.time() + 2)
    woke = [s for s in SENT if s["agent"] == "analista-1"]
    assert woke and woke[-1]["session"] == "ANALISTA-1", SENT
    assert events("notified")[-1]["agent"] == "analista-1"


# ── Posizioni in coda per il ruolo: UNA regola per l'Analista e lo Scorer (02/11) ─────────────────────────────
# Misurato: l'Analista lavora ~51 s a posizione e poi sta fermo 300-780 s anche con 15 posizioni `new` in coda.
# La regola e' `queued_work` in pause-rules.json; la coda e' quella di next-for-analista / next-for-scorer.
def _queue(db: Path, *, new=0, checked=0, checked_scored=0):
    """Posizioni `new`, `checked` senza punteggio, e `checked` CON punteggio (che non sono in coda)."""
    import sqlite3
    conn = sqlite3.connect(db)
    for _ in range(new):
        conn.execute("INSERT INTO positions (title, company, status) VALUES ('A', 'Acme', 'new')")
    for _ in range(checked):
        conn.execute("INSERT INTO positions (title, company, status) VALUES ('B', 'Acme', 'checked')")
    for _ in range(checked_scored):
        cur = conn.execute("INSERT INTO positions (title, company, status) VALUES ('C', 'Acme', 'checked')")
        conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?, 70)", (cur.lastrowid,))
    conn.commit()
    conn.close()


def test_the_queue_rule_is_one_rule_for_the_roles_the_file_lists():
    rules = json.loads((REPO_ROOT / "agents" / "_skills" / "throttle"
                        / "pause-rules.json").read_text(encoding="utf-8"))
    assert rules["queued_work"] == {"roles": ["analista", "scorer"], "pause_sec": 60}
    assert eng._QUEUED_ROLES == {"analista", "scorer"} and eng.QUEUED_WORK_PAUSE_SEC == 60


@pytest.mark.parametrize("agent,seed", [("analista-1", {"new": 3}), ("analista-2", {"new": 1}),
                                         ("scorer-4", {"checked": 5})])
def test_a_role_with_positions_in_its_queue_pauses_short(home, monkeypatch, agent, seed):
    set_config(home, **{agent: 780})
    _queue(_jobs_db(home, monkeypatch), **seed)
    res = eng.register(agent, reason="post-position checkpoint", now=T0)
    n = sum(seed.values())
    assert res["applied_sec"] == 60 and res["shortened_from"] == 780 and res["queued_work"] == n
    assert res["until"] == int(T0) + 60
    armed = events("armed")[-1]
    assert armed["applied_sec"] == 60 and armed["shortened_from"] == 780 and armed["queued_work"] == n


@pytest.mark.parametrize("agent", ["analista-1", "scorer-4"])
def test_an_empty_queue_keeps_the_captains_full_pause(home, monkeypatch, agent):
    set_config(home, **{agent: 780})
    # the seeded position is `scored`; a checked one WITH a score is not in the Scorer's queue
    _queue(_jobs_db(home, monkeypatch), checked_scored=2)
    res = eng.register(agent, now=T0)
    assert res["applied_sec"] == 780 and "shortened_from" not in res and "queued_work" not in res


def test_each_role_counts_its_own_queue_only(home, monkeypatch):
    set_config(home, **{"analista-1": 780, "scorer-4": 780})
    _queue(_jobs_db(home, monkeypatch), new=2)  # positions waiting for the Analista, none for the Scorer
    assert eng.register("analista-1", now=T0)["applied_sec"] == 60
    assert eng.register("scorer-4", now=T0)["applied_sec"] == 780


@pytest.mark.parametrize("agent", ["scout-2", "capitano-1", "scrittore-1", "critico-1", "dottore"])
def test_the_other_roles_keep_their_pause(home, monkeypatch, agent):
    set_config(home, **{agent: 660})
    _queue(_jobs_db(home, monkeypatch), new=4, checked=4)
    assert eng.register(agent, now=T0)["applied_sec"] == 660


def test_an_unreadable_queue_keeps_the_captains_pause_for_both_roles(home, monkeypatch):
    set_config(home, **{"analista-1": 780, "scorer-4": 780})
    bad = home / "jobs.db"
    bad.write_text("not a database", encoding="utf-8")
    monkeypatch.setenv("JHT_DB", str(bad))
    import sys
    monkeypatch.delitem(sys.modules, "_db", raising=False)
    assert eng.register("analista-1", now=T0)["applied_sec"] == 780
    assert eng.register("scorer-4", now=T0)["applied_sec"] == 780


def test_a_pause_shorter_than_the_cap_is_never_lengthened(home, monkeypatch):
    set_config(home, **{"scorer-4": 30})
    _queue(_jobs_db(home, monkeypatch), checked=2)
    # the floor (300 s) lifts it to 300 first, then the queue shortens it: the cap is a ceiling
    res = eng.register("scorer-4", seconds=30, now=T0)
    assert res["applied_sec"] == 60 and res["shortened_from"] == 300
    monkeypatch.setattr(eng, "effective_seconds", lambda agent, requested=None: 30)
    assert eng.register("scorer-4", now=T0)["applied_sec"] == 30


def test_user_requests_and_a_queue_together_are_still_one_short_pause(home, monkeypatch):
    set_config(home, **{"analista-1": 780})
    db = _jobs_db(home, monkeypatch, geocode_requested=1, geocode_requested_at="2026-09-27 14:54:03")
    _queue(db, new=2)
    res = eng.register("analista-1", now=T0)
    assert res["applied_sec"] == 60 and res["shortened_from"] == 780
    assert res["user_requests_waiting"] == {"next-for-geocoding": 1}


@pytest.mark.parametrize("agent,seed", [("analista-1", {"new": 3}), ("scorer-4", {"checked": 3})])
def test_a_budget_hold_keeps_the_captains_pause_even_with_a_queue(home, monkeypatch, agent, seed):
    # the same hold as the Scout's empty unit: recovery after a freeze, or the team over its pace
    set_config(home, **{agent: 780})
    _queue(_jobs_db(home, monkeypatch), **seed)
    _freeze_marker().mark("freeze", now=T0 - 600)
    res = eng.register(agent, now=T0)
    assert res["applied_sec"] == 780 and res["queued_work_kept"] == "after-freeze"
    assert "shortened_from" not in res and "queued_work" not in res
    _freeze_marker().marker_path().unlink()
    _pacing_report(home, team=3.5, target=1.4)
    res = eng.register(agent, now=T0 + 10)
    assert res["applied_sec"] == 780 and res["queued_work_kept"] == "over-pace"
    # the hold gone (team within its pace): the queue shortens again
    _pacing_report(home, team=1.5, target=1.4)
    assert eng.register(agent, now=T0 + 20)["applied_sec"] == 60


@pytest.mark.parametrize("agent,seed", [("analista-1", {"new": 3}), ("scorer-4", {"checked": 3})])
def test_the_users_burn_intent_takes_the_pause_away_with_a_queue(home, burn, monkeypatch, agent, seed):
    burn.grant(hours=5, reason="stanotte spremete")
    _freeze_marker().mark("freeze", now=T0 - 600)  # the hold is lifted by the burn too
    set_config(home, **{agent: 780})
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_burn_queue", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)
    _queue(_jobs_db(home, monkeypatch), **seed)
    res = eng.register(agent, now=T0)
    assert res["armed"] is False and res["applied_sec"] == 0 and res["until"] is None
    assert res["queued_work"] == sum(seed.values()) and res["shortened_from"] == 780
    assert flag(agent)["state"] == eng.ACTIVE
    assert events("no_throttle")[-1]["queued_work"] == sum(seed.values())


def test_the_burn_intent_with_an_empty_queue_changes_nothing_for_the_queue_rule(home, burn, monkeypatch):
    burn.grant(hours=5, reason="stanotte spremete")
    set_config(home, **{"analista-1": 780})
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_burn_empty", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)
    _jobs_db(home, monkeypatch)
    res = eng.register("analista-1", now=T0)
    assert res["applied_sec"] == 780 and "queued_work" not in res


def test_a_whole_batch_is_drained_at_one_unit_per_minute_not_per_cycle(home, monkeypatch):
    # 15 positions waiting (the scout's batch of the measured run): between two units the pause is 60 s, and it
    # becomes the Capitano's again only when the queue is empty
    set_config(home, **{"analista-1": 780})
    db = _jobs_db(home, monkeypatch)
    _queue(db, new=15)
    import sqlite3
    t, pauses = T0, []
    for _ in range(15):
        res = eng.register("analista-1", reason="post-position checkpoint", now=t)
        pauses.append(res["applied_sec"])
        t += res["applied_sec"]
        eng.tick(now=t)
        eng.ack("analista-1", now=t + 1)
        conn = sqlite3.connect(db)
        conn.execute("UPDATE positions SET status = 'checked' WHERE id = (SELECT MIN(id) FROM positions WHERE status = 'new')")
        conn.commit()
        conn.close()
        t += 50  # the unit
    # the 15th unit emptied the queue: the next pause is the full one
    assert pauses[:14] == [60] * 14 or pauses[:15] == [60] * 15
    assert eng.register("analista-1", now=t)["applied_sec"] == 780


# ── (b) ogni pausa ha una fine certa: lo «start senza end» (02/11) ───────────────────────────────────────────
def test_a_flag_write_of_the_agent_during_a_slow_tick_is_not_lost(home, monkeypatch):
    """Il guasto: il giro legge i flag, si ferma sulla consegna di una sveglia, l'agente registra la sua pausa, il giro
    riscrive lo stato vecchio e la pausa dell'agente sparisce (nessuna sveglia, nessun `end`)."""
    set_config(home, **{"scout-1": 660, "analista-1": 300})
    eng.register("scout-1", now=T0)
    eng.register("analista-1", now=T0)
    eng.tick(now=T0 + 300)           # the analyst wakes (a 300 s pause), the scout is still waiting
    eng.ack("analista-1", now=T0 + 301)
    assert flag("analista-1")["state"] == eng.ACTIVE

    def slow_delivery(session, agent, message):
        # while the tick is delivering the scout's wake-up, the analyst finishes its unit and registers
        SENT.append({"session": session, "agent": agent, "msg": message})
        eng.register("analista-1", reason="post-position checkpoint", now=T0 + 700)
        return 0

    monkeypatch.setattr(eng, "send_wakeup", slow_delivery)
    eng.tick(now=T0 + 660)
    assert flag("scout-1")["state"] == eng.NOTIFIED
    mine = flag("analista-1")
    assert mine["state"] == eng.IN_THROTTLE and mine["pause_id"] == "analista-1-%d" % int(T0 + 700), mine
    assert mine["until"] == int(T0 + 700) + 300


def test_a_pause_that_the_flag_forgot_is_closed_and_the_agent_woken(home):
    """Lo «start senza end»: il log ha l'inizio, il flag non sa niente della pausa (ACTIVE di prima)."""
    set_config(home, **{"analista-1": 300})
    eng.register("analista-1", now=T0 - 1000)
    eng.tick(now=T0 - 700)
    eng.ack("analista-1", now=T0 - 699)               # ACTIVE, since before the next pause
    eng.emit_pause("start", "analista-1", T0, id="analista-1-%d" % int(T0), requested_sec=300, applied_sec=300,
                   reason="post-position checkpoint", source="config")    # the pause the flag lost
    SENT.clear()
    margin = eng.PAUSE_END_MARGIN_SEC
    eng.tick(now=T0 + 300 + margin - 1)
    assert SENT == [] and not events("pause_recovered"), "before start + duration + margin nothing happens"
    eng.tick(now=T0 + 300 + margin + 1)
    assert [m["agent"] for m in SENT] == ["analista-1"]
    assert flag("analista-1")["state"] == eng.NOTIFIED
    rec = events("pause_recovered")
    assert len(rec) == 1 and rec[0]["pause_id"] == "analista-1-%d" % int(T0) and rec[0]["overdue_sec"] == margin + 1
    ends = [json.loads(l) for l in eng.pause_log_path().read_text().splitlines() if '"event": "end"' in l or '"event":"end"' in l]
    closing = [e for e in ends if e["id"] == "analista-1-%d" % int(T0)]
    assert len(closing) == 1 and closing[0]["recovered"] == "lost-pause" and closing[0]["interrupted"] is True
    # it is closed once: the next rounds neither wake it again nor recover it again
    eng.tick(now=T0 + 400 + margin)
    assert len(SENT) == 1 and len(events("pause_recovered")) == 1
    # the agent acknowledges and the story is over
    assert eng.ack("analista-1", now=T0 + 500 + margin)["ok"] is True


def test_the_scorer_start_without_end_with_an_active_flag_is_woken(home):
    """Il caso di un team reale (02/11): lo Scorer ha uno `start` senza `end` (19:48:12, 60 s per la coda; qui 300 s: il pavimento
    del config), il flag e' un ACTIVE senza scadenza con la stessa durata e lo stesso motivo («waiting for checked positions»): per il motore non era in
    pausa, per lo Scorer si'. Due volte nella serata, risolto a mano dal Capitano dopo 34-51 minuti."""
    set_config(home, **{"scorer-4": 300})
    eng.register("scorer-4", reason="waiting for checked positions", now=T0 - 1000)
    eng.tick(now=T0 - 700)
    eng.ack("scorer-4", now=T0 - 699)
    assert flag("scorer-4")["state"] == eng.ACTIVE and flag("scorer-4")["until"] is None
    assert flag("scorer-4")["applied_sec"] == 300 and flag("scorer-4")["reason"] == "waiting for checked positions"
    eng.emit_pause("start", "scorer-4", T0, id="scorer-4-%d" % int(T0), requested_sec=300, applied_sec=300,
                   reason="waiting for checked positions", source="config")     # no `end`, ever
    SENT.clear()
    eng.tick(now=T0 + 300 + eng.PAUSE_END_MARGIN_SEC + 1)
    assert [m["agent"] for m in SENT] == ["scorer-4"], "woken within about two minutes, not after 34 minutes"
    assert len(events("pause_recovered")) == 1


def test_queue_is_empty_is_true_only_for_a_queue_role_with_a_queue_read_and_empty(home, monkeypatch):
    class Db:
        def __init__(self, n):
            self.n = n

        def get_db(self):
            return self

        def close(self):
            pass

        def role_queue_count(self, conn, role):
            return self.n

    monkeypatch.setattr(eng, "_load_shared", lambda name, filename: Db(0))
    assert eng.queue_is_empty("scorer-4") is True and eng.queue_is_empty("analista-1") is True
    assert eng.queue_is_empty("scout-1") is False, "a role without a queue is never «waiting for work»"
    monkeypatch.setattr(eng, "_load_shared", lambda name, filename: Db(7))
    assert eng.queue_is_empty("scorer-4") is False
    monkeypatch.setattr(eng, "_load_shared", lambda name, filename: None)
    assert eng.queue_is_empty("scorer-4") is False, "no answer: not «empty»"


def test_a_lost_pause_of_a_session_that_is_gone_is_closed_without_a_wake(home, monkeypatch):
    monkeypatch.setattr(eng, "live_sessions", lambda: {"CAPITANO"})
    eng.emit_pause("start", "analista-1", T0, id="analista-1-%d" % int(T0), applied_sec=300, reason="x", source="config")
    eng.tick(now=T0 + 400)
    eng.tick(now=T0 + 500)
    assert SENT == [] and flag("analista-1") == {}
    closed = events("pause_closed")
    assert len(closed) == 1 and closed[0]["agent"] == "analista-1"


def test_a_pause_the_flag_knows_is_left_to_the_normal_round(home):
    set_config(home, **{"analista-1": 300})
    eng.register("analista-1", now=T0)
    eng.tick(now=T0 + 300 + eng.PAUSE_END_MARGIN_SEC + 30)   # normal round woke it: nothing is "lost"
    assert not events("pause_recovered") and len(SENT) == 1


def test_an_agent_that_restarted_after_the_start_is_not_woken_again(home):
    # it came back by itself (no `end` in the log), its flag says ACTIVE since after the start: not a lost pause
    eng.emit_pause("start", "scout-1", T0, id="scout-1-%d" % int(T0), applied_sec=300, reason="x", source="config")
    state = eng.read_flags()
    state["agents"]["scout-1"] = {"state": eng.ACTIVE, "since": int(T0 + 310), "until": None,
                                  "timer_armed_at": None, "session": "SCOUT-1"}
    eng.write_flags(state)
    eng.tick(now=T0 + 1000)
    assert SENT == [] and not events("pause_recovered")


def test_a_very_old_open_pause_is_ignored(home):
    eng.emit_pause("start", "scout-1", T0, id="scout-1-%d" % int(T0), applied_sec=300, reason="x", source="config")
    eng.tick(now=T0 + 300 + eng.ACTIVE_PRUNE_SEC + 10)
    assert SENT == [] and not events("pause_recovered")


# ── il log lo scrivono gli agenti: le righe `start` si validano, un lock tenuto non ferma il giro (02/11) ────────────
def _raw_log(lines):
    path = eng.pause_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        for line in lines:
            fh.write(line + "\n")


@pytest.mark.parametrize("row", [
    '{"event":"start","agent":"analista-1","id":"x-1","ts_unix":NaN,"applied_sec":300}',
    '{"event":"start","agent":"analista-1","id":"x-2","ts_unix":%d,"applied_sec":NaN}' % T0,
    '{"event":"start","agent":"analista-1","id":"x-3","ts_unix":Infinity,"applied_sec":300}',
    '{"event":"start","agent":"analista-1","id":"x-4","ts_unix":%d,"applied_sec":Infinity}' % T0,
    '{"event":"start","agent":"analista-1","id":"x-5","ts_unix":%d,"applied_sec":1e300}' % T0,
    '{"event":"start","agent":"analista-1","id":"x-6","ts_unix":1e300,"applied_sec":300}',
    '{"event":"start","agent":"analista-1","id":"x-7","ts_unix":%d,"applied_sec":-5}' % T0,
    '{"event":"start","agent":"analista-1","id":"x-8","ts_unix":true,"applied_sec":300}',
    '{"event":"start","agent":"analista-1","id":"x-9","ts_unix":%d,"applied_sec":true}' % T0,
    '{"event":"start","agent":"analista-1","id":["a"],"ts_unix":%d,"applied_sec":300}' % T0,
    '{"event":"start","agent":"analista-1","id":"%s","ts_unix":%d,"applied_sec":300}' % ("i" * 500, T0),
    '{"event":"start","agent":"analista-1","ts_unix":%d,"applied_sec":300}' % T0,
    '{"event":"start","agent":["analista-1"],"id":"x-10","ts_unix":%d,"applied_sec":300}' % T0,
    '{"event":"start","agent":"../../etc x","id":"x-11","ts_unix":%d,"applied_sec":300}' % T0,
    '{"event":"start","agent":"%s","id":"x-12","ts_unix":%d,"applied_sec":300}' % ("a" * 200, T0),
])
def test_a_start_row_that_is_not_what_the_engine_writes_is_not_an_open_pause(home, row):
    _raw_log([row])
    assert eng._open_pauses() == {}
    eng.tick(now=T0 + 5000)    # the round neither crashes nor wakes anybody for it
    assert SENT == [] and not events("pause_recovered") and not events("pause_closed")


def test_an_end_row_with_an_id_that_cannot_be_hashed_does_not_break_the_good_rows(home):
    _raw_log(['{"event":"end","id":["x"]}', '{"event":"end","id":{"a":1}}',
              '{"event":"start","agent":"scout-1","id":"scout-1-1","ts_unix":%d,"applied_sec":300}' % T0])
    assert list(eng._open_pauses()) == ["scout-1"]


def test_a_good_start_row_keeps_working_and_a_long_reason_is_cut(home):
    _raw_log(['{"event":"start","agent":"scout-1","id":"scout-1-1","ts_unix":%d,"applied_sec":300,"reason":"%s"}'
              % (T0, "r" * 5000)])
    rec = eng._open_pauses()["scout-1"]
    assert rec["id"] == "scout-1-1" and rec["applied_sec"] == 300.0 and len(rec["reason"]) == eng._PAUSE_REASON_MAX
    eng.tick(now=T0 + 300 + eng.PAUSE_END_MARGIN_SEC + 1)
    assert [m["agent"] for m in SENT] == ["scout-1"] and len(events("pause_recovered")) == 1


def test_a_flags_lock_held_by_somebody_else_does_not_stop_the_round(home, monkeypatch):
    fcntl = pytest.importorskip("fcntl")
    monkeypatch.setattr(eng, "FLAGS_LOCK_TIMEOUT_SEC", 0.3)
    set_config(home, **{"analista-1": 300})
    eng.register("analista-1", now=T0)
    lock = eng.flags_path().with_suffix(".lock")
    with open(lock, "a+") as holder:
        fcntl.flock(holder, fcntl.LOCK_EX)          # a process that keeps the lock and never lets it go
        began = time.monotonic()
        eng.tick(now=T0 + 300)                       # waits the timeout, then goes on
        spent = time.monotonic() - began
        assert 0.25 <= spent < 5, spent
        assert flag("analista-1")["state"] == eng.NOTIFIED and len(SENT) == 1
        began = time.monotonic()
        assert eng.ack("analista-1", now=T0 + 301)["ok"] is True      # the agent's side is not stuck either
        assert time.monotonic() - began < 5


def test_a_flags_lock_that_is_free_is_taken_at_once(home, monkeypatch):
    monkeypatch.setattr(eng, "FLAGS_LOCK_TIMEOUT_SEC", 5)
    began = time.monotonic()
    with eng._flags_lock():
        pass
    assert time.monotonic() - began < 1
