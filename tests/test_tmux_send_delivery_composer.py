"""Delivery contract: composer; independent cases for file-based scheduling."""

import pytest

from test_tmux_send_delivery_proof import (
    MESSAGE,
    box,
    _captures,
    _busy_codex,
    _pending_input,
)


def test_a_person_waiting_on_the_command_gets_a_short_wait_for_a_text_that_goes_away(box):
    """TEST 10 (27/10): `jht profile import` answered captain:failed (rc=130) because the Capitano's composer held a
    text that was not provably ours at that second; the same import 100 s later was delivered. A text that goes away
    by itself is waited for, and then the message is delivered whole: pasted once, one Enter, nothing over the text."""
    box.put("composer", "the message another sender of ours is about to submit")
    box.put("foreign_until", "3")
    done = box.run(JHT_TMUX_SEND_FROM="user-console")
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert len(_captures(box)) > 3, "it looked again while the text was there"


def test_a_text_that_stays_is_still_rc130_after_the_wait_and_nothing_is_pasted_or_pressed(box):
    box.put("composer", "a person's own draft")
    done = box.run(JHT_TMUX_SEND_FROM="user-console", JHT_TMUX_FOREIGN_WAIT="2")
    assert done.returncode == 130 and "NOT delivered" in done.stderr, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []
    assert len(_captures(box)) >= 3, "it waited, looking again, before giving up"
    row = _pending_input(box)[-1]
    assert row["reason"] == "composer_foreign" and row["unsent"].endswith(MESSAGE[-40:])


def test_the_bridges_and_nudges_keep_the_immediate_130(box):
    """Their own loops retry: a wait here would hold the loop of a dozen agents."""
    box.put("composer", "a text that is not ours")
    box.put("foreign_until", "3")
    done = box.run()
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and len(_captures(box)) < 5


@pytest.mark.parametrize("wait", ["0", "abc", "-3", "1.5"])
def test_the_wait_can_be_switched_off_and_a_bad_value_is_no_wait(box, wait):
    box.put("composer", "a text that is not ours")
    done = box.run(JHT_TMUX_SEND_FROM="user-console", JHT_TMUX_FOREIGN_WAIT=wait)
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and len(_captures(box)) < 5


def test_a_busy_agent_that_draws_the_paste_late_is_waited_for_and_gets_its_enter(box):
    """Before: the render window of an agent at rest ended, the transport said rc=3 («never shown», the one answer
    that means «maybe dead») and pressed nothing; the text appeared a moment later and waited for the next
    delivery's Enter. The user's chat showed «agent unavailable» for a message that arrived."""
    _busy_codex(box, late_captures=80)        # the window of an agent at rest is about 35 looks
    done = box.run(JHT_TMUX_LATE_RENDER_WAIT="60")
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1, "typed once"
    assert len(box.keys("Enter")) == 1, "and it got its Enter"


def test_a_busy_agent_that_never_draws_it_in_time_is_busy_not_dead_and_the_text_is_not_typed_again(box):
    _busy_codex(box, hold="")                 # drawn only when released: never within the wait
    done = box.run(JHT_TMUX_LATE_RENDER_WAIT="1")
    assert done.returncode == 4, done.stderr          # alive, retry later: pacing does not count it as a death
    assert len(box.typed()) == 1 and box.keys("Enter") == [] and box.keys("Escape") == []
    # the retry finds the text, now drawn, as the pending text of ours: Enter only, never a second paste
    box.put("release")
    again = box.run(JHT_TMUX_LATE_RENDER_WAIT="1")
    assert again.returncode == 0, again.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_certain_menu_on_screen_types_nothing_and_never_sends_escape(box):
    box.put("mode", "menu")
    done = box.run()
    assert done.returncode == 3
    assert box.typed() == [] and box.keys("Escape") == [] and box.keys("Enter") == []


def test_an_unrecognised_codex_form_is_pasted_once_and_proven_after_enter(box):
    box.put("mode", "unknown")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_an_echo_of_paste_before_an_ignored_enter_is_not_a_submit_receipt(box):
    box.put("mode", "unknown-echo")
    box.put("echo_on_paste")
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode != 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_localized_structural_menu_receives_no_paste_or_enter(box):
    box.put("mode", "menu-it")
    done = box.run()
    assert done.returncode == 3
    assert box.typed() == [] and box.keys("Enter") == []


def test_a_localized_pondering_form_is_queued_and_proven_after_enter(box):
    box.put("mode", "pondering-it")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_any_real_text_already_in_the_box_is_never_typed_over_or_submitted(box):
    box.put("composer", "a human draft")
    done = box.run()
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []


def test_an_exact_pending_envelope_is_submitted_without_a_second_paste(box):
    # First attempt leaves the exact, post-fence envelope in the composer.
    # The second transport invocation must attest and reuse it, not paste.
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 4


def test_an_exact_pending_envelope_retries_enter_only_then_stays_queued(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    done = box.run()
    assert done.returncode == 5, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 6


@pytest.mark.parametrize(("switch", "content"), [
    ("menu_on_paste", ""),
    ("draft_on_paste", "a human draft won the race"),
], ids=["menu", "draft"])
def test_a_change_between_preflight_and_paste_never_gets_an_enter(box, switch, content):
    box.put(switch, content)
    done = box.run()
    assert done.returncode != 0, done.stderr
    assert len(box.typed()) == 1, "the one bracketed paste may race, but is never retried"
    assert box.keys("Enter") == [] and box.keys("Escape") == [] and box.keys("Space") == []
    if switch == "draft_on_paste":
        pasted = next(box.state.glob("pasted.*")).read_text(encoding="utf-8")
        assert pasted.endswith(MESSAGE.rsplit(" ", 1)[-1])
        assert (box.state / "composer").read_text(encoding="utf-8") == content + pasted


def test_a_signature_in_the_conversation_is_not_a_proof_when_the_keys_are_lost(box):
    """21/10: la firma era gia' nella conversazione, i tasti si sono persi, l'Invio e' partito su una casella
    vuota e il trasporto ha detto «consegnato»."""
    box.put("transcript", MESSAGE + "\n")
    box.put("mute")
    done = box.run()
    assert done.returncode != 0
    assert box.keys("Enter") == [], "nothing is submitted on an empty box"


def test_an_old_nudge_in_the_conversation_does_not_count_for_a_new_one(box):
    nudge = "[MAIL] 1 new message(s) in your mailbox. Run: jht-mail drain"
    box.put("transcript", nudge + "\n")
    box.put("mute")
    done = box.run(message=nudge)
    assert done.returncode != 0 and box.keys("Enter") == []
