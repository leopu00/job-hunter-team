"""JHT-T26 — `jht team stop` stops the session it was asked for, and only the team's own sessions.

What was wrong: the command did not know `closer` or the writer's reviewers `CRITICO-S<n>`, passed
`kill-session -t NAME` without the `=` that makes tmux compare the name exactly (so a prefix could be
taken for the session), and `--all` killed `SENTINELLA-WORKER`, which is not an agent of the team but
the bridge's `/usage` probe.

These tests run the real command against a PRIVATE tmux server: its own TMUX_TMPDIR, no TMUX/TMUX_PANE
inherited (inside FLEET's tmux a command would reach the FLEET server whatever TMUX_TMPDIR says), and the
sessions run `sleep`. Nothing here can touch a session of the team that is running on this machine.

- the container path (IS_CONTAINER=1: the CLI runs where tmux is) for the single stops;
- the host path (a `docker` that says no) for `--all`, whose container path writes /jht_home.

Also here: `daily-restart-wave` looks at the flags where they really are.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
STOP = ROOT / "cli" / "src" / "commands" / "team" / "stop.js"
SKILLS = ROOT / "agents" / "_skills" / "daily-restart-wave"
TMUX = shutil.which("tmux")
NODE = shutil.which("node")

needs_tools = pytest.mark.skipif(not (TMUX and NODE), reason="needs tmux and node")


class PrivateTmux:
    """A tmux server of its own, and a way to run the CLI against it."""

    def __init__(self):
        # A short path: the socket's own path is limited to ~100 characters.
        # resolve(): on macOS /tmp is a link to /private/tmp, and tmux reports the real path.
        self.dir = Path(tempfile.mkdtemp(prefix="jts", dir="/tmp")).resolve()
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        self.log = self.dir / "tmux.log"
        # A tmux that writes down what it was asked, then does it: the `=` is seen on the wire.
        wrapper = self.bin / "tmux"
        wrapper.write_text(f'#!/bin/sh\nprintf \'%s\\n\' "$*" >> "{self.log}"\nexec "{TMUX}" "$@"\n')
        wrapper.chmod(0o755)
        # No engine: the host path is the only one this machine has.
        docker = self.bin / "docker"
        docker.write_text("#!/bin/sh\nexit 1\n")
        docker.chmod(0o755)
        self.env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE", "IS_CONTAINER")}
        self.env.update({
            "TMUX_TMPDIR": str(self.dir),
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "JHT_HOME": str(self.dir / "home"),
            "JHT_LANG": "en",
            "NO_COLOR": "1",
        })

    def tmux(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([TMUX, "-f", "/dev/null", *args], env=self.env, capture_output=True, text=True, timeout=30)

    def start(self, *names: str) -> None:
        for name in names:
            done = self.tmux("new-session", "-d", "-s", name, "sleep 600")
            assert done.returncode == 0, done.stderr
        assert self.tmux("display-message", "-p", "#{socket_path}").stdout.strip().startswith(str(self.dir))

    def alive(self) -> set[str]:
        done = self.tmux("list-sessions", "-F", "#{session_name}")
        return set(done.stdout.split()) if done.returncode == 0 else set()

    def stop(self, arg: str | None, *, all_: bool = False, container: bool = True) -> subprocess.CompletedProcess[str]:
        env = dict(self.env)
        if container:
            env["IS_CONTAINER"] = "1"
        script = (
            f"import('{STOP}').then(m => m.stopAction({json.dumps(arg)}, {{ all: {str(all_).lower()} }}))"
        )
        return subprocess.run([NODE, "-e", script], env=env, cwd=ROOT / "cli", capture_output=True, text=True, timeout=120)

    def calls(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []

    def close(self) -> None:
        # Only the private server: the socket must be under our own folder, or nothing is killed.
        socket = self.tmux("display-message", "-p", "#{socket_path}").stdout.strip()
        if socket.startswith(str(self.dir)):
            self.tmux("kill-server")
        shutil.rmtree(self.dir, ignore_errors=True)


@pytest.fixture
def tm():
    if not (TMUX and NODE):
        pytest.skip("needs tmux and node")
    box = PrivateTmux()
    try:
        yield box
    finally:
        box.close()


def node_json(expression: str):
    script = f"import('{STOP}').then(m => console.log(JSON.stringify({expression})))"
    done = subprocess.run([NODE, "-e", script], env={**os.environ, "JHT_LANG": "en"}, cwd=ROOT / "cli", capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


# --- the names ---------------------------------------------------------------------------------------


@needs_tools
def test_the_names_the_team_owns_are_exact():
    names = [
        "CAPITANO", "ASSISTENTE", "MENTOR", "SENTINELLA", "CRITICO", "SCOUT-1", "SCOUT-12", "ANALISTA-2",
        "SCORER-3", "SCRITTORE-1", "CLOSER-1", "CRITICO-S1", "CRITICO-S12", "JHT-SCOUT-1", "JHT-CRITICO-S2",
        "SENTINELLA-WORKER", "JHT-SENTINELLA-WORKER", "SCOUT-0", "SCOUT-01", "SCOUT-", "SCOUT-abc", "CRITICO-S",
        "CRITICO-S0", "CRITICO-3", "SCOUTING", "CLOSER", "notes", "DOTTORE", "MENTOR-2",
    ]
    answer = node_json(f"{json.dumps(names)}.map(n => [n, m.isTeamSession(n)])")
    owned = {name for name, yes in answer if yes}
    assert owned == {
        "CAPITANO", "ASSISTENTE", "MENTOR", "SENTINELLA", "CRITICO", "SCOUT-1", "SCOUT-12", "ANALISTA-2",
        "SCORER-3", "SCRITTORE-1", "CLOSER-1", "CRITICO-S1", "CRITICO-S12", "JHT-SCOUT-1", "JHT-CRITICO-S2",
    }


@needs_tools
def test_an_argument_names_one_session_closer_and_reviewers_included():
    cases = {
        "scout:1": {"session": "SCOUT-1"}, "scout": {"session": "SCOUT-1"}, "scout-3": {"session": "SCOUT-3"},
        "closer": {"session": "CLOSER-1"}, "closer:1": {"session": "CLOSER-1"}, "closer-2": {"session": "CLOSER-2"},
        "critico": {"session": "CRITICO"}, "critico:s2": {"session": "CRITICO-S2"}, "critico-s2": {"session": "CRITICO-S2"},
        "CRITICO:S10": {"session": "CRITICO-S10"}, "capitano": {"session": "CAPITANO"},
        "critico:2": {"error": "no-instances", "role": "critico"}, "capitano:1": {"error": "no-instances", "role": "capitano"},
        "critico:s0": {"error": "unknown"}, "wizard": {"error": "unknown"}, "": {"error": "unknown"},
    }
    got = node_json(f"Object.fromEntries({json.dumps(list(cases))}.map(a => [a, m.resolveStopTarget(a, true)]))")
    assert got == cases
    host = node_json("m.resolveStopTarget('critico:s2', false)")
    assert host == {"session": "JHT-CRITICO-S2"}


# --- stopping one --------------------------------------------------------------------------------------


@needs_tools
def test_stopping_one_stops_that_one_and_not_the_name_that_extends_it(tm):
    tm.start("SCOUT-1", "SCOUT-10", "CRITICO", "CRITICO-S2", "CRITICO-S3", "CLOSER-1", "CAPITANO")
    assert tm.stop("scout:1").returncode == 0
    assert tm.alive() == {"SCOUT-10", "CRITICO", "CRITICO-S2", "CRITICO-S3", "CLOSER-1", "CAPITANO"}
    # `critico` is the singleton, not the writer's reviewers that start with its name.
    assert tm.stop("critico").returncode == 0
    assert tm.alive() == {"SCOUT-10", "CRITICO-S2", "CRITICO-S3", "CLOSER-1", "CAPITANO"}


@needs_tools
def test_a_writers_reviewer_and_the_closer_can_be_stopped_by_name(tm):
    tm.start("CRITICO", "CRITICO-S2", "CRITICO-S3", "CLOSER-1", "CAPITANO")
    assert tm.stop("critico:s2").returncode == 0
    assert tm.alive() == {"CRITICO", "CRITICO-S3", "CLOSER-1", "CAPITANO"}
    assert tm.stop("closer").returncode == 0
    assert tm.alive() == {"CRITICO", "CRITICO-S3", "CAPITANO"}


@needs_tools
def test_the_target_always_goes_to_tmux_with_the_exact_match_mark(tm):
    tm.start("SCOUT-1", "SCOUT-10")
    assert tm.stop("scout:1").returncode == 0
    kills = [c for c in tm.calls() if c.startswith("kill-session")]
    assert kills == ["kill-session -t =SCOUT-1"]


@needs_tools
def test_a_name_that_is_not_an_agent_stops_nothing_and_says_so(tm):
    tm.start("SCOUT-1", "CRITICO", "CRITICO-S2")
    for arg in ("critico:2", "wizard", "critico:s0"):
        done = tm.stop(arg)
        assert done.returncode == 1, arg
        assert tm.alive() == {"SCOUT-1", "CRITICO", "CRITICO-S2"}, arg
    assert "critico:s<N>" in tm.stop("critico:2").stderr


@needs_tools
def test_stopping_a_session_that_is_not_there_touches_no_other(tm):
    tm.start("SCOUT-10")
    done = tm.stop("scout:1")
    assert done.returncode == 0 and "not active" in done.stdout
    assert tm.alive() == {"SCOUT-10"}
    assert not [c for c in tm.calls() if c.startswith("kill-session")]


# --- stopping all --------------------------------------------------------------------------------------


@needs_tools
def test_stop_all_stops_the_team_and_spares_the_assistant_the_probe_and_strangers(tm):
    team = ["CAPITANO", "SCOUT-1", "SCOUT-10", "CRITICO", "CRITICO-S2", "CLOSER-1", "SENTINELLA", "MENTOR", "DOTTORE"]
    spared = ["ASSISTENTE", "SENTINELLA-WORKER", "SCOUTING", "notes"]
    tm.start(*[f"JHT-{n}" for n in team], "JHT-ASSISTENTE", "JHT-SENTINELLA-WORKER", "SENTINELLA-WORKER", "SCOUTING", "notes")
    done = tm.stop(None, all_=True, container=False)
    assert done.returncode == 0, done.stderr
    assert tm.alive() == {"JHT-ASSISTENTE", "JHT-SENTINELLA-WORKER", "SENTINELLA-WORKER", "SCOUTING", "notes"}
    assert "ASSISTENTE preserved" in done.stdout
    assert spared  # documented above: these are the survivors


@needs_tools
def test_the_host_path_does_not_hand_the_name_to_a_shell(tm):
    source = STOP.read_text(encoding="utf-8")
    assert "execSync" not in source
    assert "execFileSync" in source


# --- the daily restart wave ----------------------------------------------------------------------------

LANGS = ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")


def _skill(lang: str) -> str:
    return (SKILLS / f"SKILL{lang}.md").read_text(encoding="utf-8")


def _checks(text: str) -> str:
    block = re.search(r"```bash\n((?: *JHT_HOME=.*\n)?(?: *\[ -f .*\n)+) *```", text)
    assert block, "the skill's flag check block is missing"
    return block.group(1)


@pytest.mark.parametrize("lang", LANGS)
def test_the_wave_looks_for_the_flags_where_the_team_writes_them(lang):
    text = _skill(lang)
    assert "/jht_home/.jht/" not in text  # the old path: a folder the team never uses
    block = _checks(text)
    for flag in (".team-halted.flag", ".weekly-halt.flag", ".team-standby.flag"):
        assert f'"$JHT_HOME/{flag}"' in block, (lang, flag)
    assert 'JHT_HOME="${JHT_HOME:-/jht_home}"' in block


@pytest.mark.parametrize("lang", LANGS)
def test_the_wave_skips_for_each_flag_that_exists_and_runs_when_none_does(lang, tmp_path):
    block = _checks(_skill(lang))
    bash = shutil.which("bash")
    assert bash

    def verdict(*flags: str) -> str:
        for name in (".team-halted.flag", ".weekly-halt.flag", ".team-standby.flag"):
            (tmp_path / name).unlink(missing_ok=True)
        for name in flags:
            (tmp_path / name).write_text("x")
        env = {"PATH": os.environ["PATH"], "JHT_HOME": str(tmp_path)}
        done = subprocess.run([bash, "-c", f"skip() {{ echo SKIP; }}\n{block}"], env=env, capture_output=True, text=True)
        return done.stdout.split()[0] if done.stdout.split() else "RUN"

    assert verdict() == "RUN"
    for flag in (".team-halted.flag", ".weekly-halt.flag", ".team-standby.flag"):
        assert verdict(flag) == "SKIP", flag


def test_the_wave_and_the_roster_agree_on_what_stops_the_team(tmp_path):
    """The flags the skill checks are the ones the roster's central gate reads."""
    import sys

    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import team_roster

    block = _checks(_skill(""))
    names = set(re.findall(r'"\$JHT_HOME/(\.[a-z-]+\.flag)"', block))
    assert names == {".team-halted.flag", ".weekly-halt.flag", ".team-standby.flag"}
    for name in (".team-halted.flag", ".weekly-halt.flag"):
        (tmp_path / name).write_text("x")
        assert team_roster._halted(tmp_path) != "", name
        (tmp_path / name).unlink()
    assert team_roster._halted(tmp_path) == ""
    # The pause from the app is the third gate of the roster, by the same name.
    assert ".team-standby.flag" in Path(team_roster.__file__).read_text(encoding="utf-8")
