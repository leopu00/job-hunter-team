#!/usr/bin/env python3
"""
freeze_team — congela gli agenti operativi via Esc tmux.

Pensato come azione di emergenza della Sentinella quando rileva una
situazione di consumo critico (proj > 105% / usage ≥ 90%) e non può
fidarsi che il Capitano riceva il messaggio (Codex/Kimi CLI può
droppare i Queued message in working/429).

Cosa fa:
  • lista tutte le sessioni tmux
  • esclude CAPITANO, ASSISTENTE, SENTINELLA, SENTINELLA-WORKER
  • a tutte le altre invia Esc × 2 (abort del turn corrente)

Output stampa la lista dei "frozen" (per log della Sentinella).

Exit 0 sempre.
"""
import subprocess
import sys
import time

DEFAULT_EXCLUDE = {
    "CAPITANO",
    "ASSISTENTE",
    "SENTINELLA",
    "SENTINELLA-WORKER",
}


def list_sessions():
    try:
        r = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, timeout=5,
        )
        if r.returncode != 0:
            return []
        return [s.strip() for s in r.stdout.decode("utf-8", errors="replace").splitlines() if s.strip()]
    except (subprocess.TimeoutExpired, OSError):
        return []


def send_esc(session):
    try:
        subprocess.run(
            ["tmux", "send-keys", "-t", session, "Escape"],
            capture_output=True, timeout=3,
        )
        time.sleep(0.1)
        subprocess.run(
            ["tmux", "send-keys", "-t", session, "Escape"],
            capture_output=True, timeout=3,
        )
        return True
    except (subprocess.TimeoutExpired, OSError):
        return False


def main():
    sessions = list_sessions()
    if not sessions:
        print("nessuna sessione tmux trovata")
        sys.exit(0)

    frozen = []
    skipped = []
    for s in sessions:
        if s in DEFAULT_EXCLUDE:
            skipped.append(s)
            continue
        if send_esc(s):
            frozen.append(s)

    print(f"frozen={len(frozen)} sessions={','.join(frozen) if frozen else 'none'}")
    if skipped:
        print(f"skipped={','.join(skipped)}")


if __name__ == "__main__":
    main()
