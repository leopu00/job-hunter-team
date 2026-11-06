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
  2. THROTTLE — la pausa la arma il MOTORE dei throttle (`throttle_engine.register`, la stessa pausa tracciata di
     ogni altro: flag, log `start`/`end`, sveglia, recupero di una pausa persa), con durata presa dalla
     `THROTTLE_LADDER` di `shared/skills/throttle-config.py` partendo dal rung corrente dell'agente. Una pausa sola:
     il vecchio file `$JHT_HOME/state/throttle-<agent>.json` si scrive solo se il motore non si carica. La pausa è il
     cuore, non un dettaglio: il cap di 100 step è spesso il sintomo di un rabbit-hole e rimettere in moto l'agente
     subito lo rimanda nello stesso loop. Un agente che aspetta lavoro (ruolo con coda, coda vuota) o che sta
     dentro una pausa del motore NON e' fermo: il pane immobile e' il suo comportamento giusto (un team reale, 02/11:
     lo Scorer con la coda vuota ricevette pause del watchdog sopra quelle del motore, per ore).
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
# Dopo la fine di una pausa armata nel motore, il motore sveglia l'agente al suo giro: il watchdog aspetta questo tanto
# prima di mandare lui la ripresa (motore fermo).
ENGINE_WAKE_GRACE_SEC = float(os.environ.get("JHT_STEPCAP_ENGINE_WAKE_GRACE", "120"))

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

RESUME_TEXT = ("[FROM @SYSTEM TO @{AGENT}] Continue where you left off. "
               "If the current task is stalled, close it and move to the "
               "next queued task.")


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
            _log("import %s failed: %s" % (filename, exc))
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


def _pane_target(session: str) -> str:
    """Target PANE ancorato: `=NOME:` e' l'unica forma esatta.

    tmux risolve un nome nudo per PREFISSO (`SCOUT-1` trova `SCOUT-10`), e il
    `=` da solo vale per i target sessione: su un target pane `=NOME` fallisce
    sempre. Con i due punti la parte sessione e' esatta e il pane e' l'attivo.
    """
    return f"={session}:"


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
    return _tmux("capture-pane", "-p", "-t", _pane_target(session))


def is_worker_session(name: str) -> bool:
    return bool(WORKER_SESSION_RE.match(name.strip()))


def _active_provider() -> str:
    plain = _load_shared("plain_file", "plain_file.py")
    if plain is None:
        return ""
    try:
        # una pipe o un collegamento al posto del file non appende il watchdog: illeggibile
        cfg = plain.read_json(_home() / "jht.config.json")
    except (OSError, ValueError, plain.NotPlain):
        return ""
    return str(cfg.get("active_provider") or "").strip().lower()


def _session_harness(session: str) -> str:
    """L'harness che start-agent.sh ha scritto sulla sessione (`@jht_harness`).

    Vuoto = la CLI del provider, cioè il caso di sempre. L'opzione è di
    sessione: il target vuole `=NOME`, non la forma pane di `_pane_target`.
    """
    out = _tmux("show-options", "-qv", "-t", f"={session}", "@jht_harness")
    return (out or "").strip()


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


# Segnali che l'agente è fermo perché ha ESAURITO LA QUOTA, non perché è in un
# vicolo cieco. La differenza non è estetica: un agente a quota esaurita che
# viene messo in pausa e poi ripreso torna contro lo stesso muro, e il Capitano
# che riceve «ispeziona cosa sta girando» va a cercare un problema che non c'è.
USAGE_LIMIT_MARKERS = (
    "usage limit reached",
    "limit reached",
    "rate limit",
    "429",
    "quota exceeded",
    "upgrade your plan",
    # Codex non dice «limit reached»: «■ You've hit your usage limit. Upgrade
    # to Plus …, or try again at 6:12 PM.» (stringhe del binario 0.161).
    # Nessuna delle voci sopra lo prende, e un worker Codex a quota esaurita
    # finiva al Capitano come vicolo cieco da ispezionare.
    "hit your usage limit",
)


