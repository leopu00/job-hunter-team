"""The Mentor has no record to walk until the first positions have a score, so it is not started at every boot:
`first_run.py mentor-due` says whether it is time, and the watchdog starts it by itself once the run is `steady`."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIRST_RUN = ROOT / "shared" / "skills" / "first_run.py"
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"


def _mentor_due(tmp_path: Path, state: str | None) -> tuple[int, dict]:
    """(exit code, JSON) of `first_run.py mentor-due` with the given state file (None: no file, no database)."""
    home = tmp_path / "jht"
    (home / "state").mkdir(parents=True, exist_ok=True)
    if state is not None:
        (home / "state" / "first-run.json").write_text(state, encoding="utf-8")
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_DB": str(home / "no.db"),
           "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(FIRST_RUN), "mentor-due"], capture_output=True, text=True,
                          timeout=60, env=env, check=False)
    return done.returncode, (json.loads(done.stdout) if done.stdout.strip() else {})


def _state(phase: str) -> str:
    return json.dumps({"phase": phase, "created_at": "2026-10-27T07:00:00+00:00", "burst_started_at": None,
                       "completed_at": None, "completed_reason": None, "scored_at_start": 0})


@pytest.mark.parametrize("phase", ["awaiting_profile", "burst"])
def test_the_mentor_is_not_due_while_the_first_run_is_open(tmp_path: Path, phase: str):
    code, out = _mentor_due(tmp_path, _state(phase))
    assert code == 1
    assert out == {"mentor_due": False, "phase": phase}


def test_the_mentor_is_due_when_the_run_is_steady(tmp_path: Path):
    code, out = _mentor_due(tmp_path, _state("steady"))
    assert code == 0
    assert out == {"mentor_due": True, "phase": "steady"}


def test_a_fresh_installation_has_no_mentor_until_it_has_scores(tmp_path: Path):
    code, out = _mentor_due(tmp_path, None)  # no state and nothing scored: a first run begins
    assert (code, out["phase"]) == (1, "awaiting_profile")


def test_a_state_that_cannot_be_read_counts_as_due(tmp_path: Path):
    """A state that is garbage is read as empty, and an empty one starts a first run: but the answer must never
    be a crash that keeps the Mentor off, so the module catches whatever status() raises."""
    spec_dir = tmp_path / "mod"
    spec_dir.mkdir()
    probe = spec_dir / "probe.py"
    probe.write_text(
        "import importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('fr', {str(FIRST_RUN)!r})\n"
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        "def boom():\n    raise OSError('disk gone')\n"
        "m.status = boom\n"
        "sys.exit(0 if m.mentor_due() else 1)\n", encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(probe)], capture_output=True, text=True, timeout=60,
                          env={"JHT_HOME": str(tmp_path / "jht"), "PYTHONDONTWRITEBYTECODE": "1"}, check=False)
    assert done.returncode == 0, done.stderr


# ── the watchdog: it does not respawn the Mentor while it is not due, and does when it is ────────────


def _watchdog_prelude() -> str:
    source = WATCHDOG.read_text(encoding="utf-8")
    marker = 'log "watchdog start'
    assert marker in source
    return source[: source.index(marker)]


def _ensure_mentor(tmp_path: Path, *, answer: int | None) -> tuple[list[str], str]:
    """Run the real ensure_agent for the Mentor, whose session is down, with a first_run.py that answers
    `answer` (None: no python3 to ask). Returns the start commands that were issued and the watchdog's output."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    calls = tmp_path / "start-calls.txt"
    if answer is not None:
        py = bindir / "python3"
        py.write_text(f"#!/bin/sh\nexit {answer}\n", encoding="utf-8")
        py.chmod(0o755)
    node = bindir / "node"
    node.write_text(f'#!/bin/sh\necho "$*" >> "{calls}"\nexit 0\n', encoding="utf-8")
    node.chmod(0o755)
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    script = tmp_path / "case.sh"
    exports = {"PATH": f"{bindir}:/usr/bin:/bin", "JHT_HOME": str(home), "JHT_NODE_BIN": str(node),
               "JHT_SPAWN_STATE_DIR": str(home / "logs")}
    script.write_text("".join(f"export {k}='{v}'\n" for k, v in exports.items()) + _watchdog_prelude()
                      + "\nis_session_alive() { return 1; }\nagent_is_contained() { return 1; }\n"
                        "spawn_backoff_active() { return 1; }\nnotify_captain_recovery() { :; }\n"
                        "ensure_agent mentor\n", encoding="utf-8")
    done = subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False)
    lines = calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []
    return lines, done.stdout + done.stderr


