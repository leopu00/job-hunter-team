"""Il giro del Dottore e' «fatto» solo dopo un avvio riuscito; con «Selected model is at capacity»
si riprova con attesa, e senza tentativi si vede un `round_failed`.

Misura sul team in produzione: il giro veniva segnato fatto (did_mid=true) PRIMA che la sessione partisse, e con
l'errore di capacita' la sessione restava ferma sul prompt senza nuovo tentativo ne' round_failed: il
giro saltava in silenzio. Qui: calendario (doctor_schedule), watchdog (loop vero con dipendenze finte) e
la verifica dell'avvio dello spawner (tmux finto nel PATH). Nessun tmux, LLM o rete veri.
"""

import importlib.util
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE_PATH = ROOT / "shared" / "skills" / "doctor_schedule.py"
WATCHDOG_PATH = ROOT / ".launcher" / "doctor-watchdog.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"

_spec = importlib.util.spec_from_file_location("doctor_schedule_capacity", SCHEDULE_PATH)
assert _spec and _spec.loader
ds = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ds)


# L'inizio finestra resta lo stesso fra una chiamata e l'altra (e' la chiave dello stato).
_START = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=7)


def _mid_window():
    """Una finestra di 12 h a 7 h dall'inizio: dopo il +30 min e dopo la meta' (6 h)."""
    return _START, _START + timedelta(hours=12), datetime.now(timezone.utc)


@pytest.fixture
def schedule(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(ds, "STATE_FILE", tmp_path / "logs" / "doctor-schedule-state.json")
    monkeypatch.setattr(ds, "_bounds_now", _mid_window)
    monkeypatch.setattr(ds, "CAPACITY_WAIT_SEC", 600)
    monkeypatch.setattr(ds, "CAPACITY_MAX_ATTEMPTS", 3)
    # il primo slot (+30 min) e' gia' fatto: resta il giro di meta' finestra
    assert ds.claim() == "T30"
    ds.mark("T30")
    return tmp_path


def _state(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "logs" / "doctor-schedule-state.json").read_text(encoding="utf-8"))


def _events(tmp_path: Path) -> list[dict]:
    path = tmp_path / "logs" / "dottore-actions.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_a_round_is_not_done_until_a_start_is_marked(schedule: Path):
    assert ds.claim() == "MID"
    # la sessione e' stata creata ma non e' partita: il claim non e' ancora un giro fatto
    state = _state(schedule)
    assert state["claimed_mid"] is True and state["did_mid"] is False

    result = ds.fail("MID", "capacity")

    assert result.startswith("RETRY 600 attempt=1")
    state = _state(schedule)
    assert state["did_mid"] is False, "an at-capacity start is not a round done"
    assert state["claimed_mid"] is False
    assert _events(schedule) == []


def test_the_retry_waits_and_then_comes_back_as_a_retry(schedule: Path, monkeypatch: pytest.MonkeyPatch):
    assert ds.claim() == "MID"
    ds.fail("MID", "capacity")
    assert ds.claim() == "WAIT", "the next poll must not hammer an at-capacity model"

    # passata l'attesa il giro e' dovuto di nuovo, e dice che e' un nuovo tentativo
    state = _state(schedule)
    state["retry_after"]["MID"] = 0
    (schedule / "logs" / "doctor-schedule-state.json").write_text(json.dumps(state), encoding="utf-8")
    assert ds.claim() == "MID retry=1"


def test_the_wait_grows_and_after_the_last_attempt_the_failed_round_is_visible(schedule: Path):
    waits = []
    for _ in range(2):
        assert ds.claim().split()[0] == "MID"
        waits.append(ds.fail("MID", "capacity").split()[1])
        state = _state(schedule)
        state["retry_after"]["MID"] = 0
        (schedule / "logs" / "doctor-schedule-state.json").write_text(json.dumps(state), encoding="utf-8")
    assert waits == ["600", "1200"]

    assert ds.claim() == "MID retry=2"
    assert ds.fail("MID", "capacity") == "FAILED attempts=3"

    events = _events(schedule)
    assert [event["event"] for event in events] == ["round_failed"]
    assert events[0]["slot"] == "MID" and events[0]["reason"] == "capacity" and events[0]["attempts"] == 3
    # un giro fallito non si ripete a ogni poll della finestra
    assert ds.claim() == "WAIT"
    assert _state(schedule)["did_mid"] is False


