"""The agents' control panel, container side (shared/skills/agent_control.py).

Every test runs against a fake tmux, a fake start-agent.sh and a private
JHT_HOME: nothing here can reach a real tmux server or start a real agent
(the fake tmux is first on PATH, and TMUX_TMPDIR is private as well).
"""
from __future__ import annotations

import fcntl
import importlib.machinery
import importlib.util
import io
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import stat
import sys

import pytest


ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "shared" / "skills" / "agent_control.py"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"

FAKE_TMUX = r"""#!/bin/bash
# A tmux that keeps its sessions as files in $FAKE_TMUX_DIR.
dir="$FAKE_TMUX_DIR"
echo "$*" >> "$dir/../tmux.log"
target() { local t="$1"; t="${t#=}"; echo "${t%%:*}"; }
case "$1" in
  has-session) [ -e "$dir/$(target "$3")" ] ;;
  kill-session) [ -n "$FAKE_TMUX_UNKILLABLE" ] || rm -f "$dir/$(target "$3")" ;;
  list-sessions)
    n=0; for f in "$dir"/*; do [ -e "$f" ] || continue; n=1; printf '%s\t100\t200\n' "$(basename "$f")"; done
    [ "$n" = 1 ] || { echo "no server running on /tmp/fake" >&2; exit 1; } ;;
  capture-pane) echo "pane of $(target "$5")" ;;
  *) exit 0 ;;
esac
"""

FAKE_START = r"""#!/bin/bash
# start-agent.sh <role> [instance]: records the call and «creates» the session.
echo "$JHT_SPAWN_SRC $*" >> "$FAKE_TMUX_DIR/../spawn.log"
[ -z "$FAKE_START_FAILS" ] || exit 1
role=$(echo "$1" | tr a-z A-Z)
if [ -n "$2" ]; then session="$role-$2"; else session="$role"; fi
touch "$FAKE_TMUX_DIR/$session"
"""

FAKE_SEND = """#!/bin/bash
echo "$*" >> "$FAKE_TMUX_DIR/../send.log"
"""


def _script(path: Path, body: str) -> Path:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def _load():
    loader = importlib.machinery.SourceFileLoader("agent_control_under_test", str(TOOL))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class Team:
    def __init__(self, tmp_path: Path, monkeypatch):
        self.home = tmp_path / "jht_home"
        self.home.mkdir()
        self.sessions = tmp_path / "sessions"
        self.sessions.mkdir()
        self.tmp = tmp_path
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        _script(bin_dir / "tmux", FAKE_TMUX)
        _script(bin_dir / "jht-tmux-send", FAKE_SEND)
        tmux_tmp = tmp_path / "tmux-tmp"
        tmux_tmp.mkdir()
        monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
        monkeypatch.setenv("TMUX_TMPDIR", str(tmux_tmp))
        monkeypatch.delenv("TMUX", raising=False)
        monkeypatch.setenv("JHT_HOME", str(self.home))
        monkeypatch.setenv("FAKE_TMUX_DIR", str(self.sessions))
        monkeypatch.delenv("FAKE_START_FAILS", raising=False)
        monkeypatch.delenv("FAKE_TMUX_UNKILLABLE", raising=False)
        self.tool = _load()
        self.tool.START_AGENT = _script(tmp_path / "start-agent.sh", FAKE_START)
        self.gate_rc = tmp_path / "gate-rc"
        self.disk_rc = tmp_path / "disk-rc"
        self.tool.APPLY_GATE = _script(tmp_path / "apply_gate.py",
                                       f"import sys; sys.exit(int(open({str(self.gate_rc)!r}).read()))\n")
        self.tool.HOST_VITALS = _script(tmp_path / "host_vitals.py",
                                        f"import sys; sys.exit(int(open({str(self.disk_rc)!r}).read()))\n")
        self.gate_rc.write_text("0")
        self.disk_rc.write_text("0")

    def up(self, *names: str) -> None:
        for name in names:
            (self.sessions / name).touch()

    def alive(self, name: str) -> bool:
        return (self.sessions / name).exists()

    def run(self, *argv: str, capsys):
        code = self.tool.main(list(argv))
        out = capsys.readouterr().out.strip().splitlines()
        assert len(out) == 1, out
        return code, json.loads(out[0])

    def roster(self):
        return self.tool.roster()

    def spawns(self) -> list[str]:
        log = self.tmp / "spawn.log"
        return log.read_text().splitlines() if log.exists() else []

    def journal(self) -> list[dict]:
        log = self.home / "logs" / "agent-control.jsonl"
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []


@pytest.fixture
def team(tmp_path, monkeypatch):
    return Team(tmp_path, monkeypatch)


# ── Spegni ──────────────────────────────────────────────────────────────────
def test_stop_holds_the_session_for_the_user_then_kills_it(team, capsys):
    team.up("CAPITANO", "SCOUT-1")
    code, answer = team.run("stop", "SCOUT-1", capsys=capsys)
    assert (code, answer) == (0, {"ok": True, "op": "stop", "session": "SCOUT-1", "result": "stopped"})
    assert not team.alive("SCOUT-1") and team.alive("CAPITANO")
    roster = team.roster()
    # the mark every respawn path and the 12 h refresh respect
    assert roster.is_contained("SCOUT-1")
    entry = roster.load()["agents"]["SCOUT-1"]
    assert entry["contained_by"] == "user"
    assert entry["contain_reason"] == "stopped by the user from the app"
    assert entry["contain_evidence"] == "desktop-panel"
    assert "while_mode" not in entry["containment_history"][-1]
    assert team.journal()[-1]["result"] == "stopped"
    # the kill is on the exact session
    assert "kill-session -t =SCOUT-1" in (team.tmp / "tmux.log").read_text()


def test_stop_of_an_absent_session_still_holds_it_so_the_watchdog_leaves_it_off(team, capsys):
    code, answer = team.run("stop", "CAPITANO", capsys=capsys)
    assert (code, answer["result"]) == (0, "already_stopped")
    assert team.roster().is_contained("CAPITANO")


def test_stop_does_not_kill_when_the_hold_cannot_be_written(team, capsys, monkeypatch):
    team.up("MENTOR")

    def broken(*args, **kwargs):
        raise OSError("roster not writable")

    roster = team.roster()
    monkeypatch.setattr(roster, "contain", broken)
    monkeypatch.setattr(team.tool, "roster", lambda: roster)
    code, answer = team.run("stop", "MENTOR", capsys=capsys)
    assert (code, answer["error"]) == (106, "agent_stop_failed")
    assert team.alive("MENTOR")


def test_stop_keeps_a_safety_hold_as_it_is(team, capsys):
    team.up("SCRITTORE-2")
    roster = team.roster()
    roster.record("scrittore", 2, src="test")
    roster.contain("SCRITTORE-2", "SENTINELLA", "runaway spend", "/evidence")
    code, answer = team.run("stop", "SCRITTORE-2", capsys=capsys)
    assert (code, answer["result"]) == (0, "stopped")
    assert team.roster().load()["agents"]["SCRITTORE-2"]["contained_by"] == "SENTINELLA"


def test_a_reviewer_is_only_killed_never_held(team, capsys):
    team.up("CRITICO-S3")
    code, answer = team.run("stop", "CRITICO-S3", capsys=capsys)
    assert (code, answer["result"]) == (0, "stopped")
    assert "CRITICO-S3" not in team.roster().load()["agents"]


def test_a_stop_that_does_not_kill_is_a_failure(team, capsys, monkeypatch):
    team.up("SCORER-1")
    monkeypatch.setenv("FAKE_TMUX_UNKILLABLE", "1")
    code, answer = team.run("stop", "SCORER-1", capsys=capsys)
    assert (code, answer["error"]) == (106, "agent_stop_failed")


# ── Accendi ─────────────────────────────────────────────────────────────────
def test_start_lifts_the_users_own_hold_and_starts_the_agent(team, capsys):
    team.up("SCOUT-1")
    team.run("stop", "SCOUT-1", capsys=capsys)
    code, answer = team.run("start", "SCOUT-1", capsys=capsys)
    assert (code, answer["result"]) == (0, "started")
    assert team.alive("SCOUT-1")
    assert not team.roster().is_contained("SCOUT-1")
    assert team.roster().load()["agents"]["SCOUT-1"]["release_reason"] == "started by the user from the app"
    assert team.spawns() == ["desktop-panel scout 1"]


