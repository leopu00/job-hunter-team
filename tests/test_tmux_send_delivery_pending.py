"""Delivery contract: pending; independent cases for file-based scheduling."""

from test_tmux_send_delivery_proof import (
    box,
    MESSAGE_2,
    BODY_1,
    BODY_2,
    _body,
    _pending,
    _age_the_pending,
)


def test_a_text_of_ours_left_in_the_composer_gets_its_enter_before_the_next_delivery(box):
    box.put("enter_ignored")
    first = box.run()
    assert first.returncode == 5, first.stderr
    assert _body(box, "composer") == [BODY_1] and _pending(box).exists()
    (box.state / "enter_ignored").unlink()
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    assert _body(box, "transcript") == [BODY_1, BODY_2], "the first got its Enter, then the second was delivered"
    assert len(box.typed()) == 2, "the first text was not pasted a second time"
    assert not _pending(box).exists(), "nothing of ours is left in the composer"


def test_a_confirmed_delivery_leaves_nothing_remembered(box):
    assert box.run().returncode == 0
    assert not _pending(box).exists()


def test_a_draft_that_is_not_the_text_we_left_stays_untouched(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    box.put("composer", "una bozza scritta da una persona")
    calls_before = len(box.calls())
    second = box.run(MESSAGE_2)
    assert second.returncode == 130, second.stderr
    new_calls = box.calls()[calls_before:]
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in new_calls), "nothing pasted or pressed"
    assert (box.state / "composer").read_text(encoding="utf-8") == "una bozza scritta da una persona"


def test_a_text_of_ours_an_hour_old_still_gets_its_enter(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    _age_the_pending(box, 3600)
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    assert _body(box, "transcript") == [BODY_1, BODY_2]


def test_a_text_of_ours_of_any_age_gets_its_enter_better_late_than_a_deaf_agent(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    _age_the_pending(box, 5 * 3600)                            # the 5 hours a pane stayed deaf on a real team
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    assert _body(box, "transcript") == [BODY_1, BODY_2]


def test_every_enter_the_transport_presses_names_its_session_exactly(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    assert box.run(MESSAGE_2).returncode == 0
    enters = [line for line in box.calls() if line.startswith("send-keys") and line.endswith("Enter")]
    assert enters and all("-t =CAPITANO:" in line for line in enters), enters


def test_a_text_of_ours_that_keeps_ignoring_the_enter_blocks_the_next_one_without_pasting(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    calls_before = len(box.calls())
    second = box.run(MESSAGE_2)
    assert second.returncode == 130, second.stderr
    new_calls = box.calls()[calls_before:]
    assert len([c for c in new_calls if c.startswith("send-keys") and c.endswith("Enter")]) == 3, "Enter only, three times"
    assert not any(c.startswith("paste-buffer") for c in new_calls), "the second was never pasted"
    assert _body(box, "composer") == [BODY_1]
