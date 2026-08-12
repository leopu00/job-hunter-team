"""Contratto di regressione per JHT-DOCTOR-DAILY-RESTART.

Il vecchio daily restart non deve rinascere come secondo scheduler. La
copertura corrente è una sola catena: doctor-watchdog -> Dottore/
session-refresh, con agent-watchdog come fail-safe TTL deterministico. I test
eseguono scheduler, watchdog e snippet governati con dipendenze finte: nessun
tmux, processo LLM o restart reale.
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LOCALES = ("", ".it", ".es", ".fr", ".de", ".pt", ".hu")
SCHEDULE_PATH = ROOT / "shared" / "skills" / "doctor_schedule.py"
WATCHDOG_PATH = ROOT / ".launcher" / "doctor-watchdog.sh"

_schedule_spec = importlib.util.spec_from_file_location(
    "doctor_schedule_daily_restart", SCHEDULE_PATH
)
assert _schedule_spec and _schedule_spec.loader
doctor_schedule = importlib.util.module_from_spec(_schedule_spec)
_schedule_spec.loader.exec_module(doctor_schedule)


def _localized(directory: Path, stem: str) -> list[Path]:
    return [directory / f"{stem}{locale}.md" for locale in LOCALES]


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_both_doctor_skills_exist_in_all_seven_locales():
    for skill in ("daily-restart-wave", "session-refresh"):
        directory = ROOT / "agents" / "_skills" / skill
        files = _localized(directory, "SKILL")
        assert all(path.is_file() for path in files), skill


def test_session_refresh_is_the_only_primary_doctor_path():
    prompts = _localized(ROOT / "agents" / "dottore", "dottore")
    for path in prompts:
        text = _read(path)
        assert "session-refresh" in text, path.name
        assert "daily-restart-wave" in text, path.name

    skills_list = _read(ROOT / "agents" / "dottore" / "skills.list")
    assert "superseded by the scheduled session-refresh rounds" in skills_list

    launcher_sources = "\n".join(
        _read(path) for path in (ROOT / ".launcher").glob("*.sh")
    )
    assert "daily-restart-wave" not in launcher_sources


def test_scheduler_and_ttl_fail_safe_are_distinct_and_single_owner():
    scheduler = _read(ROOT / ".launcher" / "doctor-watchdog.sh")
    schedule = _read(ROOT / "shared" / "skills" / "doctor_schedule.py")
    watchdog = _read(ROOT / ".launcher" / "agent-watchdog.sh")

    assert 'case "$slot" in' in scheduler
    assert "T30|MID|FALLBACK" in scheduler
    assert 'python3 "$SCHED" claim' in scheduler
    assert 'bash "$SPAWNER"' in scheduler
    assert "T30_MIN = 30.0" in schedule
    assert 'AGENT_MAX_SESSION_AGE_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"' in watchdog
    assert "maybe_ttl_refresh" in watchdog
    assert "oldest_age" in watchdog
    assert "daily-restart-wave" not in scheduler + schedule + watchdog


def _active_window():
    start = datetime(2026, 8, 12, 20, 0, tzinfo=timezone.utc)
    return start, start + timedelta(hours=12), start + timedelta(hours=1)


def test_schedule_claim_is_durable_before_a_slot_can_be_returned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    state_file = tmp_path / "logs" / "doctor-schedule-state.json"
    monkeypatch.setattr(doctor_schedule, "STATE_FILE", state_file)
    monkeypatch.setattr(doctor_schedule, "_bounds_now", _active_window)

    assert doctor_schedule.claim() == "T30"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert state["claimed_t30"] is True
    assert state["did_t30"] is False
    assert doctor_schedule.claim() == "WAIT", "a live claim must suppress duplicates"

    doctor_schedule.mark("T30")
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert state["claimed_t30"] is False
    assert state["did_t30"] is True


def test_schedule_claim_fails_closed_when_state_cannot_be_persisted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        doctor_schedule,
        "STATE_FILE",
        tmp_path / "logs" / "doctor-schedule-state.json",
    )
    monkeypatch.setattr(doctor_schedule, "_bounds_now", _active_window)
    monkeypatch.setattr(doctor_schedule, "_load_state", lambda: {})

    def fail_write(_state):
        raise OSError("synthetic read-only state")

    monkeypatch.setattr(doctor_schedule, "_save_state", fail_write)
    with pytest.raises(OSError, match="read-only"):
        doctor_schedule.claim()


def test_schedule_claim_fails_closed_when_existing_state_is_unreadable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    state_file = tmp_path / "logs" / "doctor-schedule-state.json"
    state_file.parent.mkdir(parents=True)
    state_file.write_text("{truncated", encoding="utf-8")
    monkeypatch.setattr(doctor_schedule, "STATE_FILE", state_file)
    monkeypatch.setattr(doctor_schedule, "_bounds_now", _active_window)

    with pytest.raises(OSError, match="state is unreadable"):
        doctor_schedule.claim()
    assert state_file.read_text(encoding="utf-8") == "{truncated"


def test_schedule_claim_fails_closed_without_interprocess_lock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        doctor_schedule,
        "STATE_FILE",
        tmp_path / "logs" / "doctor-schedule-state.json",
    )
    monkeypatch.setattr(doctor_schedule, "_bounds_now", _active_window)
    monkeypatch.setattr(doctor_schedule, "fcntl", None)

    with pytest.raises(OSError, match="lock unavailable"):
        doctor_schedule.claim()


@pytest.mark.skipif(doctor_schedule.fcntl is None, reason="POSIX runtime lock")
def test_schedule_claim_fails_closed_when_lock_release_is_uncertain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    state_file = tmp_path / "logs" / "doctor-schedule-state.json"
    monkeypatch.setattr(doctor_schedule, "STATE_FILE", state_file)
    monkeypatch.setattr(doctor_schedule, "_bounds_now", _active_window)
    real_fcntl = doctor_schedule.fcntl

    class UncertainUnlock:
        LOCK_EX = real_fcntl.LOCK_EX
        LOCK_UN = real_fcntl.LOCK_UN

        @staticmethod
        def flock(file_descriptor: int, operation: int):
            if operation == real_fcntl.LOCK_UN:
                raise OSError("synthetic uncertain unlock")
            return real_fcntl.flock(file_descriptor, operation)

    monkeypatch.setattr(doctor_schedule, "fcntl", UncertainUnlock)
    with pytest.raises(OSError, match="uncertain unlock"):
        doctor_schedule.claim()

    monkeypatch.setattr(doctor_schedule, "fcntl", real_fcntl)
    assert doctor_schedule.claim() == "WAIT"
    assert json.loads(state_file.read_text(encoding="utf-8"))["claimed_t30"] is True


@pytest.mark.skipif(doctor_schedule.fcntl is None, reason="POSIX runtime lock")
@pytest.mark.parametrize(
    ("mode", "expected_owner"), (("window", "T30"), ("fallback", "FALLBACK"))
)
def test_overlapping_schedule_processes_have_exactly_one_claim_owner(
    tmp_path: Path, mode: str, expected_owner: str
):
    worker = tmp_path / "claim_worker.py"
    worker.write_text(
        f"""import importlib.util, sys, time
