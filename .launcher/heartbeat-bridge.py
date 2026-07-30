#!/usr/bin/env python3
"""
heartbeat-bridge.py — heartbeat ORARIO al Capitano (2026-06-26; ex capitano-bridge.py).

── ROLE-MAP dei bridge deterministici (vedi docs/internal/architecture/bridges.md) ──
  sentinel-bridge.py  → SENSORE usage: fetch provider ~2-10min (adattivo), scrive
                        sentinel-data.jsonl, ticka la SENTINELLA ([BRIDGE TICK]).
  pacing-bridge.py    → REPORT pacing: ogni 15min manda velocità/verdetto alla
                        SENTINELLA ([BRIDGE PACING]). Il Capitano NON è pingato.
  heartbeat-bridge.py → QUESTO: nudge orario al CAPITANO ([HEARTBEAT]); off-hours tace.
  Due dei tre parlano alla SENTINELLA; solo questo parla al CAPITANO.

Perché esiste: col push→pull (bridge→Sentinella) il Capitano non riceve più il
[BRIDGE PACING] ogni 15 min, e si è osservato che resta INCAGLIATO quando la
Sentinella tace (steady/calm) — defer-a-un-tick-che-non-viene. Questo bridge è il
suo BATTITO: lo risveglia 1×/ora (allo scoccare dell'ora) con un nudge che lo fa
RAGIONARE — non è la Sentinella (quella analizza il budget), è uno strumento
DETERMINISTICO (no LLM) al servizio del Capitano per non lasciarlo passivo.

Intelligente, NON ripetitivo: legge i dati (code DB, top-consumer, budget) e
sceglie il nudge PIÙ RILEVANTE adesso, variando il tema. A volte tace (se tutto
è palesemente in regola e ha già nudgeato di recente) — un battito non è un
obbligo a scrivere.

Due registri (2026-07-01): sulle condizioni di ROUTINE resta un SEGNALE — pone
una condizione e lascia che sia il Capitano a decidere. Sulle ANOMALIE che lo
lasciavano passivo — su tutte il SOURCING FERMO (nessuno Scout attivo) — consegna
invece il VERDETTO deterministico come ORDINE (spawna 1 Scout, C-05), perché il
"segnale morbido" veniva razionalizzato via e la finestra chiusa a vuoto.

Output:
  - stdout (→ $JHT_HOME/logs/heartbeat-bridge.log)
  - tmux send al CAPITANO via jht-tmux-send (single-line)

Modi:
  python3 heartbeat-bridge.py            # loop orario allineato a :00
  python3 heartbeat-bridge.py --once     # un colpo, stampa, niente send
  python3 heartbeat-bridge.py --once --send
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
LOGS_DIR = JHT_HOME / "logs"
SENTINEL_JSONL = LOGS_DIR / "sentinel-data.jsonl"
AGENT_TABLE_FILE = LOGS_DIR / "agent-usage-table.json"
DB_PATH = JHT_HOME / "jobs.db"
STATE_FILE = LOGS_DIR / "heartbeat-bridge-state.json"
# Daily hard-stop (#2): flag scritto dal sentinel-bridge a cap giornaliero sforato.
# Lo leggiamo (sola lettura): a team in standby l'heartbeat orario tace.
DAILY_HALT_FLAG = LOGS_DIR / "daily-halt.flag"
# work_phase AUTOREVOLE (#4): il pacing-bridge la calcola dalle working hours e la
# scrive qui. Il sentinel-data grezzo la lascia spesso a None → l'heartbeat era
# cieco al giorno/notte e sparava nudge in piena notte.
PACING_STATE_FILE = LOGS_DIR / "pacing-bridge-state.json"
# Anti-quiescenza (#1/#2, 2026-07-01): il registro dei messaggi inter-agente. Lo
# leggiamo per sapere se uno Scout ha GIÀ dichiarato [SCOUT-ESAUSTO] di recente:
# in quel caso il mercato è secco e la quiescenza è VOLUTA (C-05b) → l'heartbeat
# NON deve ri-ordinare uno Scout che ciclerebbe a vuoto. La finestra di look-back
# è una finestra di lavoro (default 12h): oltre, al nuovo window il re-wake torna
# lecito (il re-wake resta del Capitano — vedi scout.md § idle).
MESSAGES_JSONL = LOGS_DIR / "messages.jsonl"
SCOUT_EXHAUST_LOOKBACK_H = float(
    os.environ.get("JHT_HEARTBEAT_SCOUT_EXHAUST_LOOKBACK_H", "12")
)
TARGET = os.environ.get("JHT_HEARTBEAT_SESSION", "CAPITANO")
DB_QUERY = "/app/shared/skills/db_query.py"
TICKET_PY = "/app/shared/skills/ticket.py"
# Lockfile del singleton (flock), file DEDICATO: il PID file lo cancellano
# bridge-control.sh e pid1, e cancellare un file flockato ne rompe la mutua
# esclusione. Due heartbeat vivi = [HEARTBEAT] DOPPIO al Capitano ogni ora,
# cioè turni LLM doppi sul modello più caro ([BRIDGE-SINGLETON-PARTIAL]).
LOCK_FILE = LOGS_DIR / "heartbeat-bridge.lock"
PID_FILE = LOGS_DIR / "heartbeat-bridge.pid"


def _log(msg):
    print(f"[heartbeat-bridge] {msg}", file=sys.stdout, flush=True)


def _acquire_singleton():
    """Uno solo di me. Modulo non caricabile → si prosegue senza lock (meglio
    un battito senza lock che nessun battito: il kill-by-marker dello spawner
    resta come rete)."""
    try:
        import importlib.util
        for cand in (Path("/app/shared/skills/singleton_lock.py"),
                     Path(__file__).resolve().parent.parent
                     / "shared" / "skills" / "singleton_lock.py"):
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location("singleton_lock", cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.acquire_singleton(LOCK_FILE, pid_file=PID_FILE,
                                  label="heartbeat-bridge")
            return
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        _log(f"WARN singleton_lock non caricabile ({e}) — proseguo senza lock")


def _db_count(cmd):
    """Conta le righe-posizione di un db_query (next-for-*). Ritorna int o None.
    Robusto: "nessuna"/"non" → 0; errori → None (campo omesso, non inventato)."""
    try:
        out = subprocess.run(
            ["python3", DB_QUERY, cmd], capture_output=True, text=True, timeout=30
        ).stdout
    except Exception:
        return None
    low = out.lower()
    if "nessun" in low or "no positions" in low or "vuota" in low or "empty" in low:
        return 0
    # conta righe che sembrano una posizione (iniziano con # o con un id numerico)
    n = 0
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("#") or (s[:1].isdigit() and "|" in s):
            n += 1
    return n


def _tickets_open():
    """Conta i ticket utente APERTI (coda on-demand del Capitano, C-15).
    int o None (campo omesso su errore, mai inventato)."""
    try:
        out = subprocess.run(
            ["python3", TICKET_PY, "count-open"],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
    except Exception:
        return None
    return int(out) if out.isdigit() else None


def _last_sentinel():
    try:
        last = None
        with open(SENTINEL_JSONL, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    last = json.loads(line)
                except Exception:
                    continue
        return last or {}
    except Exception:
        return {}


def _top_consumer():
    """(name, pct_share) del worker che brucia di più nell'ultima finestra, o None."""
    try:
        t = json.loads(AGENT_TABLE_FILE.read_text(encoding="utf-8"))
        agents = t.get("agents") or []
        best = None
        for a in agents:
            share = a.get("share")
            name = a.get("name")
            cad = a.get("cadence_per_min")
            if not isinstance(share, (int, float)) or not name:
                continue
            if best is None or share > best[1]:
                best = (name, share, cad)
        return best
    except Exception:
        return None


