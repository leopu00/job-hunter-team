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

Un giro e' fatto solo dopo un TURNO VERO, non dopo uno spawner che esce 0. Lo spawner esce 0 appena il kickoff e' partito
in background: su Pi (giro Windows build8) il messaggio non e' mai diventato un turno (cartella delle sessioni di Pi vuota),
eppure `fallback_done_at` e `maint_date` erano gia' scritti e dopo la ricreazione del container nessuno rilanciava il
Dottore o il Mantenitore. Ora il watchdog, dopo uno spawn riuscito (o dall'esito incerto), chiama `spawned <SLOT>`: il giro
resta rivendicato ma NON fatto. Ogni poll chiama `settle`: se la sessione ha un turno vero il giro si segna fatto (`mark`);
se la sessione e' sparita (container ricreato) o non ha ancora un turno dopo DOCTOR_TURN_WAIT_SEC il giro riparte con la
stessa regola dei tentativi della capacita' (attesa, tentativi, `round_failed` in fondo). Il turno si vede solo su Pi (il file
della sessione ha un messaggio dell'assistente che non e' un errore); per le altre CLI vale lo spawn riuscito, come prima.

`FALLBACK` = claim periodico per un team 24/7 (nessuna finestra delimitata).
`OFF` = fuori working hours. `WAIT` = nessuno slot dovuto ora. Il comando
legacy read-only `check` conserva `NOWINDOW`; il runtime usa sempre `claim`.
"""
from __future__ import annotations

import json
import os
import subprocess
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
# Le uniche cause che un giro non partito puo' dichiarare (testo libero mai nel log):
# capacity = modello a capacita'; no_turn = sessione viva ma nessun turno entro TURN_WAIT_SEC;
# session_lost = sessione sparita senza un turno (container ricreato, kill).
FAIL_REASONS = ("capacity", "no_turn", "session_lost")
TURN_WAIT_SEC = int(os.environ.get("DOCTOR_TURN_WAIT_SEC", "600"))
SESSION_LOST_WAIT_SEC = 60
MAINT = "MAINT"
ROLE_OF_SLOT = {"MAINT": "mantenitore"}
SESSION_OF_ROLE = {"dottore": "DOTTORE", "mantenitore": "MANTENITORE"}
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
        "maint_attempts": state.get("maint_attempts"),
        "maint_retry_after": state.get("maint_retry_after"),
        "maint_failed_date": state.get("maint_failed_date"),
        "fallback_done_at": state.get("fallback_done_at"),
        "fallback_claimed_at": state.get("fallback_claimed_at"),
        "fallback_attempts": state.get("fallback_attempts"),
        # chi aspetta ancora un primo turno fuori dalla finestra (Mantenitore, 24/7) lo continua ad aspettare
        "spawned": {k: v for k, v in (state.get("spawned") or {}).items() if k in (MAINT, "FALLBACK")},
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


def _service_blocked(role: str) -> bool:
    """True when the service roles have used their share of the budget (service_budget.py): the round is not claimed, and the
    person is told once a day. A reading that fails is not a block."""
    try:
        if str(Path(__file__).resolve().parent) not in sys.path:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
        import service_budget

        return service_budget.blocked(role)
    except Exception:  # noqa: BLE001
        return False


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
            if _service_blocked("dottore"):
                return "WAIT"
            state["fallback_claimed_at"] = now_s
            _save_state(state)
            return _with_retry("FALLBACK", int(state.get("fallback_attempts") or 0))

        start, end, now = bounds
        elapsed_min = (now - start).total_seconds() / 60.0
        mid_min = (end - start).total_seconds() / 120.0
        state, changed = _window_state(state, start)
        slot = _due_window_slot(state, elapsed_min, mid_min)
        if slot and _service_blocked("dottore"):
            if changed:
                _save_state(state)
            return "WAIT"
        if slot:
            state[WINDOW_SLOTS[slot][1]] = True
            _save_state(state)
            return _with_retry(slot, int((state.get("attempts") or {}).get(slot) or 0))
        if changed:
            _save_state(state)
        return "WAIT"


def _drop_spawned(state: dict, slot: str) -> None:
    spawned_table = state.get("spawned")
    if isinstance(spawned_table, dict):
        spawned_table.pop(slot, None)


def _note_done(state: dict, slot: str) -> None:
    """Which round of each role was done last, and when: a round whose session the container recreation then took away is opened
    again (`_reopen_after_recreation`)."""
    table = dict(state.get("last_done") or {})
    table[ROLE_OF_SLOT.get(slot, "dottore")] = {"slot": slot, "at": int(datetime.now().timestamp())}
    state["last_done"] = table


def mark(slot: str) -> None:
    with _state_lock():
        b = _bounds_now()
        if slot == MAINT:
            state = _load_state()
            state["maint_date"] = _today_local()
            for key in ("maint_attempts", "maint_retry_after", "maint_failed_date"):
                state.pop(key, None)
            _drop_spawned(state, slot)
            _note_done(state, slot)
            _save_state(state)
            return
        if slot == "FALLBACK":
            state = _load_state()
            state["fallback_done_at"] = int(datetime.now().timestamp())
            state.pop("fallback_claimed_at", None)
            state.pop("fallback_attempts", None)
            _drop_spawned(state, slot)
            _note_done(state, slot)
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
        _drop_spawned(state, slot)
        _note_done(state, slot)
        _save_state(state)


def spawned(slot: str) -> None:
    """The spawner went through (or its outcome is uncertain): the round stays claimed, NOT done.

    `settle` marks it done once the session has a real turn, or lets it start again.
    """
    with _state_lock():
        state = _load_state()
        table = dict(state.get("spawned") or {})
        table[slot] = int(datetime.now().timestamp())
        state["spawned"] = table
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


def _record_round_failed(slot: str, reason: str, attempts: int, actions_name: str = ACTIONS_NAME) -> None:
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
        actions = STATE_FILE.with_name(actions_name)
        actions.parent.mkdir(parents=True, exist_ok=True)
        with actions.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:  # il diario non deve fermare lo scheduler
        print(f"doctor_schedule: round_failed not recorded: {exc}", file=sys.stderr)


def _retry_wait(attempts: int, reason: str) -> int:
    """A container made again is not the model's fault: it starts again soon. The rest waits as capacity does."""
    return SESSION_LOST_WAIT_SEC if reason == "session_lost" else _capacity_wait(attempts)


