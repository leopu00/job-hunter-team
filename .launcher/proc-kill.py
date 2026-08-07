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
  proc-kill.py <marker> [--grace SEC] [--settle SEC] [--verbose]

Semantica (identica ai blocchi bash che sostituisce):
  • manda SIGTERM a tutti i match;
  • se --grace > 0: attende SEC, ri-scansiona e manda SIGKILL ai sopravvissuti;
  • se --settle > 0: attende SEC prima di uscire (finestra di quiescenza per
    chi rispawna subito dopo).

Exit code: sempre 0 (killare zero processi non è un errore — è il caso normale
al primo avvio). Errori reali vanno su stderr.
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


def _signal(pids, sig):
    sent = []
    for pid in pids:
        try:
            os.kill(pid, sig)
            sent.append(pid)
        except (ProcessLookupError, PermissionError):
            pass
        except OSError as e:
            print(f"[proc-kill] WARN kill {pid}: {e}", file=sys.stderr)
    return sent


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("marker", help="substring to find in the command line")
    ap.add_argument("--grace", type=float, default=0.0,
                    help="seconds between SIGTERM and SIGKILL (0 = SIGTERM only)")
    ap.add_argument("--settle", type=float, default=0.0,
                    help="seconds to wait before exiting")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    protected = _ancestors()
    protected.add(os.getpid())

    termed = _signal(find_targets(args.marker, protected), signal.SIGTERM)
    if args.verbose and termed:
        print(f"[proc-kill] SIGTERM {args.marker}: {termed}")

    if args.grace > 0:
        time.sleep(args.grace)
        killed = _signal(find_targets(args.marker, protected), signal.SIGKILL)
        if args.verbose and killed:
            print(f"[proc-kill] SIGKILL {args.marker}: {killed}")

    if args.settle > 0:
        time.sleep(args.settle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
