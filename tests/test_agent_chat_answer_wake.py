"""The agent is woken for an answer of the app until it has read it (agent_chat.py, ``_wake_attempt`` / ``wake_until_seen``).

First run: the Capitano posted the plan card and finished its turn; the person answered two seconds later. The wake was ONE
try, only with an empty composer and a quiet terminal, and it skipped in silence: nobody typed to the Capitano again, which
stood at its prompt for seven minutes. What must hold now:

- an empty composer takes the wake even while the CLI works (it queues the line), as a chat send does;
- a text in the composer is first handed to the transport's ``--flush-ours`` (Enter ONLY on a text it can prove is ours),
  then the wake goes; a text of anyone else is never touched and the wake is not typed over it;
- a menu or a sign-in takes nothing; every try that does not land says why with a fixed word in logs/answer-wake.log;
- the wake is repeated until the agent has read the answer, not after it has, not twice within the quiet time, and not
  for ever; one retrying process per question.
Run with: pytest tests/test_agent_chat_answer_wake.py -v
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"

EMPTY = "• Done.\n\n› \x1b[2mAsk Codex to do anything\x1b[0m\n\n  gpt-5.6-sol · ~/capitano\n"
# The turn has ended but the status line has not caught up: what the Capitano's pane showed when the person clicked.
BUSY_EMPTY = "• Working (3s • esc to interrupt)\n\n› \x1b[2mAsk Codex to do anything\x1b[0m\n\n  gpt-5.6-sol · ~/capitano\n"
DRAFT = ("─ Worked for 1m 14s ──────────────────────\n\n"
         "› [@assistente -> @capitano] [REQ] Cold-start triage completed: 6 positions total\n\n"
         "  gpt-5.6-sol high · ~/agents/capitano\n")
MENU = "Menu\n> 1. Yes\n  2. No\n"
WAKE = "[ANSWER] The user answered one of your questions. Run: jht-check-user-replies --agent capitano"


@pytest.fixture()
def chat(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_ANSWER_WAKE_RETRY", "0")
    sys.path.insert(0, str(SKILLS))
    spec = importlib.util.spec_from_file_location("answer_wake_chat", SKILLS / "agent_chat.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.path.remove(str(SKILLS))
    module._test_home = tmp_path
    return module


class Terminal:
    """A pane that answers what the test says, a transport that records, and a flush that may clear the composer."""

    def __init__(self, chat, monkeypatch, panes, *, rc=0, flush="refuses", after_flush=EMPTY):
        self.panes = list(panes)
        self.typed: list[str] = []
        self.flushed = 0
        self.after_flush = after_flush
        self.flush_mode = flush
        self.rc = rc
        monkeypatch.setattr(chat, "capture_pane", self._capture)
        monkeypatch.setattr(chat, "_delivery_binary", lambda: "/stub/jht-tmux-send")
        monkeypatch.setattr(chat, "flush_ours", self._flush)
        monkeypatch.setattr(chat.subprocess, "run", self._run)

    def _capture(self, session, timeout=None):
        return self.panes[0] if len(self.panes) == 1 else self.panes.pop(0)

    def _flush(self, session):
        self.flushed += 1
        if self.flush_mode == "refuses":
            raise self._chat_refusal()
        self.panes = [self.after_flush]

    def _run(self, argv, **kwargs):
        self.typed.append(argv[2])
        return subprocess.CompletedProcess(argv, self.rc, b"", b"")

    def bind(self, chat):
        self._chat_refusal = lambda: chat.Refusal("composer_has_text")
        return self


def terminal(chat, monkeypatch, panes, **options):
    return Terminal(chat, monkeypatch, panes, **options).bind(chat)


def log_of(chat) -> str:
    path = chat._test_home / "logs" / "answer-wake.log"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def test_an_empty_composer_takes_the_wake(chat, monkeypatch):
    term = terminal(chat, monkeypatch, [EMPTY])
    assert chat._wake_attempt("capitano", "CAPITANO") == "sent"
    assert term.typed == [WAKE] and term.flushed == 0


def test_the_turn_that_has_just_ended_takes_the_wake_too_the_composer_is_empty_while_the_cli_still_says_working(chat, monkeypatch):
    # The pane at the click of the plan card, two seconds after the end of the turn: the old rule asked for a quiet terminal and skipped.
    assert chat.prompt_state(BUSY_EMPTY) == "busy"
    term = terminal(chat, monkeypatch, [BUSY_EMPTY])
    assert chat._wake_attempt("capitano", "CAPITANO") == "sent"
    assert term.typed == [WAKE]


def test_a_text_of_ours_in_the_composer_is_flushed_first_and_then_the_wake_goes(chat, monkeypatch):
    term = terminal(chat, monkeypatch, [DRAFT], flush="clears")
    assert chat._wake_attempt("capitano", "CAPITANO") == "sent"
    assert term.flushed == 1
    assert term.typed == [WAKE]


def test_a_text_of_anyone_else_is_never_touched_and_the_wake_is_not_typed_over_it(chat, monkeypatch):
    term = terminal(chat, monkeypatch, [DRAFT], flush="refuses")
    assert chat._wake_attempt("capitano", "CAPITANO") == "text"
    assert term.flushed == 1
    assert term.typed == []


def test_a_flush_that_leaves_a_text_there_is_not_typed_over_either(chat, monkeypatch):
    term = terminal(chat, monkeypatch, [DRAFT], flush="clears", after_flush=DRAFT)
    assert chat._wake_attempt("capitano", "CAPITANO") == "text"
    assert term.typed == []


@pytest.mark.parametrize("screen", [MENU, "user@host:~$\n", "Sign in to continue\n  1. Log in\n"])
def test_a_menu_a_shell_or_a_sign_in_takes_nothing_the_wake_is_not_typed_on_a_guess(chat, monkeypatch, screen):
    term = terminal(chat, monkeypatch, [screen])
    assert chat._wake_attempt("capitano", "CAPITANO") == "blocked"
    assert term.typed == []


def test_no_pane_is_said_and_nothing_is_typed(chat, monkeypatch):
    term = terminal(chat, monkeypatch, [None])
    assert chat._wake_attempt("capitano", "CAPITANO") == "no_pane"
    assert term.typed == []


@pytest.mark.parametrize("rc,code", [(8, "busy"), (3, "blocked"), (2, "no_pane"), (130, "text"), (99, "failed")])
def test_a_transport_that_refuses_is_a_closed_code_a_retry_can_read(chat, monkeypatch, rc, code):
    terminal(chat, monkeypatch, [EMPTY], rc=rc)
    assert chat._wake_attempt("capitano", "CAPITANO") == code


def test_a_first_try_that_does_not_land_says_why_in_one_fixed_line_and_nothing_else(chat, monkeypatch):
    terminal(chat, monkeypatch, [DRAFT], flush="refuses")
    assert chat._wake_for_answer("capitano", "CAPITANO") == "text"
    lines = log_of(chat).splitlines()
    assert len(lines) == 1
    assert lines[0].endswith(" capitano wake_text")
    terminal(chat, monkeypatch, [EMPTY])
    assert chat._wake_for_answer("capitano", "CAPITANO") == "sent"
    assert len(log_of(chat).splitlines()) == 1, "a wake that landed leaves no line"


class Clock:
    def __init__(self):
        self.now = 0.0
        self.slept: list[float] = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def run_loop(chat, codes, *, seen_after=None, **options):
    clock = Clock()
    tries: list[float] = []
    queue = list(codes)

    def attempt(agent, session):
        tries.append(clock.now)
        return queue.pop(0) if queue else "busy"

    def seen(question_id):
        return seen_after is not None and clock.now >= seen_after

    result = chat.wake_until_seen("capitano", "q1", "CAPITANO", attempt=attempt, seen=seen,
                                  sleep=clock.sleep, clock=clock, every=30, window=600, quiet=120, **options)
    return result, tries, clock


def test_the_wake_is_repeated_until_the_agent_has_read_the_answer(chat):
    result, tries, _clock = run_loop(chat, ["busy", "text", "sent"], seen_after=100)
    assert result == "seen"
    assert tries[:3] == [0.0, 30.0, 60.0]
    assert len(tries) == 3, "after a line that landed it is quiet, and the answer is read before the quiet is over"


def test_a_line_that_landed_is_not_typed_again_within_the_quiet_time_but_is_after_it(chat):
    result, tries, _clock = run_loop(chat, ["sent"] * 10, seen_after=None)
    assert result == "gave_up"
    assert tries[0] == 0.0 and tries[1] == 120.0, "the next line only after the quiet time"
    assert all(b - a >= 120 for a, b in zip(tries, tries[1:])), tries


def test_an_answer_already_read_asks_for_nothing(chat):
    result, tries, _clock = run_loop(chat, ["sent"], seen_after=0)
    assert (result, tries) == ("seen", [])


def test_it_gives_up_when_the_window_is_over(chat):
    result, tries, clock = run_loop(chat, [], seen_after=None)
    assert result == "gave_up"
    assert clock.now <= 600 + 30
    assert 15 <= len(tries) <= 21, "every 30 s for ten minutes, not for ever"


def test_one_retrying_process_per_question(chat, monkeypatch):
    first = chat._wake_lock("q1")
    assert first is not None
    assert chat._wake_lock("q1") is None
    assert chat._wake_lock("q2") is not None
    first.unlink()
    assert chat._wake_lock("q1") is not None


def test_a_lock_left_by_a_process_that_died_is_taken_over(chat):
    import os
    import time as _time
    path = chat._wake_lock("q1")
    assert path is not None
    old = _time.time() - (chat.WAKE_RETRY_FOR_S + 120)
    os.utime(path, (old, old))
    assert chat._wake_lock("q1") is not None


def test_the_wake_command_for_a_question_already_held_answers_running_and_waits_for_nothing(chat, monkeypatch):
    held = chat._wake_lock("q1")
    assert held is not None
    called = []
    monkeypatch.setattr(chat, "wake_until_seen", lambda *a, **k: called.append(a) or "seen")
    assert chat.wake("capitano", "q1") == {"result": "running"}
    assert called == []
    held.unlink()
    assert chat.wake("capitano", "q1") == {"result": "seen"}
    assert chat._wake_lock("q1") is not None, "the lock is released when the process ends"


def test_the_answer_starts_the_retrying_process_only_when_the_first_try_did_not_land(chat, monkeypatch):
    spawned = []
    monkeypatch.setattr(chat, "_spawn_wake_retry", lambda agent, qid: spawned.append((agent, qid)))
    # the tail of answer(): what it does with the first try
    for code, expected in (("sent", []), ("text", [("capitano", "q1")]), ("busy", [("capitano", "q1")])):
        spawned.clear()
        monkeypatch.setattr(chat, "_wake_for_answer", lambda agent, session, code=code: code)
        if chat._wake_for_answer("capitano", "CAPITANO") != "sent":
            chat._spawn_wake_retry("capitano", "q1")
        assert spawned == expected


def test_the_retrying_process_is_detached_and_silent(chat, monkeypatch):
    seen = {}

    def fake_popen(argv, **kwargs):
        seen["argv"], seen["kwargs"] = argv, kwargs

    monkeypatch.delenv("JHT_ANSWER_WAKE_RETRY", raising=False)
    monkeypatch.setattr(chat.subprocess, "Popen", fake_popen)
    chat._spawn_wake_retry("capitano", "q1")
    assert seen["argv"][1:] == [str(SKILLS / "agent_chat.py"), "wake", "capitano", "q1"]
    kwargs = seen["kwargs"]
    assert kwargs["start_new_session"] is True
    assert kwargs["stdout"] == subprocess.DEVNULL and kwargs["stderr"] == subprocess.DEVNULL and kwargs["stdin"] == subprocess.DEVNULL


def test_the_retry_can_be_switched_off(chat, monkeypatch):
    monkeypatch.setenv("JHT_ANSWER_WAKE_RETRY", "0")

    def boom(*a, **k):
        raise AssertionError("must not start a process")

    monkeypatch.setattr(chat.subprocess, "Popen", boom)
    chat._spawn_wake_retry("capitano", "q1")