def find_usage_limit(tail: list):
    """La riga che dice «sei a quota», se c'è. Restituisce la riga, non un bool:
    al Capitano serve vedere il testo originale, non una nostra parafrasi."""
    for line in reversed(tail[-MARKER_TAIL_LINES:]):
        low = line.lower()
        for needle in USAGE_LIMIT_MARKERS:
            if needle in low:
                return line.strip()
    return None


def describe_stall(marker, rounds: int, usage_line) -> str:
    """Cosa dire al Capitano: l'OSSERVAZIONE, non la supposizione.

    Il messaggio storico diceva «hit the step cap» in entrambi i casi, ma lo
    step cap esiste solo su Kimi (`--max-steps-per-turn 100` vive nel suo ramo
    di start-agent.sh): su Claude e Codex quella frase è una diagnosi falsa, e
    l'ordine che ne segue — «ispeziona cosa sta girando» — manda a cercare un
    rabbit hole inesistente. Qui si riporta ciò che è stato visto.
    """
    if usage_line:
        return "has run out of its usage quota (pane says: %r)" % usage_line
    if marker and not str(marker).startswith("no marker:"):
        return "hit the step cap (%s)" % marker
    return "has not moved for %d minutes" % max(1, rounds)


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
        _log("write to %s failed: %s" % (path, exc))
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
        _log("failed to write state: %s" % exc)


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


def arm_pause(agent: str, seconds: int, now: float, reason: str) -> dict:
    """Arma la pausa nel motore dei throttle: {via, applied_sec, until}. Se il motore non c'e', il vecchio file.

    Il motore puo' accorciarla (coda in attesa, richieste dell'utente) o toglierla (deroga «a tutta»): vale quello
    che risponde, non quello che si chiedeva."""
    engine = _throttle_engine()
    if engine is not None:
        try:
            res = engine.register(agent, seconds=seconds, reason=reason, now=now)
            applied = int(res.get("applied_sec") or 0)
            until = res.get("until")
            return {"via": "engine", "applied_sec": applied,
                    "until": float(until) if isinstance(until, (int, float)) else float(now)}
        except Exception as exc:  # noqa: BLE001 — il motore rotto non ferma il watchdog
            _log("the engine did not take the pause of %s: %s" % (agent, exc))
    write_throttle(agent, seconds, now)
    return {"via": "legacy-file", "applied_sec": int(seconds), "until": float(now + seconds)}


def _idle_by_design(agent: str, now: float):
    """Perche' un pane immobile NON e' uno stallo: 'empty-queue' | 'engine-pause' | None.

    Un ruolo con coda e coda vuota aspetta lavoro; un agente dentro una pausa del motore (o appena svegliato, in attesa
    dell'ack) sta facendo quello che gli e' stato detto. In nessuno dei due casi una pausa del watchdog serve: si
    sommerebbe a quella del motore (due sistemi di pausa in parallelo, un team reale 02/11)."""
    engine = _throttle_engine()
    if engine is None:
        return None
    try:
        entry = engine.get_flag(agent)
        if isinstance(entry, dict):
            until = entry.get("until")
            if entry.get("state") == getattr(engine, "IN_THROTTLE", "IN_THROTTLE") \
                    and isinstance(until, (int, float)) and float(until) + ENGINE_WAKE_GRACE_SEC > now:
                return "engine-pause"
            if entry.get("state") == getattr(engine, "NOTIFIED", "NOTIFIED"):
                return "engine-pause"
        if engine.queue_is_empty(agent):
            return "empty-queue"
    except Exception as exc:  # noqa: BLE001
        _log("could not tell if %s is idle by design: %s" % (agent, exc))
    return None


def clear_throttle(agent: str) -> None:
    try:
        _throttle_state_path(agent).unlink()
    except OSError:
        pass


