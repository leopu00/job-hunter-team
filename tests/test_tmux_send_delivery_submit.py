"""Delivery contract: submit; independent cases for file-based scheduling."""

import subprocess
import sys
import threading
import time

from test_tmux_send_delivery_proof import (
    TRANSPORT,
    box,
    _lock_path,
)


def test_the_same_text_sent_twice_is_delivered_twice(box):
    assert box.run().returncode == 0
    second = box.run()
    assert second.returncode == 0, second.stderr
    assert len(box.typed()) == 2, "the first one is in the conversation now: the second is still typed and proven"


def test_an_enter_that_is_swallowed_three_times_is_alive_but_mute(box):
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5
    assert len(box.keys("Enter")) == 3


def test_a_busy_pane_alone_is_not_a_proof(box):
    """Before: a pane already busy made the first Enter 'taken' whatever the box still held."""
    box.put("mode", "busy")
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5, done.stderr


def test_a_busy_pane_whose_box_empties_is_taken(box):
    box.put("mode", "busy")
    done = box.run()
    assert done.returncode == 0, done.stderr


def test_an_enter_that_is_ignored_is_retried_with_enter_only(box):
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5, done.stderr
    assert box.keys("Space") == [] and len(box.keys("Enter")) == 3


def test_a_menu_under_the_mark_is_not_an_empty_box(box):
    box.put("mode", "menu")
    done = box.run()
    assert done.returncode != 0, "a permission menu is not 'my text was taken'"
    assert box.keys("Enter") == [] or done.returncode in (3, 5, 7)


def test_two_deliveries_to_the_same_session_do_not_mix(box):
    results = {}

    def go(n, text):
        results[n] = box.run(message=text)

    first = "[@watchdog -> @capitano] [MSG] PRIMO messaggio abbastanza lungo per avere una coda diversa AAAA"
    second = "[@watchdog -> @capitano] [MSG] SECONDO messaggio abbastanza lungo per avere una coda diversa BBBB"
    threads = [threading.Thread(target=go, args=(1, first)), threading.Thread(target=go, args=(2, second))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results[1].returncode == 0 and results[2].returncode == 0
    sequence = [("paste" if line.startswith("paste-buffer") else "Enter") for line in box.calls()
                if line.startswith("paste-buffer") or (line.startswith("send-keys") and line.endswith("Enter"))]
    assert sequence == ["paste", "Enter", "paste", "Enter"], sequence


def test_deliveries_to_different_sessions_do_not_wait_for_each_other(box, tmp_path):
    import fcntl

    locks = box.home / "locks"
    locks.mkdir(parents=True)
    held = open(locks / "tmux-send-ANALISTA-1.lock", "a")
    fcntl.flock(held, fcntl.LOCK_EX)
    try:
        started = time.monotonic()
        done = box.run(session="CAPITANO", JHT_TMUX_LOCK_WAIT="1")
        assert done.returncode == 0, done.stderr
        assert time.monotonic() - started < 20
    finally:
        held.close()


def test_a_lock_held_too_long_gives_the_lock_code_and_types_nothing(box):
    import fcntl

    locks = box.home / "locks"
    locks.mkdir(parents=True)
    held = open(locks / "tmux-send-CAPITANO.lock", "a")
    fcntl.flock(held, fcntl.LOCK_EX)
    try:
        started = time.monotonic()
        done = box.run(JHT_TMUX_LOCK_WAIT="1")
        assert done.returncode == 8, done.stderr
        assert time.monotonic() - started < 10, "the wait is bounded, well under the 15 s of the callers"
        assert box.typed() == []
    finally:
        held.close()


def test_the_lock_dies_with_its_holder(box):
    holder = subprocess.Popen([sys.executable, "-I", "-c",
                               "import fcntl,sys,time; f=open(sys.argv[1],'a'); fcntl.flock(f, fcntl.LOCK_EX); print('x', flush=True); time.sleep(60)",
                               str(_lock_path(box))], stdout=subprocess.PIPE, text=True)
    try:
        holder.stdout.readline()
        holder.kill()
        holder.wait()
        done = box.run(JHT_TMUX_LOCK_WAIT="3")
        assert done.returncode == 0, done.stderr
    finally:
        holder.kill()


def test_the_header_documents_the_new_codes_and_keeps_the_old_contract():
    text = TRANSPORT.read_text(encoding="utf-8")
    for line in ("#   3 →", "#   5 →", "#   6 → IMPERSONAZIONE", "#   7 →", "#   8 →"):
        assert line in text, line
    assert "_submitted" in text and "_composer_line" in text