def fail(slot: str, reason: str) -> str:
    """Il giro non e' partito per una causa nota (la sessione e' ferma o sparita: modello a capacita', nessun turno).

    Il giro NON e' segnato fatto e il claim si libera. Ritorna `RETRY <secondi> attempt=<n>`
    (riprova dopo l'attesa) oppure `FAILED attempts=<n>` (tentativi finiti: `round_failed`
    scritto nel diario del Dottore, o del Mantenitore per MAINT).
    """
    if reason not in FAIL_REASONS:
        raise OSError("unknown failure reason")
    with _state_lock():
        now_s = int(datetime.now().timestamp())
        state = _load_state()
        if slot == MAINT:
            attempts = int(state.get("maint_attempts") or 0) + 1
            _drop_spawned(state, slot)
            if attempts >= CAPACITY_MAX_ATTEMPTS:
                # niente altri tentativi oggi: domani il giro riparte da capo
                state["maint_failed_date"] = _today_local()
                state.pop("maint_attempts", None)
                state.pop("maint_retry_after", None)
                _save_state(state)
                _record_round_failed(slot, reason, attempts, "mantenitore-actions.jsonl")
                return f"FAILED attempts={attempts}"
            wait = _retry_wait(attempts, reason)
            state["maint_attempts"] = attempts
            state["maint_retry_after"] = now_s + wait
            _save_state(state)
            return f"RETRY {wait} attempt={attempts}"
        if slot == "FALLBACK":
            attempts = int(state.get("fallback_attempts") or 0) + 1
            _drop_spawned(state, slot)
            if attempts >= CAPACITY_MAX_ATTEMPTS:
                # niente altri tentativi ora: la cadenza normale (un claim ogni FALLBACK_SEC) riparte da adesso
                state["fallback_claimed_at"] = now_s
                state.pop("fallback_attempts", None)
                _save_state(state)
                _record_round_failed(slot, reason, attempts)
                return f"FAILED attempts={attempts}"
            wait = _retry_wait(attempts, reason)
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
        _drop_spawned(state, slot)
        if attempts >= CAPACITY_MAX_ATTEMPTS:
            state["failed"] = {**(state.get("failed") or {}), slot: reason}
            _save_state(state)
            _record_round_failed(slot, reason, attempts)
            return f"FAILED attempts={attempts}"
        wait = _retry_wait(attempts, reason)
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
    - WAIT   → già fatto oggi, o in attesa del suo primo turno, o di un nuovo tentativo, o fallito per oggi;
    - OFF    → fuori working hours (rimanda a quando il team è attivo).
    Gemello di check() ma su cadenza giornaliera: l'infra cambia lentamente,
    uno sweep al giorno basta (a differenza del context-refresh del Dottore).
    """
    state = _load_state()
    today = _today_local()
    if state.get("maint_date") == today or state.get("maint_failed_date") == today:
        return "WAIT"
    if MAINT in (state.get("spawned") or {}):
        return "WAIT"  # partito, aspetta il primo turno (`settle`)
    if int(datetime.now().timestamp()) < int(state.get("maint_retry_after") or 0):
        return "WAIT"
    if not is_within_working_hours():
        return "OFF"
    if _service_blocked("mantenitore"):
        return "WAIT"
    return "MAINT"


def mark_maintainer() -> None:
    mark(MAINT)


# ── il turno vero ───────────────────────────────────────────────────────────


def _spawn_record(role: str) -> dict | None:
    """What the spawner wrote about its last start (`jht_spawn_record_start`): when, which session, which CLI, where."""
    try:
        record = json.loads(STATE_FILE.with_name(f"spawn-last-{role}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) else None


def _pi_session_folder(workdir: str) -> Path:
    """pi's folder for a working directory (shared/skills/pi_session_resume.py: session_folder)."""
    name = workdir.lstrip("/\\")
    for ch in "/\\:":
        name = name.replace(ch, "-")
    return JHT_HOME / ".pi" / "agent" / "sessions" / f"--{name}--"


