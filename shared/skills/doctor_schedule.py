#!/usr/bin/env python3
"""doctor_schedule — decide QUANDO spawnare il Dottore in una finestra di lavoro.

Ridisegno Dottore 2026-06-13: non piu' "ogni 2h" cieco, ma 2 slot per finestra
ON: a **+30min** dall'inizio finestra (calibrazione: il Capitano ha deciso chi
lavora) e a **meta'** finestra (es. +6h su una notte 20:00-08:00). Idempotente:
ogni slot scatta UNA volta per finestra (stato in doctor-schedule-state.json,
resettato a nuova finestra).

Usato da .launcher/doctor-watchdog.sh:
    slot=$(python3 /app/shared/skills/doctor_schedule.py check)
    case "$slot" in
      T30|MID) bash spawn-doctor.sh && \
               python3 .../doctor_schedule.py mark "$slot" ;;
      OFF)      sleep <off_recheck> ;;
      WAIT|NOWINDOW) sleep <poll> ;;
    esac

`NOWINDOW` = team 24/7 (nessuna finestra delimitata): il watchdog usa un
fallback periodico. `OFF` = fuori working hours. `WAIT` = dentro finestra ma
nessuno slot dovuto ora.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, "/app")
try:
    from shared.skills.working_hours import (
        current_window_bounds,
        is_within_working_hours,
    )
except Exception:  # import path host/test
    _here = Path(__file__).resolve().parent
    sys.path.insert(0, str(_here.parent.parent))
    from shared.skills.working_hours import (  # type: ignore
        current_window_bounds,
        is_within_working_hours,
    )

T30_MIN = 30.0  # primo slot: +30 min dall'inizio finestra
JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
STATE_FILE = JHT_HOME / "logs" / "doctor-schedule-state.json"


def _load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state))
    except Exception:
        pass


def _bounds_now():
    """(start, end, now) tz-aware della finestra attiva, o None."""
    b = current_window_bounds()
    if not b:
        return None
    start, end = b
    now = datetime.now(start.tzinfo) if start.tzinfo else datetime.now()
    return start, end, now


def check() -> str:
    b = _bounds_now()
    if b is None:
        # Nessuna finestra delimitata: 24/7 (NOWINDOW) o pausa (OFF).
        return "NOWINDOW" if is_within_working_hours() else "OFF"
    start, end, now = b
    elapsed_min = (now - start).total_seconds() / 60.0
    duration_min = (end - start).total_seconds() / 60.0
    mid_min = duration_min / 2.0

    state = _load_state()
    win_key = start.isoformat()
    if state.get("window_start") != win_key:
        # Nuova finestra → slot Dottore non ancora fatti. Preserva maint_date
        # (lo slot Mantenitore è giornaliero, non per-finestra).
        state = {"window_start": win_key, "did_t30": False, "did_mid": False,
                 "maint_date": state.get("maint_date")}
        _save_state(state)

    if elapsed_min >= T30_MIN and not state.get("did_t30"):
        return "T30"
    if elapsed_min >= mid_min and not state.get("did_mid"):
        return "MID"
    return "WAIT"


def mark(slot: str) -> None:
    b = _bounds_now()
    if b is None:
        return
    start, _, _ = b
    state = _load_state()
    if state.get("window_start") != start.isoformat():
        state = {"window_start": start.isoformat(), "did_t30": False, "did_mid": False,
                 "maint_date": state.get("maint_date")}
    if slot == "T30":
        state["did_t30"] = True
    elif slot == "MID":
        state["did_mid"] = True
    _save_state(state)


def _today_local() -> str:
    """Data locale ISO (YYYY-MM-DD), coerente con i confini finestra."""
    b = current_window_bounds()
    tz = b[0].tzinfo if b else None
    return (datetime.now(tz) if tz else datetime.now()).date().isoformat()


def check_maintainer() -> str:
    """Slot Mantenitore: 1x/GIORNO (non per-finestra). Ritorna:
    - MAINT  → non ancora fatto oggi ed è ora lavorabile → spawna il Mantenitore;
    - WAIT   → già fatto oggi;
    - OFF    → fuori working hours (rimanda a quando il team è attivo).
    Gemello di check() ma su cadenza giornaliera: l'infra cambia lentamente,
    uno sweep al giorno basta (a differenza del context-refresh del Dottore).
    """
    state = _load_state()
    if state.get("maint_date") == _today_local():
        return "WAIT"
    if not is_within_working_hours():
        return "OFF"
    return "MAINT"


def mark_maintainer() -> None:
    state = _load_state()
    state["maint_date"] = _today_local()
    _save_state(state)


def main(argv):
    cmd = argv[0] if argv else "check"
    if cmd == "check":
        print(check())
        return 0
    if cmd == "mark":
        if len(argv) < 2 or argv[1] not in ("T30", "MID"):
            print("usage: doctor_schedule.py mark <T30|MID>", file=sys.stderr)
            return 2
        mark(argv[1])
        return 0
    if cmd == "check-maintainer":
        print(check_maintainer())
        return 0
    if cmd == "mark-maintainer":
        mark_maintainer()
        return 0
    print("usage: doctor_schedule.py <check|mark T30|mark MID|check-maintainer|mark-maintainer>",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