def test_a_successful_start_after_a_retry_clears_the_attempts(schedule: Path):
    assert ds.claim() == "MID"
    ds.fail("MID", "capacity")
    state = _state(schedule)
    state["retry_after"]["MID"] = 0
    (schedule / "logs" / "doctor-schedule-state.json").write_text(json.dumps(state), encoding="utf-8")
    assert ds.claim() == "MID retry=1"

    ds.mark("MID")

    state = _state(schedule)
    assert state["did_mid"] is True
    assert "MID" not in state["attempts"] and "MID" not in state["retry_after"]
    assert ds.claim() == "WAIT"


def test_only_a_known_cause_is_accepted_and_the_cli_says_so(schedule: Path):
    assert ds.claim() == "MID"
    with pytest.raises(OSError):
        ds.fail("MID", "the model at 203.0.113.7 said something")
    assert ds.main(["fail", "MID", "something else"]) == 2
    assert ds.main(["fail", "NOPE", "capacity"]) == 2


def test_the_24_7_fallback_retries_after_the_wait_and_then_reports_the_failed_round(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(ds, "STATE_FILE", tmp_path / "logs" / "doctor-schedule-state.json")
    monkeypatch.setattr(ds, "_bounds_now", lambda: None)
    monkeypatch.setattr(ds, "is_within_working_hours", lambda: True)
    monkeypatch.setattr(ds, "FALLBACK_SEC", 21600)
    monkeypatch.setattr(ds, "CAPACITY_MAX_ATTEMPTS", 2)

    assert ds.claim() == "FALLBACK"
    assert ds.fail("FALLBACK", "capacity").startswith("RETRY 600 attempt=1")
    assert ds.claim() == "WAIT"
    state = _state(tmp_path)
    state["fallback_claimed_at"] -= 600
    (tmp_path / "logs" / "doctor-schedule-state.json").write_text(json.dumps(state), encoding="utf-8")
    assert ds.claim() == "FALLBACK retry=1"
    assert ds.fail("FALLBACK", "capacity") == "FAILED attempts=2"
    assert [event["event"] for event in _events(tmp_path)] == ["round_failed"]
    assert ds.claim() == "WAIT", "after a failed round the normal cadence starts again"


# ── il watchdog (loop vero, dipendenze finte) ───────────────────────────────


def _executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


STUB_SCHEDULE = """#!/usr/bin/env python3
import os, sys
with open(os.environ["TRACE"], "a") as trace:
    trace.write("schedule " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "check-maintainer":
    print("WAIT")
elif sys.argv[1] == "claim":
    print(os.environ["CLAIM_OUT"])
elif sys.argv[1] == "fail":
    print(os.environ["FAIL_OUT"])
"""


def _run_watchdog(tmp_path: Path, spawner_body: str, claim_out: str, fail_out: str = "RETRY 600 attempt=1"):
    home = tmp_path / "home"
    (home / ".codex").mkdir(parents=True)
    (home / ".codex" / "auth.json").write_text("{}", encoding="utf-8")
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "openai"}), encoding="utf-8")
    trace = tmp_path / "trace.log"
    _executable(tmp_path / "schedule.py", STUB_SCHEDULE)
    _executable(tmp_path / "spawn.sh", spawner_body)
    env = {
        **os.environ,
        "JHT_HOME": str(home),
        "JHT_DOCTOR_SCHED": str(tmp_path / "schedule.py"),
        "JHT_DOCTOR_SPAWNER": str(tmp_path / "spawn.sh"),
        "JHT_MAINT_SPAWNER": str(tmp_path / "unused-maintainer.sh"),
        "JHT_DOCTOR_WATCHDOG_MAX_TICKS": "1",
        "DOCTOR_WATCHDOG_POLL": "0",
        "TRACE": str(trace),
        "CLAIM_OUT": claim_out,
        "FAIL_OUT": fail_out,
    }
    result = subprocess.run(["bash", str(WATCHDOG_PATH)], env=env, text=True, capture_output=True, timeout=20)
    lines = trace.read_text(encoding="utf-8").splitlines() if trace.exists() else []
    return result, lines


