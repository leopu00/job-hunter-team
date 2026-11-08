"""Every caller that gave `jht-tmux-send` a deadline used to KILL it at the deadline (TEST 5, 27/10, Capitano).

The transport has deadlines of its own (up to 100 s for a pane that is not at its prompt) and between its paste and
its Enter there is a window: a kill there leaves the paste in the composer with no Enter, and the agent is deaf to
every later message. Each caller below waits as long as it did, gets the same `TimeoutExpired` (so its tick goes on
as before), and now the transport finishes by itself; no second delivery is stacked on a running one; the call
after an overrun first asks the transport to free the composer (`--flush-ours`).

The transport here waits for an explicit release after the caller's deadline. The «old» test of each
caller runs it with the helper switched off, which is the old `subprocess.run(..., timeout)`: the Enter never comes.
That is the counter-proof, written as a test so that the harness is shown to reproduce the defect.
"""
import importlib.util
import json
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import pytest

from controlled_sender import ControlledSender

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the bridges run in the Linux container")

# (id, file, how to call it) — the call returns something falsy/-1/8 when the deadline passes
CALLERS = [
    ("pacing-bridge", ".launcher/pacing-bridge.py", lambda m: m.send_to_capitano("avviso")),
    ("heartbeat-bridge", ".launcher/heartbeat-bridge.py", lambda m: m._send("avviso")),
    ("stepcap-watchdog", ".launcher/stepcap-watchdog.py", lambda m: m.notify_captain("avviso")),
    ("throttle-engine", "shared/skills/throttle_engine.py", lambda m: m.notify_captain("avviso")),
    ("standby", "shared/skills/standby.py", lambda m: m._send("CAPITANO", "avviso")),
    ("soft-pause", "shared/skills/soft_pause_team.py", lambda m: m.send_message("CAPITANO", "avviso")),
    ("application-answers", "shared/skills/application_answers.py", lambda m: m._tmux_send("CAPITANO", "avviso")),
]
IDS = [c[0] for c in CALLERS]


