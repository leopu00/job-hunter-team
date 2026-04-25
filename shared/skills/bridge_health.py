#!/usr/bin/env python3
"""
bridge_health — controllo + restart deterministico del sentinel-bridge.

Pensato per essere chiamato dalla Sentinella all'inizio di ogni tick:
  • se il bridge gira → ritorna `running pid=N`
  • se il bridge è giù → pulisce il pid file stale, rilancia in
    background, ritorna `restarted pid=N reason=X`

Niente LLM nel loop di restart: la Sentinella vede l'output one-liner e
sa cosa segnalare al Capitano (REGOLA-08 recovery una tantum).

Uso:
    python3 /app/shared/skills/bridge_health.py [check|ensure]

Default `ensure`: check + restart se serve. `check` solo statura.

Output (machine-friendly, parsabile):
    running    pid=853
    restarted  pid=2174 reason=no_process
    restarted  pid=2174 reason=stale_pid
    fatal      reason=spawn_failed   (exit 2)
    fatal      reason=script_missing (exit 3)

Exit code 0 sempre se la verifica e' completata senza errori (anche
"restarted" è esito atteso, non errore).
"""
import os
import subprocess
import sys
import time
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
LOGS_DIR = JHT_HOME / "logs"
PID_FILE = LOGS_DIR / "sentinel-bridge.pid"
BRIDGE_LOG = Path("/tmp/sentinel-bridge.log")
BRIDGE_SCRIPT = Path("/app/.launcher/sentinel-bridge.py")
TARGET_SESSION_DEFAULT = "CAPITANO"
TICK_INTERVAL_DEFAULT = "10"

# Quando rilanciamo, aspettiamo brevemente che il processo prenda piede
# prima di stampare il PID. Il bridge fa singleton lock + carica il
# config (~50ms su questo container), 1.5s e' sicuro senza appesantire.
SPAWN_GRACE_S = 1.5


def find_bridge_pids():
    """Ritorna i PID dei processi che hanno 'sentinel-bridge.py' in argv.

    Niente pgrep (non sempre presente in busybox slim) — leggiamo
    /proc/*/cmdline. Stesso pattern usato da start-agent.sh per pulire
    bridge orfani prima di un nuovo spawn.
    """
    pids = []
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            cmdline_path = entry / "cmdline"
            try:
                cmdline = cmdline_path.read_bytes().decode("utf-8", errors="replace")
            except (OSError, PermissionError):
                continue
            if "sentinel-bridge.py" in cmdline:
                pids.append(int(entry.name))
    except OSError:
        pass
    return pids


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def read_pid_file():
    try:
        s = PID_FILE.read_text(encoding="utf-8").strip()
        return int(s) if s else None
    except (OSError, ValueError):
        return None


def cleanup_stale_pid_file():
    try:
        PID_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def spawn_bridge(target_session, tick_interval):
    """Lancia sentinel-bridge.py in background con setsid (orphan).

    Stessa modalita' di start-agent.sh: il process resta vivo anche se
    il padre (Sentinella o lo shell della skill) esce. Output redirezionato
    su /tmp/sentinel-bridge.log per troubleshooting.
    """
    if not BRIDGE_SCRIPT.exists():
        return None

    cmd = (
        f"JHT_TARGET_SESSION='{target_session}' "
        f"JHT_TICK_INTERVAL='{tick_interval}' "
        f"python3 -u {BRIDGE_SCRIPT} >> {BRIDGE_LOG} 2>&1"
    )
    # setsid + & garantisce orphan; redirezione I/O fa sì che il subprocess
    # non venga ucciso quando lo shell della skill chiude.
    try:
        subprocess.Popen(
            ["setsid", "sh", "-c", cmd],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except (OSError, FileNotFoundError):
        return None

    # Attendi che il bridge appaia nei processi.
    deadline = time.time() + SPAWN_GRACE_S + 4.0  # margine di sicurezza
    while time.time() < deadline:
        time.sleep(0.3)
        pids = find_bridge_pids()
        if pids:
            return pids[0]
    return None


def status_running(pid):
    print(f"running pid={pid}")


def status_restarted(pid, reason):
    print(f"restarted pid={pid} reason={reason}")


def status_fatal(reason):
    print(f"fatal reason={reason}", file=sys.stderr)


def main():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "ensure").lower()

    pids = find_bridge_pids()
    if pids:
        # Almeno 1 processo bridge esiste e risponde. Pid file potrebbe
        # essere disallineato (un'istanza precedente killata, una nuova
        # spawnata dal singleton lock); va bene cosi', il bridge stesso
        # gestisce il file PID al boot. Riportiamo il pid effettivo.
        status_running(pids[0])
        return

    if cmd == "check":
        # Modo "solo lettura": non rilancio, segnalo bridge giu'.
        print("stopped reason=no_process")
        sys.exit(0)

    # `ensure` (default): pulizia + restart.
    pid_in_file = read_pid_file()
    reason = "stale_pid" if (pid_in_file and not pid_alive(pid_in_file)) else "no_process"
    cleanup_stale_pid_file()

    if not BRIDGE_SCRIPT.exists():
        status_fatal("script_missing")
        sys.exit(3)

    # Il target session lo prendiamo da ENV (settato nel kick-off del
    # capitano) o default a CAPITANO. tick_interval lo lasciamo di
    # default 10m: il bridge ha la sua logica adattiva 1/3/5 dentro.
    target_session = os.environ.get("JHT_TARGET_SESSION", TARGET_SESSION_DEFAULT)
    tick_interval = os.environ.get("JHT_TICK_INTERVAL", TICK_INTERVAL_DEFAULT)

    new_pid = spawn_bridge(target_session, tick_interval)
    if new_pid is None:
        status_fatal("spawn_failed")
        sys.exit(2)

    status_restarted(new_pid, reason)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
