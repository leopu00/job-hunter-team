#!/usr/bin/env python3
"""stepcap-watchdog.py — riprende gli agenti fermi sul cap di step.

Il cap `max_steps=100` **interrompe** l'agente ma non lo **termina**: la sessione
tmux resta viva, il pane risponde, l'ultima riga è

    Max number of steps reached: 100
    Send another message to continue where it left off.

e l'agente aspetta un input che nessun componente del sistema era incaricato di
mandare. Osservato in produzione il 2026-07-28: l'unico Scout attivo fermo così,
coda degli Analisti svuotata, Scorer senza lavoro — con 6 posizioni/ora e load
0,27 su 4 core, cioè un sistema che da ogni indicatore sembrava sano.
I watchdog esistenti non lo vedono: `agent-watchdog.sh` controlla che la sessione
ESISTA e che il pane non sia degradato a bash idle, e uno stallo sul cap supera
entrambi i controlli. Vedi `docs/internal/roadmap/2026-07-28-ticket-stepcap-throttle-resume.md`.

Ciclo (default 60s), per ogni sessione WORKER (i core NON si nudgeano in
automatico — il Capitano non è un worker):

  1. RILEVAZIONE — `tmux capture-pane -p -t <SESSIONE>`, ultime 40 righe. Due
     strade, entrambe ancorate all'hash del pane IDENTICO al giro precedente:
     (a) col marcatore nelle ultime righe NON VUOTE → stallo subito. Il
         marcatore resta nello scrollback anche dopo la ripresa: trovarlo non
         basta, e senza il controllo sull'hash questo watchdog diventa un
         generatore di nudge a raffica su un agente che sta lavorando.
     (b) SENZA marcatore, se il pane non si muove per `IDLE_STALL_ROUNDS` giri
         → stallo lo stesso. Aggiunta il 2026-07-30, dopo che quattro VPS
         riportavano `stalled: 0` in contemporanea con worker fermi da ore:
         i marcatori esistono solo per Kimi, quindi la strada (a) da sola
         rendeva il watchdog inerte su tutto il resto della flotta. Gli stalli
         che ci hanno morso — turno abortito su 429, riga appesa nel composer,
         attesa di una sveglia soppressa — non stampano nulla.
  2. THROTTLE — si scrive `$JHT_HOME/state/throttle-<agent>.json` nello stesso
     formato di `agents/_tools/jht-throttle`, con durata presa dalla
     `THROTTLE_LADDER` di `shared/skills/throttle-config.py` partendo dal rung
     corrente dell'agente. La pausa è il cuore, non un dettaglio: il cap di 100
     step è spesso il sintomo di un rabbit-hole e rimettere in moto l'agente
     subito lo rimanda nello stesso loop.
  3. RIPRESA — alla scadenza, messaggio via BUFFER tmux (mai `send-keys` col
     testo inline: il quoting salta al primo apice).

## Il secondo segnale: un ack che non arriva (2026-07-30)

Il ciclo sopra guarda il PANE, e il pane non sa dire se un agente è inattivo o
bloccato. Il motore dei throttle (`shared/skills/throttle_engine.py`) produce un
segnale che invece lo sa: manda la sveglia, mette il flag su `NOTIFIED`, e
aspetta che sia **l'agente** a flipparlo su `ACTIVE` con `throttle-ack`. Un flag
fermo su `NOTIFIED` oltre la soglia non è «forse idle»: la sveglia è partita e
non ha risposto. Questo watchdog legge quella lista (`notified_without_ack()`) e
la porta al Capitano — è il segnale che gli mancava per distinguere `idle` da
`bloccato`, il buco che tutti i watchdog attuali condividono.

Backoff sugli stalli consecutivi (il contatore si azzera solo quando l'agente
PRODUCE una riga nuova a suo nome, non quando riparte — ripartire e rifermarsi
non è progresso):

  | stallo | azione                                                   |
  |--------|----------------------------------------------------------|
  |   1°   | throttle al rung corrente, poi continua                  |
  |   2°   | throttle al rung SUCCESSIVO, poi continua                |
  |   3°   | throttle al rung successivo, continua E avvisa il Capitano |
  |   4°   | NIENTE continua — escalation al Capitano (/clear o respawn) |

Gate di sicurezza (il watchdog RIPRENDE gli agenti, non aggira i freni): niente
ripresa con `.team-halted.flag`, `.team-standby.flag`, `daily-halt.flag` o
`.weekly-halt.flag` presenti, fuori dalle working hours, o col tetto di
sessioni saturo.

Osservabilità: ogni decisione va su `$JHT_HOME/logs/stepcap.jsonl`, un record per
evento. Il predecessore di questo meccanismo scriveva su `logs/idle-nudge.jsonl`
e la sua morte è stata invisibile finché non si è andati a cercare il file e non
c'era: per questo il log porta anche un `heartbeat` periodico (un file fermo =
watchdog fermo, senza ambiguità con "nessuno stallo") e il Dottore ne controlla
la freschezza con `--health`.

Limite noto (da verificare sul campo, non in laboratorio): la seconda condizione
è un'uguaglianza di hash, quindi una TUI che ridisegna qualcosa di variabile in
fondo al pane anche da ferma (un orologio, un contatore) renderebbe il pane
"sempre diverso" e la rilevazione non scatterebbe mai. Le righe vuote e gli
spazi in coda sono già normalizzati via; se dovesse servire, `JHT_STEPCAP_TAIL`
e `JHT_STEPCAP_MARKER_TAIL` regolano quanta parte del pane si guarda senza
toccare il codice. Il fallimento è nella direzione sicura: niente nudge.

Modi:
    python3 stepcap-watchdog.py             # loop (avviato da pid1)
    python3 stepcap-watchdog.py --once      # un solo giro, poi esce
    python3 stepcap-watchdog.py --health    # freschezza del log (check Dottore)
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Parametri (tutti override-abili da env: il default è il comportamento
#    descritto nel ticket, l'env serve ai test e alla diagnosi sul campo) ──
INTERVAL_SEC = float(os.environ.get("JHT_STEPCAP_INTERVAL", "60"))
TAIL_LINES = int(os.environ.get("JHT_STEPCAP_TAIL", "40"))
# Quante righe NON VUOTE in fondo al pane possono contenere il marcatore perché
# lo stallo sia "corrente". Più largo del testo del marcatore (2 righe) perché
# le TUI ci disegnano sotto il composer: 10 copre il box senza arrivare a
# pescare un marcatore di mezz'ora fa rimasto nello scrollback.
MARKER_TAIL_LINES = int(os.environ.get("JHT_STEPCAP_MARKER_TAIL", "10"))
HEARTBEAT_SEC = float(os.environ.get("JHT_STEPCAP_HEARTBEAT_SEC", "900"))
# Freschezza attesa del log per il check del Dottore: 3 battiti mancati.
MAX_LOG_AGE_SEC = float(os.environ.get("JHT_STEPCAP_MAX_AGE_SEC",
                                       str(3 * HEARTBEAT_SEC)))
ESCALATE_AT = int(os.environ.get("JHT_STEPCAP_ESCALATE_AT", "4"))
ESCALATE_COOLDOWN_SEC = float(os.environ.get("JHT_STEPCAP_ESCALATE_COOLDOWN", "3600"))
# Quando un gate blocca la ripresa non si molla l'agente: si ricontrolla più
# tardi. 15 min tiene il log leggibile durante un halt lungo e resta una prova
# periodica che il watchdog è vivo e sta aspettando, non che si è dimenticato.
GATE_RETRY_SEC = float(os.environ.get("JHT_STEPCAP_GATE_RETRY", "900"))
# Soglia dell'ack mancato. Default: quella del motore dei throttle, così esiste
# UN numero e non due che divergono. L'env serve ai test e alla diagnosi.
NOTIFIED_ACK_MAX_SEC = os.environ.get("JHT_STEPCAP_ACK_MAX")
# Un agente fermo su NOTIFIED resta fermo: senza cooldown il Capitano riceve lo
# stesso avviso a ogni giro (60s) finché qualcuno non interviene.
ACK_ESCALATE_COOLDOWN_SEC = float(os.environ.get("JHT_STEPCAP_ACK_COOLDOWN", "3600"))
CAPTAIN_SESSION = os.environ.get("JHT_STEPCAP_CAPTAIN", "CAPITANO")
TMUX_BUFFER = "jht-stepcap"
# Giri consecutivi di pane IMMOBILE che valgono uno stallo anche SENZA
# marcatore. Un turno in corso non è immobile — il timer del render cambia a
# ogni secondo, quindi l'hash cambia; immobile vuol dire che non sta uscendo
# nulla. A INTERVAL_SEC=60 il default sono 15 minuti di nulla, abbastanza da
# non confondere una pausa con uno stallo. Serve perché lo stallo che ci ha
# morso non porta marcatori: turno abortito su 429, riga appesa nel composer,
# agente in attesa di una sveglia soppressa. Nessuno di questi stampa niente.
IDLE_STALL_ROUNDS = int(os.environ.get("JHT_STEPCAP_IDLE_ROUNDS", "15"))

# ── Marcatori per PROVIDER ────────────────────────────────────────────────
# Il testo cambia da CLI a CLI: cablarne uno solo rende il watchdog inutile al
# primo cambio di provider. Si cercano quelli di TUTTI i provider (una stringa
# così specifica non collide) — gli elenchi vuoti sono i provider su cui il
# testo non è ancora stato osservato, e si riempiono man mano.
STEP_CAP_MARKERS = {
    "kimi": ("Max number of steps reached",),
    # Vuote NON per dimenticanza: Claude e Codex non stampano un marcatore di
    # step-cap noto. Finché la rilevazione dipendeva SOLO da questa tabella,
    # però, il watchdog era inerte su tutte le VPS che non girano su Kimi:
    # `find_marker` tornava sempre None, il blocco (d) usciva subito e
    # l'heartbeat riportava `stalled: 0` per sempre. Misurato il 2026-07-30 su
    # 4 VPS contemporaneamente — con worker fermi da 7h, agenti morti su un 429
    # e pane con la riga appesa nel composer, tutti classificati `phase: idle`.
    # Da lì la rilevazione senza marcatore qui sotto (IDLE_STALL_ROUNDS): non
    # servono i marcatori per accorgersi che un pane non si muove.
    "claude": (),
    "codex": (),
}
# Estensione a caldo, senza rebuild: un marcatore per riga (righe `#` = commento).
MARKERS_FILE_NAME = "stepcap-markers.txt"

# Sessioni sorvegliate: SOLO i worker. `CRITICO-S12` è legittimo, quindi il
# suffisso non è per forza numerico (per questo non si riusa `_is_worker` di
# throttle-config, che assume `-<N>`).
WORKER_SESSION_RE = re.compile(
    r"^(scout|analista|scorer|scrittore|critico)(-[a-z0-9_]+)?$", re.IGNORECASE)

RESUME_TEXT = ("[DA @SISTEMA A @{AGENT}] Continua da dove ti eri fermato. "
               "Se il compito corrente è in stallo, chiudilo e passa al "
               "successivo della coda.")


# ── Path (risolti a ogni chiamata: JHT_HOME può cambiare tra i test) ──────
def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _logs_dir() -> Path:
    return _home() / "logs"


def event_log_path() -> Path:
    return _logs_dir() / "stepcap.jsonl"


def _state_path() -> Path:
    return _logs_dir() / "stepcap-watchdog-state.json"


def _throttle_state_path(agent: str) -> Path:
    return _home() / "state" / ("throttle-%s.json" % agent)


def _resume_msg_path(agent: str) -> Path:
    return _home() / "state" / ("stepcap-msg-%s.txt" % agent)


def _log(msg: str) -> None:
    print("[stepcap-watchdog] %s" % msg, flush=True)


# ── Import a caldo delle infrastrutture condivise ─────────────────────────
# Stesso pattern degli altri bridge: prova il path del container, poi quello
# relativo al repo (test/dev). Qualunque errore degrada, non abbatte il loop.
_MODULE_CACHE: dict = {}


def _load_shared(name: str, filename: str):
    if name in _MODULE_CACHE:
        return _MODULE_CACHE[name]
    mod = None
    for cand in (Path("/app/shared/skills") / filename,
                 Path(__file__).resolve().parent.parent / "shared" / "skills" / filename):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            break
        except Exception as exc:  # noqa: BLE001 — un import rotto non ferma il watchdog
            _log("import %s fallito: %s" % (filename, exc))
            mod = None
    _MODULE_CACHE[name] = mod
    return mod


def _throttle_config():
    return _load_shared("throttle_config", "throttle-config.py")


def _throttle_engine():
    return _load_shared("throttle_engine", "throttle_engine.py")


def ladder() -> list:
    """La scala delle durate è quella di `shared/skills/throttle-config.py`.

    Fallback degradato (modulo non caricabile): un solo gradino da 5 min, cioè
    il worker floor. Meglio una pausa fissa che una copia della ladder qui: le
    due divergerebbero al primo cambio (è già successo — i gradini sono passati
    da multipli di 5 a minuti primi).
    """
    mod = _throttle_config()
    values = getattr(mod, "THROTTLE_LADDER", None) if mod else None
    return list(values) if values else [300]


def _current_throttle_sec(agent: str) -> int:
    """Rung corrente dell'agente (throttle EFFETTIVO da config, floor incluso)."""
    mod = _throttle_config()
    if not mod:
        return 0
    try:
        return int(mod.get_agent(agent))
    except Exception:  # noqa: BLE001
        return 0


