"""The plan picked on the card opens the first run (TEST 18c, 28/10).

The person clicked the card: the answer was recorded and seen by the Assistente, which wrote `plan: pro` ten seconds
later and said so in a line. Nothing then told the Capitano, who had been told once, before the plan existed, that
the profile was ready and had been refused by `begin-burst`: the first run stayed in `awaiting_profile` for four
minutes, until the person wrote «start the team». A written «start the team» unlocked it, the click alone did not.

Now the net the watchdog runs every tick (`plan-question-check`) tells the Capitano again, as the person's console, once
the profile is imported and the plan is declared and the first run has not opened: the click has the effect of the
written answer, whoever wrote the plan (the Assistente, `jht providers plan`, the net itself)."""

from __future__ import annotations

import json
import os
import stat
import time

import pytest

from test_agent_questions import ROOT, box  # noqa: F401  (box is a fixture)
from test_plan_question_is_always_a_card import answer, configure, import_profile, run

WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"


@pytest.fixture()
def sender(box, monkeypatch):
    """A transport that records what it is asked to type, and for whom, as the person's console or not."""
    log = box.home / "sender-calls.jsonl"
    script = box.home / "fake-tmux-send"
    script.write_text(
        "#!/bin/sh\n"
        f'printf \'{{"session": "%s", "from": "%s", "message": "%s"}}\\n\' "$1" "$JHT_TMUX_SEND_FROM" "$2" >> "{log}"\n'
        f'exit "${{FAKE_SENDER_EXIT:-0}}"\n',
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    box.env["JHT_TMUX_SENDER"] = str(script)

    def calls() -> list[dict]:
        return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []

    box.calls = calls
    return box


def declared_after_the_click(box, plan: str = "pro", settled: bool = True) -> str:
    """The card, the person's click on `plan`, and the plan written by the Assistente: what the 18c run did."""
    configure(box)
    asked = run(box, "ask-plan", lang="en")
    assert asked["asked"], asked
    answer(box, asked["question_id"], plan)
    configure(box, plan=plan)
    if settled:
        age(box, 120)
    return asked["question_id"]


def age(box, seconds: float) -> None:
    """The plan was written `seconds` ago."""
    path = box.home / "jht.config.json"
    moment = time.time() - seconds
    os.utime(path, (moment, moment))


def test_the_click_alone_gets_the_first_run_going(sender):
    box = sender
    declared_after_the_click(box)
    assert run(box, "status")["phase"] == "awaiting_profile"

    out = run(box, "plan-question-check")

    assert out["action"] == "start" and out["plan"] == "pro" and out["sent"] is True and out["count"] == 1, out
    (call,) = box.calls()
    assert call["session"] == "CAPITANO" and call["from"] == "user-console"
    assert "begin-burst" in call["message"] and "first-run-burst" in call["message"]
    assert "plan" in call["message"] and "profile is complete" in call["message"]
    # the Capitano's step: the burst opens with the roster of the plan the person picked
    burst = run(box, "begin-burst")
    assert burst["ok"] and burst["phase"] == "burst" and burst["plan"]["plan"] == "pro", burst
    assert burst["roster"] and burst["target_scored"]
    # nothing more is said once it is open
    assert run(box, "plan-question-check")["action"] == "none"
    assert len(box.calls()) == 1


def test_it_waits_for_the_one_who_wrote_the_plan_to_finish(sender):
    box = sender
    declared_after_the_click(box, settled=False)
    age(box, 5)
    out = run(box, "plan-question-check")
    assert out["action"] == "waiting" and 0 < out["seconds_left"] <= 45, out
    assert box.calls() == []


def test_a_plan_declared_before_the_profile_was_ready_waits_for_the_profile_too(sender):
    """The Capitano is itself told «profile ready» at the import: the reminder does not arrive in the same breath."""
    box = sender
    configure(box, plan="pro")
    age(box, 3600)                                   # the plan is an hour old
    import_profile(box, minutes_ago=0)               # the profile was just imported
    out = run(box, "plan-question-check")
    assert out["action"] == "waiting" and 0 < out["seconds_left"] <= 45, out
    assert box.calls() == []
    import_profile(box, minutes_ago=2)               # two minutes later it is time
    assert run(box, "plan-question-check")["action"] == "start"


def test_it_does_not_repeat_every_tick_and_stops_after_three(sender):
    box = sender
    declared_after_the_click(box)
    assert run(box, "plan-question-check")["action"] == "start"
    again = run(box, "plan-question-check")
    assert again["action"] == "waiting" and again["seconds_left"] > 0, again
    # the next reminders come five minutes apart (the state is moved back, as the clock would)
    for expected in (2, 3):
        state_file = box.home / "state" / "first-run.json"
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["start_nudge"]["last_at"] = "2026-01-01T00:00:00+00:00"
        state_file.write_text(json.dumps(state), encoding="utf-8")
        out = run(box, "plan-question-check")
        assert out["action"] == "start" and out["count"] == expected, out
    state_file = box.home / "state" / "first-run.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    state["start_nudge"]["last_at"] = "2026-01-01T00:00:00+00:00"
    state_file.write_text(json.dumps(state), encoding="utf-8")
    last = run(box, "plan-question-check")
    assert last["action"] == "none" and "3 times" in last["reason"], last
    assert len(box.calls()) == 3


def test_a_transport_that_fails_is_counted_and_not_retried_every_tick(sender):
    box = sender
    declared_after_the_click(box)
    box.env["FAKE_SENDER_EXIT"] = "4"
    out = run(box, "plan-question-check")
    assert out["action"] == "start" and out["sent"] is False
    assert run(box, "plan-question-check")["action"] == "waiting"


def test_nothing_is_said_before_the_profile_or_the_plan_or_after_the_run_opened(sender):
    box = sender
    # no profile imported yet: the plan is declared, but the person is still building the profile
    configure(box, plan="pro")
    age(box, 120)
    assert run(box, "plan-question-check", profile=False)["action"] == "none"
    # a profile and no plan: the net asks for the plan (as before), it does not start anything
    configure(box)
    import_profile(box, minutes_ago=60)
    assert run(box, "plan-question-check")["action"] in {"waiting", "asked", "none"}
    assert box.calls() == []
    # plan and profile, run already open: nothing
    configure(box, plan="pro")
    age(box, 120)
    run(box, "begin-burst")
    assert run(box, "plan-question-check")["action"] == "none"
    assert box.calls() == []


def test_the_plan_written_by_another_path_has_the_same_effect(sender):
    """`jht providers plan`, a hand edit, the app: no card at all, the plan is in the configuration."""
    box = sender
    configure(box, plan="plus")
    import_profile(box, minutes_ago=60)
    age(box, 120)
    out = run(box, "plan-question-check")
    assert out["action"] == "start" and out["plan"] == "plus", out
    assert len(box.calls()) == 1


def test_a_new_plan_gets_its_own_count(sender):
    box = sender
    declared_after_the_click(box, "pro")
    assert run(box, "plan-question-check")["count"] == 1
    configure(box, plan="plus")
    age(box, 120)
    state_file = box.home / "state" / "first-run.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    state["start_nudge"]["last_at"] = "2026-01-01T00:00:00+00:00"
    state_file.write_text(json.dumps(state), encoding="utf-8")
    out = run(box, "plan-question-check")
    assert out["action"] == "start" and out["plan"] == "plus" and out["count"] == 1, out


def test_the_watchdog_logs_the_reminder():
    text = WATCHDOG.read_text(encoding="utf-8")
    net = text[text.index("# --- rete della domanda sul piano"):text.index("# --- fine rete della domanda sul piano")]
    assert "'\"action\": \"start\"'" in net
