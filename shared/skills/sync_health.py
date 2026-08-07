#!/usr/bin/env python3
"""sync_health.py — canary di salute della CLOUD-SYNC (pull desired-state +
push locale→cloud) per il Mantenitore (maintainer-sweep).

Perché esiste: il 2026-07 il loop di sync si è incantato in due modi che sono
rimasti INVISIBILI per ~14h (dashboard cloud ferma) perché nessuno canariava la
sync:
  • PULL desired-state: cursore congelato (string-compare + niente ORDER) →
    ripescava e riscriveva ~500 posizioni a ogni tick (churn di updated_at).
  • PUSH monolitico: un HTTP 413 (payload troppo grande) NON avanzava il cursore
    → al tick dopo la delta cresceva → altri 413 (loop irreversibile).
Entrambi i bug di CODICE sono stati corretti (chunking + safeCursor + Date
compare + ORDER); questo canary rende STRUTTURALE la vigilanza, così una
regressione futura viene rilevata in ~1 giorno invece che restare cieca.

READ-ONLY: legge i file cursore, il DB in sola lettura (mode=ro) e la CODA del
log del daemon. NON scrive nulla, NON tocca il DB. La segnalazione (log
logbook + escalation al Capitano via jht-tmux-send) la guida la skill
maintainer-sweep, coerente col pattern di process_health.py / tool_health.py.

Segnali rilevati:
  • push_behind  (HIGH):  il team produce dati (positions.updated_at recenti) ma
                          il cursore di push è indietro di > STALE_HOURS →
                          push giù / non converge.
  • push_errors  (HIGH):  occorrenze di "Push fallito"/413/"Push interrotto"
                          nella coda del log del daemon.
  • pull_churn   (MEDIUM):"Pull desired-state applicato: N positions" con N alto
                          ripetuto nella coda del log → loop di riscrittura.
  • cursor_stale (MEDIUM):file cursore pull/push non aggiornato da > STALE_HOURS
                          mentre il team lavora (evidenza secondaria).

Uso:
  sync_health.py summary [--json]
Exit code: 0 se sano, 1 se almeno un problema HIGH/MEDIUM.

Soglie (override via env):
  JHT_SYNC_STALE_HOURS   (default 3)    — età max cursori / lag push
  JHT_SYNC_CHURN_ROWS    (default 50)   — righe/tick oltre cui il pull è "churn"
  JHT_SYNC_CHURN_TICKS   (default 3)    — quante volte deve ripetersi
  JHT_SYNC_LOG_TAIL      (default 500)  — righe di coda del daemon.log scansionate
"""
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone


def _home():
    return os.environ.get("JHT_HOME") or os.path.expanduser("~/.jht")


def _env_num(name, default, cast=float):
    try:
        return cast(os.environ.get(name, default))
    except (TypeError, ValueError):
        return cast(default)


STALE_HOURS = _env_num("JHT_SYNC_STALE_HOURS", 3, float)
CHURN_ROWS = _env_num("JHT_SYNC_CHURN_ROWS", 50, int)
CHURN_TICKS = _env_num("JHT_SYNC_CHURN_TICKS", 3, int)
LOG_TAIL = _env_num("JHT_SYNC_LOG_TAIL", 500, int)

PUSH_CURSOR = ".cloud-sync-cursor.json"   # push locale→cloud (per-tabella)
PULL_CURSOR = ".cloud-pull-cursor.json"   # pull desired-state ({since})


