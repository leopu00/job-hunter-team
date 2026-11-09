"""A position that reaches a role's queue wakes ONE waiting agent of that role (JHT-T297).

Without it an Analista that drained the queue sits idle while new positions pile up, and the Scorers behind it
starve in throttle. The hand-off stays the database (the INSERT, the `checked`
flip); the event only wakes whoever is waiting, and never twice for the same wait.

The tests talk to `event_wake.wake()` with a fake team (sessions, logs verdicts, throttle flags, sender), to the
real throttle engine for the early wake, and to the real writers (`db_insert`, `db_update`) for the hook. No tmux
and no agent log is touched.
"""
import argparse
import json
import os
import sqlite3
import sys
import threading
import time
from pathlib import Path

import pytest

from test_throttle_engine import (  # noqa: F401  (le fixture si importano per nome)
    SKILLS_DIR, T0, _freeze_marker, _jobs_db, _load, _pacing_report, burn, eng, events, home, set_config,
)

sys.path.insert(0, str(SKILLS_DIR))
import event_wake as ew  # noqa: E402

IDLE_SINCE = T0 - 600


class Team:
    """A fake team: sessions of a role, their log verdicts, their throttle flags, what was sent and pulled."""

    def __init__(self, home, *agents, queue=3):
        self.home, self.queue_n = home, queue
        self.verdicts = {a: {"state": "idle", "since": IDLE_SINCE} for a in agents}
        self.flags, self.sent, self.pulled, self.paused_set = {}, [], [], set()
        self.hold, self.send_ok, self.blocked = None, True, None

    def wake(self, role="analista", now=T0):
        return ew.wake(
            role, now=now, home=self.home,
            queue=lambda r: self.queue_n,
            sessions=lambda r: {a.upper(): 1.0 for a in self.verdicts if a.startswith(r + "-")},
            derive=lambda uid, created, n, h: self.verdicts[uid],
            paused=lambda session, h: session.lower() in self.paused_set,
            send=self._send, blocked=lambda h, n: self.blocked,
            flag_of=lambda uid: self.flags.get(uid), pull=self._pull,
            hold=lambda n: self.hold)

    def _send(self, session, text):
        self.sent.append((session, text))
        return self.send_ok

    def _pull(self, uid, now):
        self.pulled.append(uid)
        return {"pulled": True, "left_sec": 540}

    def worked(self, uid, at):
        self.verdicts[uid] = {"state": "idle", "since": at}


@pytest.fixture
def team_home(tmp_path):
    return tmp_path


def test_an_idle_analista_is_sent_the_wake_with_the_queue_and_the_command(team_home):
    team = Team(team_home, "analista-1", queue=7)
    out = team.wake()
    assert out["woken"] == "analista-1" and out["via"] == "message"
    (session, text), = team.sent
    assert session == "ANALISTA-1"
    assert text.startswith("[@system -> @analista-1] [WAKE] 7 new position(s)")
    assert "db_query.py next-for-analista" in text and "no reply, no ACK" in text


def test_a_scorer_is_woken_for_checked_positions_and_an_analista_is_not(team_home):
    team = Team(team_home, "analista-1", "scorer-1")
    out = team.wake("scorer")
    assert out["woken"] == "scorer-1"
    assert "next-for-scorer" in team.sent[0][1] and "wait for a score" in team.sent[0][1]


def test_a_busy_blocked_or_asking_agent_is_left_alone(team_home):
    team = Team(team_home, "analista-1", "analista-2", "analista-3")
    team.verdicts["analista-1"] = {"state": "lavora"}
    team.verdicts["analista-2"] = {"state": "bloccato", "reason": "usage_limit"}
    team.verdicts["analista-3"] = {"state": "aspetta_umano"}
    out = team.wake()
    assert out["woken"] is None and out["why"] == "nobody_waiting" and team.sent == []