def test_start_refuses_a_safety_hold_and_leaves_it_intact(team, capsys):
    roster = team.roster()
    roster.record("scout", 2, src="test")
    roster.contain("SCOUT-2", "SENTINELLA", "runaway spend", "/evidence")
    roster.record("analista", 1, src="test")
    roster.contain("ANALISTA-1", "DOTTORE", "credit", "/evidence")
    team.up("ANALISTA-1")  # alive while held: still not the panel's to lift
    for session in ("SCOUT-2", "ANALISTA-1"):
        code, answer = team.run("start", session, capsys=capsys)
        assert (code, answer["error"]) == (111, "agent_contained")
        assert team.roster().is_contained(session)
    assert team.roster().load()["agents"]["SCOUT-2"]["contained_by"] == "SENTINELLA"
    assert team.spawns() == []


def test_start_of_a_running_agent_is_already_running(team, capsys):
    team.up("ASSISTENTE")
    assert team.run("start", "ASSISTENTE", capsys=capsys) == (
        0, {"ok": True, "op": "start", "session": "ASSISTENTE", "result": "already_running"})
    assert team.spawns() == []


def test_start_brings_back_known_instances_and_never_scales_up(team, capsys):
    code, answer = team.run("start", "SCOUT-3", capsys=capsys)
    assert (code, answer["error"]) == (101, "agent_control_refused")
    team.roster().record("scout", 3, src="test")
    assert team.run("start", "SCOUT-3", capsys=capsys)[1]["result"] == "started"
    assert team.run("start", "CLOSER-2", capsys=capsys)[0] == 101


def test_start_refusals_leave_the_users_hold_in_place(team, capsys):
    team.run("stop", "CLOSER-1", capsys=capsys)
    team.gate_rc.write_text("1")
    assert team.run("start", "CLOSER-1", capsys=capsys)[1]["error"] == "closer_not_consented"
    team.gate_rc.write_text("0")
    team.disk_rc.write_text("3")
    assert team.run("start", "CLOSER-1", capsys=capsys)[0] == 103
    assert team.roster().is_contained("CLOSER-1")
    assert team.spawns() == []


def test_a_closer_gate_that_cannot_answer_answers_no(team, capsys, tmp_path):
    team.tool.APPLY_GATE = tmp_path / "missing.py"
    assert team.run("start", "CLOSER-1", capsys=capsys)[1]["error"] == "closer_not_consented"


def test_a_start_that_leaves_no_session_is_a_failure(team, capsys, monkeypatch):
    monkeypatch.setenv("FAKE_START_FAILS", "1")
    code, answer = team.run("start", "CAPITANO", capsys=capsys)
    assert (code, answer["error"]) == (105, "agent_start_failed")


# ── Riavvia ─────────────────────────────────────────────────────────────────
def test_restart_kills_and_starts_a_running_agent(team, capsys):
    team.up("SENTINELLA")
    assert team.run("restart", "SENTINELLA", capsys=capsys)[1]["result"] == "restarted"
    assert team.alive("SENTINELLA") and team.spawns() == ["desktop-panel sentinella"]


def test_restart_refuses_an_agent_that_is_down_or_held(team, capsys):
    assert team.run("restart", "SCOUT-1", capsys=capsys)[1]["error"] == "agent_not_running"
    team.up("SCOUT-1")
    team.roster().record("scout", 1, src="test")
    team.roster().contain("SCOUT-1", "user", "x", "y")
    assert team.run("restart", "SCOUT-1", capsys=capsys)[0] == 107
    assert team.spawns() == []


# ── the team stopped or paused (N2) ─────────────────────────────────────────
def test_with_the_team_stopped_by_the_user_start_starts_that_one_agent(team, capsys):
    (team.home / ".team-halted.flag").write_text("halted_by=user\n")
    assert team.run("start", "SCOUT-1", capsys=capsys)[1]["result"] == "started"
    assert (team.home / ".team-halted.flag").exists()


def test_with_the_team_paused_start_and_restart_are_refused(team, capsys):
    team.run("pause", "--for-hours", "2", capsys=capsys)
    assert team.run("start", "SCOUT-1", capsys=capsys) [1]["error"] == "team_paused"
    team.up("CAPITANO")
    code, answer = team.run("restart", "CAPITANO", capsys=capsys)
    assert (code, answer["error"]) == (112, "team_paused")
    assert team.alive("CAPITANO") and team.spawns() == []


# ── Pausa e Riprendi ────────────────────────────────────────────────────────
def _flag(team):
    return json.loads((team.home / ".team-standby.flag").read_text())


