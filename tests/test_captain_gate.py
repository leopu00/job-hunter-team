"""The Capitano waits for the end of the onboarding with the Assistente: `captain_gate.py` says whether it is time
(exit 0 due, 1 wait), and every way of starting it asks: start-agent.sh, the agent watchdog, `jht team start`."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "shared" / "skills" / "captain_gate.py"
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"


def _state(phase: str) -> str:
    return json.dumps({"phase": phase, "created_at": "2026-10-27T07:00:00+00:00", "burst_started_at": None,
                       "completed_at": None, "completed_reason": None, "scored_at_start": 0})


def _ask(tmp_path: Path, *, state: str | None = None, flag: bool = False, done_flag: bool = False, override: str | None = None) -> tuple[int, dict]:
    home = tmp_path / "jht"
    (home / "state").mkdir(parents=True, exist_ok=True)
    (home / "profile").mkdir(parents=True, exist_ok=True)
    if state is not None:
        (home / "state" / "first-run.json").write_text(state, encoding="utf-8")
    if flag:
        (home / "profile" / "ready.flag").write_text("", encoding="utf-8")
    if done_flag:
        (home / "profile" / "onboarding-done.flag").write_text("", encoding="utf-8")
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


def test_an_onboarding_that_is_done_makes_it_due_even_without_the_ready_flag(tmp_path: Path):
    # the person finished the onboarding (the Assistente wrote onboarding-done.flag): the setup must not say «wait for the onboarding»
    code, out = _ask(tmp_path, state=_state("awaiting_profile"), done_flag=True)
    assert (code, out["captain_due"], out["reason"]) == (0, True, "onboarding_done")


def test_a_done_flag_that_is_a_link_does_not_count(tmp_path: Path):
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    (home / "profile" / "elsewhere").write_text("", encoding="utf-8")
    (home / "profile" / "onboarding-done.flag").symlink_to(home / "profile" / "elsewhere")
    code, out = _ask(tmp_path, state=_state("awaiting_profile"))
    assert (code, out["reason"]) == (1, "onboarding_open")


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


def _start_agent_gate_after_update(tmp_path: Path, *, role: str, alive: set[str], answer: str) -> tuple[int, str]:
    """The gate of start-agent.sh after an update: the sessions of before come back, the gate answers with its JSON."""
    source = START_AGENT.read_text(encoding="utf-8")
    gate = source[source.index("# --- cancello del Capitano"):source.index("# --- fine cancello del Capitano")]
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "python3").write_text(f"#!/bin/sh\nprintf '%s\\n' '{answer}'\nexit 1\n", encoding="utf-8")
    cases = "".join(f'  "has-session -t ={name}") exit 0 ;;\n' for name in sorted(alive))
    (bindir / "tmux").write_text(f'#!/bin/sh\ncase "$1 $2 $3" in\n{cases}esac\nexit 1\n', encoding="utf-8")
    for name in ("python3", "tmux"):
        (bindir / name).chmod(0o755)
    script = tmp_path / "gate.sh"
    script.write_text("set -euo pipefail\n"
                      "get_agent_info() { case \"$1\" in capitano) echo 'CAPITANO|high|x' ;; *) echo ;; esac; }\n"
                      f"ROLE={role}\nSESSION={role.upper()}\n{gate}\necho went on\n", encoding="utf-8")
    done = subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False,
                          env={"PATH": f"{bindir}:/usr/bin:/bin"})
    return done.returncode, done.stdout + done.stderr


TOOLS_PENDING = '{"captain_due": false, "reason": "tools_pending", "phase": "steady"}'
ONBOARDING_OPEN = '{"captain_due": false, "reason": "onboarding_open", "phase": "awaiting_profile"}'


def test_after_an_update_the_sentinella_starts_with_the_capitano_already_up(tmp_path: Path):
    """Giro Mac build12b: the update brought the Capitano back, the full image was on its way, and the Sentinella was
    refused as if the onboarding (closed two days before) were open; the setup then said the configuration had failed."""
    code, out = _start_agent_gate_after_update(tmp_path, role="sentinella", alive={"CAPITANO"}, answer=TOOLS_PENDING)
    assert code == 0 and "went on" in out, out


def test_waiting_for_the_tools_of_the_full_image_is_not_called_an_open_onboarding(tmp_path: Path):
    for role in ("capitano", "sentinella"):
        work = tmp_path / role
        work.mkdir()
        code, out = _start_agent_gate_after_update(work, role=role, alive=set(), answer=TOOLS_PENDING)
        assert code == 75 and "went on" not in out, out
        assert "tools of the full image" in out and "onboarding with the Assistente is not done" not in out, out


def test_a_failed_download_of_the_tools_holds_both_and_says_the_command(tmp_path: Path):
    """JHT-T362: a failed pull holds the Capitano before the first run; the refusal says what the person does."""
    answer = '{"captain_due": false, "reason": "tools_failed", "phase": "awaiting_profile"}'
    code, out = _start_agent_gate_after_update(tmp_path, role="capitano", alive=set(), answer=answer)
    assert code == 75 and "jht tools pull" in out and "onboarding with the Assistente is not done" not in out, out


def test_an_open_onboarding_still_holds_both_and_says_so(tmp_path: Path):
    code, out = _start_agent_gate_after_update(tmp_path, role="sentinella", alive=set(), answer=ONBOARDING_OPEN)
    assert code == 75 and "onboarding with the Assistente is not done" in out, out


def test_a_closed_onboarding_after_an_update_is_never_onboarding_open(tmp_path: Path):
    """The home of an update: ready.flag of two days before, the first run steady. Whatever the tools, the gate never
    answers that the onboarding is open."""
    home = tmp_path / "jht"
    (home / "state").mkdir(parents=True)
    (home / "profile").mkdir(parents=True)
    (home / "state" / "first-run.json").write_text('{"phase": "steady"}', encoding="utf-8")
    flag = home / "profile" / "ready.flag"
    flag.write_text("2026-11-16T08:37:34Z\n", encoding="utf-8")
    moment = time.time() - 2 * 86400
    os.utime(flag, (moment, moment))
    done = subprocess.run([sys.executable, "-I", str(GATE)], capture_output=True, text=True, timeout=60, check=False,
                          env={"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_DB": str(home / "no.db"),
                               "PYTHONDONTWRITEBYTECODE": "1"})
    assert json.loads(done.stdout)["reason"] != "onboarding_open", done.stdout


# ── the Scorer waits for the whole profile (giro Windows 16/11: 19 calls during the onboarding, the budget started early) ─


# An invented profile that the validator passes whole (the questionnaire that follows is optional), and one with only the three
# fields of ready.flag.
VALID_PROFILE = ("name: Alex Example\ntarget_role: Data analyst\nlocation: Lisbon\nseniority_target: mid\nexperience_years: 4\n"
                 "languages:\n  - language: English\n    level: C1\nskills:\n  primary: [SQL]\n")
MINIMUM_PROFILE = "target_role: Data analyst\nlocation: Lisbon\nlanguages:\n  - language: English\n    level: C1\n"


def _ask_scorer(tmp_path: Path, *, state: str | None = None, ready_age: float | None = None, done: bool = False,
                profile: str | None = None, **env_extra: str) -> tuple[int, dict]:
    home = tmp_path / "jht"
    (home / "state").mkdir(parents=True, exist_ok=True)
    (home / "profile").mkdir(parents=True, exist_ok=True)
    if profile is not None:
        (home / "profile" / "candidate_profile.yml").write_text(profile, encoding="utf-8")
    if state is not None:
        (home / "state" / "first-run.json").write_text(state, encoding="utf-8")
    if ready_age is not None:
        flag = home / "profile" / "ready.flag"
        flag.write_text("2026-11-16T14:08:44Z\n", encoding="utf-8")
        moment = time.time() - ready_age
        os.utime(flag, (moment, moment))
    if done:
        (home / "profile" / "onboarding-done.flag").write_text("2026-11-16T14:16:59Z\n", encoding="utf-8")
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_DB": str(home / "no.db"),
           "PYTHONDONTWRITEBYTECODE": "1", **env_extra}
    ran = subprocess.run([sys.executable, "-I", str(GATE), "scorer"], capture_output=True, text=True, timeout=60, env=env,
                         check=False)
    return ran.returncode, (json.loads(ran.stdout) if ran.stdout.strip() else {})


def test_the_scorer_waits_while_the_assistente_still_asks(tmp_path: Path):
    """ready.flag starts the Capitano (three fields of the profile), not the Scorer: in burst, a minute after the flag."""
    code, out = _ask_scorer(tmp_path, state=_state("burst"), ready_age=60)
    assert (code, out["scorer_due"], out["reason"]) == (1, False, "profile_open")


def test_a_valid_profile_with_ready_flag_makes_the_scorer_due_while_the_questionnaire_goes_on(tmp_path: Path):
    """JHT-T362: fifty positions and no score, the Scorer held by the optional questionnaire until the budget ran out."""
    code, out = _ask_scorer(tmp_path / "valid", state=_state("burst"), ready_age=60, profile=VALID_PROFILE)
    assert (code, out["reason"]) == (0, "profile_valid")
    code, out = _ask_scorer(tmp_path / "minimum", state=_state("burst"), ready_age=60, profile=MINIMUM_PROFILE)
    assert (code, out["reason"]) == (1, "profile_open"), "the three fields of ready.flag are not a profile to score against"
    code, out = _ask_scorer(tmp_path / "noflag", state=_state("awaiting_profile"), profile=VALID_PROFILE)
    assert out["reason"] != "profile_valid", "without ready.flag the Assistente has not confirmed it"


def test_the_end_of_the_onboarding_makes_the_scorer_due(tmp_path: Path):
    code, out = _ask_scorer(tmp_path, state=_state("burst"), ready_age=60, done=True)
    assert (code, out["reason"]) == (0, "onboarding_done")


def test_half_an_hour_after_ready_flag_the_scorer_is_due_without_the_end_of_the_onboarding(tmp_path: Path):
    """An Assistente that never writes the flag (an older install, a person who went away) does not hold it for ever."""
    code, out = _ask_scorer(tmp_path, state=_state("burst"), ready_age=1801)
    assert (code, out["reason"]) == (0, "onboarding_cap")
    code, out = _ask_scorer(tmp_path, state=_state("burst"), ready_age=200, JHT_SCORER_ONBOARDING_MAX="100")
    assert (code, out["reason"]) == (0, "onboarding_cap")


def test_a_steady_team_and_an_imported_profile_have_their_scorer(tmp_path: Path):
    code, out = _ask_scorer(tmp_path, state=_state("steady"), ready_age=10)
    assert (code, out["reason"]) == (0, "phase")


def test_the_scorer_override_starts_it_anyway(tmp_path: Path):
    code, out = _ask_scorer(tmp_path, state=_state("burst"), ready_age=10, JHT_SCORER_BEFORE_PROFILE="1")
    assert (code, out["reason"]) == (0, "override")


def test_a_done_flag_that_is_a_link_does_not_count(tmp_path: Path):
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    (home / "profile" / "elsewhere").write_text("", encoding="utf-8")
    (home / "profile" / "onboarding-done.flag").symlink_to(home / "profile" / "elsewhere")
    code, out = _ask_scorer(tmp_path, state=_state("burst"), ready_age=10)
    assert (code, out["reason"]) == (1, "profile_open")


def _start_agent_scorer_gate(tmp_path: Path, *, answer: int, session_alive: bool, role: str) -> tuple[int, str]:
    source = START_AGENT.read_text(encoding="utf-8")
    gate = source[source.index("# --- cancello dello Scorer"):source.index("# --- fine cancello dello Scorer")]
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "python3").write_text(f"#!/bin/sh\n[ \"$2\" = scorer ] || exit 99\nexit {answer}\n", encoding="utf-8")
    (bindir / "tmux").write_text(f"#!/bin/sh\nexit {0 if session_alive else 1}\n", encoding="utf-8")
    for name in ("python3", "tmux"):
        (bindir / name).chmod(0o755)
    script = tmp_path / "gate.sh"
    script.write_text(f"set -euo pipefail\nROLE={role}\nSESSION=X\n{gate}\necho went on\n", encoding="utf-8")
    ran = subprocess.run(["bash", str(script)], capture_output=True, text=True, timeout=60, check=False,
                         env={"PATH": f"{bindir}:/usr/bin:/bin"})
    return ran.returncode, ran.stdout + ran.stderr


def test_start_agent_refuses_the_scorer_while_the_profile_is_open(tmp_path: Path):
    code, out = _start_agent_scorer_gate(tmp_path, answer=1, session_alive=False, role="scorer")
    assert code == 75 and "went on" not in out and "SCORER not started" in out


@pytest.mark.parametrize("answer, alive, role", [(0, False, "scorer"), (2, False, "scorer"), (1, True, "scorer"),
                                                 (1, False, "scout"), (1, False, "analista")])
def test_start_agent_lets_the_scorer_start_go_on(tmp_path: Path, answer: int, alive: bool, role: str):
    code, out = _start_agent_scorer_gate(tmp_path, answer=answer, session_alive=alive, role=role)
    assert code == 0 and "went on" in out, out