def _cloud_enabled():
    """True se il cloud sync è configurato+abilitato (stesso predicato di pid1 /
    process_health._cloud_daemon_expected). Se disabilitato, la sync non è
    attesa → i segnali di staleness sono INFO, non guasti."""
    try:
        with open(os.path.join(_home(), "cloud.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        return False
    return cfg.get("enabled") is True and isinstance(cfg.get("token"), str)


def _weekly_halt():
    """L'utente ha ordinato stop team → nessuna sync attesa (non è un guasto)."""
    return os.path.exists(os.path.join(_home(), ".weekly-halt.flag"))


def _parse_ts(s):
    """Parsa un timestamp SQLite ('YYYY-MM-DD HH:MM:SS') o ISO ('...T...Z' /
    '...+00:00') → epoch secondi UTC. None se non parsabile."""
    if not s or not isinstance(s, str):
        return None
    t = s.strip().replace("T", " ").replace("Z", "")
    t = re.sub(r"[+-]\d{2}:?\d{2}$", "", t).strip()  # drop offset
    t = t.split(".")[0]  # drop frazioni di secondo
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            dt = datetime.strptime(t, fmt).replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            continue
    return None


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _cursor_state(name):
    """Ritorna {exists, mtime_age_h, value_positions?} per un file cursore."""
    path = os.path.join(_home(), name)
    st = {"file": name, "exists": os.path.exists(path)}
    if not st["exists"]:
        return st
    try:
        st["mtime_age_h"] = round((time.time() - os.path.getmtime(path)) / 3600, 2)
    except OSError:
        st["mtime_age_h"] = None
    data = _read_json(path) or {}
    # push cursor: dizionario per-tabella; pull cursor: {since}
    if "since" in data:
        st["since"] = data.get("since")
    else:
        st["positions"] = data.get("positions")
    return st


def _db_path():
    env_db = os.environ.get("JHT_DB")
    if env_db:
        return env_db
    return os.path.join(_home(), "jobs.db")


def _db_max_updated():
    """MAX(updated_at) su positions, in sola lettura. None se DB assente/vuoto."""
    path = _db_path()
    if not os.path.exists(path):
        return None
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        row = conn.execute("SELECT MAX(updated_at) FROM positions").fetchone()
        return row[0] if row else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def _tail(path, n):
    """Ultime n righe di un file di testo (best-effort, senza leggere tutto)."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            block = 8192
            data = b""
            while size > 0 and data.count(b"\n") <= n:
                step = min(block, size)
                size -= step
                f.seek(size)
                data = f.read(step) + data
        return data.decode("utf-8", "replace").splitlines()[-n:]
    except OSError:
        return []


PUSH_FAIL_RE = re.compile(r"Push fallito|Push interrotto|HTTP 413|413 su riga")
PULL_APPLIED_RE = re.compile(r"Pull desired-state applicato:\s*(\d+)\s+positions")


def _scan_daemon_log():
    """Scansiona la coda di logs/daemon.log per evidenze di push-fail e
    pull-churn. Il log NON ha timestamp per-riga (cattura raw da pid1), quindi
    'recente' è approssimato dalla CODA (ultimi LOG_TAIL righe)."""
    path = os.path.join(_home(), "logs", "daemon.log")
    lines = _tail(path, LOG_TAIL)
    push_fail = sum(1 for ln in lines if PUSH_FAIL_RE.search(ln))
    churn_ticks = 0
    max_applied = 0
    for ln in lines:
        m = PULL_APPLIED_RE.search(ln)
        if m:
            n = int(m.group(1))
            max_applied = max(max_applied, n)
            if n >= CHURN_ROWS:
                churn_ticks += 1
    return {
        "log_present": bool(lines),
        "push_fail_hits": push_fail,
        "pull_churn_ticks": churn_ticks,
        "pull_max_applied": max_applied,
    }


def scan():
    enabled = _cloud_enabled()
    halted = _weekly_halt()
    working = enabled and not halted  # sync attesa solo se il team lavora

    push = _cursor_state(PUSH_CURSOR)
    pull = _cursor_state(PULL_CURSOR)
    db_max = _db_max_updated()
    logs = _scan_daemon_log()

    problems = []

    def add(kind, severity, detail, suggest):
        problems.append({"kind": kind, "severity": severity,
                         "detail": detail, "suggest": suggest})

    # 1) PUSH BEHIND — il team produce dati ma il cursore push è indietro.
    push_val = push.get("positions")
    if working and db_max:
        dbm = _parse_ts(db_max)
        pcur = _parse_ts(push_val) if push_val else None
        if dbm is not None:
            lag_h = None
            if pcur is None and push.get("exists"):
                lag_h = float("inf")  # cursore senza valore positions ma DB pieno
            elif pcur is not None:
                lag_h = (dbm - pcur) / 3600
            if lag_h is not None and lag_h > STALE_HOURS:
                add("push_behind", "HIGH",
                    f"positions.updated_at max={db_max}, but push cursor={push_val} "
                    f"(lag ~{lag_h if lag_h != float('inf') else '∞'}h > {STALE_HOURS}h)",
                    "Push is not converging. Check logs/daemon.log for 413 or "
                    "'Push interrupted'. Chunking should drain the backlog; if it "
                    "still lags, force a cycle with `jht cloud push` and reduce "
                    "chunks via JHT_PUSH_POS_CHUNK=40 if 413 persists.")

    # 2) PUSH ERRORS dal log (evidenza diretta di 413 / interruzioni).
    if working and logs["push_fail_hits"] > 0:
        add("push_errors", "HIGH",
            f"{logs['push_fail_hits']} push-fail/413 occurrences in the last "
            f"{LOG_TAIL} lines of daemon.log",
            "Push is failing. For 413 errors, chunking should drain the backlog; "
            "if a single row is discarded, one unusual position exceeds the "
            "server limit and must be investigated. Escalate the count to the Captain.")

    # 3) PULL CHURN — il pull riapplica troppe righe per tick, ripetutamente.
    if working and logs["pull_churn_ticks"] >= CHURN_TICKS:
        add("pull_churn", "MEDIUM",
            f"{logs['pull_churn_ticks']} ticks with >= {CHURN_ROWS} positions "
            f"applied (max {logs['pull_max_applied']}) in the daemon.log tail",
            "This suggests a stuck pull loop whose cursor is not converging. "
            "Verify the Date-compare + ORDER cursor fix is deployed; an idle "
            "steady-state pull should apply about 0 rows.")

    # 4) CURSOR STALE — evidenza secondaria (i file cursore avanzano solo su
    #    lavoro reale; da soli non provano un guasto, ma a team attivo + DB
    #    fresco un cursore vecchio rafforza i segnali sopra).
    for cur, label in ((push, "push"), (pull, "pull")):
        age = cur.get("mtime_age_h")
        if working and cur.get("exists") and isinstance(age, (int, float)) \
                and age > STALE_HOURS:
            # Solo se c'è attività recente nel DB (altrimenti a riposo è normale).
            dbm = _parse_ts(db_max) if db_max else None
            fresh_db = dbm is not None and (time.time() - dbm) / 3600 < STALE_HOURS
            if fresh_db:
                add("cursor_stale", "MEDIUM",
                    f"{label} cursor ({cur['file']}) has not moved for {age}h, "
                    f"but the database was active < {STALE_HOURS}h ago "
                    f"(updated_at max={db_max})",
                    "Sync is not advancing its cursor while the team produces data. "
                    "Correlate with push_behind, push_errors, and pull_churn.")

    high = [p for p in problems if p["severity"] == "HIGH"]
    return {
        "cloud_enabled": enabled,
        "weekly_halt": halted,
        "team_working": working,
        "push_cursor": push,
        "pull_cursor": pull,
        "db_positions_max_updated": db_max,
        "log": logs,
        "problems": problems,
        "healthy": len(problems) == 0,
        "has_high": len(high) > 0,
    }


def main():
    res = scan()
    if "--json" in sys.argv:
        print(json.dumps(res, indent=2))
    else:
        state = "HEALTHY" if res["healthy"] else "PROBLEMS"
        print(f"sync-health: {state}  (cloud_enabled={res['cloud_enabled']}, "
              f"team_working={res['team_working']})")
        pc = res["push_cursor"]
        plc = res["pull_cursor"]
        print(f"  push cursor : positions={pc.get('positions')} "
              f"(file {'ok' if pc.get('exists') else 'MISSING'}, "
              f"age {pc.get('mtime_age_h')}h)")
        print(f"  pull cursor : since={plc.get('since')} "
              f"(file {'ok' if plc.get('exists') else 'MISSING'}, "
              f"age {plc.get('mtime_age_h')}h)")
        print(f"  db max upd  : {res['db_positions_max_updated']}")
        lg = res["log"]
        print(f"  daemon.log  : push_fail={lg['push_fail_hits']} "
              f"churn_ticks={lg['pull_churn_ticks']} "
              f"max_applied={lg['pull_max_applied']} "
              f"(last {LOG_TAIL} lines, log_present={lg['log_present']})")
        if res["problems"]:
            print("  PROBLEMS:")
            for p in res["problems"]:
                print(f"   [{p['severity']}] {p['kind']}: {p['detail']}")
                print(f"          → {p['suggest']}")
        else:
            print("  -> no sync problems detected")
    sys.exit(0 if res["healthy"] else 1)


if __name__ == "__main__":
    main()
