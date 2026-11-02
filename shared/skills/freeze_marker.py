#!/usr/bin/env python3
"""freeze_marker — la traccia di un congelamento del team, per chi deve sapere che si sta riprendendo.

`freeze_team.py` (Esc x2) e `soft_pause_team.py` (pausa graceful per FATAL usage)
fermano il team a mano della Sentinella, ma non lasciavano niente di leggibile da
una macchina: dopo il `[RIPRENDI]` nessuno poteva dire «siamo appena ripartiti».
Il motore del throttle ne ha bisogno: nel recupero la pausa del Capitano è un
freno sulla spesa, e non va accorciata da un'unità vuota dello Scout
(`pause-rules.json`, `keep_captains_pause`).

Un file solo, `state/last-freeze.json` = {"ts": epoch, "kind": ...}, riscritto a
ogni congelamento. Scrivere non deve mai far fallire il congelamento: un errore
di disco è muto (la traccia manca, il team si ferma lo stesso).
"""
import json
import os
import sys
import time
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import plain_file  # noqa: E402  (a pipe or a link in place of the marker must not hold the reader)


def marker_path() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home") / "state" / "last-freeze.json"


def mark(kind: str, now=None) -> None:
    path = marker_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"ts": time.time() if now is None else float(now),
                                   "kind": str(kind)}), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def seconds_since(now=None):
    """Secondi dall'ultimo congelamento, o None (nessuna traccia, o illeggibile)."""
    try:
        ts = float(plain_file.read_json(marker_path(), max_size=4096)["ts"])
    except (OSError, plain_file.NotPlain, ValueError, KeyError, TypeError):
        return None
    elapsed = (time.time() if now is None else float(now)) - ts
    return elapsed if elapsed >= 0 else None