def _standby_active(home: Path) -> bool:
    """Standby ATTIVO adesso, secondo l'UNICO predicato del team
    ([STANDBY-EXPIRY-IGNORED-BY-RESPAWNERS], `shared/skills/standby.py`).

    Il flag porta la sua condizione di uscita: uno SCADUTO non è più standby e
    non deve tenere fermi gli agenti sul cap all'infinito. `home` è esplicito
    perché qui la home si risolve a ogni chiamata (`_home()`), mentre in
    standby.py è una costante di modulo risolta all'import.

    Fail-CLOSED: modulo non caricabile → il vecchio `.exists()`. Riprendere gli
    agenti a spesa zero per un import rotto sarebbe peggio del bug.
    """
    mod = _load_shared("standby", "standby.py")
    if mod is None or not hasattr(mod, "is_active"):
        return (home / ".team-standby.flag").exists()
    try:
        return bool(mod.is_active(home=home))
    except Exception as exc:  # noqa: BLE001
        _log("standby predicate failed (%s) — falling back to .exists()" % exc)
        return (home / ".team-standby.flag").exists()


# ── Gate di sicurezza ─────────────────────────────────────────────────────
def _halt_flags():
    home, logs = _home(), _logs_dir()
    return (
        ("team-halted", home / ".team-halted.flag"),
        # Lo standby NON è in questa lista: non si valuta sull'esistenza del
        # file ma col predicato `_standby_active()` — un flag SCADUTO non è più
        # standby, e continuare a leggerlo come tale terrebbe gli agenti fermi
        # sul cap all'infinito. Vedi resume_gate().
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
    # Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]): in standby questo
    # watchdog tace — niente nudge, niente kick-off. La sveglia è del
    # sentinel-bridge; quando lo standby non è più ATTIVO (flag rimosso O
    # scaduto) il retry (GATE_RETRY_SEC) riprende gli agenti fermi sul cap.
    if _standby_active(_home()):
        return "team-standby"
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
        _log("failed to write resume message: %s" % exc)
        return False
    if _tmux("load-buffer", "-b", TMUX_BUFFER, str(path)) is None:
        return False
    if _tmux("paste-buffer", "-b", TMUX_BUFFER, "-d", "-t", _pane_target(session)) is None:
        return False
    # Le TUI Ink non registrano l'Enter se arriva prima del render del testo.
    time.sleep(float(os.environ.get("JHT_STEPCAP_PASTE_SETTLE", "0.5")))
    if _tmux("send-keys", "-t", _pane_target(session), "Enter") is None:
        return False
    if _active_provider() == "kimi" and _session_harness(session) != "pi":
        # Kimi può accodare il prompt: Ctrl-S ne forza il submit (stesso
        # accorgimento di jht-tmux-send). Innocuo se l'Enter è già passato.
        # Vale per la CLI di Kimi, non per il provider: una sessione su pi
        # (marcata da start-agent.sh) non lo riceve.
        time.sleep(0.2)
        _tmux("send-keys", "-t", _pane_target(session), "C-s")
    return True


# Seconds this caller waits for the transport before it sees the deadline (JHT_TMUX_SEND_WAIT_STEPCAP_S; the old
# JHT_TMUX_SEND_WAIT_S, one name for every caller, still sets it when the caller's own is absent).
TMUX_SEND_WAIT_S = float(os.environ.get("JHT_TMUX_SEND_WAIT_STEPCAP_S", os.environ.get("JHT_TMUX_SEND_WAIT_S", "120")))
# >>> tmux_send_run bootstrap (the same text in every caller: shared/skills/tmux_send_run_bootstrap.txt, scripts/sync_tmux_send_bootstrap.py)
# `subprocess.run(..., timeout=N)` KILLS jht-tmux-send at the deadline; between its paste and its Enter that
# leaves a paste in the composer with no Enter (TEST 5, 27/10). tmux_send_run.py waits as long, raises the same
# TimeoutExpired, and lets the transport finish; without the module the old call is kept.
_tmux_send_run_module = None


def _transport_run(args, timeout, text=True):
    global _tmux_send_run_module
    if _tmux_send_run_module is None:
        import importlib.util
        _tmux_send_run_module = False
        here = Path(__file__).resolve().parent
        for cand in (here / "tmux_send_run.py", Path("/app/shared/skills/tmux_send_run.py"),
                     here.parent / "shared" / "skills" / "tmux_send_run.py"):
            if cand.is_file():
                try:
                    spec = importlib.util.spec_from_file_location("tmux_send_run", cand)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    _tmux_send_run_module = mod
                    break
                except (OSError, ImportError, SyntaxError):
                    continue
    if _tmux_send_run_module:
        return _tmux_send_run_module.run(args, timeout, text=text)
    return subprocess.run(args, capture_output=True, text=text, timeout=timeout)
# <<< tmux_send_run bootstrap


def _delivery_module():
    skill_path = str(Path(__file__).resolve().parent.parent / "shared" / "skills")
    if skill_path not in sys.path:
        sys.path.insert(0, skill_path)
    module = _load_shared("stepcap_delivery", "stepcap_delivery.py")
    if module is None:
        raise RuntimeError("delivery_state_unavailable: step-cap delivery module missing")
    return module


def _delivery_context():
    from delivery_context import Context
    return Context(globals())


def notify_captain(message):
    return _delivery_module().notify_captain(_delivery_context(), message)


# ── Un giro ───────────────────────────────────────────────────────────────
def _agent_paused(session: str) -> bool:
    """L'utente ha messo in pausa QUESTO agente (JHT-T181, `agent_pause.py`): niente nudge né sveglie.
    Un solo predicato, come per lo standby; non solleva mai (un modulo rotto = non in pausa)."""
    mod = _load_shared("agent_pause", "agent_pause.py")
    if mod is None:
        return False
    try:
        return bool(mod.is_paused(session, home=_home()))
    except Exception:  # noqa: BLE001
        return False


def _handle_agent(session, agent, entry, now, live_workers):
    return _delivery_module()._handle_agent(_delivery_context(), session, agent, entry, now, live_workers)


def check_missing_acks(state, now):
    return _delivery_module().check_missing_acks(_delivery_context(), state, now)


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
            _log("error for %s: %s" % (session, exc))

    for gone in [a for a in agents if a not in seen]:
        agents.pop(gone, None)

    # Ack mancati: fuori dal ciclo per sessione, perché il segnale non viene dal
    # pane e vale anche per un agente che il pane mostrerebbe perfettamente sano.
    try:
        missing_acks = check_missing_acks(state, now)
    except Exception as exc:  # noqa: BLE001
        _log("ack check failed: %s" % exc)
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
                   reason="%s does not exist: the watchdog has never written it" % path.name)
        return out
    out["exists"] = True
    if last is None:
        out.update(ok=False, reason="no readable records")
        return out
    age = now - last
    out.update(age_sec=round(age, 1), last_event=event,
               last_ts_iso=datetime.fromtimestamp(last, timezone.utc)
               .isoformat().replace("+00:00", "Z"))
    out["ok"] = age <= MAX_LOG_AGE_SEC
    if not out["ok"]:
        out["reason"] = ("last record %.0f min ago (expected one heartbeat every "
                         "%.0f min): process alive but function stalled?"
                         % (age / 60.0, HEARTBEAT_SEC / 60.0))
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="stepcap-watchdog",
        description="Resume agents stopped at the step cap (with throttling).")
    parser.add_argument("--once", action="store_true", help="run one cycle")
    parser.add_argument("--health", action="store_true",
                        help="freshness of logs/stepcap.jsonl (exit 1 if stale)")
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