def test_a_start_at_capacity_does_not_mark_the_round_and_reports_the_retry(tmp_path: Path):
    result, trace = _run_watchdog(tmp_path, '#!/bin/sh\necho spawn >> "$TRACE"\nexit 75\n', "MID")

    assert result.returncode == 0, result.stderr
    assert trace == ["schedule check-maintainer", "schedule claim", "spawn", "schedule fail MID capacity"]
    assert not any("mark" in line for line in trace), "the round must not be marked done"
    assert "model at capacity (slot=MID)" in result.stdout and "retry later" in result.stdout


def test_the_last_failed_attempt_is_a_loud_round_failed_not_a_silent_skip(tmp_path: Path):
    result, trace = _run_watchdog(
        tmp_path, '#!/bin/sh\necho spawn >> "$TRACE"\nexit 75\n', "MID retry=3", "FAILED attempts=4"
    )

    assert result.returncode == 0, result.stderr
    assert trace[-1] == "schedule fail MID capacity"
    assert "ROUND FAILED" in result.stdout and "round_failed recorded" in result.stdout


def test_a_retry_tells_the_spawner_which_attempt_it_is(tmp_path: Path):
    result, trace = _run_watchdog(
        tmp_path, '#!/bin/sh\necho "spawn retry=$JHT_DOCTOR_RETRY" >> "$TRACE"\nexit 0\n', "MID retry=2"
    )

    assert result.returncode == 0, result.stderr
    assert trace == [
        "schedule check-maintainer",
        "schedule claim",
        "spawn retry=2",
        "schedule mark MID",
    ]


def test_a_first_attempt_is_not_a_retry(tmp_path: Path):
    result, trace = _run_watchdog(
        tmp_path, '#!/bin/sh\necho "spawn retry=$JHT_DOCTOR_RETRY" >> "$TRACE"\nexit 0\n', "T30"
    )
    assert result.returncode == 0, result.stderr
    assert "spawn retry=0" in trace and trace[-1] == "schedule mark T30"


# ── lo spawner: l'avvio riuscito e' la sessione NON ferma a capacita' ───────


def _fake_tmux(tmp_path: Path, pane_text: str) -> dict:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    pane = tmp_path / "pane.txt"
    pane.write_text(pane_text, encoding="utf-8")
    calls = tmp_path / "tmux.calls"
    _executable(
        bin_dir / "tmux",
        f'#!/bin/sh\necho "$@" >> "{calls}"\n'
        f'case "$1" in capture-pane) cat "{pane}" ;; esac\nexit 0\n',
    )
    logs = tmp_path / "logs"
    logs.mkdir()
    return {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "JHT_SPAWN_START_CHECK_SEC": "3",
        "LOGS": str(logs),
        "CALLS": str(calls),
    }


def _verify(env: dict) -> subprocess.CompletedProcess:
    script = f'. "{SPAWN_LIB}"; jht_spawn_verify_start DOTTORE spawn-doctor dottore "$LOGS" spawn-doctor.sh; echo "rc=$?"'
    return subprocess.run(["bash", "-c", script], env=env, text=True, capture_output=True, timeout=30)


def test_a_session_stopped_at_the_prompt_for_capacity_is_a_failed_start(tmp_path: Path):
    env = _fake_tmux(tmp_path, "> Read AGENTS.md\n  Selected model is at capacity. Please try a different model.\n")

    result = _verify(env)

    assert "rc=75" in result.stdout, result.stdout + result.stderr
    assert "model is at capacity" in result.stderr
    events = [json.loads(line) for line in (tmp_path / "logs" / "dottore-actions.jsonl").read_text().splitlines()]
    assert events == [
        {"ts": events[0]["ts"], "session": "DOTTORE", "role": "dottore", "event": "spawn_failed",
         "reason": "capacity", "src": "spawn-doctor.sh"}
    ]
    assert "kill-session" in Path(env["CALLS"]).read_text(), "the stuck session is not left behind"