def _rung_index(seconds: int) -> int:
    rungs = ladder()
    for i, value in enumerate(rungs):
        if seconds <= value:
            return i
    return len(rungs) - 1


def throttle_for(agent: str, consecutive: int) -> int:
    """1° stallo = rung corrente, ogni stallo successivo un gradino più su."""
    rungs = ladder()
    base = _rung_index(_current_throttle_sec(agent))
    return rungs[min(base + max(0, consecutive - 1), len(rungs) - 1)]


def _within_working_hours(now: float) -> bool:
    """Fail-open: senza il modulo o senza config si lavora (team 24/7)."""
    mod = _load_shared("working_hours", "working_hours.py")
    if not mod:
        return True
    try:
        return bool(mod.is_within_working_hours(
            datetime.fromtimestamp(now, timezone.utc)))
    except Exception:  # noqa: BLE001
        return True


def _host_agent_cap():
    mod = _load_shared("plan_registry", "plan_registry.py")
    if not mod:
        return None
    try:
        return mod._host_agent_cap()  # noqa: SLF001 — unica fonte del tetto RAM
    except Exception:  # noqa: BLE001
        return None


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


def list_sessions():
    """[(nome, session_created)] di tutte le sessioni tmux vive."""
    out = _tmux("list-sessions", "-F", "#{session_name}|#{session_created}")
    if not out:
        return []
    sessions = []
    for line in out.splitlines():
        name, _, created = line.partition("|")
        name = name.strip()
        if name:
            sessions.append((name, created.strip()))
    return sessions


