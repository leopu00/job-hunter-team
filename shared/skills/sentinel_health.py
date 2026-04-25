#!/usr/bin/env python3
"""
sentinel_health — controllo + restart della Sentinella LLM.

Pensato per essere chiamato dal bridge prima di mandare un [BRIDGE TICK]
alla Sentinella. Se la sessione tmux SENTINELLA non esiste o è morta,
la skill prova a rilanciarla via start-agent.sh.

Uso:
    python3 /app/shared/skills/sentinel_health.py [check|ensure]

Output (machine-friendly):
    running                                 # session viva e responsive
    restarted reason=missing_session        # session non c'era, spawnata
    restarted reason=dead_pane              # session c'era ma CLI morto
    fatal reason=spawn_failed               # restart non riuscito
    fatal reason=launcher_missing           # start-agent.sh non trovato
    stopped                                 # check mode + session morta

Exit code 0 sempre (anche restarted/stopped).
Exit 2 per fatal.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

SENTINELLA_SESSION = "SENTINELLA"
START_AGENT_SH = "/app/.launcher/start-agent.sh"
RESTART_BOOT_WAIT_S = 5  # margine perché tmux + Codex partano


def tmux_has_session(name):
    return subprocess.run(
        ["tmux", "has-session", "-t", name],
        capture_output=True,
    ).returncode == 0


def tmux_capture(name, lines=20):
    r = subprocess.run(
        ["tmux", "capture-pane", "-t", name, "-p", "-S", f"-{lines}"],
        capture_output=True,
    )
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else ""


def session_looks_alive(name):
    """La sessione esiste E il pane non è in uno stato di shell-vuota.

    Match grezzo ma robusto: se nelle ultime righe vediamo il prompt
    della shell ($ o #) senza traccia di Codex CLI/codex/gpt, la session
    è "morta" (CLI uscito, shell rimasta). Codex stampa box ASCII e
    'gpt-5.5' nel header che resta visibile.
    """
    if not tmux_has_session(name):
        return False, "missing_session"
    pane = tmux_capture(name, lines=40)
    if not pane.strip():
        return False, "empty_pane"
    # Heuristic: se vedo "gpt-" o "Codex" o "codex --yolo" nel pane,
    # il CLI sta girando. Se vedo solo il prompt (riga che termina con
    # "$ " o "# "), il CLI è uscito.
    has_codex_marker = ("gpt-" in pane.lower()
                       or "codex" in pane.lower()
                       or "openai" in pane.lower())
    if has_codex_marker:
        return True, None
    return False, "dead_pane"


def restart_sentinella():
    """Lancia start-agent.sh sentinella in background. Lo script gestisce
    già spawn tmux + boot Codex + kick-off del prompt loop."""
    if not Path(START_AGENT_SH).exists():
        return False, "launcher_missing"
    try:
        # Detached: non blocchiamo il chiamante (es. il bridge) per i 5s
        # di boot. Output redirezionato a /tmp così troubleshooting facile.
        with open("/tmp/sentinel-restart.log", "ab") as logf:
            subprocess.Popen(
                ["bash", START_AGENT_SH, "sentinella"],
                stdin=subprocess.DEVNULL,
                stdout=logf,
                stderr=logf,
                start_new_session=True,
            )
    except (OSError, FileNotFoundError):
        return False, "spawn_failed"
    # Aspettiamo brevemente che la session compaia
    deadline = time.time() + RESTART_BOOT_WAIT_S
    while time.time() < deadline:
        time.sleep(0.5)
        if tmux_has_session(SENTINELLA_SESSION):
            return True, None
    return False, "spawn_timeout"


def main():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "ensure").lower()
    alive, reason = session_looks_alive(SENTINELLA_SESSION)

    if alive:
        print("running")
        return

    if cmd == "check":
        print(f"stopped reason={reason or 'unknown'}")
        return

    # ensure: tenta restart
    if reason in ("dead_pane", "empty_pane") and tmux_has_session(SENTINELLA_SESSION):
        # Pane c'è ma CLI morto: kill della session prima del restart
        # (start-agent.sh fa idempotency via tmux has-session quindi
        # senza pulizia non rispawnerebbe).
        subprocess.run(
            ["tmux", "kill-session", "-t", SENTINELLA_SESSION],
            capture_output=True,
        )

    ok, fail_reason = restart_sentinella()
    if not ok:
        print(f"fatal reason={fail_reason}", file=sys.stderr)
        sys.exit(2)
    print(f"restarted reason={reason or 'unknown'}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
