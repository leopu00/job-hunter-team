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
import time
from pathlib import Path


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
        ts = float(json.loads(marker_path().read_text(encoding="utf-8"))["ts"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    elapsed = (time.time() if now is None else float(now)) - ts
    return elapsed if elapsed >= 0 else None
