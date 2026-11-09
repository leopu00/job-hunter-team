"""The Capitano waits for the end of the onboarding with the Assistente: `captain_gate.py` says whether it is time
(exit 0 due, 1 wait), and every way of starting it asks: start-agent.sh, the agent watchdog, `jht team start`."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "shared" / "skills" / "captain_gate.py"
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"


def _state(phase: str) -> str:
    return json.dumps({"phase": phase, "created_at": "2026-10-27T07:00:00+00:00", "burst_started_at": None,
                       "completed_at": None, "completed_reason": None, "scored_at_start": 0})


def _ask(tmp_path: Path, *, state: str | None = None, flag: bool = False, override: str | None = None) -> tuple[int, dict]:
    home = tmp_path / "jht"
    (home / "state").mkdir(parents=True, exist_ok=True)
    (home / "profile").mkdir(parents=True, exist_ok=True)
    if state is not None:
        (home / "state" / "first-run.json").write_text(state, encoding="utf-8")
    if flag:
        (home / "profile" / "ready.flag").write_text("", encoding="utf-8")
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_DB": str(home / "no.db"),
           "PYTHONDONTWRITEBYTECODE": "1"}
    if override is not None:
        env["JHT_CAPTAIN_BEFORE_ONBOARDING"] = override
    done = subprocess.run([sys.executable, "-I", str(GATE)], capture_output=True, text=True, timeout=60, env=env, check=False)
    return done.returncode, (json.loads(done.stdout) if done.stdout.strip() else {})


def test_a_fresh_installation_has_no_capitano_until_the_onboarding_closes(tmp_path: Path):
    code, out = _ask(tmp_path)
    assert (code, out["captain_due"], out["reason"]) == (1, False, "onboarding_open")


def test_awaiting_profile_without_the_flag_waits(tmp_path: Path):
    code, out = _ask(tmp_path, state=_state("awaiting_profile"))
    assert (code, out["reason"]) == (1, "onboarding_open")


def test_the_ready_flag_makes_it_due(tmp_path: Path):
    code, out = _ask(tmp_path, state=_state("awaiting_profile"), flag=True)
    assert (code, out["reason"]) == (0, "ready_flag")


def test_a_flag_that_is_not_a_regular_file_does_not_count(tmp_path: Path):
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    (home / "profile" / "elsewhere").write_text("", encoding="utf-8")
    (home / "profile" / "ready.flag").symlink_to(home / "profile" / "elsewhere")
    code, out = _ask(tmp_path, state=_state("awaiting_profile"))
    assert (code, out["reason"]) == (1, "onboarding_open")


@pytest.mark.parametrize("phase", ["burst", "steady"])
def test_a_run_past_the_profile_never_loses_its_capitano(tmp_path: Path, phase: str):
    code, out = _ask(tmp_path, state=_state(phase))
    assert (code, out["reason"], out["phase"]) == (0, "phase", phase)


def test_the_override_starts_it_anyway(tmp_path: Path):
    code, out = _ask(tmp_path, override="1")
    assert (code, out["reason"]) == (0, "override")


def test_an_unreadable_state_counts_as_due_with_a_clear_exit(tmp_path: Path):
    probe = tmp_path / "probe.py"
    probe.write_text(
        "import sys\n"
        f"sys.path.insert(0, {str(GATE.parent)!r})\n"
        "import first_run\n"
        "def boom(*a, **k):\n    raise OSError('disk gone')\n"
        "first_run.status = boom\n"
        "import captain_gate\n"
        "sys.exit(captain_gate.main())\n", encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(probe)], capture_output=True, text=True, timeout=60,
                          env={"JHT_HOME": str(tmp_path / "jht"), "PYTHONDONTWRITEBYTECODE": "1"}, check=False)
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout)["reason"] == "unknown"


# ── the watchdog: it does not respawn the Capitano while the onboarding is open, and does when it closes ─────


def _watchdog_prelude() -> str:
    source = WATCHDOG.read_text(encoding="utf-8")
    marker = 'log "watchdog start'
    assert marker in source
    return source[: source.index(marker)]


def _ensure(tmp_path: Path, role: str, *, answer: int | None) -> tuple[list[str], str]:
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
    exports = {"PATH": f"{bindir}:/usr/bin:/bin", "JHT_HOME": str(home), "JHT_NODE_BIN": str(node),
               "JHT_SPAWN_STATE_DIR": str(home / "logs")}
    script = tmp_path / "case.sh"
    script.write_text("".join(f"export {k}='{v}'\n" for k, v in exports.items()) + _watchdog_prelude()
                      + "\nis_session_alive() { return 1; }\nagent_is_contained() { return 1; }\n"
                        "spawn_backoff_active() { return 1; }\nnotify_captain_recovery() { :; }\n"
                        f"ensure_agent {role}\n", encoding="utf-8")
    done = subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False)
    lines = calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []
    return lines, done.stdout + done.stderr


def test_the_watchdog_leaves_the_capitano_down_while_the_onboarding_is_open(tmp_path: Path):
    started, out = _ensure(tmp_path, "capitano", answer=1)
    assert started == [], out
    assert "inactive" not in out and "FAILED" not in out


def test_the_watchdog_starts_the_capitano_when_it_is_due(tmp_path: Path):
    started, out = _ensure(tmp_path, "capitano", answer=0)
    assert len(started) == 1 and started[0].endswith("team start capitano"), out


@pytest.mark.parametrize("answer", [2, 127, None])
def test_the_watchdog_starts_the_capitano_when_the_answer_is_not_a_clear_no(tmp_path: Path, answer):
    started, out = _ensure(tmp_path, "capitano", answer=answer)
    assert len(started) == 1, out


def test_the_watchdog_leaves_the_sentinella_down_with_the_capitano(tmp_path: Path):
    """The Sentinella watches the budget FOR the Capitano: while the Capitano waits it has nothing to watch."""
    started, out = _ensure(tmp_path, "sentinella", answer=1)
    assert started == [], out


def test_the_watchdog_starts_the_sentinella_when_the_team_is_due(tmp_path: Path):
    started, out = _ensure(tmp_path, "sentinella", answer=0)
    assert len(started) == 1 and started[0].endswith("team start sentinella"), out


def test_the_other_agents_do_not_wait_for_the_onboarding(tmp_path: Path):
    started, out = _ensure(tmp_path, "assistente", answer=1)
    assert len(started) == 1 and started[0].endswith("team start assistente"), out


# ── start-agent.sh: the one place every way of starting the Capitano goes through ────────────────────────


def _start_agent_gate(tmp_path: Path, *, answer: int, session_alive: bool, role: str = "capitano") -> tuple[int, str]:
    source = START_AGENT.read_text(encoding="utf-8")
    gate = source[source.index("# --- cancello del Capitano"):source.index("# --- fine cancello del Capitano")]
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "python3").write_text(f"#!/bin/sh\nexit {answer}\n", encoding="utf-8")
    (bindir / "tmux").write_text(f"#!/bin/sh\nexit {0 if session_alive else 1}\n", encoding="utf-8")
    for name in ("python3", "tmux"):
        (bindir / name).chmod(0o755)
    script = tmp_path / "gate.sh"
    # start-agent.sh runs under `set -euo pipefail`: the gate has to survive a python3 that exits with anything
    script.write_text(f"set -euo pipefail\nROLE={role}\nSESSION=X\n{gate}\necho went on\n", encoding="utf-8")
    done = subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False,
                          env={"PATH": f"{bindir}:/usr/bin:/bin"})
    return done.returncode, done.stdout + done.stderr


def test_start_agent_refuses_the_capitano_while_the_onboarding_is_open(tmp_path: Path):
    code, out = _start_agent_gate(tmp_path, answer=1, session_alive=False)
    assert code == 75 and "went on" not in out and "CAPITANO not started" in out


def test_start_agent_refuses_the_sentinella_with_the_capitano(tmp_path: Path):
    code, out = _start_agent_gate(tmp_path, answer=1, session_alive=False, role="sentinella")
    assert code == 75 and "went on" not in out and "SENTINELLA not started" in out


@pytest.mark.parametrize("answer, alive, role", [(0, False, "capitano"), (2, False, "capitano"), (127, False, "capitano"),
                                                 (1, True, "capitano"), (1, False, "scout"), (1, True, "sentinella"),
                                                 (0, False, "sentinella"), (1, False, "assistente")])
def test_start_agent_lets_the_start_go_on(tmp_path: Path, answer: int, alive: bool, role: str):
    """Due, an unclear answer (set -e must not kill the script), a session already up, or another role."""
    code, out = _start_agent_gate(tmp_path, answer=answer, session_alive=alive, role=role)
    assert code == 0 and "went on" in out, out
