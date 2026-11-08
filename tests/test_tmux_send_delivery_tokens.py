"""Delivery contract: tokens; independent cases for file-based scheduling."""

import subprocess
import pytest

from test_tmux_send_delivery_proof import (
    TRANSPORT,
    box,
    MESSAGE_2,
    BODY_1,
    BODY_2,
    _body,
    _pending,
    BIG,
    BIG_BODY,
    BIG_LINES,
    _pending_input,
    _collapse,
    _env,
)


@pytest.mark.parametrize("kind", ["codex", "claude"])
def test_a_long_paste_the_tui_keeps_out_of_sight_is_ours_and_gets_its_enter(box, kind):
    _collapse(box, kind)
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert BIG_BODY in (box.state / "transcript").read_text(encoding="utf-8")
    assert _body(box, "composer") == [] and not _pending(box).exists()


def test_a_long_paste_into_a_codex_that_starts_working_is_still_ours_and_gets_its_enter(box):
    """TEST 5, 27/10: the bridge's 1043-character PACE-GUARD, pasted into a Capitano that was at rest, whose turn
    started 0.1 s later (the Enter of the previous paste starts it). Codex then draws «tab to queue message ... NN%
    context left» as its footer; with that footer unrecognised the composer was no longer «our text» when the
    transport looked again before the Enter (rc=130, composer_changed), and the token stayed in the box until a
    person pressed Enter."""
    _collapse(box, "codex", busy_after=0.12)
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert _body(box, "composer") == [] and not _pending(box).exists()


def test_a_long_paste_into_a_codex_whose_turn_starts_at_the_paste_is_ours_and_gets_its_enter(box):
    _collapse(box, "codex")
    box.put("turn_on_paste")
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Enter")) == 1 and _body(box, "composer") == []


def test_a_long_paste_into_a_codex_that_is_already_working_is_ours_and_gets_its_enter(box):
    _collapse(box, "codex")
    box.put("mode", "busy")
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert _body(box, "composer") == []


def test_a_long_message_with_line_breaks_is_ours_on_claude_too(box):
    _collapse(box, "claude")
    done = box.run(BIG_LINES)
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Enter")) == 1


@pytest.mark.parametrize("kind, extra", [("codex", {"collapse_n": 999}), ("claude", {"collapse_n": 99}),
                                         ("codex", {"token_beside": "una bozza accanto"}),
                                         ("claude", {"token_beside": "una bozza accanto"})])
def test_a_paste_token_that_is_not_provably_ours_gets_no_enter_and_is_written_down(box, kind, extra):
    _collapse(box, kind, **extra)
    done = box.run(BIG)
    assert done.returncode == 130, done.stderr
    assert box.keys("Enter") == [] and len(box.typed()) == 1
    rows = _pending_input(box)
    assert rows and rows[-1]["reason"] == "composer_changed" and rows[-1]["session"] == "CAPITANO"
    assert rows[-1]["draft"].endswith(BIG_BODY[-40:])


def test_a_long_text_left_with_its_enter_swallowed_gets_it_with_the_next_delivery(box):
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run(BIG).returncode == 5
    assert "Pasted Content" in (box.state / "composer").read_text(encoding="utf-8")
    (box.state / "enter_ignored").unlink()
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    assert BIG_BODY in transcript and BODY_2 in transcript
    assert len(box.typed()) == 2, "the long text was not pasted a second time"


def test_the_token_of_the_real_team_gets_its_enter_with_no_new_delivery_needed(box):
    # a 1024-character message, the way it was left on the 26/10
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run("x" * 1024).returncode == 5
    assert (box.state / "composer").read_text(encoding="utf-8") == "[Pasted Content 1024 chars]"
    (box.state / "enter_ignored").unlink()
    done = subprocess.run([str(TRANSPORT), "--flush-ours", "CAPITANO"], capture_output=True, text=True, timeout=60,
                          env=_env(box))
    assert done.returncode == 0, done.stderr
    assert (box.state / "composer").read_text(encoding="utf-8") == "" and not _pending(box).exists()


def test_a_token_the_registry_does_not_explain_is_left_alone_and_the_message_is_written_down(box):
    _collapse(box, "codex")
    box.put("composer", "[Pasted Content 1024 chars]")             # nobody of ours left it: no record
    calls_before = len(box.calls())
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in box.calls()[calls_before:])
    rows = _pending_input(box)
    assert rows[-1]["reason"] == "composer_foreign" and rows[-1]["unsent"].endswith(BODY_2)


def test_an_old_two_field_record_cannot_prove_a_token_ours(box):
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run(BIG).returncode == 5
    stamp, digest, *_ = _pending(box).read_text(encoding="utf-8").split()
    _pending(box).write_text(f"{stamp} {digest}\n", encoding="utf-8")   # the record of the transport before this one
    (box.state / "enter_ignored").unlink()
    calls_before = len(box.calls())
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in box.calls()[calls_before:])


@pytest.mark.parametrize("draft_after", ["half", "typing"])
def test_every_130_after_the_paste_is_written_down(box, draft_after):
    if draft_after == "half":
        box.put("split", "30")
        done = box.run(JHT_TMUX_PARTIAL_WAIT="1")
        reason = "half_drawn"
    else:
        box.put("draft_on_paste", "bozza ")
        done = box.run()
        reason = "composer_changed"
    assert done.returncode == 130, done.stderr
    assert _pending_input(box)[-1]["reason"] == reason


def test_a_message_not_typed_because_the_composer_is_somebody_elses_is_written_down(box):
    box.put("composer", "una bozza scritta da una persona")
    done = box.run()
    assert done.returncode == 130 and "NOT delivered" in done.stderr
    row = _pending_input(box)[-1]
    assert row["reason"] == "composer_foreign" and row["unsent"].endswith(BODY_1) and "draft" not in row