def test_an_agent_in_a_throttle_gets_its_deadline_brought_forward_not_a_message(team_home):
    team = Team(team_home, "analista-1")
    team.flags["analista-1"] = {"state": "IN_THROTTLE", "since": T0 - 60, "until": T0 + 540}
    out = team.wake()
    assert (out["woken"], out["via"], out["left_sec"]) == ("analista-1", "throttle", 540)
    assert team.pulled == ["analista-1"] and team.sent == []


def test_a_throttle_about_to_expire_or_an_agent_just_woken_by_the_engine_is_not_touched(team_home):
    team = Team(team_home, "analista-1", "analista-2")
    team.flags["analista-1"] = {"state": "IN_THROTTLE", "since": T0 - 600, "until": T0 + 5}
    team.flags["analista-2"] = {"state": "NOTIFIED", "since": T0 - 2}
    out = team.wake()
    assert out["why"] == "nobody_waiting" and team.pulled == [] and team.sent == []


def test_the_throttle_the_engine_refuses_to_shorten_is_a_decision_not_a_wake(team_home):
    team = Team(team_home, "analista-1")
    team.flags["analista-1"] = {"state": "IN_THROTTLE", "since": T0 - 60, "until": T0 + 540}
    out = ew.wake("analista", now=T0, home=team_home, queue=lambda r: 2,
                  sessions=lambda r: {"ANALISTA-1": 1.0}, derive=lambda *a: {"state": "idle"},
                  paused=lambda *a: False, send=team._send, blocked=lambda h, n: None,
                  flag_of=lambda uid: team.flags[uid], hold=lambda n: None,
                  pull=lambda uid, now: {"pulled": False, "reason": "daily_halt"})
    assert out["why"] == "throttle_kept" and out["detail"] == "daily_halt" and out["woken"] is None


def test_the_same_wait_is_never_woken_twice_and_the_second_event_goes_to_the_next_agent(team_home):
    team = Team(team_home, "analista-1", "analista-2")
    first, second, third = team.wake(now=T0), team.wake(now=T0 + 2), team.wake(now=T0 + 4)
    assert (first["woken"], second["woken"], third["woken"]) == ("analista-1", "analista-2", None)
    assert third["why"] == "nobody_waiting" and len(team.sent) == 2


def test_a_burst_of_events_wakes_each_idle_agent_once_and_no_more(team_home):
    team = Team(team_home, "analista-1", "analista-2")
    results = [team.wake(now=T0 + i) for i in range(25)]  # a Scout inserts 25 positions in a row
    assert len(team.sent) == 2 and sum(1 for r in results if r["woken"]) == 2


def test_an_agent_that_worked_since_the_wake_can_be_woken_again(team_home):
    team = Team(team_home, "analista-1")
    assert team.wake(now=T0)["woken"] == "analista-1"
    team.worked("analista-1", at=T0 + 90)  # it took the wake, did a turn and is idle again
    assert team.wake(now=T0 + 100)["woken"] == "analista-1" and len(team.sent) == 2


def test_a_wake_nobody_answered_is_retried_only_after_the_retry_window(team_home):
    team = Team(team_home, "analista-1")
    team.wake(now=T0)
    assert team.wake(now=T0 + ew.RETRY_SEC - 1)["woken"] is None
    assert team.wake(now=T0 + ew.RETRY_SEC + 1)["woken"] == "analista-1"
    assert len(team.sent) == 2


def test_a_send_that_fails_keeps_nothing_reserved_so_the_next_event_tries_again(team_home):
    team = Team(team_home, "analista-1")
    team.send_ok = False
    assert team.wake(now=T0)["why"] == "send_failed"
    team.send_ok = True
    assert team.wake(now=T0 + 1)["woken"] == "analista-1"
    ledger = json.loads((team_home / "state" / "event-wakes.json").read_text())
    assert len(ledger["sent"]["analista"]) == 1


