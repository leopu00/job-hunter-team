#!/usr/bin/env python3
"""recreate_marker — la traccia di una ricreazione di un agente CORE, per chi misura il ritmo del budget.

Quando il watchdog ricrea un agente core (TTL di 12 h: kill + recreate; o un giro del Dottore) le sessioni nuove
rileggono il loro prompt e la loro storia: sono centinaia di migliaia di token spesi senza produrre niente. Il 01/11
21:39Z la ricreazione dei quattro core ha fatto salire il contatore settimanale da 38 a 42 % in circa un'ora: il ritmo
«4,0 %/h contro 2,0» ha fatto scrivere «Above pace … STOP new spawns» e nessuno scout e' partito fino all'01:15Z, con
la pipeline vuota. Il ritmo di quella finestra e' manutenzione, non produzione, e non deve fermare la produzione.

Un file solo, `state/last-recreate.json` = {"ts": epoch dell'ultima ricreazione, "kind": ..., "sessions": [...]},
riscritto dal watchdog a ogni ricreazione. Le ricreazioni ravvicinate (la stessa tornata: i quattro core in tre minuti)
si uniscono nello stesso file: `sessions` le elenca, `ts` e' quella dell'ultima. Chi legge (pace_rate.py, i bridge)
chiede `seconds_since()`.

Scrivere non deve mai far fallire la ricreazione: un errore di disco e' muto (la traccia manca, l'agente rinasce lo
stesso). Come freeze_marker.py, che e' il modello.

Uso dal watchdog (shell):
  python3 /app/shared/skills/recreate_marker.py mark CAPITANO ttl
"""
import json
import os
import sys
import time
from pathlib import Path

# Ricreazioni a meno di questo tempo l'una dall'altra sono la stessa tornata.
SAME_ROUND_SEC = 600


def marker_path() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home") / "state" / "last-recreate.json"


def _read():
    try:
        data = json.loads(marker_path().read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("ts"), (int, float)):
            return data
    except (OSError, ValueError, TypeError):
        pass
    return None


def mark(session: str, kind: str = "ttl", now=None) -> None:
    """Registra che `session` e' stata ricreata adesso (o a `now`)."""
    ts = time.time() if now is None else float(now)
    sessions = []
    previous = _read()
    if previous and 0 <= ts - float(previous["ts"]) <= SAME_ROUND_SEC:
        sessions = [s for s in previous.get("sessions") or [] if isinstance(s, str)]
    name = str(session).strip().upper()
    if name and name not in sessions:
        sessions.append(name)
    path = marker_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"ts": ts, "kind": str(kind), "sessions": sessions}), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def seconds_since(now=None):
    """Secondi dall'ultima ricreazione, o None (nessuna traccia, illeggibile, o nel futuro)."""
    data = _read()
    if data is None:
        return None
    elapsed = (time.time() if now is None else float(now)) - float(data["ts"])
    return elapsed if elapsed >= 0 else None


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) >= 2 and args[0] == "mark":
        mark(args[1], args[2] if len(args) > 2 else "ttl")
        return 0
    print("uso: recreate_marker.py mark SESSIONE [ttl|doctor]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
