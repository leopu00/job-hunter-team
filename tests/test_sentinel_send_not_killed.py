"""The sentinel-bridge no longer kills `jht-tmux-send` when it overruns (TEST 5, 27/10, Capitano).

It waited 15 s and killed the transport. The transport has deadlines of its own (up to 100 s for a pane that is
not at its prompt), and between its paste and its Enter there is a window: a kill there leaves the paste in the
composer with no Enter, and the Capitano is deaf to every later message. Now the bridge waits as before (it must
not stop its loop), lets the transport finish by itself, does not stack a second delivery on the same pane, and
the round after an overrun asks the transport to submit a paste of ours that may be sitting there
(`--flush-ours`, which presses Enter only on a text it can prove is its own).
"""
import importlib.util
import os
import stat
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / ".launcher" / "sentinel-bridge.py"

# A transport that is slow: a delivery pastes after 1.0 s and presses Enter 0.5 s later; `--flush-ours` answers 0.
SLOW_SENDER = """#!/bin/bash
echo "$*" >> "{dir}/calls.log"
if [ "$1" = "--flush-ours" ]; then exit 0; fi
sleep 1.0; touch "{dir}/pasted.$$"
sleep 0.5; touch "{dir}/entered.$$"
exit 0
"""

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="il bridge gira nel container Linux")


@pytest.fixture()
def bridge(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sender = bin_dir / "jht-tmux-send"
    sender.write_text(SLOW_SENDER.format(dir=tmp_path), encoding="utf-8")
    sender.chmod(sender.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    monkeypatch.setenv("PYTHONDONTWRITEBYTECODE", "1")
    spec = importlib.util.spec_from_file_location("sentinel_bridge_not_killed_test", BRIDGE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "_standby_active", lambda: False)
    monkeypatch.setattr(module, "TMUX_SEND_WAIT_S", 0.4)
    module._tmux_send_running.clear()
    module._tmux_send_overran.clear()
    module._composer_refusals.clear()
    return type("B", (), {"module": module, "dir": tmp_path,
                          "calls": staticmethod(lambda: (tmp_path / "calls.log").read_text(encoding="utf-8").splitlines()
                                                if (tmp_path / "calls.log").exists() else []),
                          "entered": staticmethod(lambda: sorted(p.name for p in tmp_path.glob("entered.*")))})


def _wait_for(predicate, seconds=6.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def test_a_transport_that_overruns_is_left_to_finish_and_still_presses_its_enter(bridge):
    assert bridge.module.jht_tmux_send("CAPITANO", "avviso") is False, "the tick goes on without waiting for it"
    assert bridge.entered() == [], "it was still pasting when the bridge stopped waiting"
    assert _wait_for(lambda: len(bridge.entered()) == 1), "nobody killed it: the paste got its Enter"


def test_a_second_delivery_is_not_stacked_on_one_still_running(bridge):
    assert bridge.module.jht_tmux_send("CAPITANO", "primo") is False
    assert bridge.module.jht_tmux_send("CAPITANO", "secondo") is False
    assert [c for c in bridge.calls() if not c.startswith("--flush-ours")] == ["CAPITANO primo"]
    assert _wait_for(lambda: len(bridge.entered()) == 1)


def test_the_round_after_an_overrun_first_asks_the_transport_to_free_the_composer(bridge):
    assert bridge.module.jht_tmux_send("CAPITANO", "primo") is False
    assert _wait_for(lambda: len(bridge.entered()) == 1)
    bridge.module.TMUX_SEND_WAIT_S = 5.0
    assert bridge.module.jht_tmux_send("CAPITANO", "secondo") is True
    assert bridge.calls() == ["CAPITANO primo", "--flush-ours CAPITANO", "CAPITANO secondo"]
    # and only once: the next round goes straight to the delivery
    assert bridge.module.jht_tmux_send("CAPITANO", "terzo") is True
    assert bridge.calls()[-1] == "CAPITANO terzo" and sum(c.startswith("--flush-ours") for c in bridge.calls()) == 1


def test_a_delivery_that_ends_in_time_is_what_it_always_was(bridge):
    bridge.module.TMUX_SEND_WAIT_S = 5.0
    assert bridge.module.jht_tmux_send("CAPITANO", "avviso") is True
    assert bridge.calls() == ["CAPITANO avviso"] and len(bridge.entered()) == 1