@pytest.mark.parametrize("why,setup", [
    ("queue_empty", lambda t: setattr(t, "queue_n", 0)),
    ("team_halted", lambda t: setattr(t, "blocked", "team_halted")),
    ("standby", lambda t: setattr(t, "blocked", "standby")),
    ("budget_hold", lambda t: setattr(t, "hold", "after-freeze")),
])
def test_no_wake_when_the_queue_is_empty_the_team_is_stopped_or_the_budget_is_held(team_home, why, setup):
    team = Team(team_home, "analista-1")
    setup(team)
    out = team.wake()
    assert out["why"] == why and out["woken"] is None and team.sent == []


def test_a_paused_agent_is_skipped_and_the_next_one_is_woken(team_home):
    team = Team(team_home, "analista-1", "analista-2")
    team.paused_set.add("analista-1")
    assert team.wake()["woken"] == "analista-2"


def test_the_hourly_valve_stops_a_runaway_and_reopens_after_the_hour(team_home):
    team = Team(team_home, "analista-1")
    ledger = ew.Ledger(team_home)
    with ledger as l:
        l.write({"agents": {}, "sent": {"analista": [T0 - 10 - i for i in range(ew.HOURLY_CAP)]}})
    assert team.wake(now=T0)["why"] == "hourly_cap" and team.sent == []
    assert team.wake(now=T0 + 3600)["woken"] == "analista-1"


def test_no_session_of_the_role_means_nothing_to_wake(team_home):
    team = Team(team_home, "scorer-1")
    assert team.wake("analista")["why"] == "no_session"