def test_pause_writes_a_standby_with_its_exit_condition(team, capsys):
    before = datetime.now(timezone.utc)
    assert team.run("pause", "--for-hours", "4", capsys=capsys)[1]["result"] == "paused"
    flag = _flag(team)
    until = datetime.fromisoformat(flag["until"])
    assert timedelta(hours=4) - timedelta(seconds=5) <= until - before <= timedelta(hours=4, seconds=5)
    assert flag["requested_by"] == "user" and flag["reason"] == "paused by the user from the app"
    assert team.run("pause", "--wake-on-weekly", capsys=capsys)[1]["result"] == "already_paused"
    assert _flag(team)["until"] == flag["until"]


def test_pause_until_the_weekly_reset(team, capsys):
    team.run("pause", "--wake-on-weekly", capsys=capsys)
    assert _flag(team)["wake_on"] == {"weekly_below": 100.0} and _flag(team)["until"] is None


def test_pause_until_an_instant_in_utc(team, capsys):
    until = (datetime.now(timezone.utc) + timedelta(hours=10)).replace(microsecond=0)
    team.run("pause", "--until", until.isoformat().replace("+00:00", "Z"), capsys=capsys)
    assert datetime.fromisoformat(_flag(team)["until"]) == until


@pytest.mark.parametrize("argv", [
    ("pause",),
    ("pause", "--for-hours", "0"),
    ("pause", "--for-hours", "169"),
    ("pause", "--for-hours", "2", "--wake-on-weekly"),
    ("pause", "--until", "2020-01-01T00:00:00Z"),
    ("pause", "--until", (datetime.now(timezone.utc) + timedelta(days=8)).isoformat()),
    ("pause", "--until", (datetime.now() + timedelta(hours=2)).replace(tzinfo=None).isoformat()),
    ("pause", "--until", "tomorrow"),
])
def test_a_pause_without_a_valid_exit_condition_is_not_written(team, capsys, argv):
    code, answer = team.run(*argv, capsys=capsys)
    assert (code, answer["error"]) == (100, "agent_control_invalid")
    assert not (team.home / ".team-standby.flag").exists()


def test_resume_leaves_standby(team, capsys):
    assert team.run("resume", capsys=capsys)[1]["result"] == "not_paused"
    team.run("pause", "--for-hours", "1", capsys=capsys)
    assert team.run("resume", capsys=capsys)[1]["result"] == "resumed"
    assert not (team.home / ".team-standby.flag").exists()


def test_resume_of_a_team_the_user_stopped_is_refused_and_changes_nothing(team, capsys):
    team.run("pause", "--for-hours", "1", capsys=capsys)
    (team.home / ".team-halted.flag").write_text("halted_by=user\n")
    code, answer = team.run("resume", capsys=capsys)
    assert (code, answer["error"]) == (108, "team_halted")
    assert (team.home / ".team-standby.flag").exists()


# ── the closed request ──────────────────────────────────────────────────────
@pytest.mark.parametrize("argv", [
    ("stop",),
    ("stop", "scout-1"),
    ("stop", "SCOUT-1;rm"),
    ("stop", "SCOUT-1", "please"),
    ("start", "SCOUT-01"),
    ("send", "SCOUT-1", "hello"),
    ("restart", "--help"),
    ("stop", "SCOUT-1", "--force"),
])
def test_anything_outside_the_grammar_is_invalid(team, capsys, argv):
    team.up("SCOUT-1")
    code, answer = team.run(*argv, capsys=capsys)
    assert (code, answer["error"]) in {(100, "agent_control_invalid"), (101, "agent_control_refused")}
    assert team.alive("SCOUT-1") and team.spawns() == []


@pytest.mark.parametrize("session", ["DOTTORE", "MANTENITORE", "SENTINELLA-WORKER", "DOCTOR-WATCHDOG", "HQ-MASTER"])
def test_sessions_without_actions_are_refused(team, capsys, session):
    team.up(session)
    for op in ("start", "stop", "restart"):
        code, answer = team.run(op, session, capsys=capsys)
        assert (code, answer["error"]) == (101, "agent_control_refused")
    assert team.alive(session)


def test_a_reviewer_is_never_started(team, capsys):
    assert team.run("start", "CRITICO-S2", capsys=capsys)[0] == 101


