#!/usr/bin/env python3
"""proc-kill.py — termina i processi il cui cmdline contiene un marker, SENZA
self-match.

Perché esiste: il pattern storico usato negli script del launcher

    for _pid in $(grep -l MARKER /proc/[0-9]*/cmdline); do kill "$_pid"; done

ha due difetti gravi in produzione:
  1. SELF-MATCH — l'argv del processo che scansiona contiene il marker
     (`grep -l codex-auth-healer.sh ...`), quindi la scansione trova sé stessa
     e la pipeline si suicida / riporta falsi positivi. È lo stesso motivo per
     cui `agent-watchdog.sh` usa `shared/skills/process_health.py` (che legge
     /proc in Python, con i marker nel FILE e non in argv) invece del grep.
  2. FALSI POSITIVI — qualunque processo innocente che nomini il marker
     (un `tail -f /jht_home/logs/sentinel-bridge.log`, un editor, la shell di
     un agente) viene ucciso.

Qui la scansione avviene in Python: il marker NON è in argv di nessun processo
scansionato salvo il target. In più escludiamo esplicitamente:
  • il nostro PID;
  • tutta la catena degli antenati (chi ci ha lanciati — es. start-agent.sh);
  • qualunque processo che stia eseguendo questo stesso script.

Uso:
  proc-kill.py <marker> [--grace SEC] [--settle SEC] [--verify SEC] [--verbose]

Semantica (identica ai blocchi bash che sostituisce):
  • manda SIGTERM a tutti i match;
  • se --grace > 0: attende SEC, ri-scansiona e manda SIGKILL ai sopravvissuti;
  • se --settle > 0: attende SEC prima di uscire (finestra di quiescenza per
    chi rispawna subito dopo);
  • poi VERIFICA: per al massimo --verify secondi (default 2) controlla che
    ogni bersaglio sia davvero sparito.

Exit code:
  0  nessun bersaglio, o tutti spariti (killare zero processi non è un errore:
     è il caso normale al primo avvio);
  1  almeno un bersaglio è ancora vivo dopo il segnale: segnale rifiutato
     (AppArmor nel container: «kill: Permission denied», apparmor=DENIED
     operation=signal) oppure ignorato. Prima usciva 0 lo stesso, e chi
     chiamava lanciava un doppione accanto al processo vecchio.
"""
import argparse
import glob
import os
import signal
import sys
import time

SELF_MARKER = os.path.basename(__file__)


def _read_cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\x00", b" ").decode("utf-8", "replace")
    except OSError:
        # il processo può sparire tra la glob e la open: normale
        return None


def _ancestors():
    """PID di tutti gli antenati (noi escluso) risalendo PPid in /proc."""
    out = set()
    pid = os.getppid()
    seen = 0
    while pid and pid > 1 and seen < 64:
        out.add(pid)
        seen += 1
        try:
            with open(f"/proc/{pid}/status", encoding="utf-8") as f:
                nxt = 0
                for line in f:
                    if line.startswith("PPid:"):
                        nxt = int(line.split()[1])
                        break
            pid = nxt
        except (OSError, ValueError, IndexError):
            break
    return out


def find_targets(marker, protected):
    """PID vivi il cui cmdline contiene `marker`, esclusi self/antenati/altri
    proc-kill.py."""
    targets = []
    for path in glob.glob("/proc/[0-9]*/cmdline"):
        try:
            pid = int(path.split("/")[2])
        except (IndexError, ValueError):
            continue
        if pid in protected:
            continue
        cmd = _read_cmdline(pid)
        if not cmd or marker not in cmd:
            continue
        if SELF_MARKER in cmd:
            continue  # un'altra istanza di questo killer, non un daemon
        targets.append(pid)
    return targets


def _signal(pids, sig, refused):
    """Manda `sig` a `pids`; chi lo rifiuta (EPERM) finisce in `refused`."""
    sent = []
    for pid in pids:
        try:
            os.kill(pid, sig)
            sent.append(pid)
        except ProcessLookupError:
            pass
        except PermissionError as e:
            refused.add(pid)
            print(f"[proc-kill] DENIED kill {pid}: {e}", file=sys.stderr)
        except OSError as e:
            print(f"[proc-kill] WARN kill {pid}: {e}", file=sys.stderr)
    return sent


def _still_running(pid, marker):
    """Il bersaglio c'è ancora: cmdline leggibile che contiene il marker.

    Uno zombie ha il cmdline vuoto (è morto, aspetta solo il padre), e un pid
    riusato da un altro processo non ha il marker: nessuno dei due conta.
    """
    cmd = _read_cmdline(pid)
    return bool(cmd) and marker in cmd


def _survivors(pids, marker, wait):
    deadline = time.monotonic() + wait
    while True:
        alive = sorted(p for p in pids if _still_running(p, marker))
        if not alive or time.monotonic() >= deadline:
            return alive
        time.sleep(0.05)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("marker", help="substring to find in the command line")
    ap.add_argument("--grace", type=float, default=0.0,
                    help="seconds between SIGTERM and SIGKILL (0 = SIGTERM only)")
    ap.add_argument("--settle", type=float, default=0.0,
                    help="seconds to wait before exiting")
    ap.add_argument("--verify", type=float, default=2.0,
                    help="seconds to wait for the targets to be gone (exit 1 if not)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    protected = _ancestors()
    protected.add(os.getpid())

    refused = set()
    targets = set(find_targets(args.marker, protected))
    termed = _signal(sorted(targets), signal.SIGTERM, refused)
    if args.verbose and termed:
        print(f"[proc-kill] SIGTERM {args.marker}: {termed}")

    if args.grace > 0:
        time.sleep(args.grace)
        late = find_targets(args.marker, protected)
        targets.update(late)
        killed = _signal(late, signal.SIGKILL, refused)
        if args.verbose and killed:
            print(f"[proc-kill] SIGKILL {args.marker}: {killed}")

    if args.settle > 0:
        time.sleep(args.settle)

    alive = _survivors(targets, args.marker, args.verify)
    if alive:
        how = "signal refused" if set(alive) <= refused else "still running after the signal"
        print(f"[proc-kill] FAIL {args.marker}: {how}: {alive}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
