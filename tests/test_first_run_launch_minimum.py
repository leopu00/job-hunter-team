"""The burst starts with the plan and the LEAST profile the search needs, while the questionnaire goes on (03/11).

The first run waited for the whole questionnaire (~10 minutes): the net that tells the Capitano to start counted its
45 seconds from the last modification of the profile, and every answer of the questionnaire rewrites it. Now the
profile is fit to start with a role, a place and a language (`shared/config/profile-minimum.json`, `launch_required`),
and the wait counts from the first time the profile was seen fit, not from the last answer."""

from __future__ import annotations

import json
import os
import time

from test_agent_questions import box  # noqa: F401
from test_first_run_start_after_the_card import age, declared_after_the_click, nudge_file, run, sender  # noqa: F401
from test_plan_question_is_always_a_card import configure, import_profile

ROLE_ONLY = "name: Test Person\ntarget_role: Backend engineer\n"
ROLE_PLACE = "name: Test Person\ntarget_role: Backend engineer\nlocation: Stockholm\n"
LAUNCHABLE = ROLE_PLACE + "languages:\n  - {language: Swedish, level: B2}\n"


def seen_file(box):
    return box.home / "state" / "first-run-launchable.json"


def test_a_role_without_a_place_or_a_language_is_not_a_profile_to_start_from(sender):
    box = sender
    declared_after_the_click(box)
    import_profile(box, minutes_ago=30, content=ROLE_ONLY)
    out = run(box, "plan-question-check")
    assert out["action"] == "none" and "not imported" in out["reason"], out
    import_profile(box, minutes_ago=30, content=ROLE_PLACE)  # still no language
    assert run(box, "plan-question-check")["action"] == "none"
    assert box.calls() == [] and not seen_file(box).exists()


def test_a_role_a_place_and_a_language_start_the_team_without_email_years_or_skills(sender):
    box = sender
    declared_after_the_click(box)
    import_profile(box, minutes_ago=30, content=LAUNCHABLE)
    out = run(box, "plan-question-check")
    assert out["action"] == "start" and out["sent"] is True, out
    (call,) = box.calls()
    assert call["session"] == "CAPITANO" and "begin-burst" in call["message"]


def test_the_answers_of_the_questionnaire_do_not_start_the_wait_again(sender):
    """The profile was fit two minutes ago; the last card rewrote it a second ago: the Capitano is told now."""
    box = sender
    declared_after_the_click(box)
    path = import_profile(box, minutes_ago=0, content=LAUNCHABLE)
    seen_file(box).parent.mkdir(exist_ok=True)
    seen_file(box).write_text(json.dumps({"since": time.time() - 120}), encoding="utf-8")
    os.utime(path, (time.time() - 1, time.time() - 1))
    out = run(box, "plan-question-check")
    assert out["action"] == "start", out


def test_without_the_record_the_same_rewrite_would_wait_which_is_what_the_record_changes(sender):
    box = sender
    declared_after_the_click(box)
    import_profile(box, minutes_ago=0, content=LAUNCHABLE)
    out = run(box, "plan-question-check")  # first sight, file just written: the wait is on
    assert out["action"] == "waiting" and 0 < out["seconds_left"] <= 45, out
    assert json.loads(seen_file(box).read_text(encoding="utf-8"))["since"] <= time.time()


def test_the_first_sight_is_kept_while_the_profile_stays_fit_and_goes_when_it_stops_being(sender):
    box = sender
    declared_after_the_click(box)
    import_profile(box, minutes_ago=0, content=LAUNCHABLE)
    run(box, "plan-question-check")
    first = json.loads(seen_file(box).read_text(encoding="utf-8"))["since"]
    import_profile(box, minutes_ago=0, content=LAUNCHABLE + "experience_years: 3\n")  # a card was answered
    run(box, "plan-question-check")
    assert json.loads(seen_file(box).read_text(encoding="utf-8"))["since"] == first
    import_profile(box, minutes_ago=0, content=ROLE_ONLY)  # the person took the language away
    run(box, "plan-question-check")
    assert not seen_file(box).exists()


def test_a_record_that_cannot_be_read_is_replaced_and_never_stops_the_check(sender):
    box = sender
    declared_after_the_click(box)
    import_profile(box, minutes_ago=30, content=LAUNCHABLE)
    seen_file(box).parent.mkdir(exist_ok=True)
    seen_file(box).write_text("{not json", encoding="utf-8")
    assert run(box, "plan-question-check")["action"] == "start"


def test_the_plan_card_is_asked_with_the_launch_profile_too(sender):
    """`ask-plan` and the net wait for a fit profile, no longer for a complete one."""
    box = sender
    configure(box)
    import_profile(box, minutes_ago=30, content=LAUNCHABLE)
    asked = run(box, "ask-plan", lang="en")
    assert asked.get("asked") is True, asked
