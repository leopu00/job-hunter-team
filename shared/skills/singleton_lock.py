#!/usr/bin/env python3
"""singleton_lock.py — «uno solo di me», per tutta la bridge-suite.

Estratto da `sentinel-bridge.py` ([BRIDGE-SINGLETON-PARTIAL]). Il flock c'era
su due dei sette membri della suite che `start-agent.sh bridge` lancia dallo
stesso blocco; gli altri cinque avevano un PID file check-then-write o niente.
E `start-agent.sh bridge` ha almeno tre invocatori concorrenti (agent-watchdog
ogni 30s, la skill maintainer-sweep, la riga di riparazione di
process_health.py): due esecuzioni sovrapposte fanno kill→spawn entrambe, e
due heartbeat-bridge vivi significano `[HEARTBEAT]` DOPPIO al Capitano ogni
ora — turni LLM doppi sul modello più caro, la classe di spreco già
documentata dal coordinator-burn.

Perché `flock` e non il PID file:

  • è ATOMICO a livello di kernel — fra `PID_FILE.exists()` e `write_text()`
    c'è una finestra in cui due processi lanciati insieme si vedono entrambi
    soli e partono entrambi;
  • si rilascia DA SOLO alla morte del processo, anche di SIGKILL: non lascia
    lock stale da ripulire, a differenza del PID file che sopravvive ai crash.

Due regole che sembrano dettagli e non lo sono:

  1. **Il lockfile è DEDICATO e separato dal PID file.** Il PID file lo
     cancellano `bridge-control.sh` e pid1 (`cleanupStaleBridgeState`), e
     cancellare un file flockato ne rompe la mutua esclusione: il processo
     dopo crea un inode NUOVO e prende un lock diverso, cioè nessun lock.
     Il PID file resta perché lo leggono la UI e pid1 — sono due file con due
     lavori diversi, non si unificano.
  2. **Se il lock non è disponibile si PROSEGUE.** Filesystem non scrivibile o
     `fcntl` assente (bind mount non-POSIX, Windows) non devono lasciare il
     team senza bridge: meglio un bridge senza lock che nessun bridge — il
     kill-by-marker dello spawner resta come rete.

Uso:

    from singleton_lock import acquire_singleton
    acquire_singleton(LOCK_FILE, pid_file=PID_FILE, label="heartbeat-bridge")
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import fcntl
except ImportError:      # pragma: no cover — Windows/non-POSIX
    fcntl = None         # type: ignore[assignment]


# I file handle restano aperti per TUTTA la vita del processo: è il possesso
# del fd a tenere il flock. Se il modulo li lasciasse andare, il GC chiuderebbe
# il fd e il lock cadrebbe senza che nessuno se ne accorga.
_HELD: list = []


def acquire_singleton(lock_file, pid_file=None, label: str = "",
                      exit_on_busy: bool = True) -> bool:
    """Prende il lock del singleton. True se si può proseguire.

    `exit_on_busy=True` (default): un'altra istanza viva → messaggio e
    `sys.exit(0)`, che è quello che vuole un daemon lanciato in doppio.
    `exit_on_busy=False`: ritorna False e lascia decidere al chiamante.

    `pid_file` è opzionale e viene scritto DOPO l'acquisizione: è informativo
    (UI, pid1), non è il lock.
    """
    tag = f"[{label or 'singleton'}]"
    lock_file = Path(lock_file)
    try:
        lock_file.parent.mkdir(parents=True, exist_ok=True)
        fh = open(lock_file, "a+", encoding="utf-8")
    except OSError as e:
        print(f"{tag} WARN lockfile non apribile ({e}) — proseguo senza lock",
              flush=True)
        return True
    if fcntl is None:
        print(f"{tag} WARN fcntl non disponibile — proseguo senza lock",
              flush=True)
        _HELD.append(fh)
        return True
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        try:
            fh.seek(0)
            other = fh.read().strip() or "?"
        except OSError:
            other = "?"
        fh.close()
        print(f"{tag} altra istanza viva (pid={other}), exit", flush=True)
        if exit_on_busy:
            sys.exit(0)
        return False
    _HELD.append(fh)
    try:
        fh.seek(0)
        fh.truncate()
        fh.write(str(os.getpid()))
        fh.flush()
    except OSError:
        pass
    if pid_file is not None:
        try:
            pid_file = Path(pid_file)
            pid_file.parent.mkdir(parents=True, exist_ok=True)
            pid_file.write_text(str(os.getpid()), encoding="utf-8")
        except OSError as e:
            print(f"{tag} WARN write pid file: {e}", file=sys.stderr)
    return True
