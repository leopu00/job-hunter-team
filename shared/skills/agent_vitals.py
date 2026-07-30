#!/usr/bin/env python3
"""agent_vitals.py — CPU%/RSS PER-AGENTE nel tempo (daemon).

Porta in JHT il meccanismo del monitor di claude-team (AGENT_ID nel
processo → ps per-agente): qui il marcatore è `JHT_AGENT_NAME`, che
start-agent.sh esporta nella shell tmux PRIMA di lanciare la CLI, quindi
ogni processo discendente dell'agente ce l'ha in `/proc/<pid>/environ`.
Il daemon campiona i delta utime+stime di ogni processo marcato e
aggrega per agente: CPU% ISTANTANEA (percentuale di un core, come top),
non la media-vita di `ps`.

Output: una riga JSON per tick su `$JHT_HOME/logs/agent-vitals.jsonl`:
    {"ts": ISO-UTC, "agents": {"scout-2": {"cpu_pct": 12.3,
                                           "rss_mb": 810.4, "procs": 7}}}
Cap righe anti-crescita (~7 giorni a 30s). Consumatori: la scheda
agente del gioco (AGENT_HISTORY_PY) e chiunque voglia lo storico.

CLI:
    python3 agent_vitals.py            # daemon (tick 30s)
    python3 agent_vitals.py current    # un campione da 2s, stampa e esce
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
OUT_FILE = JHT_HOME / "logs" / "agent-vitals.jsonl"
PID_FILE = JHT_HOME / "logs" / "agent-vitals.pid"
# Lockfile del singleton (flock), file DEDICATO e mai cancellato: il PID file
# lo ripulisce chi riavvia la suite, e cancellare un file flockato ne rompe la
# mutua esclusione ([BRIDGE-SINGLETON-PARTIAL]). Qui il PID file da solo non
# era nemmeno riletto: due daemon lanciati insieme si sovrascrivevano il pid e
# campionavano entrambi lo stesso /proc, raddoppiando le righe del JSONL.
LOCK_FILE = JHT_HOME / "logs" / "agent-vitals.lock"
INTERVAL_S = float(os.environ.get("JHT_AGENT_VITALS_INTERVAL", "30"))
MAX_LINES = 20000  # 30s/tick → ~7 giorni
CLK_TCK = os.sysconf("SC_CLK_TCK")
PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")

# Stessi ruoli canonici di token_metrics_lib: un JHT_AGENT_NAME che non
# è un ruolo (residui di test) non deve diventare un agente fantasma.
VALID_ROLES = (
    "capitano", "sentinella", "assistente", "mentor", "dottore",
    "mantenitore", "scout", "analista", "scorer", "scrittore",
    "critico", "tesoriere",
)
_NAME_RE = re.compile(
    r"^(%s)(-[a-z0-9]+)?$" % "|".join(VALID_ROLES))


def _agent_of(pid: str) -> str | None:
    """JHT_AGENT_NAME dall'environ del processo ('' se non marcato)."""
    try:
        env = Path("/proc", pid, "environ").read_bytes()
    except OSError:
        return None
    for chunk in env.split(b"\0"):
        if chunk.startswith(b"JHT_AGENT_NAME="):
            name = chunk[len(b"JHT_AGENT_NAME="):].decode(errors="replace")
            name = name.strip().lower()
            return name if _NAME_RE.match(name) else None
    return None


def _cpu_ticks(pid: str) -> int | None:
    """utime+stime da /proc/<pid>/stat (comm può contenere spazi)."""
    try:
        stat = Path("/proc", pid, "stat").read_text()
    except OSError:
        return None
    try:
        after = stat.rsplit(")", 1)[1].split()
        return int(after[11]) + int(after[12])  # utime, stime (campi 14,15)
    except (IndexError, ValueError):
        return None


def _rss_bytes(pid: str) -> int:
    try:
        return int(Path("/proc", pid, "statm").read_text().split()[1]) * PAGE_SIZE
    except (OSError, IndexError, ValueError):
        return 0


def scan() -> dict:
    """{pid: (agente, cpu_ticks, rss)} dei soli processi marcati."""
    out = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        agent = _agent_of(entry)
        if not agent:
            continue
        ticks = _cpu_ticks(entry)
        if ticks is None:
            continue
        out[entry] = (agent, ticks, _rss_bytes(entry))
    return out


def sample(prev: dict, cur: dict, elapsed: float) -> dict:
    """Aggrega i delta per agente: cpu%% di un core + RSS + n processi."""
    agents: dict = {}
    for pid, (agent, ticks, rss) in cur.items():
        a = agents.setdefault(agent, {"cpu": 0.0, "rss": 0, "procs": 0})
        a["procs"] += 1
        a["rss"] += rss
        if pid in prev and prev[pid][0] == agent:
            delta = max(0, ticks - prev[pid][1])
            a["cpu"] += delta / CLK_TCK / max(0.001, elapsed) * 100.0
    return {
        name: {"cpu_pct": round(v["cpu"], 1),
               "rss_mb": round(v["rss"] / 1048576.0, 1),
               "procs": v["procs"]}
        for name, v in sorted(agents.items())
    }


def append_line(agents: dict) -> None:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    row = {"ts": datetime.now(timezone.utc).isoformat(), "agents": agents}
    with OUT_FILE.open("a") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")
    # prune economico: solo quando il cap è sforato del 10%
    try:
        with OUT_FILE.open() as f:
            lines = f.readlines()
        if len(lines) > MAX_LINES * 1.1:
            tmp = OUT_FILE.with_suffix(".tmp")
            tmp.write_text("".join(lines[-MAX_LINES:]))
            tmp.replace(OUT_FILE)
    except OSError:
        pass


def _acquire_singleton() -> None:
    """Uno solo di me (flock) + PID file. Modulo non caricabile → si prosegue
    scrivendo il solo PID file: meglio un daemon senza lock che nessun daemon."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from singleton_lock import acquire_singleton
        acquire_singleton(LOCK_FILE, pid_file=PID_FILE, label="agent-vitals")
        return
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[agent-vitals] WARN singleton_lock non caricabile ({e}) — "
              f"proseguo senza lock", flush=True)
    try:
        PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        PID_FILE.write_text(str(os.getpid()))
    except OSError:
        pass


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "current":
        prev = scan()
        time.sleep(2.0)
        print(json.dumps(sample(prev, scan(), 2.0), indent=2))
        return
    _acquire_singleton()
    print(f"[agent-vitals] pid={os.getpid()} tick={INTERVAL_S:.0f}s "
          f"out={OUT_FILE}", flush=True)
    prev = scan()
    prev_t = time.monotonic()
    while True:
        time.sleep(INTERVAL_S)
        cur = scan()
        now = time.monotonic()
        agents = sample(prev, cur, now - prev_t)
        if agents:
            append_line(agents)
        prev, prev_t = cur, now


if __name__ == "__main__":
    main()