def test_the_watchdog_leaves_the_mentor_down_while_the_run_is_open(tmp_path: Path):
    started, out = _ensure_mentor(tmp_path, answer=1)
    assert started == [], out
    assert "inactive" not in out and "FAILED" not in out


def test_the_watchdog_starts_the_mentor_when_it_is_due(tmp_path: Path):
    started, out = _ensure_mentor(tmp_path, answer=0)
    assert len(started) == 1 and started[0].endswith("team start mentor"), out


@pytest.mark.parametrize("answer", [2, 127, None])
def test_the_watchdog_starts_the_mentor_when_the_answer_is_not_a_clear_no(tmp_path: Path, answer):
    """argparse's 2, a crash, a missing python3: only an exit 1 from mentor-due keeps the Mentor off."""
    started, out = _ensure_mentor(tmp_path, answer=answer)
    assert len(started) == 1, out


def test_the_other_core_agents_do_not_ask_whether_it_is_time(tmp_path: Path):
    """Only the Mentor waits: with a `no` on offer, the Assistente is still started."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "python3").write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    (bindir / "python3").chmod(0o755)
    calls = tmp_path / "start-calls.txt"
    node = bindir / "node"
    node.write_text(f'#!/bin/sh\necho "$*" >> "{calls}"\nexit 0\n', encoding="utf-8")
    node.chmod(0o755)
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    exports = {"PATH": f"{bindir}:/usr/bin:/bin", "JHT_HOME": str(home), "JHT_NODE_BIN": str(node),
               "JHT_SPAWN_STATE_DIR": str(home / "logs")}
    script = tmp_path / "case.sh"
    script.write_text("".join(f"export {k}='{v}'\n" for k, v in exports.items()) + _watchdog_prelude()
                      + "\nis_session_alive() { return 1; }\nagent_is_contained() { return 1; }\n"
                        "spawn_backoff_active() { return 1; }\nnotify_captain_recovery() { :; }\n"
                        "ensure_agent assistente\n", encoding="utf-8")
    subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False)
    assert calls.read_text(encoding="utf-8").strip().endswith("team start assistente")


# ── start-agent.sh: the one place every way of starting the Mentor goes through ───────────────────


def _start_agent_gate(tmp_path: Path, *, answer: int, session_alive: bool, now: str = "") -> tuple[int, str]:
    """Run the Mentor gate of start-agent.sh (the lines between its two markers) and say whether it let the start
    go on (`went on`) or stopped it."""
    source = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    gate = source[source.index("# --- cancello del Mentor"):source.index("# --- fine cancello del Mentor")]
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "python3").write_text(f"#!/bin/sh\nexit {answer}\n", encoding="utf-8")
    (bindir / "tmux").write_text(f"#!/bin/sh\nexit {0 if session_alive else 1}\n", encoding="utf-8")
    for name in ("python3", "tmux"):
        (bindir / name).chmod(0o755)
    script = tmp_path / "gate.sh"
    script.write_text(f"ROLE=mentor\nSESSION=MENTOR\nJHT_MENTOR_NOW='{now}'\n{gate}\necho went on\n", encoding="utf-8")
    done = subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False,
                          env={"PATH": f"{bindir}:/usr/bin:/bin"})
    return done.returncode, done.stdout + done.stderr


def test_start_agent_refuses_the_mentor_while_the_run_is_open(tmp_path: Path):
    code, out = _start_agent_gate(tmp_path, answer=1, session_alive=False)
    assert code == 75 and "went on" not in out and "MENTOR not started" in out


@pytest.mark.parametrize("answer, alive, now", [(0, False, ""), (2, False, ""), (127, False, ""), (1, True, ""), (1, False, "1")])
def test_start_agent_lets_the_mentor_start_when_it_is_time_or_forced(tmp_path: Path, answer: int, alive: bool, now: str):
    """Due, an unclear answer, a session that is already up (nothing to refuse), or JHT_MENTOR_NOW=1."""
    code, out = _start_agent_gate(tmp_path, answer=answer, session_alive=alive, now=now)
    assert code == 0 and "went on" in out, out
