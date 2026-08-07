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
import stat
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

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
    assert any("non ha ancora firmato l'ack" in m for m in CAPTAIN_MSGS), \
        "l'escalation deve arrivare al Capitano, non solo al log"
    assert any("bloccato" in m for m in CAPTAIN_MSGS), \
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

    def fake_run(argv, **kwargs):
        calls.append(list(argv))
        return _Res()

    monkeypatch.setattr(eng.subprocess, "run", fake_run)
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
    """Il caso del ticket, sul codice VERO: un Enter a freddo non viene
    processato e il testo resta nel composer. Il sender lo rileva e recupera con
    `Space`+`Enter`. Qui `tmux` è finto e il pane si svuota solo al secondo
    submit: se il recupero non ci fosse, la sveglia sarebbe persa in silenzio.
    """
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "tmux-calls.log"
    fake = bindir / "tmux"
    fake.write_text(
        "#!/usr/bin/env bash\n"
        'echo "$@" >> "%s"\n'
        'state="%s"\n'
        'case "$1" in\n'
        '  has-session) exit 0 ;;\n'
        '  capture-pane)\n'
        '    if [ -f "$state" ]; then\n'
        # Submit avvenuto: il composer è vuoto (nessuna signature nella riga
        # di prompt) e la TUI non è occupata.
        '      printf "> lavoro precedente\\n%%s\\n" "> "\n'
        '    else\n'
        # Testo digitato ma NON submittato: resta appeso nella riga di prompt.
        '      printf "> lavoro precedente\\n> [DA @SISTEMA A @SCOUT-3] [RIPRENDI] La tua\\n"\n'
        '    fi\n'
        '    exit 0 ;;\n'
        '  send-keys)\n'
        '    for a in "$@"; do\n'
        '      if [ "$a" = "Space" ]; then : > "$state"; fi\n'
        '    done\n'
        '    exit 0 ;;\n'
        'esac\n'
        'exit 0\n' % (log, tmp_path / "submitted"),
        encoding="utf-8")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)

    env = dict(os.environ)
    env["PATH"] = "%s:%s" % (bindir, env.get("PATH", ""))
    env["JHT_HOME"] = str(tmp_path)
    message = ("[DA @SISTEMA A @SCOUT-3] [RIPRENDI] La tua pausa è finita. "
               "PRIMO comando: `throttle-ack scout-3`.")
    res = subprocess.run([str(SENDER), "SCOUT-3", message], env=env,
                         capture_output=True, text=True, timeout=180)

    calls = log.read_text(encoding="utf-8")
    assert "Space" in calls, \
        "senza il carattere di sveglia l'Enter a freddo resta non processato"
    assert res.returncode == 0, (
        "la sveglia va consegnata comunque: rc=%d\n%s"
        % (res.returncode, res.stderr))
    # Il testo non è MAI passato da send-keys inline (solo `-l "$message"`, che
    # è il typing, e i tasti nudi Enter/Space).
    for line in calls.splitlines():
        if line.startswith("send-keys") and "-l" not in line:
            assert line.split()[-1] in ("Enter", "Space", "C-s", "Escape"), line


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
    assert "throttle-engine respawn dopo crash" in src
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
