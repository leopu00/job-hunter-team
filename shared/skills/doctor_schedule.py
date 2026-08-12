#!/usr/bin/env python3
"""doctor_schedule — decide QUANDO spawnare il Dottore in una finestra di lavoro.

Ridisegno Dottore 2026-06-13: non piu' "ogni 2h" cieco, ma 2 slot per finestra
ON: a **+30min** dall'inizio finestra (calibrazione: il Capitano ha deciso chi
lavora) e a **meta'** finestra (es. +6h su una notte 20:00-08:00). Idempotente:
ogni slot viene rivendicato su disco PRIMA dello spawn (stato in
doctor-schedule-state.json, resettato a nuova finestra). Se il processo cade
dopo il claim, lo slot resta incerto e non viene duplicato; il TTL deterministico
di agent-watchdog resta la rete che garantisce la freshness.

Usato da .launcher/doctor-watchdog.sh:
    slot=$(python3 /app/shared/skills/doctor_schedule.py claim)
    case "$slot" in
      T30|MID|FALLBACK)
        if bash spawn-doctor.sh; then
          python3 .../doctor_schedule.py mark "$slot"
        else
          python3 .../doctor_schedule.py release "$slot"
        fi ;;
      OFF)      sleep <off_recheck> ;;
      WAIT)     sleep <poll> ;;
    esac

`FALLBACK` = claim periodico per un team 24/7 (nessuna finestra delimitata).
`OFF` = fuori working hours. `WAIT` = nessuno slot dovuto ora. Il comando
legacy read-only `check` conserva `NOWINDOW`; il runtime usa sempre `claim`.
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
FALLBACK_SEC = int(os.environ.get("DOCTOR_FALLBACK_SEC", "21600"))
JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
STATE_FILE = JHT_HOME / "logs" / "doctor-schedule-state.json"
WINDOW_SLOTS = {
    "T30": ("did_t30", "claimed_t30"),
    "MID": ("did_mid", "claimed_mid"),
}


def _load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    """Persist atomically or raise: no durable claim means no LLM spawn."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_name(f".{STATE_FILE.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, STATE_FILE)
        # Persist the rename as well as the file contents. If this fsync fails,
        # claim() reports failure and the watchdog does not spawn.
        if os.name != "nt":
            directory_fd = os.open(STATE_FILE.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _bounds_now():
    """(start, end, now) tz-aware della finestra attiva, o None."""
    b = current_window_bounds()
    if not b:
        return None
    start, end = b
    now = datetime.now(start.tzinfo) if start.tzinfo else datetime.now()
    return start, end, now


def _window_state(state: dict, start: datetime) -> tuple[dict, bool]:
    """Return state for the active window, preserving independent cadence."""
    win_key = start.isoformat()
    if state.get("window_start") == win_key:
        return state, False
    return {
        "window_start": win_key,
        "did_t30": False,
        "did_mid": False,
        "claimed_t30": False,
        "claimed_mid": False,
        "maint_date": state.get("maint_date"),
        "fallback_done_at": state.get("fallback_done_at"),
        "fallback_claimed_at": state.get("fallback_claimed_at"),
    }, True


def _due_window_slot(state: dict, elapsed_min: float, mid_min: float) -> str | None:
    if (
        elapsed_min >= T30_MIN
        and not state.get("did_t30")
        and not state.get("claimed_t30")
    ):
        return "T30"
    if (
        elapsed_min >= mid_min
        and not state.get("did_mid")
        and not state.get("claimed_mid")
    ):
        return "MID"
    return None


def check() -> str:
    b = _bounds_now()
    if b is None:
        # Nessuna finestra delimitata: 24/7 (NOWINDOW) o pausa (OFF).
        return "NOWINDOW" if is_within_working_hours() else "OFF"
    start, end, now = b
    elapsed_min = (now - start).total_seconds() / 60.0
    duration_min = (end - start).total_seconds() / 60.0
    mid_min = duration_min / 2.0

    state, changed = _window_state(_load_state(), start)
    if changed:
        _save_state(state)
    return _due_window_slot(state, elapsed_min, mid_min) or "WAIT"


def claim() -> str:
    """Durably reserve the next rich-refresh slot before any spawn.

    A persisted claim is deliberately fail-closed: after a crash it suppresses
    a duplicate LLM spawn. Missing that rich round is safe because the separate
    age-only watchdog still enforces the session TTL.
    """
    bounds = _bounds_now()
    state = _load_state()
    if bounds is None:
        if not is_within_working_hours():
            return "OFF"
        now_s = int(datetime.now().timestamp())
        last = int(
            state.get("fallback_claimed_at")
            or state.get("fallback_done_at")
            or 0
        )
        if now_s - last < FALLBACK_SEC:
            return "WAIT"
        state["fallback_claimed_at"] = now_s
        _save_state(state)
        return "FALLBACK"

    start, end, now = bounds
    elapsed_min = (now - start).total_seconds() / 60.0
    mid_min = (end - start).total_seconds() / 120.0
    state, changed = _window_state(state, start)
    slot = _due_window_slot(state, elapsed_min, mid_min)
    if slot:
        state[WINDOW_SLOTS[slot][1]] = True
        _save_state(state)
        return slot
    if changed:
        _save_state(state)
    return "WAIT"


def mark(slot: str) -> None:
    if slot == "FALLBACK":
        state = _load_state()
        state["fallback_done_at"] = int(datetime.now().timestamp())
        state.pop("fallback_claimed_at", None)
        _save_state(state)
        return
    b = _bounds_now()
    if b is None:
        return
    start, _, _ = b
    state, _ = _window_state(_load_state(), start)
    done_field, claim_field = WINDOW_SLOTS[slot]
    state[done_field] = True
    state[claim_field] = False
    _save_state(state)


def release(slot: str) -> None:
    """Release only a known failed spawn; uncertain outcomes keep the claim."""
    state = _load_state()
    if slot == "FALLBACK":
        state.pop("fallback_claimed_at", None)
        _save_state(state)
        return
    bounds = _bounds_now()
    if bounds is None or state.get("window_start") != bounds[0].isoformat():
        return
    state[WINDOW_SLOTS[slot][1]] = False
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
        try:
            print(check())
            return 0
        except OSError as exc:
            print(f"doctor_schedule: state persistence failed: {exc}", file=sys.stderr)
            return 1
    if cmd == "claim":
        try:
            print(claim())
            return 0
        except OSError as exc:
            print(f"doctor_schedule: claim persistence failed: {exc}", file=sys.stderr)
            return 1
    if cmd in ("mark", "release"):
        if len(argv) < 2 or argv[1] not in (*WINDOW_SLOTS, "FALLBACK"):
            print(
                f"usage: doctor_schedule.py {cmd} <T30|MID|FALLBACK>",
                file=sys.stderr,
            )
            return 2
        try:
            (mark if cmd == "mark" else release)(argv[1])
            return 0
        except OSError as exc:
            print(f"doctor_schedule: {cmd} persistence failed: {exc}", file=sys.stderr)
            return 1
    if cmd == "check-maintainer":
        print(check_maintainer())
        return 0
    if cmd == "mark-maintainer":
        try:
            mark_maintainer()
            return 0
        except OSError as exc:
            print(f"doctor_schedule: maintainer persistence failed: {exc}", file=sys.stderr)
            return 1
    print(
        "usage: doctor_schedule.py "
        "<check|claim|mark SLOT|release SLOT|check-maintainer|mark-maintainer>",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