def test_a_session_that_started_is_a_successful_start(tmp_path: Path):
    env = _fake_tmux(tmp_path, "> Read AGENTS.md\n  Running the health-check cycle...\n")

    result = _verify(env)

    assert "rc=0" in result.stdout, result.stdout + result.stderr
    assert not (tmp_path / "logs" / "dottore-actions.jsonl").exists()
    assert "kill-session" not in Path(env["CALLS"]).read_text()


def test_the_doctor_spawner_waits_for_the_verified_start_before_it_reports_one():
    source = (ROOT / ".launcher" / "spawn-doctor.sh").read_text(encoding="utf-8")
    assert source.index("jht_spawn_kickoff") < source.index("jht_spawn_verify_start") < source.index('echo "[$LABEL] $SESSION started')
    assert 'jht_spawn_verify_start "$SESSION" "$LABEL" dottore "$LOGS_DIR" "spawn-doctor.sh" || exit $?' in source


# ── il modello di riserva ───────────────────────────────────────────────────


def _repl_cmd(provider: str, override: str | None) -> str:
    env = {**os.environ}
    env.pop("JHT_SPAWN_MODEL_OVERRIDE", None)
    if override is not None:
        env["JHT_SPAWN_MODEL_OVERRIDE"] = override
    env["JHT_HOME"] = str(Path(os.environ.get("TMPDIR", "/tmp")) / "jht-capacity-test-home")
    script = f'. "{SPAWN_LIB}"; jht_spawn_repl_cmd {provider}'
    out = subprocess.run(["bash", "-c", script], env=env, text=True, capture_output=True, timeout=30)
    return out.stdout.strip()


def test_the_fallback_model_replaces_the_usual_one_for_claude_and_codex_only_when_set():
    assert "--model sonnet" in _repl_cmd("claude", None)
    assert "--model backup-model-1" in _repl_cmd("claude", "backup-model-1")
    assert "codex --yolo -c" in _repl_cmd("codex", None)
    assert "codex --yolo -m backup-model-1 -c" in _repl_cmd("codex", "backup-model-1")


def test_a_model_name_with_shell_characters_is_never_typed_into_the_pane():
    assert "--model sonnet" in _repl_cmd("claude", "x; rm -rf ~")
    assert "touch" not in _repl_cmd("claude", "$(touch /tmp/x)")


def test_a_model_name_that_starts_with_a_dash_would_be_an_option_and_is_ignored():
    for bad in ("--oss", "-x", "-m", "--model=other"):
        assert "--model sonnet" in _repl_cmd("claude", bad), bad
        assert " -m " not in _repl_cmd("codex", bad) and bad not in _repl_cmd("codex", bad), bad


def _name_ok(value: str) -> bool:
    script = f'. "{SPAWN_LIB}"; jht_spawn_model_name_ok "$1"'
    return subprocess.run(["bash", "-c", script, "x", value], capture_output=True, timeout=30).returncode == 0


def test_the_model_name_check_is_one_function_for_the_log_and_for_the_pane():
    assert _name_ok("backup-model-1") and _name_ok("a.b_c:d/e-f") and _name_ok("9x")
    for bad in ("", "-x", "--oss", "x y", "x\nINJECTED", "x\x1b[31m", "$(id)", "a" * 65):
        assert not _name_ok(bad), repr(bad)


def test_the_doctor_spawner_validates_the_fallback_model_before_it_logs_or_exports_it():
    source = (ROOT / ".launcher" / "spawn-doctor.sh").read_text(encoding="utf-8")
    check = source.index('jht_spawn_model_name_ok "$FALLBACK_MODEL"')
    assert check < source.index('export JHT_SPAWN_MODEL_OVERRIDE="$FALLBACK_MODEL"')
    assert check < source.index("fallback model '$FALLBACK_MODEL'")
    # the value that failed the check never reaches the round's log
    assert "is not a model name — ignored" in source
    refused = source.split("is not a model name")[1].split("\n")[0]
    assert "$FALLBACK_MODEL" not in refused