from datetime import datetime, timedelta, timezone
spec = importlib.util.spec_from_file_location("schedule_worker", {str(SCHEDULE_PATH)!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
start = datetime(2026, 8, 12, 20, 0, tzinfo=timezone.utc)
if sys.argv[1] == "window":
    module._bounds_now = lambda: (start, start + timedelta(hours=12), start + timedelta(hours=1))
else:
    module._bounds_now = lambda: None
    module.is_within_working_hours = lambda: True
original_load = module._load_state
def slow_load():
    state = original_load()
    time.sleep(0.25)
    return state
module._load_state = slow_load
print(module.claim())
""",
        encoding="utf-8",
    )
    home = tmp_path / "home"
    env = {**os.environ, "JHT_HOME": str(home)}
    processes = [
        subprocess.Popen(
            [sys.executable, str(worker), mode],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for _ in range(2)
    ]
    results = [process.communicate(timeout=10) for process in processes]
    assert all(process.returncode == 0 for process in processes), results
    assert sorted(stdout.strip() for stdout, _ in results) == sorted(
        [expected_owner, "WAIT"]
    )


def test_24_7_fallback_is_owned_by_the_same_durable_claim(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    state_file = tmp_path / "logs" / "doctor-schedule-state.json"
    monkeypatch.setattr(doctor_schedule, "STATE_FILE", state_file)
    monkeypatch.setattr(doctor_schedule, "_bounds_now", lambda: None)
    monkeypatch.setattr(doctor_schedule, "is_within_working_hours", lambda: True)

    assert doctor_schedule.claim() == "FALLBACK"
    assert doctor_schedule.claim() == "WAIT"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert state["fallback_claimed_at"] > 0

    doctor_schedule.release("FALLBACK")
    assert doctor_schedule.claim() == "FALLBACK", "a known failed spawn must retry"


def _write_executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


def _run_watchdog_once(tmp_path: Path, schedule_body: str, spawner_body: str):
    home = tmp_path / "home"
    (home / ".codex").mkdir(parents=True)
    (home / ".codex" / "auth.json").write_text("{}", encoding="utf-8")
    (home / "jht.config.json").write_text(
        json.dumps({"active_provider": "openai"}), encoding="utf-8"
    )
    trace = tmp_path / "trace.log"
    schedule = tmp_path / "schedule.py"
    spawner = tmp_path / "spawn.sh"
    _write_executable(schedule, schedule_body)
    _write_executable(spawner, spawner_body)
    env = {
        **os.environ,
        "JHT_HOME": str(home),
        "JHT_DOCTOR_SCHED": str(schedule),
        "JHT_DOCTOR_SPAWNER": str(spawner),
        "JHT_MAINT_SPAWNER": str(tmp_path / "unused-maintainer.sh"),
        "JHT_DOCTOR_WATCHDOG_MAX_TICKS": "1",
        "DOCTOR_WATCHDOG_POLL": "0",
        "TRACE": str(trace),
    }
    result = subprocess.run(
        ["bash", str(WATCHDOG_PATH)],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
    )
    lines = trace.read_text(encoding="utf-8").splitlines() if trace.exists() else []
    return result, lines


def test_watchdog_runtime_claims_before_spawn_and_marks_after_success(tmp_path: Path):
    result, trace = _run_watchdog_once(
        tmp_path,
        """#!/usr/bin/env python3
import os, sys
with open(os.environ["TRACE"], "a") as trace:
    trace.write("schedule " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "check-maintainer":
    print("WAIT")
elif sys.argv[1] == "claim":
    print("T30")
""",
        """#!/bin/sh
echo spawn >> "$TRACE"
exit 0
""",
    )
    assert result.returncode == 0, result.stderr
    assert trace == [
        "schedule check-maintainer",
        "schedule claim",
        "spawn",
        "schedule mark T30",
    ]


def test_watchdog_runtime_does_not_spawn_without_a_durable_claim(tmp_path: Path):
    result, trace = _run_watchdog_once(
        tmp_path,
        """#!/usr/bin/env python3
import os, sys
with open(os.environ["TRACE"], "a") as trace:
    trace.write("schedule " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "check-maintainer":
    print("WAIT")
elif sys.argv[1] == "claim":
    print("synthetic persistence failure", file=sys.stderr)
    raise SystemExit(7)
""",
        """#!/bin/sh
echo spawn >> "$TRACE"
exit 0
""",
    )
    assert result.returncode == 0, result.stderr
    assert trace == ["schedule check-maintainer", "schedule claim"]
    assert "schedule claim FAILED rc=7" in result.stdout


def test_watchdog_releases_only_a_known_failed_spawn(tmp_path: Path):
    result, trace = _run_watchdog_once(
        tmp_path,
        """#!/usr/bin/env python3
import os, sys
with open(os.environ["TRACE"], "a") as trace:
    trace.write("schedule " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "check-maintainer":
    print("WAIT")
elif sys.argv[1] == "claim":
    print("MID")
""",
        """#!/bin/sh
echo spawn >> "$TRACE"
exit 4
""",
    )
    assert result.returncode == 0, result.stderr
    assert trace == [
        "schedule check-maintainer",
        "schedule claim",
        "spawn",
        "schedule release MID",
    ]
    assert "spawn FAILED (slot=MID) rc=4" in result.stdout


def test_rich_refresh_orders_and_snapshots_before_recreate():
    skill = _read(ROOT / "agents" / "_skills" / "session-refresh" / "SKILL.md")

    assert "worker sessions FIRST" in skill
    assert "coordinators LAST" in skill
    assert "CAPITANO" in skill
    capture = skill.index("tmux capture-pane -p -S - -t")
    durable_snapshot = skill.index('with open(journal, "a")')
    recreate = skill.index('tmux kill-session -t "$S"')
    assert capture < durable_snapshot < recreate
    assert "doctor-retrospective.jsonl" in skill


def test_capitano_gets_one_heads_up_before_the_first_recreate_in_every_locale():
    files = _localized(
        ROOT / "agents" / "_skills" / "session-refresh", "SKILL"
    )
    for path in files:
        text = _read(path)
        assert "ROUND_HEADS_UP_SENT" in text, path.name
        notify = text.index("jht-tmux-send CAPITANO")
        recreate = text.index('tmux kill-session -t "$S"')
        assert notify < recreate, path.name


def _heads_up_script(path: Path, sender: Path) -> str:
    text = _read(path)
    section = text[text.index("ROUND_HEADS_UP_SENT=0") :]
    match = re.search(
        r"```bash\n(if \[ \"\$ROUND_HEADS_UP_SENT\" -eq 0 \]; then.*?\nfi)\n```",
        section,
        re.DOTALL,
    )
    assert match, path.name
    return match.group(1).replace(
        "/app/agents/_skills/tmux-send/jht-tmux-send", str(sender)
    )


@pytest.mark.parametrize(
    "path",
    _localized(ROOT / "agents" / "_skills" / "session-refresh", "SKILL"),
    ids=lambda path: path.name,
)
def test_heads_up_runtime_is_once_only_after_verified_delivery(
    path: Path, tmp_path: Path
):
    calls = tmp_path / "calls"
    sender = tmp_path / "sender.sh"
    _write_executable(sender, f'#!/bin/sh\necho call >> "{calls}"\nexit 0\n')
    snippet = _heads_up_script(path, sender)
    result = subprocess.run(
        ["bash", "-c", f"ROUND_HEADS_UP_SENT=0\n{snippet}\n{snippet}"],
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, (path.name, result.stderr)
    assert calls.read_text(encoding="utf-8").splitlines() == ["call"]


@pytest.mark.parametrize(
    "path",
    _localized(ROOT / "agents" / "_skills" / "session-refresh", "SKILL"),
    ids=lambda path: path.name,
)
def test_heads_up_runtime_aborts_before_recreate_when_delivery_fails(
    path: Path, tmp_path: Path
):
    recreate = tmp_path / "recreate"
    sender = tmp_path / "sender.sh"
    _write_executable(sender, "#!/bin/sh\nexit 4\n")
    snippet = _heads_up_script(path, sender)
    result = subprocess.run(
        [
            "bash",
            "-c",
            f'ROUND_HEADS_UP_SENT=0\n{snippet}\necho recreated > "{recreate}"',
        ],
        text=True,
        capture_output=True,
    )
    assert result.returncode == 1, path.name
    assert not recreate.exists(), f"{path.name}: recreate continued after failed notice"


def test_config_has_one_canonical_vocabulary_not_legacy_preferences():
    primary = "\n".join(
        _read(path)
        for path in _localized(
            ROOT / "agents" / "_skills" / "session-refresh", "SKILL"
        )
    )
    scheduler = _read(ROOT / "shared" / "skills" / "doctor_schedule.py")
    launchers = _read(ROOT / ".launcher" / "doctor-watchdog.sh") + _read(
        ROOT / ".launcher" / "agent-watchdog.sh"
    )
    legacy = _read(
        ROOT / "agents" / "_skills" / "daily-restart-wave" / "SKILL.md"
    )

    assert "JHT_AGENT_MAX_SESSION_AGE_H" in primary
    assert "working_hours" in scheduler
    assert "preferences.json" not in primary + scheduler + launchers
    assert "Read `~/.jht/preferences.json`" in legacy
    assert "❌" in legacy[legacy.index("Read `~/.jht/preferences.json`") - 5 :]
