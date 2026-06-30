#!/usr/bin/env python3
"""
capitano-bridge.py — heartbeat ORARIO al Capitano (2026-06-26).

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

NON decide al posto del Capitano: pone una domanda / segnala una condizione e
lascia che sia LUI a verificare (con le sue skill) e decidere.

Output:
  - stdout (→ /tmp/capitano-bridge.log)
  - tmux send al CAPITANO via jht-tmux-send (single-line)

Modi:
  python3 capitano-bridge.py            # loop orario allineato a :00
  python3 capitano-bridge.py --once     # un colpo, stampa, niente send
  python3 capitano-bridge.py --once --send
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
STATE_FILE = LOGS_DIR / "capitano-bridge-state.json"
# Daily hard-stop (#2): flag scritto dal sentinel-bridge a cap giornaliero sforato.
# Lo leggiamo (sola lettura): a team in standby l'heartbeat orario tace.
DAILY_HALT_FLAG = LOGS_DIR / "daily-halt.flag"
TARGET = os.environ.get("JHT_CAPITANO_HEARTBEAT_SESSION", "CAPITANO")
DB_QUERY = "/app/shared/skills/db_query.py"


def _log(msg):
    print(f"[capitano-bridge] {msg}", file=sys.stdout, flush=True)


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


def choose_nudge(state, hour, last_theme):
    """Sceglie il nudge PIÙ RILEVANTE adesso (deterministico, vario). Ritorna
    (theme, message) o (None, None) per tacere. Priorità: condizioni anomale
    prima, poi rotazione a tema per non ripetersi."""
    sessions = [s.upper() for s in _live_sessions()]
    scouts_live = [s for s in sessions if s.startswith("SCOUT")]
    qa, qs = state.get("q_analista"), state.get("q_scorer")
    top = state.get("top")
    wk = state.get("weekly")

    # 1) PIPELINE FERMA: code vuote + nessuno Scout → sourcing fermo (lo scenario
    #    osservato: Capitano incagliato a pipeline vuota). Priorità massima.
    if qa == 0 and qs == 0 and not scouts_live:
        return ("pipeline-ferma",
                f"[HEARTBEAT] Code VUOTE (analista={qa}, scorer={qs}) e NESSUNO Scout "
                f"attivo → il sourcing è fermo. weekly={wk}%. Se hai margine di budget, "
                f"perché non stai sorgendo? Verifica (pipeline-triage / rate-budget) e "
                f"decidi se spawnare uno Scout. (nudge orario, decidi tu)")

    # 2) WORKER CALDO: top-consumer con share alto e cadenza ~0 = sospetto
    #    rabbit-hole/stuck → fai verificare al Capitano (non killare tu).
    if top and top[1] >= 50 and (top[2] is None or top[2] < 0.05):
        return ("worker-caldo",
                f"[HEARTBEAT] {top[0]} brucia ~{top[1]:.0f}% del team con cadenza ~0 "
                f"nell'ultima finestra → potrebbe essere un task lungo o un rabbit-hole. "
                f"Dagli un'occhiata (capture-pane / agent-speed-table): se non produce, "
                f"valuta Continua o KILL. (nudge orario, decidi tu)")

    # 3) BACKLOG: code profonde → forse servono più worker.
    if (qa or 0) >= 15 or (qs or 0) >= 15:
        return ("backlog",
                f"[HEARTBEAT] Coda profonda (analista={qa}, scorer={qs}). Se il budget "
                f"regge, valuta se scalare i worker sul collo di bottiglia. (decidi tu)")

    # 4) Rotazione leggera per non ripetere lo stesso tema; a volte SILENZIO.
    rota = [
        ("pacing-check",
         f"[HEARTBEAT] Stato: weekly={wk}% status={state.get('status')}. Sei nella "
         f"banda di pace giusta? Se in dubbio, tira rate-budget e ricalibra. (decidi tu)"),
        ("code-check",
         f"[HEARTBEAT] Code: analista={qa}, scorer={qs}. Pipeline sana? Un giro di "
         f"pipeline-triage se qualcosa non ti torna. (decidi tu)"),
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
    # Daily hard-stop (#2): a team in standby (cap giornaliero sforato) anche il
    # battito orario tace — niente nudge "(decidi tu)" mentre il team è in pausa.
    if DAILY_HALT_FLAG.exists():
        _log(f"{now:%H:%M} daily-halt: heartbeat soppresso (team in standby)")
        return
    st = gather_state()
    persisted = _read_state()
    theme, msg = choose_nudge(st, now.hour, persisted.get("last_theme"))
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
        tick(datetime.now(timezone.utc), send)
        return
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
