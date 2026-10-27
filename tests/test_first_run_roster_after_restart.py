"""After a restart of the containers every session is gone: in a burst the Capitano is told which roles of the
roster have no session, so it starts those and not the whole formation over again."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIRST_RUN = ROOT / "shared" / "skills" / "first_run.py"
LANGS = ("en", "it", "es", "fr", "de", "hu", "pt")
SUFFIX = {"en": "", "it": ".it", "es": ".es", "fr": ".fr", "de": ".de", "hu": ".hu", "pt": ".pt"}
ROSTER = {"scout": 3, "analista": 2, "scorer": 1}


def _fake_tmux(bindir: Path, *, sessions: list[str] | None, stderr: str = "", rc: int = 0) -> None:
    bindir.mkdir(exist_ok=True)
    script = bindir / "tmux"
    lines = "".join(f"echo '{name}'\n" for name in (sessions or []))
    err = f"echo '{stderr}' >&2\n" if stderr else ""
    script.write_text(f"#!/bin/sh\n{lines}{err}exit {rc}\n", encoding="utf-8")  # builtins only: PATH is the bin folder
    script.chmod(0o755)


def _status(tmp_path: Path, *, phase: str = "burst", roster: dict | None = ROSTER, command: str = "status",
            path_has_tmux: bool = True) -> dict:
    home = tmp_path / "jht"
    (home / "state").mkdir(parents=True, exist_ok=True)
    state = {"phase": phase, "created_at": "2026-10-27T07:00:00+00:00", "burst_started_at": "2026-10-27T07:00:00+00:00",
             "completed_at": None, "completed_reason": None, "scored_at_start": 0}
    if roster is not None:
        state["roster"] = roster
    (home / "state" / "first-run.json").write_text(json.dumps(state), encoding="utf-8")
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "codex", "providers": {"openai": {"plan": "pro"}}}), encoding="utf-8")
    env = {"PATH": str(tmp_path / "bin") if path_has_tmux else str(tmp_path / "nobin"), "JHT_HOME": str(home),
           "JHT_HOST_ENV_FILE": "/nonexistent/jht-host.env", "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(FIRST_RUN), command], capture_output=True, text=True,
                          timeout=60, env=env, check=False)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


@pytest.mark.parametrize("command", ["status", "begin-burst"])
def test_after_a_restart_the_whole_roster_is_missing(tmp_path: Path, command: str):
    _fake_tmux(tmp_path / "bin", sessions=[], stderr="no server running on /tmp/tmux-0/default", rc=1)
    out = _status(tmp_path, command=command)
    assert out["roster_alive"] == {"scout": 0, "analista": 0, "scorer": 0}
    assert out["roster_missing"] == ROSTER


def test_only_the_roles_without_a_session_are_missing(tmp_path: Path):
    _fake_tmux(tmp_path / "bin", sessions=["CAPITANO", "SENTINELLA", "SCOUT-1", "SCOUT-2", "ANALISTA-1", "scorer-1", "SCOUT-10"])
    out = _status(tmp_path)
    assert out["roster_alive"] == {"scout": 3, "analista": 1, "scorer": 1}
    assert out["roster_missing"] == {"scout": 0, "analista": 1, "scorer": 0}  # more than asked is not "negative"


def test_a_session_of_another_name_is_not_a_worker_of_the_roster(tmp_path: Path):
    _fake_tmux(tmp_path / "bin", sessions=["SCOUT", "SCOUT-X", "XSCOUT-1", "SCOUT-1-OLD", "SCORER-2"])
    out = _status(tmp_path)
    assert out["roster_alive"] == {"scout": 0, "analista": 0, "scorer": 1}


def test_when_tmux_cannot_be_asked_nothing_is_assumed(tmp_path: Path):
    out = _status(tmp_path, path_has_tmux=False)
    assert out["roster_check"] == "unavailable" and "roster_missing" not in out and "roster_alive" not in out
    _fake_tmux(tmp_path / "bin", sessions=[], stderr="protocol version mismatch", rc=1)
    out = _status(tmp_path)
    assert out["roster_check"] == "unavailable" and "roster_missing" not in out


@pytest.mark.parametrize("phase, roster", [("steady", ROSTER), ("awaiting_profile", None), ("burst", None)])
def test_outside_a_burst_with_a_roster_it_says_nothing(tmp_path: Path, phase: str, roster):
    _fake_tmux(tmp_path / "bin", sessions=[])
    out = _status(tmp_path, phase=phase, roster=roster)
    assert not {"roster_alive", "roster_missing", "roster_check"} & set(out)


@pytest.mark.parametrize("lang", LANGS)
def test_the_skill_tells_the_capitano_to_start_only_the_missing_ones(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    for key in ("roster_alive", "roster_missing", "roster_check", "`unavailable`", "C-08 bis"):
        assert key in text, key
    where = text.index("roster_missing")
    assert text.index("\n**2. ") < where < text.index("\n**3. ")  # inside the roster step, before the downstream


@pytest.mark.parametrize("lang", LANGS)
def test_the_capitano_prompt_does_not_ask_for_the_whole_roster_at_a_restart(lang: str):
    prompt = (ROOT / "agents" / "capitano" / f"capitano{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    line = next(l for l in prompt.splitlines() if l.startswith("**C-22 —"))
    assert "roster_missing" in line and "first-run-burst" in line and "`[PROFILO-PRONTO]`" in line
    # the table of triggers sends the first run to the skill and to C-22, as in English
    assert any(l.startswith("| ") and "first_run.py status" in l and "`first-run-burst` → **C-22**" in l
               for l in prompt.splitlines())


@pytest.mark.parametrize("roster, alive, missing", [
    ({"scout": "three", "analista": 2}, {"analista": 0}, {"analista": 2}),
    ({"scout": None, "analista": -1, "scorer": True}, {}, {}),
    ({"scout": 2.5, "scorer": 1}, {"scorer": 0}, {"scorer": 1}),
    ({"scout.*": 1}, {"scout.*": 0}, {"scout.*": 1}),  # a role is a name, not a pattern
])
def test_a_state_file_that_was_tampered_with_does_not_break_the_status(tmp_path: Path, roster, alive, missing):
    _fake_tmux(tmp_path / "bin", sessions=[])
    out = _status(tmp_path, roster=roster)
    assert out["roster_alive"] == alive and out["roster_missing"] == missing


def test_a_roster_that_is_not_a_table_says_nothing(tmp_path: Path):
    _fake_tmux(tmp_path / "bin", sessions=[])
    out = _status(tmp_path, roster=["scout", "scorer"])
    assert not {"roster_alive", "roster_missing", "roster_check"} & set(out)
