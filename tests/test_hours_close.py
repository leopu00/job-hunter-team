"""At the close of the working window the workers stop in order, and are told to resume at the opening (a round on Linux: 11 sessions
alive at 18:06 after an 18:00 close). Fake clock, fake tmux."""
import sys
from pathlib import Path
from types import SimpleNamespace

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import hours_close as hc  # noqa: E402

TEAM = ["CAPITANO", "SENTINELLA", "ASSISTENTE", "MENTOR", "DOTTORE", "SENTINELLA-WORKER", "SCOUT-1", "SCOUT-2", "ANALISTA-1", "SCORER-1"]
WORKERS = ["SCOUT-1", "SCOUT-2", "ANALISTA-1", "SCORER-1"]


def _world(busy=()):
    sent, closed = [], []
    world = SimpleNamespace(sent=sent, closed=closed, busy=set(busy), alive=list(TEAM))
    world.send = lambda s, t: sent.append((s, t)) or True
    world.kill = lambda s: closed.append(s) or world.alive.remove(s) or True
    world.panes = {}
    world.idle = lambda s: None if s in world.busy else world.panes.get(s, "same pane")
    return world


def _look(world, run, now, outside=True):
    return hc.step(SimpleNamespace(), run, outside=outside, sessions=list(world.alive), idle=world.idle, send=world.send,
                   kill=world.kill, now=now)


def test_the_close_tells_each_worker_once_and_touches_nobody_else():
    world, run = _world(), SimpleNamespace(state={})
    out = _look(world, run, 18 * 3600 + 60)
    assert sorted(out["told"]) == sorted(WORKERS) and out["closed"] == []
    assert {s for s, _ in world.sent} == set(WORKERS), "the Captain, the Assistente, the Mentor, the Dottore and the sensor are not told"
    assert "Finish the task you are on" in world.sent[0][1]
    world.sent.clear()
    assert _look(world, run, 18 * 3600 + 120)["told"] == [] and world.sent == [], "once"


def test_an_idle_worker_is_closed_when_its_pane_is_the_same_at_two_looks_a_busy_one_is_left_to_finish():
    world, run = _world(busy={"SCOUT-2"}), SimpleNamespace(state={})
    start = 18 * 3600
    _look(world, run, start)
    assert _look(world, run, start + 60)["closed"] == [], "not before IDLE_AFTER_SEC: the message has to be read"
    assert _look(world, run, start + 300)["closed"] == [], "the first look that sees it idle only takes note of the pane"
    out = _look(world, run, start + 600)
    assert sorted(out["closed"]) == ["ANALISTA-1", "SCORER-1", "SCOUT-1"] and "SCOUT-2" in world.alive, "never cut in the middle of a turn"
    world.busy.clear()
    assert _look(world, run, start + 900)["closed"] == []
    assert _look(world, run, start + 1200)["closed"] == ["SCOUT-2"]
    assert [s for s in world.alive if hc.WORKER.match(s)] == []


def test_a_pane_that_changes_between_two_looks_is_a_worker_at_work_even_with_no_busy_line():
    world, run = _world(), SimpleNamespace(state={})
    start = 18 * 3600
    _look(world, run, start)
    for step, pane in enumerate(("a", "b", "c", "d")):
        world.panes = {w: pane for w in WORKERS}
        assert _look(world, run, start + 300 * (step + 1))["closed"] == []
    assert world.closed == []


def test_a_worker_that_stays_busy_is_told_again_once_and_never_closed_busy():
    world, run = _world(busy=set(WORKERS)), SimpleNamespace(state={})
    start = 18 * 3600
    _look(world, run, start)
    world.sent.clear()
    _look(world, run, start + hc.RESEND_AFTER_SEC + 5)
    assert sorted(s for s, _ in world.sent) == sorted(WORKERS)
    world.sent.clear()
    _look(world, run, start + hc.RESEND_AFTER_SEC + 400)
    assert world.sent == [] and world.closed == []