def capture_pane(session: str):
    return _tmux("capture-pane", "-p", "-t", session)


def is_worker_session(name: str) -> bool:
    return bool(WORKER_SESSION_RE.match(name.strip()))


def _active_provider() -> str:
    try:
        cfg = json.loads((_home() / "jht.config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    return str(cfg.get("active_provider") or "").strip().lower()


def markers() -> tuple:
    """Marcatori di cap: tabella per provider + estensioni da file/env."""
    found = []
    for values in STEP_CAP_MARKERS.values():
        found.extend(values)
    try:
        raw = (_home() / "config" / MARKERS_FILE_NAME).read_text(encoding="utf-8")
        found.extend(ln.strip() for ln in raw.splitlines()
                     if ln.strip() and not ln.lstrip().startswith("#"))
    except OSError:
        pass
    found.extend(m.strip() for m in os.environ.get("JHT_STEPCAP_MARKERS", "").split("|")
                 if m.strip())
    # dedup mantenendo l'ordine
    return tuple(dict.fromkeys(found))


# ── Lettura del pane ──────────────────────────────────────────────────────
def pane_tail(pane: str) -> list:
    """Ultime TAIL_LINES righe non vuote, normalizzate (niente spazi in coda).

    Le righe vuote sono scartate PRIMA dell'hash: un cursore che lampeggia o
    una riga di padding che cambia non devono far sembrare "vivo" un pane fermo.
    """
    lines = [ln.rstrip() for ln in pane.splitlines()]
    return [ln for ln in lines if ln.strip()][-TAIL_LINES:]


def pane_hash(tail: list) -> str:
    return hashlib.sha1("\n".join(tail).encode("utf-8", "replace")).hexdigest()


def find_marker(tail: list):
    """Marcatore presente nelle ultime MARKER_TAIL_LINES righe NON VUOTE."""
    window = tail[-MARKER_TAIL_LINES:]
    for marker in markers():
        for line in window:
            if marker in line:
                return marker
    return None


# ── Produzione (il contatore si azzera solo se l'agente PRODUCE) ──────────
def _production_spec(agent: str):
    """(tabella, colonna autore) per il ruolo, dalla mappa del Dottore."""
    mod = _load_shared("doctor_analytics", "doctor_analytics.py")
    table = getattr(mod, "PRODUCTION", None) if mod else None
    if not table:
        return None
    role = re.sub(r"-.*$", "", agent.strip().lower())
    spec = table.get(role)
    return (spec[0], spec[1]) if spec else None


def produced_count(agent: str):
    """Righe attribuite all'agente in positions/scores/applications.

    None = non misurabile (DB assente o rotto). Volutamente NON filtrato per
    finestra: serve solo il confronto con il valore allo stallo precedente.
    """
    spec = _production_spec(agent)
    if not spec:
        return None
    table, by_col = spec
    db = _home() / "jobs.db"
    try:
        if not db.exists() or db.stat().st_size == 0:
            return None  # jobs.db a 0 byte: già visto, non è un DB vuoto
    except OSError:
        return None
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
        try:
            # `<agente>` oppure `<agente> (codex)`: il match a prefisso nudo
            # (`scout-1%`) prenderebbe anche scout-11 — e un collega che produce
            # azzererebbe il contatore di chi è fermo.
            row = conn.execute(
                "SELECT COUNT(*) FROM %s WHERE LOWER(%s) = ? OR LOWER(%s) LIKE ?"
                % (table, by_col, by_col),
                (agent.lower(), agent.lower() + " %")).fetchone()
        finally:
            conn.close()
        return int(row[0]) if row else None
    except sqlite3.Error:
        return None


# ── Log eventi ────────────────────────────────────────────────────────────
def emit(event: str, agent=None, ts=None, **fields) -> dict:
    # `ts` è l'orologio del GIRO, non quello della riga: è il tempo su cui il
    # watchdog ha deciso, ed è quello che rende verificabile "fra throttled e
    # resumed sono passati almeno throttle_sec secondi".
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


# ── Stato ─────────────────────────────────────────────────────────────────
def _new_entry(created=None) -> dict:
    return {
        "session_created": created,
        "phase": "idle",        # idle | throttled | resumed | escalated
        "hash": None,           # hash del giro precedente (condizione #2)
        "stall_hash": None,     # hash al momento della rilevazione
        "consecutive": 0,
        "until": None,
        "throttle_sec": None,
        "produced": None,       # produzione all'ultimo stallo (baseline)
        "resume_hash": None,
        "last_escalate_ts": None,
        "immobile": 0,          # giri consecutivi di pane fermo senza marcatore
    }


def read_state() -> dict:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"agents": {}, "last_heartbeat": None}
    if not isinstance(data, dict):
        return {"agents": {}, "last_heartbeat": None}
    data.setdefault("agents", {})
    data.setdefault("last_heartbeat", None)
    return data


def write_state(state: dict) -> None:
    path = _state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        _log("scrittura stato fallita: %s" % exc)


# ── Throttle (stesso formato di agents/_tools/jht-throttle) ───────────────
def write_throttle(agent: str, seconds: int, now: float) -> Path:
    path = _throttle_state_path(agent)
    payload = {
        "agent": agent,
        "id": "stepcap-%d" % int(now),
        "until": int(now + seconds),
        "started": int(now),
        "applied_sec": int(seconds),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return path


def clear_throttle(agent: str) -> None:
    try:
        _throttle_state_path(agent).unlink()
    except OSError:
        pass


# ── Gate di sicurezza ─────────────────────────────────────────────────────
def _halt_flags():
    home, logs = _home(), _logs_dir()
    return (
        ("team-halted", home / ".team-halted.flag"),
        # Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]): in standby anche
        # questo watchdog tace — niente nudge, niente kick-off. La sveglia è
        # del sentinel-bridge; alla rimozione del flag il retry (GATE_RETRY_SEC)
        # riprende gli agenti ancora fermi sul cap.
        ("team-standby", home / ".team-standby.flag"),
        # daily-halt lo scrivono i tre bridge in logs/; la variante in home
        # è controllata comunque, così un cambio di posizione non ci acceca.
        ("daily-halt", logs / "daily-halt.flag"),
        ("daily-halt", home / ".daily-halt.flag"),
        ("weekly-halt", home / ".weekly-halt.flag"),
        ("weekly-halt", logs / "weekly-halt.flag"),
    )


def resume_gate(now: float, live_workers: int = 0):
    """None se si può riprendere, altrimenti il MOTIVO del blocco.

    Questo watchdog RIPRENDE gli agenti, non aggira i freni di sicurezza:
    nessuna deroga, nemmeno con `.burn-intent.flag` attivo — la deroga
    dell'utente riguarda gli automatismi di SPESA, e un halt resta un halt.
    """
    for name, path in _halt_flags():
        try:
            if path.exists():
                return name
        except OSError:
            continue
    if not _within_working_hours(now):
        return "off-hours"
    cap = _host_agent_cap()
    # Tetto di sessioni saturo: la macchina è già oltre quel che regge e
    # l'agente stava per essere terminato comunque — rimetterlo in moto
    # peggiorerebbe il thrash invece di produrre.
    if cap is not None and live_workers > cap:
        return "session-cap"
    return None


# ── Ripresa via buffer tmux ───────────────────────────────────────────────
def send_resume(session: str, agent: str, message: str) -> bool:
    """Scrive su file e passa dai buffer tmux.

    MAI `send-keys` col testo inline: il quoting salta al primo apice del
    messaggio (ed è il motivo per cui questo passaggio è scritto così nel
    ticket). `-d` scarica il buffer dopo il paste: non lasciamo il testo nella
    paste-history dell'utente.
    """
    path = _resume_msg_path(agent)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(message, encoding="utf-8")
    except OSError as exc:
        _log("scrittura messaggio di ripresa fallita: %s" % exc)
        return False
    if _tmux("load-buffer", "-b", TMUX_BUFFER, str(path)) is None:
        return False
    if _tmux("paste-buffer", "-b", TMUX_BUFFER, "-d", "-t", session) is None:
        return False
    # Le TUI Ink non registrano l'Enter se arriva prima del render del testo.
    time.sleep(float(os.environ.get("JHT_STEPCAP_PASTE_SETTLE", "0.5")))
    if _tmux("send-keys", "-t", session, "Enter") is None:
        return False
    if _active_provider() == "kimi":
        # Kimi può accodare il prompt: Ctrl-S ne forza il submit (stesso
        # accorgimento di jht-tmux-send). Innocuo se l'Enter è già passato.
        time.sleep(0.2)
        _tmux("send-keys", "-t", session, "C-s")
    return True


def notify_captain(message: str) -> bool:
    for cand in ("jht-tmux-send",
                 "/app/agents/_skills/tmux-send/jht-tmux-send"):
        try:
            res = subprocess.run([cand, CAPTAIN_SESSION, message],
                                 capture_output=True, text=True, timeout=120)
        except FileNotFoundError:
            continue
        except (OSError, subprocess.SubprocessError):
            return False
        return res.returncode == 0
    return False


# ── Un giro ───────────────────────────────────────────────────────────────
def _handle_agent(session, agent, entry, now, live_workers):
    pane = capture_pane(session)
    if pane is None:
        return  # tmux non risponde per questa sessione: si riprova al giro dopo
    tail = pane_tail(pane)
    current = pane_hash(tail)
    marker = find_marker(tail)
    phase = entry.get("phase", "idle")

    # (a) Verifica post-ripresa: il pane deve muoversi entro un giro. Se non si
    #     muove il paste non è entrato — va detto, non nascosto.
    if phase == "resumed":
        if current == entry.get("resume_hash"):
            emit("resume_failed", agent=agent, ts=now, session=session,
                 consecutive=entry.get("consecutive"))
        entry.update(phase="idle", hash=current, resume_hash=None,
                     stall_hash=None, immobile=0)
        return

    # (b) Throttle in corso.
    if phase == "throttled":
        if now < (entry.get("until") or 0):
            return
        if current != entry.get("stall_hash"):
            # L'agente è ripartito da solo (o qualcuno gli ha scritto): niente
            # nudge. Il contatore NON si azzera — solo la produzione lo azzera.
            emit("recovered", agent=agent, ts=now, session=session,
                 consecutive=entry.get("consecutive"))
            clear_throttle(agent)
            entry.update(phase="idle", hash=current, until=None, stall_hash=None,
                         immobile=0)
            return
        gate = resume_gate(now, live_workers)
        if gate:
            emit("gated", agent=agent, ts=now, session=session, gate=gate,
                 consecutive=entry.get("consecutive"))
            entry["until"] = now + GATE_RETRY_SEC
            return
        clear_throttle(agent)
        message = RESUME_TEXT.format(AGENT=agent.upper())
        if send_resume(session, agent, message):
            emit("resumed", agent=agent, ts=now, session=session,
                 consecutive=entry.get("consecutive"),
                 throttle_sec=entry.get("throttle_sec"))
            entry.update(phase="resumed", resume_hash=current, hash=None,
                         until=None, stall_hash=None)
        else:
            emit("resume_send_failed", agent=agent, ts=now, session=session,
                 consecutive=entry.get("consecutive"))
            entry.update(phase="idle", hash=None, until=None, stall_hash=None,
                         immobile=0)
        return

    # (c) Escalation in corso: non si tocca più finché il pane non cambia.
    if phase == "escalated":
        if current != entry.get("stall_hash"):
            emit("recovered", agent=agent, ts=now, session=session,
                 consecutive=entry.get("consecutive"))
            entry.update(phase="idle", hash=current, stall_hash=None, immobile=0)
        return

    # (d) RILEVAZIONE. Due strade verso lo stesso verdetto:
    #     - marcatore in coda E pane immobile → stallo subito (via storica);
    #     - nessun marcatore ma pane immobile da IDLE_STALL_ROUNDS giri →
    #       stallo lo stesso. Senza questa seconda strada il watchdog vede
    #       solo gli stalli che si annunciano da soli, cioè quasi nessuno.
    previous = entry.get("hash")
    entry["hash"] = current
    if previous is None or previous != current:
        entry["immobile"] = 0
        return
    if marker:
        entry["immobile"] = 0
    else:
        rounds = int(entry.get("immobile") or 0) + 1
        entry["immobile"] = rounds
        if rounds < IDLE_STALL_ROUNDS:
            return
        # Fermo DEVE essere fermo: durante un halt o fuori finestra l'immobilità
        # è il comportamento giusto. Si continua a contare (così alla riapertura
        # il verdetto è immediato) ma non si chiama stallo ciò che è un ordine.
        if resume_gate(now, live_workers):
            return
        marker = f"nessun marcatore: pane immobile da {rounds} giri"

    produced = produced_count(agent)
    baseline = entry.get("produced")
    progressed = (baseline is not None and produced is not None
                  and produced > baseline)
    consecutive = 1 if (progressed or not entry.get("consecutive")) \
        else int(entry["consecutive"]) + 1
    entry["consecutive"] = consecutive
    entry["produced"] = produced
    entry["stall_hash"] = current
    emit("detected", agent=agent, ts=now, session=session, marker=marker,
         consecutive=consecutive, produced=produced)

    if consecutive >= ESCALATE_AT:
        entry["phase"] = "escalated"
        entry["until"] = None
        emit("escalated", agent=agent, ts=now, session=session, marker=marker,
             consecutive=consecutive)
        last = entry.get("last_escalate_ts") or 0
        if now - last >= ESCALATE_COOLDOWN_SEC:
            entry["last_escalate_ts"] = now
            notify_captain(
                "[DA @SISTEMA A @CAPITANO] %s è finito sul cap di step %d volte "
                "di fila senza produrre nulla in mezzo: è un rabbit-hole, non un "
                "incidente. NON lo riprendo più in automatico — decidi tu "
                "(`/clear` o respawn). Storico: logs/stepcap.jsonl."
                % (agent, consecutive))
        return

    seconds = throttle_for(agent, consecutive)
    try:
        write_throttle(agent, seconds, now)
    except OSError as exc:
        _log("throttle non scritto per %s: %s" % (agent, exc))
    entry.update(phase="throttled", until=now + seconds, throttle_sec=seconds)
    emit("throttled", agent=agent, ts=now, session=session, marker=marker,
         consecutive=consecutive, throttle_sec=seconds)
    if consecutive == ESCALATE_AT - 1:
        notify_captain(
            "[DA @SISTEMA A @CAPITANO] %s è finito sul cap di step %d volte di "
            "fila senza produrre nulla in mezzo. L'ho messo in pausa %d min e "
            "poi lo riprendo: se ci ricasca smetto di riprenderlo e passo la "
            "decisione a te. Il cap di 100 step è di solito un rabbit-hole — "
            "vale la pena guardare cosa sta girando."
            % (agent, consecutive, max(1, seconds // 60)))


def check_missing_acks(state: dict, now: float) -> list:
    """Agenti che hanno ricevuto la sveglia e non hanno firmato: ESCALATION.

    È l'altro segnale di questo watchdog, e l'unico DETERMINISTICO. Il ciclo del
    cap di step guarda il pane e deve indovinare; qui non si indovina: il motore
    dei throttle ha mandato la sveglia, ha scritto `NOTIFIED` con l'ora, e ha
    lasciato l'ack all'agente. Se il flag è ancora lì dopo N minuti l'agente non
    è inattivo — non ha risposto a una richiesta che gli è arrivata.

    Nessun nudge: questo watchdog non sa cosa ha bloccato l'agente e riprovare a
    scrivergli è ciò che ha già fallito. Si porta la prova al Capitano, che
    decide (`/clear` o respawn).
    """
    mod = _throttle_engine()
    if mod is None:
        return []
    try:
        limit = float(NOTIFIED_ACK_MAX_SEC) if NOTIFIED_ACK_MAX_SEC \
            else float(mod.NOTIFIED_ACK_MAX_SEC)
        stuck = mod.notified_without_ack(now=now, max_sec=limit)
    except Exception as exc:  # noqa: BLE001 — il segnale nuovo non abbatte il giro
        _log("lettura dei flag di throttle fallita: %s" % exc)
        return []
    if not stuck:
        # Nessuno fermo: si buttano i cooldown, così un agente che si ribloccasse
        # domani viene segnalato subito e non dopo un'ora di silenzio.
        state.pop("ack_escalations", None)
        return []

    sent = state.setdefault("ack_escalations", {})
    if not isinstance(sent, dict):
        sent = {}
        state["ack_escalations"] = sent
    for row in stuck:
        agent = row["agent"]
        emit("notified_no_ack", agent=agent, ts=now, session=row.get("session"),
             waiting_sec=row.get("waiting_sec"), threshold_sec=int(limit))
        last = sent.get(agent) or 0
        if now - float(last) < ACK_ESCALATE_COOLDOWN_SEC:
            continue
        sent[agent] = now
        notify_captain(
            "[DA @SISTEMA A @CAPITANO] %s ha ricevuto la sveglia dal motore dei "
            "throttle %d min fa e non ha ancora firmato l'ack (flag fermo su "
            "NOTIFIED). Non è «forse idle»: la sveglia è arrivata e non ha "
            "risposto, quindi è bloccato. Non gli scrivo altro — decidi tu "
            "(`/clear` o respawn). Prova: state/throttle-flags.json, storico "
            "logs/throttle-engine.jsonl."
            % (agent, max(1, int(row.get("waiting_sec", 0) // 60))))
    # Un agente che ha firmato non deve portarsi dietro il suo cooldown.
    live = {row["agent"] for row in stuck}
    for gone in [a for a in sent if a not in live]:
        sent.pop(gone, None)
    return stuck


def tick(now=None) -> dict:
    """Un giro completo. Ritorna lo stato aggiornato (comodo per i test)."""
    now = time.time() if now is None else float(now)
    state = read_state()
    agents = state["agents"]

    sessions = [(name, created) for name, created in list_sessions()
                if is_worker_session(name)]
    live_workers = len(sessions)
    seen = set()
    for session, created in sessions:
        agent = session.lower()
        seen.add(agent)
        entry = agents.get(agent)
        if not isinstance(entry, dict) or entry.get("session_created") != created:
            # Sessione nuova (primo giro o respawn dopo un'escalation): stato
            # pulito, contatore incluso — è un'altra istanza dell'agente.
            entry = _new_entry(created)
            agents[agent] = entry
        try:
            _handle_agent(session, agent, entry, now, live_workers)
        except Exception as exc:  # noqa: BLE001 — un agente rotto non ferma il giro
            _log("errore su %s: %s" % (session, exc))

    for gone in [a for a in agents if a not in seen]:
        agents.pop(gone, None)

    # Ack mancati: fuori dal ciclo per sessione, perché il segnale non viene dal
    # pane e vale anche per un agente che il pane mostrerebbe perfettamente sano.
    try:
        missing_acks = check_missing_acks(state, now)
    except Exception as exc:  # noqa: BLE001
        _log("controllo degli ack fallito: %s" % exc)
        missing_acks = []

    last_hb = state.get("last_heartbeat")
    if last_hb is None or (now - float(last_hb)) >= HEARTBEAT_SEC:
        state["last_heartbeat"] = now
        stalled = sum(1 for e in agents.values()
                      if e.get("phase") in ("throttled", "escalated"))
        emit("heartbeat", ts=now, watched=live_workers, stalled=stalled,
             no_ack=len(missing_acks) or None)

    write_state(state)
    return state


# ── Freschezza del log (check del Dottore) ────────────────────────────────
def health(now=None) -> dict:
    """Il log è fresco? Un watchdog senza log è un watchdog di cui non sai dire
    se è vivo: `logs/idle-nudge.jsonl` non esisteva proprio, e nessuno se n'era
    accorto. Il `heartbeat` periodico rende questa domanda decidibile."""
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
                   reason="%s non esiste: il watchdog non ha mai scritto" % path.name)
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


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="stepcap-watchdog",
        description="Riprende gli agenti fermi sul cap di step (throttle in mezzo).")
    parser.add_argument("--once", action="store_true", help="un solo giro")
    parser.add_argument("--health", action="store_true",
                        help="freschezza di logs/stepcap.jsonl (exit 1 se stantio)")
    args = parser.parse_args(argv)

    if args.health:
        res = health()
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res.get("ok") else 1

    if args.once:
        tick()
        return 0

    _log("up — interval=%ds markers=%d jht_home=%s"
         % (INTERVAL_SEC, len(markers()), _home()))
    while True:
        try:
            tick()
        except Exception as exc:  # noqa: BLE001 — il loop non muore mai in silenzio
            _log("tick error: %s" % exc)
        time.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    sys.exit(main())
