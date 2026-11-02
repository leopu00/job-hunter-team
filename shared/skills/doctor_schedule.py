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

Un giro e' "fatto" (did_*) solo dopo un AVVIO RIUSCITO: lo spawner esce 0 solo
quando la sessione e' davvero partita (non ferma sul prompt con "Selected model
is at capacity"). Con quell'errore esce 75 e il watchdog chiama `fail SLOT
capacity`: il claim si libera, il giro NON e' segnato fatto, si riprova dopo
un'attesa crescente (DOCTOR_CAPACITY_WAIT_SEC, 10 min poi il doppio, tetto 1 h)
e dal secondo tentativo con il modello di riserva se la configurazione lo
prevede; dopo DOCTOR_CAPACITY_MAX_ATTEMPTS tentativi il giro e' FALLITO in modo
visibile: evento `round_failed` in logs/dottore-actions.jsonl.

`FALLBACK` = claim periodico per un team 24/7 (nessuna finestra delimitata).
`OFF` = fuori working hours. `WAIT` = nessuno slot dovuto ora. Il comando
legacy read-only `check` conserva `NOWINDOW`; il runtime usa sempre `claim`.
"""
from __future__ import annotations

import json
import os
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - il runtime container e' POSIX
    fcntl = None

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
# Errore di capacita' del modello: tentativi, attesa, tetto dell'attesa.
CAPACITY_MAX_ATTEMPTS = int(os.environ.get("DOCTOR_CAPACITY_MAX_ATTEMPTS", "4"))
CAPACITY_WAIT_SEC = int(os.environ.get("DOCTOR_CAPACITY_WAIT_SEC", "600"))
CAPACITY_WAIT_CAP_SEC = 3600
# Le uniche cause che un giro non partito puo' dichiarare (testo libero mai nel log).
FAIL_REASONS = ("capacity",)
ACTIONS_NAME = "dottore-actions.jsonl"
WINDOW_SLOTS = {
    "T30": ("did_t30", "claimed_t30"),
    "MID": ("did_mid", "claimed_mid"),
}


@contextmanager
def _state_lock():
    """Serialize state read-modify-write across overlapping watchdog calls."""
    if fcntl is None:
        raise OSError("interprocess state lock unavailable")
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_path = STATE_FILE.with_name(f".{STATE_FILE.name}.lock")
    with lock_path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _load_state() -> dict:
    try:
        raw_state = STATE_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    try:
        state = json.loads(raw_state)
    except (json.JSONDecodeError, TypeError) as exc:
        raise OSError("doctor schedule state is unreadable") from exc
    if not isinstance(state, dict):
        raise OSError("doctor schedule state is not an object")
    return state


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
        "attempts": {},
        "retry_after": {},
        "failed": {},
        "maint_date": state.get("maint_date"),
        "fallback_done_at": state.get("fallback_done_at"),
        "fallback_claimed_at": state.get("fallback_claimed_at"),
    }, True


def _slot_open(state: dict, slot: str, now_s: float) -> bool:
    """Un giro fallito per sempre o in attesa del prossimo tentativo non e' dovuto."""
    if (state.get("failed") or {}).get(slot):
        return False
    return now_s >= float((state.get("retry_after") or {}).get(slot) or 0)


def _due_window_slot(
    state: dict, elapsed_min: float, mid_min: float, now_s: float | None = None
) -> str | None:
    now_s = datetime.now().timestamp() if now_s is None else now_s
    if (
        elapsed_min >= T30_MIN
        and not state.get("did_t30")
        and not state.get("claimed_t30")
        and _slot_open(state, "T30", now_s)
    ):
        return "T30"
    if (
        elapsed_min >= mid_min
        and not state.get("did_mid")
        and not state.get("claimed_mid")
        and _slot_open(state, "MID", now_s)
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

    with _state_lock():
        state, changed = _window_state(_load_state(), start)
        if changed:
            _save_state(state)
        return _due_window_slot(state, elapsed_min, mid_min) or "WAIT"


def _with_retry(slot: str, attempts: int) -> str:
    """`MID` al primo tentativo, `MID retry=2` quando e' un nuovo tentativo dopo un errore di capacita'."""
    return f"{slot} retry={attempts}" if attempts > 0 else slot


def claim() -> str:
    """Durably reserve the next rich-refresh slot before any spawn.

    A persisted claim is deliberately fail-closed: after a crash it suppresses
    a duplicate LLM spawn. Missing that rich round is safe because the separate
    age-only watchdog still enforces the session TTL.
    """
    with _state_lock():
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
            return _with_retry("FALLBACK", int(state.get("fallback_attempts") or 0))

        start, end, now = bounds
        elapsed_min = (now - start).total_seconds() / 60.0
        mid_min = (end - start).total_seconds() / 120.0
        state, changed = _window_state(state, start)
        slot = _due_window_slot(state, elapsed_min, mid_min)
        if slot:
            state[WINDOW_SLOTS[slot][1]] = True
            _save_state(state)
            return _with_retry(slot, int((state.get("attempts") or {}).get(slot) or 0))
        if changed:
            _save_state(state)
        return "WAIT"


def mark(slot: str) -> None:
    with _state_lock():
        b = _bounds_now()
        if slot == "FALLBACK":
            state = _load_state()
            state["fallback_done_at"] = int(datetime.now().timestamp())
            state.pop("fallback_claimed_at", None)
            state.pop("fallback_attempts", None)
            _save_state(state)
            return
        if b is None:
            return
        start, _, _ = b
        state, _ = _window_state(_load_state(), start)
        done_field, claim_field = WINDOW_SLOTS[slot]
        state[done_field] = True
        state[claim_field] = False
        for table in ("attempts", "retry_after", "failed"):
            (state.get(table) or {}).pop(slot, None)
        _save_state(state)


def release(slot: str) -> None:
    """Release only a known failed spawn; uncertain outcomes keep the claim."""
    with _state_lock():
        bounds = _bounds_now()
        state = _load_state()
        if slot == "FALLBACK":
            state.pop("fallback_claimed_at", None)
            _save_state(state)
            return
        if bounds is None or state.get("window_start") != bounds[0].isoformat():
            return
        state[WINDOW_SLOTS[slot][1]] = False
        _save_state(state)


def _capacity_wait(attempts: int) -> int:
    """Attesa prima del tentativo successivo: la base, poi il doppio a ogni errore, con un tetto."""
    return min(CAPACITY_WAIT_CAP_SEC, CAPACITY_WAIT_SEC * (2 ** max(0, attempts - 1)))


def _record_round_failed(slot: str, reason: str, attempts: int) -> None:
    """Il giro non e' partito e non ripartira': visibile nello stesso file degli altri giri del Dottore."""
    now = datetime.now()
    entry = {
        "ts": now.astimezone().isoformat(timespec="seconds"),
        "round_id": f"{now.strftime('%Y%m%dT%H%M%S')}-{slot.lower()}",
        "event": "round_failed",
        "slot": slot,
        "reason": reason,
        "attempts": attempts,
        "src": "doctor_schedule.py",
    }
    try:
        actions = STATE_FILE.with_name(ACTIONS_NAME)
        actions.parent.mkdir(parents=True, exist_ok=True)
        with actions.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:  # il diario non deve fermare lo scheduler
        print(f"doctor_schedule: round_failed not recorded: {exc}", file=sys.stderr)


def fail(slot: str, reason: str) -> str:
    """Il giro non e' partito per una causa nota (la sessione e' ferma, es. modello a capacita').

    Il giro NON e' segnato fatto e il claim si libera. Ritorna `RETRY <secondi> attempt=<n>`
    (riprova dopo l'attesa) oppure `FAILED attempts=<n>` (tentativi finiti: `round_failed`
    scritto nel diario del Dottore).
    """
    if reason not in FAIL_REASONS:
        raise OSError("unknown failure reason")
    with _state_lock():
        now_s = int(datetime.now().timestamp())
        state = _load_state()
        if slot == "FALLBACK":
            attempts = int(state.get("fallback_attempts") or 0) + 1
            if attempts >= CAPACITY_MAX_ATTEMPTS:
                # niente altri tentativi ora: la cadenza normale (un claim ogni FALLBACK_SEC) riparte da adesso
                state["fallback_claimed_at"] = now_s
                state.pop("fallback_attempts", None)
                _save_state(state)
                _record_round_failed(slot, reason, attempts)
                return f"FAILED attempts={attempts}"
            wait = _capacity_wait(attempts)
            state["fallback_attempts"] = attempts
            # il prossimo claim torna WAIT finche' non sono passati `wait` secondi
            state["fallback_claimed_at"] = now_s - FALLBACK_SEC + wait
            _save_state(state)
            return f"RETRY {wait} attempt={attempts}"
        bounds = _bounds_now()
        if bounds is None or state.get("window_start") != bounds[0].isoformat():
            return "FAILED attempts=0"  # la finestra e' cambiata: questo giro non esiste piu'
        state, _ = _window_state(state, bounds[0])
        attempts_by_slot = dict(state.get("attempts") or {})
        attempts = int(attempts_by_slot.get(slot) or 0) + 1
        attempts_by_slot[slot] = attempts
        state["attempts"] = attempts_by_slot
        state[WINDOW_SLOTS[slot][1]] = False
        if attempts >= CAPACITY_MAX_ATTEMPTS:
            state["failed"] = {**(state.get("failed") or {}), slot: reason}
            _save_state(state)
            _record_round_failed(slot, reason, attempts)
            return f"FAILED attempts={attempts}"
        wait = _capacity_wait(attempts)
        state["retry_after"] = {**(state.get("retry_after") or {}), slot: now_s + wait}
        _save_state(state)
        return f"RETRY {wait} attempt={attempts}"


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
    with _state_lock():
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
    if cmd == "fail":
        if len(argv) < 3 or argv[1] not in (*WINDOW_SLOTS, "FALLBACK") or argv[2] not in FAIL_REASONS:
            print("usage: doctor_schedule.py fail <T30|MID|FALLBACK> <capacity>", file=sys.stderr)
            return 2
        try:
            print(fail(argv[1], argv[2]))
            return 0
        except OSError as exc:
            print(f"doctor_schedule: fail persistence failed: {exc}", file=sys.stderr)
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
        "<check|claim|mark SLOT|release SLOT|fail SLOT capacity|check-maintainer|mark-maintainer>",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