def gather_state():
    s = _last_sentinel()
    return {
        "weekly": s.get("weekly_usage"),
        "usage5h": s.get("usage"),
        "status": s.get("status"),
        "work_phase": s.get("work_phase"),
        "q_analista": _db_count("next-for-analista"),
        "q_scorer": _db_count("next-for-scorer"),
        "tickets_open": _tickets_open(),
        "top": _top_consumer(),
    }


def _live_sessions():
    try:
        out = subprocess.run(
            ["tmux", "ls"], capture_output=True, text=True, timeout=10
        ).stdout
        return [l.split(":", 1)[0] for l in out.splitlines() if ":" in l]
    except Exception:
        return []


def _work_phase():
    """Fase di lavoro autorevole, letta dal pacing-bridge-state. Ritorna
    "ON"/"OFF", oppure None se non determinabile o nessun orario configurato
    (team 24/7) → in quel caso NON si silenzia."""
    try:
        wp = json.loads(PACING_STATE_FILE.read_text(encoding="utf-8")).get("work_phase")
        return wp if wp in ("ON", "OFF") else None
    except (OSError, ValueError):
        return None


# ── Intento di spesa dell'utente (shared/skills/burn_intent.py) ────────────
# Il flag `.burn-intent.flag` è il punto UNICO di verità sul fatto che l'utente
# abbia chiesto di spingere. Il modulo viene cachato (l'import costa un exec),
# lo STATO no: `is_active()` rilegge il file, così una revoca vale al battito
# successivo. Fail-closed: modulo mancante o flag illeggibile → freno attivo.
_BURN_INTENT_MOD = None