def test_the_opening_tells_the_workers_still_alive_to_resume_and_forgets_the_rest():
    world, run = _world(busy={"SCOUT-2"}), SimpleNamespace(state={})
    start = 18 * 3600
    _look(world, run, start)
    _look(world, run, start + 300)
    _look(world, run, start + 600)
    world.sent.clear()
    out = _look(world, run, 8 * 3600 + 86400, outside=False)
    assert out["resumed"] == ["SCOUT-2"] and world.sent == [("SCOUT-2", hc.RESUME_TEXT)]
    assert run.state["hours_close"]["told"] == {}
    world.sent.clear()
    assert _look(world, run, 8 * 3600 + 86460, outside=False)["resumed"] == [] and world.sent == []


def test_inside_the_window_nothing_is_told_or_closed():
    world, run = _world(), SimpleNamespace(state={})
    out = _look(world, run, 10 * 3600, outside=False)
    assert out == {"told": [], "closed": [], "resumed": []} and world.sent == [] and world.closed == []


def test_a_send_that_fails_is_tried_again_at_the_next_look_and_a_broken_look_never_raises():
    world, run = _world(), SimpleNamespace(state={})
    world.send = lambda s, t: False
    assert _look(world, run, 100)["told"] == []
    world.send = lambda s, t: world.sent.append((s, t)) or True
    assert sorted(_look(world, run, 160)["told"]) == sorted(WORKERS)
    assert hc.step(SimpleNamespace(), SimpleNamespace(), outside=True, sessions=WORKERS) == {"told": [], "closed": [], "resumed": []}


def test_the_spending_override_and_an_unreadable_schedule_never_close_the_team():
    assert hc._outside(None, SimpleNamespace(_bi_on=True, within_hours=False)) is False
    assert hc._outside(None, SimpleNamespace(_bi_on=False, within_hours=False)) is True


def test_the_bridge_loop_looks_at_the_hours_after_the_memory():
    text = (SKILLS / "sentinel_loop.py").read_text(encoding="utf-8")
    assert "    ram_guard.step(api, run)\n    hours_close.step(api, run)\n" in text


def test_the_schedule_of_the_person_decides_with_a_fake_clock(monkeypatch):
    import working_hours
    from datetime import datetime, timezone
    window = lambda now=None, config=None: 9 <= now.hour < 18  # noqa: E731
    clock = {"now": datetime(2026, 11, 18, 17, 59, tzinfo=timezone.utc)}
    monkeypatch.setattr(working_hours, "is_within_working_hours", lambda now=None, config=None: window(clock["now"]))
    run = SimpleNamespace(_bi_on=False, within_hours=True)
    assert hc._outside(None, run) is False
    clock["now"] = datetime(2026, 11, 18, 18, 0, tzinfo=timezone.utc)
    assert hc._outside(None, run) is True, "the window closed at 18:00 and the bridge's own phase had not said so"


# ── the panes of the harnesses as they are drawn: a turn running is never an idle pane (the close would cut it in the middle) ──
import subprocess  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pi_screens  # noqa: E402

CODEX_BUSY = "• Working (16s • esc to interrupt)\n\n› \n\n  gpt-5.6-sol · ~/scout-1\n"
CODEX_DONE = "• Done: saved 3 positions.\n\n› Ask Codex to do anything\n\n  gpt-5.6-sol · ~/scout-1\n"
CLAUDE_BUSY = "✻ Pondering… (12s · ↑ 1.2k tokens · esc to interrupt)\n\n❯ \n"


def _pane(monkeypatch, text):
    monkeypatch.setattr(hc.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=text, stderr=""))
    return hc._idle("SCOUT-1")


def test_a_pi_pane_with_a_turn_running_is_busy_and_a_finished_one_is_idle(monkeypatch):
    assert _pane(monkeypatch, pi_screens.screen(busy=True)) is None, "«⠹ Working» on the top rule is a turn running"
    assert _pane(monkeypatch, pi_screens.screen(top=pi_screens.RETRYING)) is None, "a retry is a turn that is not over"
    assert _pane(monkeypatch, pi_screens.screen(above=["done: 3 positions saved"])), "the composer between two rules, nothing running"


def test_a_codex_and_a_claude_pane_with_a_turn_running_are_busy_and_a_finished_one_is_idle(monkeypatch):
    assert _pane(monkeypatch, CODEX_BUSY) is None
    assert _pane(monkeypatch, CLAUDE_BUSY) is None
    assert _pane(monkeypatch, CODEX_DONE)