@pytest.fixture()
def world(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sender = ControlledSender(tmp_path)
    sender.install(bin_dir / "jht-tmux-send")
    loaded = []
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    monkeypatch.setenv("PYTHONDONTWRITEBYTECODE", "1")
    monkeypatch.setenv("JHT_TMUX_SEND_WAIT_S", "0.4")
    monkeypatch.setenv("JHT_THROTTLE_ENGINE_NOTIFY_TIMEOUT", "0.4")

    def load(relative):
        path = ROOT / relative
        spec = importlib.util.spec_from_file_location("transport_caller_" + path.stem.replace("-", "_"), path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        loaded.append(module)
        # the helper is shared: its state is per process, so every test starts from none
        return module

    def calls():
        log = tmp_path / "calls.log"
        rows = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
        assert all(row["fixture"] == sender.fixture for row in rows)
        return [" ".join(row["args"]) for row in rows]

    def entered():
        return sorted(p.name for p in tmp_path.glob("entered.*"))

    try:
        yield type("W", (), {"load": staticmethod(load), "calls": staticmethod(calls),
                             "entered": staticmethod(entered), "dir": tmp_path, "sender": sender})
    finally:
        try:
            sender.close()
        finally:
            for module in loaded:
                helper = getattr(module, "_tmux_send_run_module", None)
                if helper:
                    for proc in list(helper._running.values()):
                        proc.wait(timeout=5)


def _wait_for(predicate, seconds=6.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def _wait_for_exit(module):
    """The transport touches `entered` and only then exits: a delivery started before it has exited is, rightly,
    «still running». A test that wants the next round waits for the end of the process, not for its marker."""
    helper = module._tmux_send_run_module
    # `all()` of nothing is true: a helper that did not keep the process would pass at once and the race would
    # come back unseen
    assert helper._running, "the helper keeps the process it started"
    assert _wait_for(lambda: all(proc.poll() is not None for proc in list(helper._running.values()))), "the transport finished"


def _fresh_helper(module):
    """Make the module load the helper afresh, with no overrun or running delivery remembered."""
    module._tmux_send_run_module = None
    module._transport_run([sys.executable, "-c", "pass"], 5)      # loads it (a program that is not a transport: no session)
    helper = module._tmux_send_run_module
    assert helper, "the helper is found from the repo layout"
    helper.reset()
    return helper


@pytest.mark.parametrize("name, relative, call", CALLERS, ids=IDS)
def test_a_transport_that_overruns_is_left_to_finish_and_still_presses_its_enter(world, name, relative, call):
    module = world.load(relative)
    _fresh_helper(module)
    started = time.monotonic()
    result = call(module)
    assert not result or result in (-1, 8), "the caller sees the deadline as before: not delivered"
    assert time.monotonic() - started < 1.3, "it did not wait for the transport"
    assert world.entered() == [], "it was still pasting when the caller stopped waiting"
    world.sender.wait_started()
    world.sender.release_all()
    assert _wait_for(lambda: len(world.entered()) == 1), "nobody killed it: the paste got its Enter"
    _wait_for_exit(module)
    world.sender.wait_exited()


@pytest.mark.parametrize("name, relative, call", CALLERS, ids=IDS)
def test_with_the_old_kill_the_paste_is_left_without_its_enter(world, name, relative, call):
    """The counter-proof: the helper switched off is the old `subprocess.run(timeout)`, and the Enter never comes."""
    module = world.load(relative)
    module._tmux_send_run_module = False
    call(module)
    world.sender.wait_started()
    world.sender.wait_exited()
    world.sender.release_all()
    assert world.entered() == [], "killed between the paste and the Enter: what TEST 5 left in the Capitano's composer"


@pytest.mark.parametrize("name, relative, call", CALLERS, ids=IDS)
def test_a_second_delivery_is_not_stacked_and_the_round_after_frees_the_composer_first(world, name, relative, call):
    module = world.load(relative)
    _fresh_helper(module)
    call(module)
    second = call(module)
    assert not second or second in (-1, 8)
    assert [c for c in world.calls() if not c.startswith("--flush-ours")] == [c for c in world.calls()[:1]], \
        "a single delivery was started"
    world.sender.wait_started()
    world.sender.release_all()
    assert _wait_for(lambda: len(world.entered()) == 1)
    _wait_for_exit(module)
    world.sender.wait_exited()
    module_wait = 5.0
    os.environ["JHT_TMUX_SEND_WAIT_S"] = str(module_wait)
    setattr(module, "TMUX_SEND_WAIT_S", module_wait)
    if hasattr(module, "NOTIFY_TIMEOUT_SEC"):
        module.NOTIFY_TIMEOUT_SEC = module_wait
    third = call(module)
    world.sender.wait_started(count=2)
    world.sender.wait_exited()
    assert third in (True, 0) or third is not False
    log = world.calls()
    assert sum(c.startswith("--flush-ours") for c in log) == 1, log
    assert log.index(next(c for c in log if c.startswith("--flush-ours"))) == 1, "the flush comes before the new delivery"
    assert len(log) == 3


# -- a caller that exits after the deadline (standby, soft_pause_team, application_answers are short-lived) ----------

SHORT_LIVED = """
import subprocess, sys
sys.path.insert(0, {skills!r})
sender = {sender!r}
if {use_helper!r}:
    import tmux_send_run
    try:
        tmux_send_run.run([sender, "CAPITANO", "x"], 0.3)
    except subprocess.TimeoutExpired:
        pass
else:
    proc = subprocess.Popen([sender, "CAPITANO", "x"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        proc.communicate(timeout=0.3)
    except subprocess.TimeoutExpired:
        pass
"""


@contextmanager
def _short_lived_caller(tmp_path, use_helper):
    import subprocess

    with ControlledSender(tmp_path, chatty=True) as sender:
        executable = sender.install(tmp_path / "chatty-send")
        code = SHORT_LIVED.format(skills=str(ROOT / "shared" / "skills"), sender=str(executable), use_helper=use_helper)
        done = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, timeout=30)
        assert done.returncode == 0, done.stderr
        record, = sender.wait_started()
        yield sender, record["pid"]


def test_a_caller_that_exits_after_the_deadline_does_not_take_the_transport_with_it(tmp_path):
    with _short_lived_caller(tmp_path, use_helper=True) as (sender, pid):
        sender.release_all()
        assert _wait_for(lambda: (tmp_path / f"entered.{pid}").exists()), "its diagnostics had a place to go: it reached its Enter"
        sender.wait_exited()


def test_with_pipes_the_transport_of_a_caller_that_left_dies_on_its_first_diagnostic_line(tmp_path):
    """The counter-proof: the same caller with the transport's output on pipes, which closed when it exited."""
    with _short_lived_caller(tmp_path, use_helper=False) as (sender, pid):
        sender.release_all()
        sender.wait_exited()
        assert (tmp_path / f"pasted.{pid}").exists() is False and (tmp_path / f"entered.{pid}").exists() is False