def _burn_intent_active():
    global _BURN_INTENT_MOD
    try:
        if _BURN_INTENT_MOD is None:
            import importlib.util
            for cand in (Path("/app/shared/skills/burn_intent.py"),
                         Path(__file__).resolve().parent.parent
                         / "shared" / "skills" / "burn_intent.py"):
                if not cand.exists():
                    continue
                spec = importlib.util.spec_from_file_location("burn_intent", cand)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                _BURN_INTENT_MOD = mod
                break
        return bool(_BURN_INTENT_MOD.is_active()) if _BURN_INTENT_MOD else False
    except Exception:  # noqa: BLE001 — un guard non abbatte il battito
        return False


# ── Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]) ────────────────────────
# Col flag `.team-standby.flag` valido il battito orario è SOSPESO del tutto:
# ogni [HEARTBEAT] costerebbe un turno di modello al Capitano mentre il team è
# fermo di proposito. NON derogato da BURN-INTENT (lo standby nasce a weekly
# esaurito, dove la deroga economica non compra niente). La sveglia è del
# sentinel-bridge. Stesso pattern del modulo burn_intent: cache del MODULO,
# mai dello stato (is_active rilegge il flag a ogni battito).
_STANDBY_MOD = None


def _standby_active():
    global _STANDBY_MOD
    try:
        if _STANDBY_MOD is None:
            import importlib.util
            for cand in (Path("/app/shared/skills/standby.py"),
                         Path(__file__).resolve().parent.parent
                         / "shared" / "skills" / "standby.py"):
                if not cand.exists():
                    continue
                spec = importlib.util.spec_from_file_location("standby", cand)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                _STANDBY_MOD = mod
                break
        return bool(_STANDBY_MOD.is_active()) if _STANDBY_MOD else False
    except Exception:  # noqa: BLE001 — la direzione sicura è continuare a battere
        return False


