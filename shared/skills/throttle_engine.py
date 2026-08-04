#!/usr/bin/env python3
"""throttle_engine.py — il tempo esce dal dominio dell'agente.

Fino al 2026-07-30 il throttle era un contratto che l'agente doveva onorare da
solo: `jht-throttle` bloccava il **suo stesso processo** con un loop di sleep, e
se quel processo moriva l'agente doveva accorgersene e ribloccarsi. Ogni
failure mode osservata in produzione è figlia di quel disegno — la peggiore, il
2026-07-30: un Analista ha lanciato `jht-throttle … &` dentro un comando
composito ucciso dal timeout della tool call (60s), il figlio detached è morto
col parent, e **nessuno l'ha più svegliato**. 2h15m di stallo con il watchdog
che classificava la sessione `idle` = sana.

Qui il tempo passa a un processo che non è figlio di nessuna shell di agente:

    AGENTE                      MOTORE (questo file, daemon avviato da pid1)
      |                            |
      |-- throttle <me> ---------->|  legge la durata EFFETTIVA per <me>
      |                            |  scrive il flag: <me> = IN_THROTTLE
      |   (l'agente CHIUDE il      |  arma il timer (su DISCO, non in memoria)
      |    turno e non fa NULLA)   |
      |                            |
      |<-- sveglia via tmux -------|  timer scaduto → flag = NOTIFIED
      |                            |
      |-- throttle-ack <me> ------>|  L'AGENTE flippa NOTIFIED → ACTIVE
      |   (primo atto al risveglio)|

## Il flag lo chiude l'AGENTE, non il motore

Il motore scrive `IN_THROTTLE` e poi `NOTIFIED`. Il passaggio a `ACTIVE` è solo
dell'agente, via `throttle-ack`. Questo trasforma il flag in una **prova di
reattività**: un flag fermo su `NOTIFIED` oltre una soglia non è «forse idle»,
è **certamente bloccato** — la sveglia è partita e non ha risposto. È la
risposta strutturale al buco che tutti i watchdog condividono (`idle` e
`bloccato` indistinguibili guardando il pane). L'escalation su quel segnale
vive nello `stepcap-watchdog`, che è il watchdog del PROGRESSO: vedi
`NOTIFIED_ACK_MAX_SEC` e `notified_without_ack()` qui sotto.

| flag          | significato                | anomalia se dura troppo          |
|---------------|----------------------------|----------------------------------|
| `IN_THROTTLE` | attesa legittima           | no (la durata la sa il motore)   |
| `NOTIFIED`    | sveglia inviata, ack atteso| **sì → escalation dopo N min**   |
| `ACTIVE`      | agente operativo           | valutare col progresso DB        |

## Perché lo stato sta su disco e i timer NON in memoria

Ogni giro rilegge `$JHT_HOME/state/throttle-flags.json` e confronta `until`
(timestamp ASSOLUTO) con l'ora corrente. Non esiste un `threading.Timer` da
perdere: un crash o un respawn del daemon **ri-arma da sé** tutti i timer
pendenti, perché non c'era niente da ri-armare. È lo stesso motivo per cui
`stepcap-watchdog` tiene la sua macchina a stati su file.

## La durata non la decide l'agente e non la vede

Al momento di armare il timer il motore chiede la durata EFFETTIVA a
`shared/skills/throttle-config.py` (`get_agent` → `effective`: worker floor,
ladder coprima, deroga a termine dell'utente). Quindi:
  - un cambio di config morde al **ciclo successivo** dell'agente, senza
    messaggi e senza che i worker rileggano niente;
  - il ciclo **in corso** non viene alterato: `until` è già stato calcolato;
  - floor/ladder/burn-intent restano in UN posto solo — qui non si ricopiano.

## Gate di sicurezza

Il motore SVEGLIA gli agenti, cioè fa spendere: non aggira i freni. Con
`.team-halted.flag`, `.team-standby.flag`, `daily-halt.flag`, `weekly-halt.flag`
o fuori dalle working hours la sveglia non parte — e non viene persa: si
ricontrolla ogni `GATE_RETRY_SEC` finché il freno non è tolto.

## La sveglia passa dal sender protetto, mai da `send-keys` nudo

`jht-tmux-send` verifica che il composer si sia svuotato e recupera l'Enter
perso con `Space`+`Enter` (vedi `[TMUX-SEND-LOST-ENTER-ON-CLAUDE]`): un Enter a
freddo non viene processato e il messaggio resta appeso nel prompt, rendendo il
pane finto-occupato per tutti. Il motore non reimplementa nulla di questo — lo
CHIAMA e interpreta i suoi exit code (0 consegnato, 4 occupato-vivo → si
riprova, 3/5 → è un caso da Dottore e va detto al Capitano).

Modi:
    python3 throttle_engine.py                 # loop (avviato da pid1)
    python3 throttle_engine.py --once          # un solo giro, poi esce
    python3 throttle_engine.py --health        # freschezza del log (Dottore)
    python3 throttle_engine.py register <a>    # arma il timer, RITORNA SUBITO
    python3 throttle_engine.py ack <a>         # NOTIFIED → ACTIVE (l'agente)
    python3 throttle_engine.py check <a>       # exit 1 se ancora in attesa
    python3 throttle_engine.py status [<a>]    # i flag, leggibili
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Stati del flag ────────────────────────────────────────────────────────
IN_THROTTLE = "IN_THROTTLE"
NOTIFIED = "NOTIFIED"
ACTIVE = "ACTIVE"

# ── Parametri (tutti override-abili da env: il default è il comportamento
#    descritto nel ticket, l'env serve ai test e alla diagnosi sul campo) ──
INTERVAL_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_INTERVAL", "10"))
HEARTBEAT_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_HEARTBEAT", "900"))
# Freschezza attesa del log per il check del Dottore: 3 battiti mancati.
MAX_LOG_AGE_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_MAX_AGE",
                                       str(3 * HEARTBEAT_SEC)))
# Quando un gate blocca la sveglia non si molla l'agente: si ricontrolla più
# tardi. Stessa scelta (e stesso valore) dello stepcap-watchdog.
GATE_RETRY_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_GATE_RETRY", "900"))
# Un wake consegnato un istante PRIMA che il daily hard-stop scriva il flag
# puo arrivare all'agente dopo l'ESC iniziale. In quel caso `throttle-ack` e'
# l'ultimo choke point deterministico prima che l'agente torni a lavorare o
# pinghi il Capitano: lo rimettiamo in attesa lunga, senza generare messaggi.
DAILY_HALT_RETRY_SEC = float(os.environ.get(
    "JHT_THROTTLE_ENGINE_DAILY_HALT_RETRY", "3600"))
# Sveglia non consegnata (pane occupato, TUI in boot): si riprova presto e per
# un numero BOUNDED di volte, poi si rallenta a GATE_RETRY_SEC e si avvisa il
# Capitano. Non si abbandona mai un agente: un timer che smette di riprovare
# riproduce esattamente lo stallo che questo motore esiste per chiudere.
NOTIFY_RETRY_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_NOTIFY_RETRY", "60"))
MAX_NOTIFY_ATTEMPTS = int(os.environ.get("JHT_THROTTLE_ENGINE_NOTIFY_ATTEMPTS", "5"))
# Budget di tempo per una singola consegna: `jht-tmux-send` può attendere fino a
# 90s che un turno in corso finisca (JHT_TMUX_BUSY_WAIT), più i tentativi di
# submit. 240s copre il caso peggiore senza appendere il daemon per sempre.
NOTIFY_TIMEOUT_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_NOTIFY_TIMEOUT", "240"))
# Soglia oltre la quale un flag `NOTIFIED` è una PROVA di non-reattività. Letta
# dallo stepcap-watchdog, che è il posto dove vive l'escalation.
NOTIFIED_ACK_MAX_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_ACK_MAX", "600"))
# Un `ACTIVE` non serve più a nessuno dopo un po': si pota per non far crescere
# il file all'infinito su un roster che cambia (worker one-shot, respawn).
ACTIVE_PRUNE_SEC = float(os.environ.get("JHT_THROTTLE_ENGINE_PRUNE", "86400"))
CAPTAIN_SESSION = os.environ.get("JHT_THROTTLE_ENGINE_CAPTAIN", "CAPITANO")

# Il testo della sveglia. Due obblighi in una riga: l'ack è il PRIMO comando
# (senza quello il flag resta NOTIFIED e il watchdog escala su un agente sano),
# e il rientro nel loop è immediato — un risveglio che finisce in un ACK e poi
# in attesa di ordini produce un falso `new=0` (vedi SC-08 nei prompt Scout).
WAKE_TEXT = (
    "[DA @SISTEMA A @{AGENT}] [RIPRENDI] La tua pausa è finita. "
    "PRIMO comando, prima di qualunque altra cosa: `throttle-ack {agent}`. "
    "Poi torna SUBITO al tuo loop e riprendi dal punto in cui eri: "
    "non aspettare altri ordini."
)


# ── Path (risolti a ogni chiamata: JHT_HOME può cambiare tra i test) ──────
def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def flags_path() -> Path:
    return _home() / "state" / "throttle-flags.json"


def event_log_path() -> Path:
    return _home() / "logs" / "throttle-engine.jsonl"


def pause_log_path() -> Path:
    """Il log storico delle pause, `logs/throttle-events.jsonl`.

    Lo scriveva `shared/skills/throttle.py`, che nel disegno nuovo non viene più
    invocato. Lo LEGGONO ancora `throttle-series.py` (il chart per agente) e il
    `pacing-bridge`, che dai record `start`/`checkpoint` ricava la CADENZA per
    agente — l'ingrediente con cui il Capitano calibra la durata
    (`throttle_effettivo = cadenza × durata`). Smettere di scriverlo avrebbe
    spento quel segnale in silenzio, quindi il motore lo alimenta al posto suo,
    con lo stesso schema.
    """
    return _home() / "logs" / "throttle-events.jsonl"


def _legacy_state_path(agent: str) -> Path:
    """Lo state file per-agente del vecchio disegno.

    Lo scrivono ancora `spawn_stagger.py` (pre-arma il throttle del worker
    appena nato) e `stepcap-watchdog.py` (pausa prima di riprendere un agente
    fermo sul cap). Nessuno dei due è in questo ticket, quindi `check`/`wait`
    continuano a LEGGERLO: ignorarlo qui vorrebbe dire che quei due meccanismi
    smettono silenziosamente di gatare gli agenti.
    """
    return _home() / "state" / ("throttle-%s.json" % agent)


def _log(msg: str) -> None:
    """Diagnostica su STDERR, sempre.

    Non è una scelta di stile: `register` e `status` sono invocati dagli shim
    dentro una command substitution (`UNTIL=$(… --print until)`), e una riga di
    log su stdout finirebbe dentro il valore, facendo confrontare a bash una
    frase con un intero. pid1 cattura entrambi i flussi, quindi il daemon non
    perde niente.
    """
    print("[throttle-engine] %s" % msg, file=sys.stderr, flush=True)


# ── Import a caldo delle infrastrutture condivise ─────────────────────────
# Stesso pattern dei bridge e dello stepcap-watchdog: prova il path del
# container, poi quello relativo al repo (test/dev). Un import rotto degrada,
# non abbatte il loop.
_MODULE_CACHE: dict = {}


def _load_shared(name: str, filename: str):
    if name in _MODULE_CACHE:
        return _MODULE_CACHE[name]
    mod = None
    for cand in (Path("/app/shared/skills") / filename,
                 Path(__file__).resolve().parent / filename):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            break
        except Exception as exc:  # noqa: BLE001 — un import rotto non ferma il motore
            _log("import %s fallito: %s" % (filename, exc))
            mod = None
    _MODULE_CACHE[name] = mod
    return mod


def _throttle_config():
    return _load_shared("throttle_config", "throttle-config.py")


def effective_seconds(agent: str, requested=None) -> int:
    """Durata EFFETTIVA per l'agente: floor + ladder + deroga a termine.

    `requested=None` → il valore che il Capitano ha messo in config. Un valore
    esplicito passa comunque da `effective()`, così un numero scritto a mano in
    un prompt non scavalca il worker floor.

    La logica NON si ricopia qui: vive in `throttle-config.py` e questo è il
    punto in cui viene applicata. Senza il modulo si degrada al worker floor
    (300s) invece di non mettere pausa: la direzione sicura è il freno.
    """
    mod = _throttle_config()
    if mod is None:
        return 300 if requested is None else max(0, int(requested))
    try:
        if requested is None:
            return int(mod.get_agent(agent))
        return int(mod.effective(agent, int(requested)))
    except Exception as exc:  # noqa: BLE001
        _log("durata non risolvibile per %s: %s" % (agent, exc))
        return 300


def _within_working_hours(now: float) -> bool:
    """Fail-open: senza il modulo o senza finestre configurate si lavora (24/7).

    `working_hours: null` significa «nessuna restrizione», non «sempre fuori
    orario»: `is_within_working_hours` ritorna già True in quel caso.
    """
    mod = _load_shared("working_hours", "working_hours.py")
    if not mod:
        return True
    try:
        return bool(mod.is_within_working_hours(
            datetime.fromtimestamp(now, timezone.utc)))
    except Exception:  # noqa: BLE001
        return True


# ── tmux (argv diretto, mai una shell) ────────────────────────────────────
def _tmux(*args, timeout: float = 20):
    """Ritorna stdout, o None se tmux manca / esce non-zero / va in timeout."""
    try:
        res = subprocess.run(("tmux",) + tuple(args), capture_output=True,
                             text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        return None
    return res.stdout


def live_sessions():
    """Set dei nomi di sessione tmux vivi, o None se tmux non risponde.

    None ≠ insieme vuoto: senza tmux non si sa nulla, e potare i flag su
    «nessuna sessione esiste» cancellerebbe timer validi al primo hiccup.
    """
    out = _tmux("list-sessions", "-F", "#{session_name}")
    if out is None:
        return None
    return {ln.strip() for ln in out.splitlines() if ln.strip()}


def session_for(agent: str, entry=None) -> str:
    """Sessione tmux dell'agente: quella registrata, altrimenti il nome in
    maiuscolo (`scout-3` → `SCOUT-3`, la convenzione del launcher)."""
    if isinstance(entry, dict) and entry.get("session"):
        return str(entry["session"])
    return str(agent or "").strip().upper()


# ── Log eventi ────────────────────────────────────────────────────────────
def emit(event: str, agent=None, ts=None, **fields) -> dict:
    # `ts` è l'orologio del GIRO, non quello della riga: è il tempo su cui il
    # motore ha deciso, ed è quello che rende verificabile «fra armed e
    # notified sono passati almeno applied_sec secondi».
    record = {"ts": int(time.time() if ts is None else ts), "event": event}
    if agent:
        record["agent"] = agent
    record.update({k: v for k, v in fields.items() if v is not None})
    record["ts_iso"] = datetime.fromtimestamp(record["ts"], timezone.utc) \
        .isoformat().replace("+00:00", "Z")
    path = event_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        _log("scrittura %s fallita: %s" % (path, exc))
    _log("%s %s" % (event, json.dumps({k: v for k, v in record.items()
                                       if k not in ("ts", "ts_iso")},
                                      ensure_ascii=False)))
    return record


def emit_pause(event: str, agent: str, ts, **fields) -> None:
    """Un record nello schema storico di `throttle-events.jsonl`.

    Append semplice: un record sta sotto PIPE_BUF (4 KB), quindi `'a'` è già
    atomico su Linux e non serve un lock. Errori ignorati — un log che non si
    scrive non deve fermare un agente in piena attività.
    """
    record = {"event": event, "ts_unix": float(ts),
              "ts": datetime.fromtimestamp(float(ts), timezone.utc).isoformat(),
              "agent": agent}
    record.update({k: v for k, v in fields.items() if v is not None})
    path = pause_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, separators=(",", ":")) + "\n")
    except OSError as exc:
        _log("scrittura %s fallita: %s" % (path, exc))


# ── Stato su disco ────────────────────────────────────────────────────────
def read_flags() -> dict:
    """`{"agents": {...}, "last_heartbeat": ts}`. Illeggibile → stato vuoto.

    Mai solleva: questo file viene letto anche da `throttle-ack`, cioè dal
    percorso critico di un agente che si sta risvegliando.
    """
    try:
        data = json.loads(flags_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"agents": {}, "last_heartbeat": None}
    if not isinstance(data, dict):
        return {"agents": {}, "last_heartbeat": None}
    agents = data.get("agents")
    data["agents"] = agents if isinstance(agents, dict) else {}
    data.setdefault("last_heartbeat", None)
    return data


def write_flags(state: dict) -> None:
    """tmp + rename: il file è riletto da `ack` e da `check` mentre il daemon
    scrive, e leggerlo a metà write è una corsa che accade davvero."""
    path = flags_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        _log("scrittura flag fallita: %s" % exc)


def get_flag(agent: str) -> dict:
    entry = read_flags()["agents"].get(agent)
    return entry if isinstance(entry, dict) else {}


def _daily_halt_active() -> bool:
    """Il solo gate del daily cap, letto anche dal percorso agente (`ack`).

    Non usa `wake_gate`: un ack gia' consegnato deve chiudere la race del
    daily-halt senza cambiare le semantiche esistenti di working-hours,
    standby o burn-intent. La variante in home resta compatibile con le
    installazioni che hanno spostato il flag fuori da `logs/`.
    """
    home = _home()
    for path in (home / "logs" / "daily-halt.flag",
                 home / ".daily-halt.flag"):
        try:
            if path.exists():
                return True
        except OSError:
            continue
    return False


# ── Registrazione (la chiama l'agente, e ritorna SUBITO) ──────────────────
def register(agent: str, seconds=None, reason=None, session=None,
             now=None) -> dict:
    """Arma il timer per `agent` e ritorna. NON dorme, NON forka, NON attende.

    È il cuore del ticket: l'unica cosa che l'agente fa col tempo è dire «ho
    finito un'unità di lavoro». Il resto è del motore, che non è figlio della
    sua shell e quindi non muore col timeout della sua tool call.
    """
    agent = str(agent or "").strip().lower()
    if not agent:
        raise ValueError("agent richiesto")
    now = time.time() if now is None else float(now)
    applied = effective_seconds(agent, seconds)

    state = read_flags()
    if applied <= 0:
        # Throttle 0 = nessuna pausa (il core interattivo ci sta per scelta:
        # deve restare reattivo per la chat dell'utente). L'agente resta ACTIVE
        # e continua: non c'è nulla da svegliare.
        state["agents"][agent] = {
            "state": ACTIVE, "since": int(now), "until": None,
            "timer_armed_at": None, "applied_sec": 0,
            "session": session_for(agent, {"session": session}),
        }
        write_flags(state)
        emit("no_throttle", agent=agent, ts=now, reason=reason)
        # `checkpoint`: l'agente è arrivato a fine unità con throttle 0. Non è
        # una pausa, ma È un battito, ed è ciò che dà la cadenza al pacing.
        emit_pause("checkpoint", agent, now, requested_sec=0, reason=reason,
                   source="explicit" if seconds is not None else "config")
        return {"agent": agent, "armed": False, "applied_sec": 0, "until": None}

    until = int(now + applied)
    pause_id = "%s-%d" % (agent, int(now))
    state["agents"][agent] = {
        "state": IN_THROTTLE,
        "since": int(now),
        "until": until,
        "timer_armed_at": int(now),
        "applied_sec": applied,
        "session": session_for(agent, {"session": session}),
        "reason": reason,
        "notify_attempts": 0,
        "pause_id": pause_id,
    }
    write_flags(state)
    emit("armed", agent=agent, ts=now, applied_sec=applied, until=until,
         reason=reason)
    emit_pause("start", agent, now, id=pause_id,
               requested_sec=seconds if seconds is not None else applied,
               applied_sec=applied, reason=reason,
               source="explicit" if seconds is not None else "config")
    return {"agent": agent, "armed": True, "applied_sec": applied,
            "until": until}


# ── Ack (lo fa l'AGENTE: è ciò che rende NOTIFIED una prova) ──────────────
def ack(agent: str, now=None) -> dict:
    """`NOTIFIED → ACTIVE`. È il primo atto dell'agente al risveglio.

    Ammesso **solo quando l'attesa è finita**: da `NOTIFIED` sempre, da
    `IN_THROTTLE` solo se `until` è già passato (è il caso di chi ha atteso in
    proprio col vecchio `jht-throttle` e si è liberato prima che il motore
    ticchettasse). Un ack ANTICIPATO viene rifiutato: se l'agente potesse
    chiudere il flag quando vuole, il throttle tornerebbe a essere una cosa
    che decide lui — cioè esattamente il disegno che stiamo smontando.
    """
    agent = str(agent or "").strip().lower()
    now = time.time() if now is None else float(now)
    state = read_flags()
    entry = state["agents"].get(agent)

    # [PACING-DAILY-HALT-STANDBY-LEAK] — chiude la race fra una sveglia gia'
    # consegnata e l'ESC del bridge. Non si passa mai ad ACTIVE, quindi il
    # worker non entra nel loop e non manda il vecchio `[READY]` al Capitano.
    # Il timer lungo non e' una nuova decisione di pacing: e' solo il prossimo
    # istante di retry; anche alla scadenza il daemon ricontrolla il flag prima
    # di svegliare. Tolto il flag, la sveglia non e' persa.
    if _daily_halt_active():
        previous = entry.get("state") if isinstance(entry, dict) else None
        session = session_for(agent, entry)
        retry = max(GATE_RETRY_SEC, DAILY_HALT_RETRY_SEC)
        if not isinstance(entry, dict):
            entry = {}
            state["agents"][agent] = entry
        entry.update({
            "state": IN_THROTTLE,
            "since": int(now),
            "until": int(now + retry),
            "timer_armed_at": int(now),
            "applied_sec": int(retry),
            "session": session,
            "reason": "daily-halt",
            "notify_attempts": 0,
            "pause_id": entry.get("pause_id") or "%s-%d" % (agent, int(now)),
        })
        write_flags(state)
        emit("ack_suppressed", agent=agent, ts=now, previous=previous,
             gate="daily-halt", retry_sec=int(retry), session=session)
        return {"agent": agent, "ok": False, "state": IN_THROTTLE,
                "previous": previous, "remaining_sec": int(retry),
                "reason": "daily-halt"}

    if not isinstance(entry, dict):
        # Nessun flag: un ack di un agente che non era in pausa è innocuo e
        # va registrato come ACTIVE — è comunque la prova che è reattivo.
        state["agents"][agent] = {"state": ACTIVE, "since": int(now),
                                  "until": None, "timer_armed_at": None,
                                  "session": session_for(agent)}
        write_flags(state)
        emit("acked", agent=agent, ts=now, previous="none")
        return {"agent": agent, "ok": True, "state": ACTIVE, "previous": None}

    previous = entry.get("state")
    if previous == ACTIVE:
        emit("ack_noop", agent=agent, ts=now)
        return {"agent": agent, "ok": True, "state": ACTIVE,
                "previous": ACTIVE}

    until = entry.get("until")
    if previous == IN_THROTTLE and isinstance(until, (int, float)) and now < until:
        remaining = int(until - now)
        emit("ack_refused", agent=agent, ts=now, remaining_sec=remaining)
        return {"agent": agent, "ok": False, "state": IN_THROTTLE,
                "previous": IN_THROTTLE, "remaining_sec": remaining,
                "reason": "still_in_throttle"}

    waited = None
    if isinstance(entry.get("since"), (int, float)):
        waited = int(now - float(entry["since"]))
    armed_at = entry.get("timer_armed_at")
    pause_id = entry.get("pause_id")
    applied = entry.get("applied_sec")
    entry.update({"state": ACTIVE, "since": int(now), "until": None,
                  "timer_armed_at": None, "notify_attempts": 0,
                  "pause_id": None})
    write_flags(state)
    emit("acked", agent=agent, ts=now, previous=previous,
         ack_delay_sec=waited if previous == NOTIFIED else None,
         self_resumed=True if previous == IN_THROTTLE else None)
    if pause_id:
        # Chiude lo `start` nel log storico: senza l'`end` il chart mostra una
        # pausa orfana e la durata reale resta invisibile.
        actual = None
        if isinstance(armed_at, (int, float)):
            actual = round(max(0.0, now - float(armed_at)), 2)
        emit_pause("end", agent, now, id=pause_id, applied_sec=applied,
                   actual_sleep_sec=actual, interrupted=False,
                   reason=entry.get("reason"))
    return {"agent": agent, "ok": True, "state": ACTIVE, "previous": previous,
            "ack_delay_sec": waited}


# ── Interrogazione (usata dai gate e dagli shim) ──────────────────────────
def pending_until(agent: str, now=None):
    """Timestamp fino a cui l'agente NON deve iniziare un task, o None.

    Unione delle due fonti: il flag del motore e il vecchio state file
    per-agente (che spawn_stagger e stepcap-watchdog scrivono ancora). Si
    prende il massimo — una pausa che vale è una pausa che vale, chiunque
    l'abbia armata.
    """
    now = time.time() if now is None else float(now)
    candidates = []
    entry = get_flag(str(agent or "").strip().lower())
    if entry.get("state") == IN_THROTTLE and isinstance(entry.get("until"), (int, float)):
        candidates.append(float(entry["until"]))
    try:
        legacy = json.loads(_legacy_state_path(agent).read_text(encoding="utf-8"))
        if isinstance(legacy.get("until"), (int, float)):
            candidates.append(float(legacy["until"]))
    except (OSError, ValueError, AttributeError):
        pass
    future = [c for c in candidates if c > now]
    return max(future) if future else None


def notified_without_ack(now=None, max_sec=None) -> list:
    """Agenti fermi su `NOTIFIED` da più di `max_sec`. La lista è la PROVA.

    Letta dallo stepcap-watchdog: è il segnale che gli mancava per distinguere
    «idle» (nessuno gli ha chiesto niente) da «bloccato» (gli è arrivata la
    sveglia e non ha risposto).
    """
    now = time.time() if now is None else float(now)
    limit = NOTIFIED_ACK_MAX_SEC if max_sec is None else float(max_sec)
    out = []
    for agent, entry in read_flags()["agents"].items():
        if not isinstance(entry, dict) or entry.get("state") != NOTIFIED:
            continue
        since = entry.get("since")
        if not isinstance(since, (int, float)):
            continue
        waiting = now - float(since)
        if waiting >= limit:
            out.append({"agent": agent, "since": int(since),
                        "waiting_sec": int(waiting),
                        "session": session_for(agent, entry)})
    return sorted(out, key=lambda r: r["agent"])


def status(agent=None, now=None) -> dict:
    now = time.time() if now is None else float(now)
    state = read_flags()
    rows = {}
    for name, entry in state["agents"].items():
        if agent is not None and name != str(agent).strip().lower():
            continue
        if not isinstance(entry, dict):
            continue
        row = dict(entry)
        until = entry.get("until")
        if isinstance(until, (int, float)):
            row["remaining_sec"] = max(0, int(float(until) - now))
        if isinstance(entry.get("since"), (int, float)):
            row["age_sec"] = int(now - float(entry["since"]))
        rows[name] = row
    return {"agents": rows, "notified_ack_max_sec": NOTIFIED_ACK_MAX_SEC}


# ── Gate di sicurezza ─────────────────────────────────────────────────────
def _halt_flags():
    home = _home()
    logs = home / "logs"
    return (
        ("team-halted", home / ".team-halted.flag"),
        # Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]): in standby una
        # sveglia è spesa, quindi non parte. L'agente resta IN_THROTTLE e il
        # retry lo riprende quando il flag sparisce — nessun timer perso.
        ("team-standby", home / ".team-standby.flag"),
        # daily-halt lo scrivono i tre bridge in logs/; la variante in home è
        # controllata comunque, così un cambio di posizione non ci acceca.
        ("daily-halt", logs / "daily-halt.flag"),
        ("daily-halt", home / ".daily-halt.flag"),
        ("weekly-halt", home / ".weekly-halt.flag"),
        ("weekly-halt", logs / "weekly-halt.flag"),
    )


def wake_gate(now: float):
    """None se si può svegliare, altrimenti il MOTIVO del blocco.

    Nessuna deroga, nemmeno con `.burn-intent.flag` attivo: la deroga
    dell'utente riguarda gli automatismi di SPESA (floor e ladder, che cedono
    a monte in `effective()`), un halt resta un halt.
    """
    for name, path in _halt_flags():
        try:
            if path.exists():
                return name
        except OSError:
            continue
    if not _within_working_hours(now):
        return "off-hours"
    return None


# ── La sveglia (dal sender protetto, MAI `send-keys` nudo) ────────────────
def _sender_candidates():
    here = Path(__file__).resolve().parent.parent.parent
    return ("jht-tmux-send",
            "/app/agents/_skills/tmux-send/jht-tmux-send",
            str(here / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"))


def send_wakeup(session: str, agent: str, message: str) -> int:
    """Exit code di `jht-tmux-send`. Seam dei test.

    Non si reimplementa la consegna: il sender protetto typea il testo,
    verifica che il composer si sia SVUOTATO e recupera l'Enter perso con
    `Space`+`Enter` (bounded, 3 tentativi). Qui si interpretano i suoi codici:
      0 consegnato · 2 sessione inesistente · 3 TUI irricettiva ·
      4 occupata ma VIVA (riprovare, mai rimpiazzare) · 5 testo appeso.
    """
    last = -2
    for cand in _sender_candidates():
        try:
            res = subprocess.run([cand, session, message], capture_output=True,
                                 text=True, timeout=NOTIFY_TIMEOUT_SEC)
        except FileNotFoundError:
            continue
        except (OSError, subprocess.SubprocessError) as exc:
            _log("sender %s fallito: %s" % (cand, exc))
            return -1
        if res.returncode != 0:
            _log("sender rc=%d: %s" % (res.returncode,
                                       (res.stderr or "").strip()[:300]))
        return res.returncode
    _log("nessun jht-tmux-send trovato: sveglia non consegnabile")
    return last


def notify_captain(message: str) -> bool:
    for cand in _sender_candidates():
        try:
            res = subprocess.run([cand, CAPTAIN_SESSION, message],
                                 capture_output=True, text=True, timeout=120)
        except FileNotFoundError:
            continue
        except (OSError, subprocess.SubprocessError):
            return False
        return res.returncode == 0
    return False


def wake_message(agent: str) -> str:
    return WAKE_TEXT.format(AGENT=agent.upper(), agent=agent)


# ── Un giro ───────────────────────────────────────────────────────────────
def _handle_entry(agent, entry, now, sessions) -> bool:
    """True se l'entry va rimossa dai flag."""
    state_name = entry.get("state")
    session = session_for(agent, entry)

    if state_name == ACTIVE:
        since = entry.get("since")
        gone = sessions is not None and session not in sessions
        stale = isinstance(since, (int, float)) and (now - float(since)) > ACTIVE_PRUNE_SEC
        return bool(gone or stale)

    if state_name == NOTIFIED:
        # L'ack è dell'agente: qui NON si chiude nulla. L'unica cosa che il
        # motore fa su un NOTIFIED è dimenticarlo se la sessione è morta —
        # l'escalation su un ack che non arriva è dello stepcap-watchdog.
        if sessions is not None and session not in sessions:
            emit("session_gone", agent=agent, ts=now, session=session,
                 flag=NOTIFIED)
            return True
        return False

    if state_name != IN_THROTTLE:
        return False

    until = entry.get("until")
    if not isinstance(until, (int, float)):
        # Un flag IN_THROTTLE senza scadenza non è un throttle: è un file
        # toccato a mano o troncato. Meglio liberare l'agente che tenerlo
        # fermo per sempre su un timer che non esiste.
        emit("flag_repaired", agent=agent, ts=now, reason="until assente")
        entry.update({"state": ACTIVE, "since": int(now), "until": None})
        return False

    if now < float(until):
        return False

    if sessions is not None and session not in sessions:
        emit("session_gone", agent=agent, ts=now, session=session,
             flag=IN_THROTTLE)
        return True

    gate = wake_gate(now)
    if gate:
        emit("gated", agent=agent, ts=now, session=session, gate=gate)
        entry["until"] = int(now + GATE_RETRY_SEC)
        return False

    rc = send_wakeup(session, agent, wake_message(agent))
    if rc == 0:
        waited = None
        if isinstance(entry.get("timer_armed_at"), (int, float)):
            waited = int(now - float(entry["timer_armed_at"]))
        entry.update({"state": NOTIFIED, "since": int(now), "until": None,
                      "notify_attempts": 0})
        emit("notified", agent=agent, ts=now, session=session,
             waited_sec=waited, applied_sec=entry.get("applied_sec"))
        return False

    if rc == 2:
        # La sessione non esiste più (sparita fra `list-sessions` e l'invio).
        emit("session_gone", agent=agent, ts=now, session=session, rc=rc)
        return True

    attempts = int(entry.get("notify_attempts") or 0) + 1
    entry["notify_attempts"] = attempts
    emit("notify_failed", agent=agent, ts=now, session=session, rc=rc,
         attempt=attempts)
    if attempts >= MAX_NOTIFY_ATTEMPTS:
        # Bounded: si smette di martellare ogni minuto, NON si smette di
        # provare. Il Capitano lo sa una volta, poi il ritmo scende a
        # GATE_RETRY_SEC e il contatore riparte.
        entry["notify_attempts"] = 0
        entry["until"] = int(now + GATE_RETRY_SEC)
        emit("notify_gave_up", agent=agent, ts=now, session=session, rc=rc,
             attempts=attempts)
        notify_captain(
            "[DA @SISTEMA A @CAPITANO] Non riesco a svegliare %s: la sua "
            "pausa è scaduta e %d tentativi di consegna sono falliti "
            "(jht-tmux-send rc=%d). Il pane potrebbe avere del testo appeso "
            "nel prompt (caso da Dottore, kill+recreate) o essere una shell "
            "nuda dopo un crash. Continuo a riprovare ogni %d min. "
            "Storico: logs/throttle-engine.jsonl."
            % (agent, attempts, rc, max(1, int(GATE_RETRY_SEC // 60))))
    else:
        entry["until"] = int(now + NOTIFY_RETRY_SEC)
    return False


def tick(now=None) -> dict:
    """Un giro completo. Ritorna lo stato aggiornato (comodo per i test).

    Nessun timer in memoria: si rilegge il file e si confrontano i `until`.
    È il motivo per cui un respawn del daemon non perde niente.
    """
    now = time.time() if now is None else float(now)
    state = read_flags()
    agents = state["agents"]
    sessions = live_sessions()

    for agent in list(agents):
        entry = agents.get(agent)
        if not isinstance(entry, dict):
            agents.pop(agent, None)
            continue
        try:
            if _handle_entry(agent, entry, now, sessions):
                agents.pop(agent, None)
        except Exception as exc:  # noqa: BLE001 — un agente rotto non ferma il giro
            _log("errore su %s: %s" % (agent, exc))

    last_hb = state.get("last_heartbeat")
    if last_hb is None or (now - float(last_hb)) >= HEARTBEAT_SEC:
        state["last_heartbeat"] = now
        counts = {IN_THROTTLE: 0, NOTIFIED: 0, ACTIVE: 0}
        for entry in agents.values():
            key = entry.get("state")
            if key in counts:
                counts[key] += 1
        emit("heartbeat", ts=now, in_throttle=counts[IN_THROTTLE],
             notified=counts[NOTIFIED], active=counts[ACTIVE],
             tracked=len(agents))

    write_flags(state)
    return state


# ── Freschezza del log (check del Dottore) ────────────────────────────────
def health(now=None) -> dict:
    """Il log è fresco? Un daemon di cui non sai dire se la FUNZIONE è viva è
    il guasto che ha reso invisibile la morte dell'idle-nudge: il `heartbeat`
    periodico rende la domanda decidibile."""
    now = time.time() if now is None else float(now)
    path = event_log_path()
    out = {"path": str(path), "max_age_sec": MAX_LOG_AGE_SEC}
    last, event = None, None
    try:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec.get("ts"), (int, float)):
                    last, event = float(rec["ts"]), rec.get("event")
    except OSError:
        out.update(ok=False, exists=False,
                   reason="%s non esiste: il motore non ha mai scritto" % path.name)
        return out
    out["exists"] = True
    if last is None:
        out.update(ok=False, reason="nessun record leggibile")
        return out
    age = now - last
    out.update(age_sec=round(age, 1), last_event=event,
               last_ts_iso=datetime.fromtimestamp(last, timezone.utc)
               .isoformat().replace("+00:00", "Z"))
    out["ok"] = age <= MAX_LOG_AGE_SEC
    if not out["ok"]:
        out["reason"] = ("ultimo record %.0f min fa (atteso un heartbeat ogni "
                         "%.0f min): processo vivo ma funzione ferma?"
                         % (age / 60.0, HEARTBEAT_SEC / 60.0))
    return out


# ── CLI ───────────────────────────────────────────────────────────────────
def _print_register(res: dict, fmt: str) -> None:
    if fmt == "json":
        print(json.dumps(res, ensure_ascii=False))
    elif fmt == "until":
        print(res["until"] if res.get("until") else "")
    else:
        if res.get("armed"):
            print("THROTTLE_ARMED agent=%s applied_sec=%d until=%d"
                  % (res["agent"], res["applied_sec"], res["until"]))
        else:
            print("THROTTLE_NONE agent=%s applied_sec=0" % res["agent"])


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="throttle-engine",
        description="Motore dei throttle: possiede i timer, sveglia gli agenti.")
    parser.add_argument("--once", action="store_true", help="un solo giro")
    parser.add_argument("--health", action="store_true",
                        help="freschezza di logs/throttle-engine.jsonl (exit 1 se stantio)")
    sub = parser.add_subparsers(dest="cmd")

    p_reg = sub.add_parser("register", help="arma il timer e ritorna subito")
    p_reg.add_argument("agent")
    p_reg.add_argument("seconds", nargs="?", type=int, default=None,
                       help="durata richiesta (passa comunque da effective())")
    p_reg.add_argument("--reason", default=None)
    p_reg.add_argument("--session", default=None)
    p_reg.add_argument("--print", dest="fmt", default="line",
                       choices=("line", "json", "until"))

    p_ack = sub.add_parser("ack", help="NOTIFIED → ACTIVE (lo fa l'agente)")
    p_ack.add_argument("agent")
    p_ack.add_argument("--json", action="store_true")

    p_chk = sub.add_parser("check", help="exit 1 se l'agente è ancora in attesa")
    p_chk.add_argument("agent")

    p_st = sub.add_parser("status", help="i flag correnti")
    p_st.add_argument("agent", nargs="?", default=None)
    p_st.add_argument("--json", action="store_true")
    p_st.add_argument("--print", dest="fmt", default=None,
                      choices=("until",))

    sub.add_parser("daemon", help="loop (default se non passi un comando)")

    args = parser.parse_args(argv)

    if args.health:
        res = health()
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res.get("ok") else 1

    if args.cmd == "register":
        try:
            res = register(args.agent, seconds=args.seconds, reason=args.reason,
                           session=args.session)
        except ValueError as exc:
            print("error: %s" % exc, file=sys.stderr)
            return 1
        _print_register(res, args.fmt)
        return 0

    if args.cmd == "ack":
        res = ack(args.agent)
        if args.json:
            print(json.dumps(res, ensure_ascii=False))
        elif res.get("ok"):
            print("THROTTLE_ACK agent=%s %s→ACTIVE"
                  % (res["agent"], res.get("previous") or "none"))
        else:
            if res.get("reason") == "daily-halt":
                print("DAILY_HALT_ACTIVE agent=%s retry=%ss — NON lavorare, "
                      "NON scrivere al Capitano: chiudi il turno; il motore "
                      "ti svegliera' dopo la rimozione del flag"
                      % (res["agent"], res.get("remaining_sec")),
                      file=sys.stderr)
            else:
                print("ACK_REFUSED agent=%s remaining=%ss — sei ancora in pausa, "
                      "ti sveglio io: chiudi il turno"
                      % (res["agent"], res.get("remaining_sec")), file=sys.stderr)
        return 0 if res.get("ok") else 1

    if args.cmd == "check":
        until = pending_until(args.agent)
        if until is None:
            return 0
        print("STILL_THROTTLED agent=%s remaining=%ds"
              % (args.agent, int(until - time.time())), file=sys.stderr)
        return 1

    if args.cmd == "status":
        if args.fmt == "until":
            until = pending_until(args.agent) if args.agent else None
            print(int(until) if until else "")
            return 0
        res = status(args.agent)
        if args.json:
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0
        if not res["agents"]:
            print("nessun flag")
            return 0
        for name in sorted(res["agents"]):
            row = res["agents"][name]
            extra = ""
            if row.get("remaining_sec") is not None:
                extra = " remaining=%ss" % row["remaining_sec"]
            elif row.get("age_sec") is not None:
                extra = " da %ss" % row["age_sec"]
            print("%-16s %-12s%s" % (name, row.get("state"), extra))
        return 0

    if args.once:
        tick()
        return 0

    _log("up — interval=%ds jht_home=%s ack_max=%ds"
         % (INTERVAL_SEC, _home(), NOTIFIED_ACK_MAX_SEC))
    while True:
        try:
            tick()
        except Exception as exc:  # noqa: BLE001 — il loop non muore mai in silenzio
            _log("tick error: %s" % exc)
        time.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    sys.exit(main())