def test_one_action_at_a_time(team, capsys):
    lock = team.home / "locks" / "agent-control.lock"
    lock.parent.mkdir(parents=True)
    with lock.open("a") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        team.up("SCOUT-1")
        code, answer = team.run("stop", "SCOUT-1", capsys=capsys)
    assert (code, answer["error"]) == (102, "agent_control_busy")
    assert team.alive("SCOUT-1")


def test_the_exit_codes_are_closed_distinct_and_clear_of_2_and_70(team):
    codes = list(team.tool.EXIT.values())
    assert len(codes) == len(set(codes))
    assert all(100 <= code <= 127 for code in codes)


# ── the stdin channel reads, and only reads ─────────────────────────────────
def _stdin(team, monkeypatch, capsys, request):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(request) + "\n"))
    assert team.tool.main([]) == 0
    return json.loads(capsys.readouterr().out)


@pytest.mark.parametrize("request_", [
    {"op": "stop", "name": "SCOUT-1"}, {"op": "start", "name": "SCOUT-2"},
    {"op": "restart", "name": "SCOUT-1"}, {"op": "pause"}, {"op": "resume"},
])
def test_on_stdin_an_action_is_refused(team, capsys, monkeypatch, request_):
    team.up("SCOUT-1")
    assert _stdin(team, monkeypatch, capsys, request_) == {"ok": False, "error": "agents_unavailable"}
    assert team.alive("SCOUT-1") and team.spawns() == []
    assert not (team.home / ".team-standby.flag").exists()


def test_on_stdin_the_list_reads(team, capsys, monkeypatch):
    team.up("CAPITANO", "SCOUT-1")
    team.tool.AGENT_STATE = team.tmp / "nonexistent.py"
    answer = _stdin(team, monkeypatch, capsys, {"op": "list"})
    assert answer["ok"] and answer["data"]["states"] is False
    assert [item["name"] for item in answer["data"]["items"]] == ["CAPITANO", "SCOUT-1"]


def test_the_team_read_tells_stopped_paused_and_held(team, capsys):
    team.run("stop", "SCOUT-1", capsys=capsys)
    team.roster().record("scout", 2, src="test")
    team.roster().contain("SCOUT-2", "SENTINELLA", "x", "y")
    team.run("pause", "--wake-on-weekly", capsys=capsys)
    (team.home / ".team-halted.flag").write_text("x")
    data = team.run("team", capsys=capsys)[1]["data"]
    assert data["halted"] is True
    assert data["standby"] == {"state": "active", "until": None, "weekly_reset": True}
    assert data["held"] == [{"session": "SCOUT-1", "by_user": True}, {"session": "SCOUT-2", "by_user": False}]


# ── the journal (N3) ────────────────────────────────────────────────────────
def test_the_journal_rotates_and_never_grows_without_end(team, capsys):
    log = team.home / "logs" / "agent-control.jsonl"
    log.parent.mkdir(parents=True)
    log.write_text("x" * team.tool.JOURNAL_MAX_BYTES)
    team.run("stop", "SCOUT-1", capsys=capsys)
    assert (log.parent / "agent-control.jsonl.1").stat().st_size == team.tool.JOURNAL_MAX_BYTES
    assert len(team.journal()) == 1


# ── the grammar and the launcher ────────────────────────────────────────────
def test_every_role_the_panel_starts_is_one_start_agent_knows(team):
    text = START_AGENT.read_text(encoding="utf-8")
    body = text[text.index("get_agent_info()"):]
    body = body[:body.index("\n}\n")]
    known = set(re.findall(r"^\s*([a-z]+)\)", body, re.M))
    roles = set(team.tool.SINGLETONS.values()) | set(team.tool.NUMBERED.values())
    assert roles <= known, roles - known


def test_the_watchdog_sees_the_users_stop_as_contained(team, capsys):
    # agent-watchdog.sh asks exactly this (agent_is_contained) before it
    # brings a core role back and before the 12 h refresh.
    import subprocess
    team.up("CAPITANO")
    team.run("stop", "CAPITANO", capsys=capsys)
    roster_tool = ROOT / "shared" / "skills" / "team_roster.py"
    assert subprocess.run([sys.executable, str(roster_tool), "is-contained", "CAPITANO"]).returncode == 0
    team.run("start", "CAPITANO", capsys=capsys)
    assert subprocess.run([sys.executable, str(roster_tool), "is-contained", "CAPITANO"]).returncode != 0