def _scout_exhausted_recently(now):
    """True se uno Scout ha dichiarato [SCOUT-ESAUSTO] nell'ultima finestra di
    lavoro (SCOUT_EXHAUST_LOOKBACK_H). In quel caso le fonti sono DAVVERO secche e
    la quiescenza è voluta (C-05b): l'heartbeat non deve ordinare un altro Scout
    che ripasserebbe le stesse fonti esaurite. Il re-wake resta del Capitano al
    prossimo window. Robusto: file assente / righe non-JSON / ts illeggibile → non
    blocca (ritorna False = 'nessun esaurimento noto', l'ordine può partire)."""
    from collections import deque
    cutoff = now - timedelta(hours=SCOUT_EXHAUST_LOOKBACK_H)
    try:
        with open(MESSAGES_JSONL, encoding="utf-8") as f:
            tail = deque(f, maxlen=2000)  # basta la coda: un window è ~poche centinaia
    except OSError:
        return False
    for line in tail:
        if "ESAUSTO" not in line:  # filtro a buon mercato prima del parse
            continue
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if "SCOUT-ESAUSTO" not in json.dumps(m, ensure_ascii=False):
            continue
        try:
            t = datetime.fromisoformat(str(m.get("ts")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        if t >= cutoff:
            return True
    return False


def choose_nudge(state, now, last_theme):
    """Sceglie il nudge PIÙ RILEVANTE adesso (deterministico, vario). Ritorna
    (theme, message) o (None, None) per tacere. Priorità: condizioni anomale
    prima, poi rotazione a tema per non ripetersi. Le ANOMALIE vengono consegnate
    come ORDINE (verdetto deterministico); la rotazione resta un SEGNALE."""
    hour = now.hour
    sessions = [s.upper() for s in _live_sessions()]
    scouts_live = [s for s in sessions if s.startswith("SCOUT")]
    qa, qs = state.get("q_analista"), state.get("q_scorer")
    top = state.get("top")
    wk = state.get("weekly")

    # 0) TICKET UTENTE APERTO — priorità ASSOLUTA (C-15). Una richiesta diretta
    #    dell'utente dalla pagina posizione precede il lavoro autonomo del team:
    #    l'utente sta aspettando. Consegnato come ORDINE, prima di ogni altra cosa.
    tk = state.get("tickets_open")
    if tk and tk > 0:
        return ("ticket-utente",
                f"[HEARTBEAT] {tk} ticket utente APERTO/I in coda (richieste dirette "
                f"sulla pagina posizione). ORDINE (C-15): `ticket.py list-open`, assegna "
                f"ORA l'agente adatto (Analista per verifica offerta/azienda/requisiti; "
                f"Scrittore per un CV) — le richieste utente PRECEDONO il lavoro autonomo. "
                f"L'agente risponde con `ticket.py resolve <id> --response \"…\"`.")

    # 1) SOURCING FERMO — priorità massima (fix #1/#2, 2026-07-01).
    #    Trigger: NESSUNO Scout attivo = nessuno sorge, a prescindere da 1-2 residui
    #    a valle. Il vecchio `qa==0 and qs==0` si spegneva per una singola posizione
    #    NEW rimasta: la notte del 30/06 il Capitano è restato fermo ~7h con qa=1,
    #    0 Scout, chiudendo la finestra a vuoto. Due eccezioni corrette:
    #      (a) [SCOUT-ESAUSTO] recente → mercato secco, quiescenza VOLUTA (C-05b):
    #          non ri-ordinare uno Scout che ciclerebbe sulle stesse fonti;
    #      (b) backlog a valle profondo (≥15) → il collo di bottiglia è downstream,
    #          non il sourcing: lo gestisce il ramo (3).
    #    E non è più un sussurro: è il VERDETTO (spawna Scout) consegnato come ORDINE.
    downstream_deep = (qa or 0) >= 15 or (qs or 0) >= 15
    if not scouts_live and not downstream_deep and not _scout_exhausted_recently(now):
        return ("sourcing-fermo",
                f"[HEARTBEAT] Nessuno Scout attivo e nessun [SCOUT-ESAUSTO] oggi "
                f"(analista={qa}, scorer={qs}, weekly={wk}%) → il sourcing è FERMO. "
                f"ORDINE (C-05): apri `pipeline-triage` e spawna 1 Scout ORA, poi scala "
                f"a squadra coordinata (C-21). NON chiudere la finestra di lavoro senza "
                f"aver fatto girare gli Scout fino al loro [SCOUT-ESAUSTO].")

    # 2) WORKER CALDO: top-consumer con share alto e cadenza ~0 = sospetto
    #    rabbit-hole/stuck → un segnale, non un ordine: il Capitano non killa al buio.
    if top and top[1] >= 50 and (top[2] is None or top[2] < 0.05):
        return ("worker-caldo",
                f"[HEARTBEAT] {top[0]} brucia ~{top[1]:.0f}% del team con cadenza ~0 "
                f"nell'ultima finestra → possibile task lungo o stuck. (segnale: "
                f"worker caldo)")

    # 3) BACKLOG: code profonde → forse servono più worker.
    if (qa or 0) >= 15 or (qs or 0) >= 15:
        return ("backlog",
                f"[HEARTBEAT] Coda profonda (analista={qa}, scorer={qs}). (segnale: "
                f"collo di bottiglia; più worker se il budget regge)")

    # 4) Rotazione leggera per non ripetere lo stesso tema; a volte SILENZIO.
    # NB (#3): nessun "(decidi tu)" né "fai pipeline-triage". Il nudge consegna
    # un DATO; come reagire lo dice il prompt (C-20). L'imperativo a "decidere"
    # costava un turno di deliberazione (spesso uno spawn di subagente) a vuoto.
    rota = [
        ("pacing-check",
         f"[HEARTBEAT] weekly={wk}% status={state.get('status')}. (segnale di pace orario)"),
        ("code-check",
         f"[HEARTBEAT] code analista={qa}, scorer={qs}. (segnale pipeline orario)"),
        (None, None),   # un'ora su tre: silenzio
    ]
    theme, msg = rota[hour % len(rota)]
    if theme is not None and theme == last_theme:
        return (None, None)  # non ripetere lo stesso tema due ore di fila
    return (theme, msg)


def _send(msg):
    for cand in ("jht-tmux-send",
                 "/app/agents/_skills/tmux-send/jht-tmux-send"):
        try:
            r = subprocess.run([cand, TARGET, msg], capture_output=True,
                               text=True, timeout=90)
            if r.returncode == 0:
                return True
        except FileNotFoundError:
            continue
        except Exception:
            return False
    return False


def _read_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_state(d):
    try:
        STATE_FILE.write_text(json.dumps(d), encoding="utf-8")
    except Exception:
        pass


def tick(now, send):
    # Standby a spesa zero: PRIMA di ogni altro gate e SENZA deroghe — il
    # battito tace finché il sentinel-bridge non risveglia il team.
    if _standby_active():
        _log(f"{now:%H:%M} standby: heartbeat soppresso (team a spesa zero)")
        return
    # Intento dell'utente letto PRIMA dei due gate: sopprimere il battito è già
    # applicare l'halt, e un Capitano senza battito è un Capitano che non sa che
    # l'utente ha chiesto il contrario (notte 2026-07-27).
    burn_intent_on = _burn_intent_active()
    # Daily hard-stop (#2): a team in standby (cap giornaliero sforato) anche il
    # battito orario tace — niente nudge "(decidi tu)" mentre il team è in pausa.
    if DAILY_HALT_FLAG.exists() and not burn_intent_on:
        _log(f"{now:%H:%M} daily-halt: heartbeat soppresso (team in standby)")
        return
    # Off-hours gate (#4): fuori dall'orario di lavoro il team riposa → niente
    # battito. (work_phase=None = nessun orario configurato, team 24/7 → si batte.)
    # Il gate orario è un automatismo di spesa: con BURN-INTENT attivo l'utente
    # ha deciso di lavorare adesso, e il battito continua.
    if _work_phase() == "OFF" and not burn_intent_on:
        _log(f"{now:%H:%M} off-hours (work_phase=OFF): heartbeat soppresso")
        return
    if burn_intent_on:
        _log(f"{now:%H:%M} BURN-INTENT attivo: battito mantenuto "
             f"(daily-halt/off-hours derogati dall'utente)")
    st = gather_state()
    persisted = _read_state()
    theme, msg = choose_nudge(st, now, persisted.get("last_theme"))
    if not msg:
        _log(f"{now:%H:%M} silent (theme={theme}) state={st}")
        return
    _log(f"{now:%H:%M} nudge[{theme}]: {msg}")
    if send:
        ok = _send(msg)
        _log(f"send → {'ok' if ok else 'FAIL'}")
        if ok:
            _write_state({"last_theme": theme, "last_ts": now.isoformat()})


def main():
    once = "--once" in sys.argv
    send = ("--send" in sys.argv) or not once
    if once:
        # `--once` è diagnostico e non compete con nulla: niente lock, così non
        # esce silenziosamente quando il daemon è vivo.
        tick(datetime.now(timezone.utc), send)
        return
    _acquire_singleton()
    _log(f"up — heartbeat orario al {TARGET}, jht_home={JHT_HOME}")
    while True:
        now = datetime.now(timezone.utc)
        nxt = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        time.sleep(max(1, (nxt - now).total_seconds()))
        try:
            tick(datetime.now(timezone.utc), send=True)
        except Exception as e:
            _log(f"tick error: {e}")


if __name__ == "__main__":
    main()
