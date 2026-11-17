"""`jht-tmux-send ANALISTA` (a role without a number) goes to the lowest-numbered session of that role that is alive.

Windows, build 9 to 10: a Scout pinged ANALISTA-1 (the example of its prompt) and was told «not present» while ANALISTA-5 was the one
alive. The system numbers the workers, so a prompt cannot know the number. The role alone is resolved by the transport; a number
written out is never rewritten, because that message is for THAT session.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TRANSPORT = ROOT / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"

# a tmux that knows a list of sessions (file `sessions`) and logs every call; whatever comes after the lookup fails on purpose:
# these tests read the lookup and the first target the transport uses, not a delivery (that has its own tests)
FAKE = r"""#!/bin/sh
echo "$*" >> "$FT/calls"
case "$1" in
  has-session)
    want="$3"; want="${want#=}"
    grep -qx -- "$want" "$FT/sessions" && exit 0
    case "$3" in =*) exit 1 ;; esac
    grep -q -- "^$want" "$FT/sessions" && exit 0
    exit 1 ;;
  list-sessions) cat "$FT/sessions"; exit 0 ;;
esac
exit 1
"""


@pytest.fixture()
def box(tmp_path):
    (tmp_path / "bin").mkdir()
    (tmp_path / "bin" / "tmux").write_text(FAKE, encoding="utf-8")
    (tmp_path / "bin" / "tmux").chmod(0o755)
    (tmp_path / "state").mkdir()
    (tmp_path / "home").mkdir()

    def run(sessions: list[str], target: str):
        (tmp_path / "state" / "sessions").write_text("\n".join(sessions) + "\n", encoding="utf-8")
        (tmp_path / "state" / "calls").write_text("", encoding="utf-8")
        env = {**os.environ, "FT": str(tmp_path / "state"), "PATH": f"{tmp_path / 'bin'}:/usr/bin:/bin:" + os.environ.get("PATH", ""),
               "JHT_HOME": str(tmp_path / "home"), "JHT_TMUX_PROMPT_WAIT": "0", "JHT_TMUX_TEXT_WAIT": "0", "PYTHONDONTWRITEBYTECODE": "1"}
        for name in ("TMUX", "JHT_TMUX_SEND_FROM"):
            env.pop(name, None)
        done = subprocess.run(["bash", str(TRANSPORT), target, "[@scout-2 -> @analista] [INFO] Position inserted (ID: 7)"],
                              capture_output=True, text=True, timeout=60, env=env)
        calls = (tmp_path / "state" / "calls").read_text(encoding="utf-8").splitlines()
        return done, calls

    return run


def _targets(calls: list[str]) -> set[str]:
    out = set()
    for line in calls:
        words = line.split()
        for before, word in zip(words, words[1:]):
            if before == "-t":
                out.add(word.lstrip("=").split(":")[0])
    return out


def test_a_role_alone_goes_to_the_session_of_the_role_that_is_alive(box):
    done, calls = box(["CAPITANO", "SCOUT-2", "ANALISTA-5", "SCORER-5"], "ANALISTA")
    assert "delivering to ANALISTA-5" in done.stderr
    assert "ANALISTA-5" in _targets(calls)
    assert "ANALISTA" not in _targets([c for c in calls if not c.startswith("has-session -t =")])   # past the lookup, only the real session


def test_the_lowest_number_wins_not_the_first_in_the_alphabet(box):
    done, calls = box(["ANALISTA-12", "ANALISTA-3", "ANALISTA-5"], "ANALISTA")
    assert "delivering to ANALISTA-3" in done.stderr
    assert "ANALISTA-3" in _targets(calls)


@pytest.mark.parametrize("role", ["SCORER", "SCOUT", "SCRITTORE", "CLOSER"])
def test_every_worker_role_resolves_the_same_way(box, role):
    done, _ = box([f"{role}-4", "ANALISTA-1"], role)
    assert f"delivering to {role}-4" in done.stderr


def test_a_number_written_out_is_never_rewritten(box):
    done, calls = box(["ANALISTA-5"], "ANALISTA-1")
    assert done.returncode == 2 and "non esiste" in done.stderr and "delivering to" not in done.stderr
    assert "ANALISTA-5" not in _targets(calls)


def test_a_role_with_no_session_alive_says_so(box):
    done, _ = box(["CAPITANO", "SCOUT-2"], "ANALISTA")
    assert done.returncode == 2 and "non esiste" in done.stderr and "delivering to" not in done.stderr


def test_a_session_that_has_the_exact_name_is_used_as_it_is(box):
    done, calls = box(["ANALISTA", "ANALISTA-5"], "ANALISTA")
    assert "delivering to" not in done.stderr
    assert "ANALISTA" in _targets(calls)