def _pi_turn_seen(workdir: str, since: float) -> bool:
    """A session file of pi written since `since` with an answer of the model that is not an error or an abort."""
    try:
        files = [p for p in _pi_session_folder(workdir).glob("*.jsonl") if p.is_file()]
    except OSError:
        return False
    for path in files:
        try:
            if path.stat().st_mtime < since - 2 or path.stat().st_size > 64 * 1024 * 1024:
                continue
            with path.open(encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    try:
                        entry = json.loads(line)
                    except ValueError:
                        continue
                    message = entry.get("message") if isinstance(entry, dict) else None
                    if (
                        isinstance(entry, dict)
                        and entry.get("type") == "message"
                        and isinstance(message, dict)
                        and message.get("role") == "assistant"
                        and message.get("stopReason") not in ("error", "aborted")
                    ):
                        return True
        except OSError:
            continue
    return False


def _session_alive(session: str) -> bool:
    """False only when tmux says there is no such session; a tmux that does not answer is no proof of anything."""
    try:
        done = subprocess.run(
            ["tmux", "has-session", "-t", f"={session}"], capture_output=True, timeout=5, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return True
    return done.returncode != 1


def _session_of(role: str, record) -> str:
    """The tmux session of a role. The record on disk names a session too, but it counts only when it is the role's own
    (DOTTORE, MANTENITORE): any other name in that file is never looked at or killed."""
    return SESSION_OF_ROLE[role]


def _kill_session(session: str) -> None:
    try:
        subprocess.run(["tmux", "kill-session", "-t", f"={session}"], capture_output=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        pass


def _turn_verdict(slot: str, spawned_at: float, now_s: float):
    """`(verdict, record)`: seen | wait | no_turn | session_lost, for a round whose session was started."""
    role = ROLE_OF_SLOT.get(slot, "dottore")
    record = _spawn_record(role)
    # No record of this start, or a record of an older one: nothing to judge by, the start counts as it did before.
    if not record or float(record.get("ts") or 0) < spawned_at - 900 or float(record.get("ts") or 0) > spawned_at + 60:
        return "seen", record
    if record.get("cli") != "pi":
        return "seen", record
    started = float(record.get("ts") or spawned_at)
    if _pi_turn_seen(str(record.get("workdir") or ""), started):
        return "seen", record
    session = _session_of(role, record)
    if not _session_alive(session):
        return "session_lost", record
    if now_s - started >= TURN_WAIT_SEC:
        return "no_turn", record
    return "wait", record


# The switch onto the full image recreates the container at the end of the onboarding (JHT-T346): the job writes this file BEFORE
# the core goes down. A Dottore or a Mantenitore whose round was done and whose session that recreation took away was not started
# again until its next slot (F-08: both gone after 15:22). Their round is opened again, once per recreation.
SWITCH_FILE = JHT_HOME / "state" / "tools-switch.json"
SWITCH_LOOKBACK_SEC = 6 * 3600   # a recreation older than this is not the one that took the session away


def _switch_at(now_s: float):
    """The moment of the last recreation for the switch, or None: a plain small file, schema 1, an ISO time not in the future."""
    try:
        if SWITCH_FILE.is_symlink() or not SWITCH_FILE.is_file() or SWITCH_FILE.stat().st_size > 4096:
            return None
        data = json.loads(SWITCH_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("schema") != 1 or not isinstance(data.get("at"), str):
            return None
        at = datetime.fromisoformat(data["at"].replace("Z", "+00:00")).timestamp()
    except (OSError, ValueError, TypeError):
        return None
    if at > now_s + 60 or now_s - at > SWITCH_LOOKBACK_SEC:
        return None
    return at


def _reopen(state: dict, slot: str) -> None:
    if slot == MAINT:
        if state.get("maint_date") == _today_local():
            state.pop("maint_date", None)
    elif slot == "FALLBACK":
        state.pop("fallback_done_at", None)
        state.pop("fallback_claimed_at", None)
    elif slot in WINDOW_SLOTS:
        done_field, claim_field = WINDOW_SLOTS[slot]
        state[done_field] = False
        state[claim_field] = False


def _reopen_after_recreation(now_s: float) -> list[str]:
    """`REOPEN <slot> recreated` for each round done before the recreation whose session is gone since."""
    at = _switch_at(now_s)
    if at is None:
        return []
    lines = []
    with _state_lock():
        state = _load_state()
        if state.get("switch_seen_at") == at:
            return []
        for role, done in sorted((state.get("last_done") or {}).items()):
            if not isinstance(done, dict) or role not in SESSION_OF_ROLE or float(done.get("at") or 0) > at:
                continue
            record = _spawn_record(role) or {}
            if float(record.get("ts") or 0) > at or role_alive(role):
                continue   # started again after the recreation, or still there
            slot = str(done.get("slot") or "")
            if slot in WINDOW_SLOTS and state.get("window_start") is None:
                continue
            _reopen(state, slot)
            lines.append(f"REOPEN {slot} recreated")
        state["switch_seen_at"] = at
        _save_state(state)
    return lines


def role_alive(role: str) -> bool:
    return _session_alive(SESSION_OF_ROLE[role])


def settle() -> list[str]:
    """Settle every round that was started and is waiting for its first turn. One line per round:
    `DONE <slot>` · `PENDING <slot>` · `RETRY <slot> <reason> <wait> attempt=<n>` · `FAILED <slot> <reason> attempts=<n>` ·
    `REOPEN <slot> recreated` for a done round whose session the recreation of the container took away."""
    now_s = datetime.now().timestamp()
    lines = _reopen_after_recreation(now_s)
    with _state_lock():
        pending = {k: float(v) for k, v in (_load_state().get("spawned") or {}).items()}
    for slot, spawned_at in pending.items():
        if slot in WINDOW_SLOTS:
            bounds = _bounds_now()
            with _state_lock():
                state = _load_state()
                if bounds is None or state.get("window_start") != bounds[0].isoformat():
                    # the window ended while it waited: that round does not exist any more, and it must not mark the next one
                    _drop_spawned(state, slot)
                    _save_state(state)
                    lines.append(f"STALE {slot}")
                    continue
        verdict, record = _turn_verdict(slot, spawned_at, now_s)
        if verdict == "seen":
            mark(slot)
            lines.append(f"DONE {slot}")
        elif verdict == "wait":
            lines.append(f"PENDING {slot}")
        else:
            if verdict == "no_turn":
                # a session without a turn is not left behind counted as running: the next start finds it clean
                _kill_session(_session_of(ROLE_OF_SLOT.get(slot, "dottore"), record))
            result = fail(slot, verdict)
            lines.append(f"{result.split(' ')[0]} {slot} {verdict} {' '.join(result.split(' ')[1:])}".rstrip())
    return lines


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
        if len(argv) < 2 or argv[1] not in (*WINDOW_SLOTS, "FALLBACK") + ((MAINT,) if cmd == "mark" else ()):
            print(
                f"usage: doctor_schedule.py {cmd} <T30|MID|FALLBACK{'|MAINT' if cmd == 'mark' else ''}>",
                file=sys.stderr,
            )
            return 2
        try:
            (mark if cmd == "mark" else release)(argv[1])
            return 0
        except OSError as exc:
            print(f"doctor_schedule: {cmd} persistence failed: {exc}", file=sys.stderr)
            return 1
    if cmd == "spawned":
        if len(argv) < 2 or argv[1] not in (*WINDOW_SLOTS, "FALLBACK", MAINT):
            print("usage: doctor_schedule.py spawned <T30|MID|FALLBACK|MAINT>", file=sys.stderr)
            return 2
        try:
            spawned(argv[1])
            return 0
        except OSError as exc:
            print(f"doctor_schedule: spawned persistence failed: {exc}", file=sys.stderr)
            return 1
    if cmd == "settle":
        try:
            for line in settle():
                print(line)
            return 0
        except OSError as exc:
            print(f"doctor_schedule: settle persistence failed: {exc}", file=sys.stderr)
            return 1
    if cmd == "fail":
        if len(argv) < 3 or argv[1] not in (*WINDOW_SLOTS, "FALLBACK", MAINT) or argv[2] not in FAIL_REASONS:
            print("usage: doctor_schedule.py fail <T30|MID|FALLBACK|MAINT> <capacity|no_turn|session_lost>", file=sys.stderr)
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
        "<check|claim|mark SLOT|spawned SLOT|settle|release SLOT|fail SLOT REASON|check-maintainer|mark-maintainer>",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
