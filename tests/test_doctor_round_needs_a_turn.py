"""Il giro del Dottore e del Mantenitore e' «fatto» solo dopo un TURNO VERO della sessione, non quando lo spawner esce 0.

Giro Windows build8 (pi, immagine nucleo poi piena): lo spawner usciva 0, il watchdog segnava `fallback_done_at` e
`maint_date`, ma la sessione di pi non aveva mai preso il messaggio (cartella delle sessioni vuota, 0 turni). Alla
ricreazione del container le sessioni sparivano e, col giro gia' segnato, nessuno le rilanciava. Qui: il calendario
(`spawned` / `settle`), la riga dello spawner che dice quale sessione cercare, e il watchdog (loop vero, dipendenze finte).
Nessun tmux, LLM o rete veri.
"""

import importlib.util
import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE_PATH = ROOT / "shared" / "skills" / "doctor_schedule.py"
WATCHDOG_PATH = ROOT / ".launcher" / "doctor-watchdog.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"

_spec = importlib.util.spec_from_file_location("doctor_schedule_turn", SCHEDULE_PATH)
assert _spec and _spec.loader
ds = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ds)

_START = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=7)
DOCTOR_DIR = "/jht_home/agents/dottore"
MAINT_DIR = "/jht_home/agents/mantenitore"
TODAY = "2026-11-17"
KILLED: list[str] = []   # the sessions the schedule killed in this test


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(ds, "JHT_HOME", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", tmp_path / "logs" / "doctor-schedule-state.json")
    monkeypatch.setattr(ds, "_bounds_now", lambda: (_START, _START + timedelta(hours=12), datetime.now(timezone.utc)))
    monkeypatch.setattr(ds, "_today_local", lambda: TODAY)
    monkeypatch.setattr(ds, "is_within_working_hours", lambda: True)
    monkeypatch.setattr(ds, "CAPACITY_WAIT_SEC", 600)
    monkeypatch.setattr(ds, "CAPACITY_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(ds, "TURN_WAIT_SEC", 600)
    KILLED.clear()
    monkeypatch.setattr(ds, "_kill_session", KILLED.append)
    monkeypatch.setattr(ds, "_session_alive", lambda session: True)
    return tmp_path


def _state(home: Path) -> dict:
    return json.loads((home / "logs" / "doctor-schedule-state.json").read_text(encoding="utf-8"))


def _write_state(home: Path, state: dict) -> None:
    (home / "logs" / "doctor-schedule-state.json").write_text(json.dumps(state), encoding="utf-8")


def _events(home: Path, name: str = "dottore-actions.jsonl") -> list[dict]:
    path = home / "logs" / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def _record(home: Path, role: str, *, cli: str = "pi", age: float = 5, workdir: str | None = None) -> float:
    """What the spawner writes (jht_spawn_record_start), `age` seconds ago."""
    ts = time.time() - age
    (home / "logs").mkdir(parents=True, exist_ok=True)
    (home / "logs" / f"spawn-last-{role}.json").write_text(json.dumps({
        "ts": int(ts), "session": role.upper(), "role": role, "cli": cli,
        "workdir": workdir or (DOCTOR_DIR if role == "dottore" else MAINT_DIR),
    }), encoding="utf-8")
    return ts


def _pi_session(home: Path, workdir: str, *messages: dict) -> Path:
    name = workdir.lstrip("/").replace("/", "-")
    folder = home / ".pi" / "agent" / "sessions" / f"--{name}--"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "2026-11-17T11-20-00-000Z_abc.jsonl"
    lines = [{"type": "session", "cwd": workdir}] + [{"type": "message", "message": m} for m in messages]
    path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
    return path


ANSWER = {"role": "assistant", "stopReason": "stop", "content": [{"type": "text", "text": "health-check started"}]}
ERROR = {"role": "assistant", "stopReason": "error", "errorMessage": "Selected model is at capacity", "content": []}


def _claim_mid(home: Path) -> None:
    assert ds.claim().split()[0] == "T30"
    ds.mark("T30")
    assert ds.claim().split()[0] == "MID"


# ── un giro e' fatto solo dopo un turno vero ────────────────────────────────


def test_a_spawned_round_is_claimed_not_done_and_does_not_start_twice(home: Path):
    _claim_mid(home)
    ds.spawned("MID")

    state = _state(home)
    assert state["did_mid"] is False and state["claimed_mid"] is True and "MID" in state["spawned"]
    assert ds.claim() == "WAIT"


def test_a_round_with_a_real_turn_is_marked_done(home: Path):
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore")
    _pi_session(home, DOCTOR_DIR, {"role": "user", "content": "Read AGENTS.md"}, ANSWER)

    assert ds.settle() == ["DONE MID"]

    state = _state(home)
    assert state["did_mid"] is True and state["claimed_mid"] is False and "MID" not in state["spawned"]
    assert ds.claim() == "WAIT"


def test_pi_with_an_empty_session_folder_is_waited_for_and_then_started_again(home: Path):
    """The build8 case: the session lives, pi never took the message, the folder is empty."""
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore", age=60)
    (home / ".pi" / "agent" / "sessions" / "--jht_home-agents-dottore--").mkdir(parents=True)

    assert ds.settle() == ["PENDING MID"], "the first minutes are the start, not a failure"
    assert _state(home)["did_mid"] is False

    _record(home, "dottore", age=ds.TURN_WAIT_SEC + 5)
    result = ds.settle()

    assert result == ["RETRY MID no_turn 600 attempt=1"]
    assert KILLED == ["DOTTORE"], "an empty session is not left behind counted as running"
    state = _state(home)
    assert state["did_mid"] is False and state["claimed_mid"] is False and "MID" not in state["spawned"]
    assert ds.claim() == "WAIT", "after the wait, not before"
    state["retry_after"]["MID"] = 0
    _write_state(home, state)
    assert ds.claim() == "MID retry=1"


def test_an_error_of_the_model_is_not_a_turn(home: Path):
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore", age=ds.TURN_WAIT_SEC + 5)
    _pi_session(home, DOCTOR_DIR, {"role": "user", "content": "Read AGENTS.md"}, ERROR)

    assert ds.settle() == ["RETRY MID no_turn 600 attempt=1"]


def test_an_old_session_file_is_not_the_turn_of_this_start(home: Path):
    _claim_mid(home)
    ds.spawned("MID")
    path = _pi_session(home, DOCTOR_DIR, ANSWER)
    old = time.time() - 7200
    os.utime(path, (old, old))
    _record(home, "dottore", age=ds.TURN_WAIT_SEC + 5)

    assert ds.settle() == ["RETRY MID no_turn 600 attempt=1"]


def test_a_container_made_again_starts_the_round_again_soon(home: Path, monkeypatch: pytest.MonkeyPatch):
    """The sessions die with the container; the state file stays in the logs volume: the round must not stay «spawned»."""
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore", age=120)
    monkeypatch.setattr(ds, "_session_alive", lambda session: False)

    assert ds.settle() == ["RETRY MID session_lost 60 attempt=1"]
    assert KILLED == [], "there is no session to kill"
    assert _state(home)["did_mid"] is False


def test_after_the_last_attempt_the_failed_round_is_visible(home: Path):
    _claim_mid(home)
    for attempt in (1, 2):
        ds.spawned("MID")
        _record(home, "dottore", age=ds.TURN_WAIT_SEC + 5)
        assert ds.settle()[0].startswith(f"RETRY MID no_turn")
        state = _state(home)
        state["retry_after"]["MID"] = 0
        _write_state(home, state)
        assert ds.claim() == f"MID retry={attempt}"
    ds.spawned("MID")
    _record(home, "dottore", age=ds.TURN_WAIT_SEC + 5)

    assert ds.settle() == ["FAILED MID no_turn attempts=3"]

    events = _events(home)
    assert [event["event"] for event in events] == ["round_failed"]
    assert events[0]["slot"] == "MID" and events[0]["reason"] == "no_turn" and events[0]["attempts"] == 3
    assert ds.claim() == "WAIT"


def test_a_cli_that_cannot_be_judged_keeps_the_old_rule(home: Path):
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore", cli="claude")
    assert ds.settle() == ["DONE MID"]

    ds.mark("T30")
    ds.spawned("T30")  # a start with no record of it at all
    (home / "logs" / "spawn-last-dottore.json").unlink()
    assert ds.settle() == ["DONE T30"]


def test_a_record_of_an_older_start_is_not_used_to_judge_this_one(home: Path):
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore", age=86400)  # the start of yesterday: this one left no record
    assert ds.settle() == ["DONE MID"]


def test_a_round_whose_window_ended_is_dropped_and_never_marks_the_next_one(home: Path, monkeypatch: pytest.MonkeyPatch):
    _claim_mid(home)
    ds.spawned("MID")
    _record(home, "dottore")
    later = _START + timedelta(days=1)
    monkeypatch.setattr(ds, "_bounds_now", lambda: (later, later + timedelta(hours=12), datetime.now(timezone.utc)))

    assert ds.settle() == ["STALE MID"]
    assert _state(home)["spawned"] == {}


# ── il giro 24/7 (FALLBACK) ─────────────────────────────────────────────────


def test_the_24_7_fallback_is_done_only_with_a_turn(home: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(ds, "_bounds_now", lambda: None)
    monkeypatch.setattr(ds, "FALLBACK_SEC", 21600)
    assert ds.claim() == "FALLBACK"
    ds.spawned("FALLBACK")
    _record(home, "dottore", age=ds.TURN_WAIT_SEC + 5)

    assert ds.settle() == ["RETRY FALLBACK no_turn 600 attempt=1"]
    state = _state(home)
    assert "fallback_done_at" not in state, "the round that never took a turn is not done"
    assert ds.claim() == "WAIT"
    state["fallback_claimed_at"] -= 600
    _write_state(home, state)
    assert ds.claim() == "FALLBACK retry=1"

    ds.spawned("FALLBACK")
    _record(home, "dottore")
    _pi_session(home, DOCTOR_DIR, ANSWER)
    assert ds.settle() == ["DONE FALLBACK"]
    assert _state(home)["fallback_done_at"] > 0


# ── il Mantenitore ──────────────────────────────────────────────────────────


def test_the_maintainer_day_is_marked_only_with_a_turn(home: Path):
    assert ds.check_maintainer() == "MAINT"
    ds.spawned("MAINT")
    assert ds.check_maintainer() == "WAIT", "started, waiting for its first turn: not started a second time"
    assert "maint_date" not in _state(home)

    _record(home, "mantenitore")
    _pi_session(home, MAINT_DIR, ANSWER)
    assert ds.settle() == ["DONE MAINT"]

    assert _state(home)["maint_date"] == TODAY
    assert ds.check_maintainer() == "WAIT"


def test_a_maintainer_without_a_turn_starts_again_and_then_fails_visibly(home: Path, monkeypatch: pytest.MonkeyPatch):
    for attempt in (1, 2):
        ds.spawned("MAINT")
        _record(home, "mantenitore", age=ds.TURN_WAIT_SEC + 5)
        assert ds.settle() == [f"RETRY MAINT no_turn {600 * 2 ** (attempt - 1)} attempt={attempt}"]
        assert "maint_date" not in _state(home)
        assert ds.check_maintainer() == "WAIT", "after the wait, not before"
        state = _state(home)
        state["maint_retry_after"] = 0
        _write_state(home, state)
        assert ds.check_maintainer() == "MAINT"
    ds.spawned("MAINT")
    _record(home, "mantenitore", age=ds.TURN_WAIT_SEC + 5)

    assert ds.settle() == ["FAILED MAINT no_turn attempts=3"]

    events = _events(home, "mantenitore-actions.jsonl")
    assert [event["event"] for event in events] == ["round_failed"] and events[0]["slot"] == "MAINT"
    assert _events(home) == [], "the Doctor's own diary is not the Maintainer's"
    assert ds.check_maintainer() == "WAIT", "no more attempts today"
    monkeypatch.setattr(ds, "_today_local", lambda: "2026-11-18")
    assert ds.check_maintainer() == "MAINT", "tomorrow starts clean"


def test_a_maintainer_lost_with_its_container_starts_again(home: Path, monkeypatch: pytest.MonkeyPatch):
    ds.spawned("MAINT")
    _record(home, "mantenitore", age=90)
    monkeypatch.setattr(ds, "_session_alive", lambda session: False)

    assert ds.settle() == ["RETRY MAINT session_lost 60 attempt=1"]
    state = _state(home)
    state["maint_retry_after"] = 0
    _write_state(home, state)
    assert ds.check_maintainer() == "MAINT"


def test_the_cli_accepts_the_new_commands_and_refuses_unknown_ones(home: Path, capsys: pytest.CaptureFixture):
    assert ds.main(["spawned", "NOPE"]) == 2
    assert ds.main(["spawned"]) == 2
    assert ds.main(["fail", "MAINT", "some free text"]) == 2
    assert ds.main(["mark", "MAINT"]) == 0
    assert _state(home)["maint_date"] == TODAY
    assert ds.main(["settle"]) == 0
    assert capsys.readouterr().out == ""


# ── lo spawner scrive quale sessione cercare ────────────────────────────────


def test_the_spawner_records_the_session_the_schedule_must_find_a_turn_in(tmp_path: Path):
    script = f'. "{SPAWN_LIB}"; jht_spawn_record_start "{tmp_path}" dottore DOTTORE pi /jht_home/agents/dottore'
    result = subprocess.run(["bash", "-c", script], text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    record = json.loads((tmp_path / "spawn-last-dottore.json").read_text(encoding="utf-8"))
    assert record == {"ts": record["ts"], "session": "DOTTORE", "role": "dottore", "cli": "pi",
                      "workdir": "/jht_home/agents/dottore"}
    assert abs(record["ts"] - time.time()) < 30
    assert not list(tmp_path.glob(".spawn-last-*")), "no temporary file is left"


def test_a_record_that_cannot_be_written_does_not_stop_the_start(tmp_path: Path):
    script = f'. "{SPAWN_LIB}"; jht_spawn_record_start "{tmp_path}/missing" dottore DOTTORE pi /x; echo "rc=$?"'
    result = subprocess.run(["bash", "-c", script], text=True, capture_output=True, timeout=30)
    assert "rc=0" in result.stdout


@pytest.mark.parametrize("script,role", [("spawn-doctor.sh", "dottore"), ("spawn-maintainer.sh", "mantenitore")])
def test_the_service_spawners_record_their_start_after_the_kickoff(script: str, role: str):
    text = (ROOT / ".launcher" / script).read_text(encoding="utf-8")
    record = f'jht_spawn_record_start "$LOGS_DIR" {role} "$SESSION" "$ACTIVE_CLI"'
    assert record in text
    assert text.index("jht_spawn_kickoff") < text.index(record) < text.index('echo "[$LABEL] $SESSION started')


# ── il watchdog (loop vero, schedule e spawner finti) ───────────────────────

STUB = """#!/usr/bin/env python3
import os, sys
with open(os.environ["TRACE"], "a") as trace:
    trace.write("schedule " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "settle":
    print(os.environ.get("SETTLE_OUT", ""))
elif sys.argv[1] == "check-maintainer":
    print(os.environ.get("MAINT_OUT", "WAIT"))
elif sys.argv[1] == "claim":
    print("WAIT")
"""


def _watchdog(tmp_path: Path, settle_out: str = "", maint_out: str = "WAIT", maint_spawner: str = "exit 0"):
    home = tmp_path / "home"
    (home / ".codex").mkdir(parents=True)
    (home / ".codex" / "auth.json").write_text("{}", encoding="utf-8")
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "openai"}), encoding="utf-8")
    for name, body in (("schedule.py", STUB), ("maint.sh", f'#!/bin/sh\necho maint >> "$TRACE"\n{maint_spawner}\n')):
        (tmp_path / name).write_text(body, encoding="utf-8")
        (tmp_path / name).chmod(0o755)
    trace = tmp_path / "trace.log"
    env = {
        **os.environ,
        "JHT_HOME": str(home),
        "JHT_DOCTOR_SCHED": str(tmp_path / "schedule.py"),
        "JHT_DOCTOR_SPAWNER": str(tmp_path / "unused.sh"),
        "JHT_MAINT_SPAWNER": str(tmp_path / "maint.sh"),
        "JHT_DOCTOR_WATCHDOG_MAX_TICKS": "1",
        "DOCTOR_WATCHDOG_POLL": "0",
        "TRACE": str(trace),
        "SETTLE_OUT": settle_out,
        "MAINT_OUT": maint_out,
    }
    result = subprocess.run(["bash", str(WATCHDOG_PATH)], env=env, text=True, capture_output=True, timeout=30)
    lines = trace.read_text(encoding="utf-8").splitlines() if trace.exists() else []
    failed = home / "logs" / "spawn-failed.json"
    return result, lines, json.loads(failed.read_text(encoding="utf-8")) if failed.exists() else {}


def test_the_watchdog_settles_the_rounds_before_it_decides_anything_else(tmp_path: Path):
    result, trace, _failed = _watchdog(tmp_path)
    assert result.returncode == 0, result.stderr
    assert trace[:3] == ["schedule settle", "schedule check-maintainer", "schedule claim"]


def test_the_watchdog_says_a_round_that_took_no_turn_and_keeps_it_visible(tmp_path: Path):
    out = "RETRY MID no_turn 600 attempt=1\nRETRY MAINT session_lost 60 attempt=1"
    result, _trace, failed = _watchdog(tmp_path, settle_out=out)

    assert result.returncode == 0, result.stderr
    assert "dottore started but took NO TURN (no_turn, slot=MID) — round NOT done" in result.stdout
    assert "mantenitore started but took NO TURN (session_lost, slot=MAINT)" in result.stdout
    assert set(failed) == {"dottore", "mantenitore"}
    assert "no first turn" in failed["dottore"]["why"]


def test_the_watchdog_closes_a_failed_round_loudly_and_a_done_one_clears_the_failure(tmp_path: Path):
    result, _trace, failed = _watchdog(tmp_path, settle_out="FAILED MID no_turn attempts=4\nDONE MAINT")
    assert result.returncode == 0, result.stderr
    assert "ROUND FAILED: dottore took no first turn (no_turn, slot=MID)" in result.stdout
    assert "first turn seen: mantenitore round done (slot=MAINT)" in result.stdout
    assert set(failed) == {"dottore"}, "a Mantenitore that took its turn is not a failed role"


def test_a_maintainer_start_is_spawned_not_marked_for_the_day(tmp_path: Path):
    result, trace, _failed = _watchdog(tmp_path, maint_out="MAINT")
    assert result.returncode == 0, result.stderr
    assert "maint" in trace and "schedule spawned MAINT" in trace
    assert "schedule mark-maintainer" not in trace and "schedule mark MAINT" not in trace
    assert "waiting for its first turn" in result.stdout


def test_a_failed_maintainer_start_marks_nothing(tmp_path: Path):
    result, trace, failed = _watchdog(tmp_path, maint_out="MAINT", maint_spawner="exit 9")
    assert result.returncode == 0, result.stderr
    assert not any("spawned" in line or "mark" in line for line in trace)
    assert "mantenitore" in failed


def test_a_session_name_in_the_record_that_is_not_the_roles_own_is_never_killed():
    assert ds._session_of("dottore", {"session": "CAPITANO"}) == "DOTTORE"
    assert ds._session_of("mantenitore", {"session": "x; kill-server"}) == "MANTENITORE"
    assert ds._session_of("dottore", None) == "DOTTORE"


def test_the_start_record_is_json_whatever_the_names_hold(tmp_path):
    lib = Path(__file__).resolve().parent.parent / ".launcher" / "spawn-lib.sh"
    out = subprocess.run(["bash", "-c", f'. "{lib}"; jht_spawn_record_start "{tmp_path}" dottore \'A"B\\C\' pi \'/w/"x y\''],
                         capture_output=True, text=True, timeout=60, env={**os.environ, "JHT_HOME": str(tmp_path)})
    record = json.loads((tmp_path / "spawn-last-dottore.json").read_text(encoding="utf-8"))
    assert record["session"] == 'A"B\\C' and record["workdir"] == '/w/"x y' and record["cli"] == "pi", out.stderr
    assert set(record) == {"ts", "role", "session", "cli", "workdir"}