def test_two_events_at_the_same_instant_wake_a_lone_agent_once(team_home):
    team = Team(team_home, "analista-1")
    out, barrier = [], threading.Barrier(2)

    def one():
        barrier.wait()
        out.append(team.wake(now=T0))

    threads = [threading.Thread(target=one) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(r["woken"] or "" for r in out) == ["", "analista-1"] and len(team.sent) == 1


def test_every_decision_is_one_line_of_the_log(team_home):
    team = Team(team_home, "analista-1")
    team.wake(now=T0)
    team.queue_n = 0
    team.wake(now=T0 + 1)
    rows = [json.loads(line) for line in (team_home / "logs" / "event-wakes.jsonl").read_text().splitlines()]
    assert [(r["why"], r["woken"]) for r in rows] == [("woken", "analista-1"), ("queue_empty", None)]


# ── the real checks that sit behind the injected ones ───────────────────────

def test_the_halt_flags_and_the_standby_are_read_from_the_home(tmp_path, monkeypatch):
    assert ew.blocked_reason(tmp_path, T0) is None
    (tmp_path / ".weekly-halt.flag").write_text("x")
    assert ew.blocked_reason(tmp_path, T0) == "team_halted"
    (tmp_path / ".weekly-halt.flag").unlink()
    (tmp_path / ".team-standby.flag").write_text(json.dumps(
        {"since": int(T0), "until": None, "wake_on": {"weekly_below": 100}, "reason": "x", "requested_by": "user"}))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    assert ew.blocked_reason(tmp_path, T0) == "standby"


def test_sessions_of_matches_only_the_agents_of_the_role_whatever_the_case():
    class Run:
        stdout = "ANALISTA-1\t100\nanalista-12\t101\nanalista-1-extra\t102\nSCORER-1\t103\nmy-analista-2\t104\n"
    found = ew.sessions_of("analista", runner=lambda *a, **k: Run())
    assert found == {"ANALISTA-1": 100.0, "analista-12": 101.0}


def test_notify_starts_a_wake_for_the_role_of_the_state_and_nothing_else(monkeypatch):
    started = []
    sessions = lambda role: {"X": 1.0} if role == "analista" else {}
    assert ew.notify("new", spawn=started.append, sessions=sessions, environ={}) is True
    assert ew.notify("checked", spawn=started.append, sessions=sessions, environ={}) is False  # no scorer session
    assert ew.notify("scored", spawn=started.append, sessions=sessions, environ={}) is False
    assert ew.notify("new", spawn=started.append, sessions=sessions, environ={ew.DISABLE_ENV: "0"}) is False
    assert started == ["analista"]


def test_notify_never_raises_into_the_writer():
    def boom(*a):
        raise OSError("tmux gone")
    assert ew.notify("new", spawn=boom, sessions=lambda r: {"X": 1.0}, environ={}) is False
    assert ew.notify("new", sessions=boom, environ={}) is False


# ── the early wake in the real throttle engine ──────────────────────────────

def _throttled(home, monkeypatch, agent="analista-1", seconds=660):
    set_config(home, **{agent: seconds})
    _jobs_db(home, monkeypatch)
    res = eng.register(agent, now=T0)
    assert res["armed"] and res["applied_sec"] == seconds
    return res


def test_the_engine_brings_a_throttle_forward_and_the_tick_wakes_it_as_at_expiry(home, monkeypatch):
    _throttled(home, monkeypatch)
    out = ew.pull_forward("analista-1", T0 + 30, eng)
    assert out == {"agent": "analista-1", "pulled": True, "left_sec": 630}
    assert eng.get_flag("analista-1")["until"] == int(T0 + 30)
    assert events("woken_early")[-1]["left_sec"] == 630
    assert eng.pending_until("analista-1", now=T0 + 31) is None, "a shim blocked on the throttle must be free to leave"


def test_a_throttle_already_due_or_not_a_throttle_is_not_pulled(home, monkeypatch):
    _throttled(home, monkeypatch)
    assert ew.pull_forward("analista-1", T0 + 700, eng)["reason"] == "already_due"
    assert ew.pull_forward("scorer-9", T0, eng)["reason"] == "not_in_throttle"


def test_the_engine_does_not_shorten_a_throttle_that_is_a_budget_brake(home, monkeypatch):
    _throttled(home, monkeypatch)
    _freeze_marker().mark("freeze", now=T0 - 60)
    out = ew.pull_forward("analista-1", T0 + 30, eng)
    assert out["pulled"] is False and out["reason"] == "after-freeze"
    assert eng.get_flag("analista-1")["until"] == int(T0 + 660)
    assert events("woken_early_refused")[-1]["hold"] == "after-freeze"


def test_the_engine_does_not_shorten_the_daily_halt_timer(home, monkeypatch):
    _throttled(home, monkeypatch)
    state = eng.read_flags()
    state["agents"]["analista-1"]["reason"] = "daily-halt"
    eng.write_flags(state)
    assert ew.pull_forward("analista-1", T0 + 30, eng)["reason"] == "daily_halt"


def test_the_users_burn_lifts_the_hold_for_the_early_wake(home, burn, monkeypatch):
    _throttled(home, monkeypatch)
    _freeze_marker().mark("freeze", now=T0 - 60)
    burn.grant(hours=2, reason="burst until 23:00", pace_cap_sec=60)
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_event_wake", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)
    assert ew.pull_forward("analista-1", T0 + 30, eng)["pulled"] is True


# ── the writers call the hook, and only when a position enters a queue ──────

@pytest.fixture
def writers(tmp_path, monkeypatch):
    """`db_insert` and `db_update` on a database of their own, with the hook recording instead of spawning."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    for name in ("_db", "db_insert", "db_update", "event_wake"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    import _db
    import db_insert
    import db_update
    import event_wake
    monkeypatch.setattr(_db, "DB_PATH", str(tmp_path / "jobs.db"))
    conn = _db.get_db()
    _db.ensure_schema(conn)
    conn.close()
    calls = []
    monkeypatch.setattr(event_wake, "notify", lambda state, **kw: calls.append(state) or True)
    return db_insert, db_update, calls


def _position_args(db_insert, url):
    return db_insert.build_parser().parse_args(
        ["position", "--title", "Engineer", "--company", "Acme", "--url", url, "--source", "test", "--found-by", "scout-1"])


def _update(db_update, monkeypatch, pid, *extra):
    monkeypatch.setattr(sys, "argv", ["db_update.py", "position", str(pid), *extra])
    db_update.main()


def test_an_insert_that_lands_in_the_analista_queue_notifies_and_a_duplicate_does_not(writers):
    db_insert, db_update, calls = writers
    db_insert.insert_position(_position_args(db_insert, "https://example.invalid/1"))
    assert calls == ["new"]
    with pytest.raises(SystemExit):
        db_insert.insert_position(_position_args(db_insert, "https://example.invalid/1"))
    assert calls == ["new"], "a refused duplicate is not new work"


def test_a_status_change_is_told_to_the_hook_and_a_note_only_update_is_not(writers, monkeypatch):
    db_insert, db_update, calls = writers
    db_insert.insert_position(_position_args(db_insert, "https://example.invalid/2"))
    calls.clear()
    _update(db_update, monkeypatch, 1, "--notes", "read the JD")
    assert calls == []
    _update(db_update, monkeypatch, 1, "--status", "excluded", "--notes", "EXCLUDED: [GEO] far")
    assert calls == ["excluded"], "the hook is told every transition; only new and checked map to a role"
    assert ew.STATE_TO_ROLE.get("excluded") is None
    _update(db_update, monkeypatch, 1, "--status", "excluded", "--notes", "again")
    assert calls == ["excluded"], "the same status twice is not a transition"


def test_the_analysts_flip_to_checked_is_told_to_the_hook(writers, monkeypatch):
    db_insert, db_update, calls = writers
    db_insert.insert_position(_position_args(db_insert, "https://example.invalid/3"))
    calls.clear()
    _update(db_update, monkeypatch, 1, "--status", "checked", "--loc-city", "Milan", "--loc-country", "Italy")
    assert calls == ["checked"] and ew.STATE_TO_ROLE["checked"] == "scorer"


def test_the_writers_import_the_hook_and_never_depend_on_it_to_succeed():
    for name in ("db_insert.py", "db_update.py"):
        text = (SKILLS_DIR / name).read_text(encoding="utf-8")
        assert "import event_wake" in text and "event_wake.notify(" in text


# ── no side effect on the tests that run after these ────────────────────────

def test_no_test_of_this_file_writes_the_process_environment_by_hand():
    """A test that sets or deletes a variable of the process by hand (instead of monkeypatch) breaks the files that run
    after it: the isolated JHT_HOME of the suite once went missing this way, and the pipeline tests fell back to the
    repository's own data."""
    import ast
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    writes = [node.lineno for node in ast.walk(tree)
              if isinstance(node, (ast.Assign, ast.Delete, ast.AugAssign))
              for target in (node.targets if isinstance(node, (ast.Assign, ast.Delete)) else [node.target])
              if isinstance(target, ast.Subscript) and ast.unparse(target.value) == "os.environ"]
    assert writes == []


def test_the_suite_keeps_the_wake_off_so_a_test_never_reaches_a_real_session():
    assert os.environ.get(ew.DISABLE_ENV) == "0"


def test_a_burst_of_inserts_starts_one_wake_per_role(tmp_path):
    started = []
    sessions = lambda role: {"X": 1.0}
    assert ew.notify("new", spawn=started.append, sessions=sessions, environ={}, home=tmp_path) is True
    assert ew.notify("new", spawn=started.append, sessions=sessions, environ={}, home=tmp_path) is False
    assert ew.notify("checked", spawn=started.append, sessions=sessions, environ={}, home=tmp_path) is True  # other role
    stamp = tmp_path / "logs" / ".event-wake-analista.stamp"
    old = time.time() - ew.DEBOUNCE_SEC - 1
    os.utime(stamp, (old, old))
    assert ew.notify("new", spawn=started.append, sessions=sessions, environ={}, home=tmp_path) is True
    assert started == ["analista", "scorer", "analista"]


def test_a_home_that_cannot_be_written_does_not_stop_the_wake(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    started = []
    assert ew.notify("new", spawn=started.append, sessions=lambda r: {"X": 1.0}, environ={}, home=blocker) is True
    assert started == ["analista"]
