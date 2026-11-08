"""Delivery contract: signed; independent cases for file-based scheduling."""

import pytest

from test_tmux_send_delivery_proof import (
    box,
    _captures,
    MESSAGE_2,
    BODY_1,
    BODY_2,
    _body,
    _pending,
    _age_the_pending,
    BIG,
    BIG_LINES,
    _pending_input,
    _collapse,
    _flush,
    USER_OLD,
    AGENT_OLD,
    _signed_taken,
    _left_by_us,
)


def test_b_a_message_of_an_agent_the_transport_pasted_and_nobody_submitted_is_not_a_draft_ours_goes_in_behind_it(box):
    left = _left_by_us(box)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 2 and len(box.keys("Enter")) == 4, "the second paste, and one Enter (three were swallowed)"
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    assert BODY_1 in transcript and BODY_2 in transcript and transcript.index(BODY_1) < transcript.index(BODY_2)
    assert _body(box, "composer") == [] and "pasting behind it" in done.stderr and left


def test_b_the_persons_words_with_their_marks_left_unsent_are_not_a_draft_either(box):
    _signed_taken(box, USER_OLD)


def test_b_the_persons_words_followed_by_a_message_of_ours_are_taken_together(box):
    left = _left_by_us(box)
    box.put("composer", USER_OLD + left)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Enter")) == 4 and BODY_2 in (box.state / "transcript").read_text(encoding="utf-8")
    assert _body(box, "composer") == []


def test_b_a_signed_message_on_codex_is_taken_behind_too(box):
    box.put("layout", "codex")
    left = _left_by_us(box)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert BODY_2 in (box.state / "transcript").read_text(encoding="utf-8") and left


def test_b_the_wait_of_the_person_on_the_command_does_not_apply_a_signed_text_is_not_waited_for(box):
    box.put("composer", USER_OLD)
    done = box.run(MESSAGE_2, JHT_TMUX_SEND_FROM="user-console", JHT_TMUX_FOREIGN_WAIT="5")
    assert done.returncode == 0, done.stderr
    assert len(_captures(box)) < 15, "no look-again loop for a text that is signed"


def test_c_an_envelope_without_marks_the_transport_did_not_paste_is_the_persons_text(box):
    """A message between agents has no end of its own: a person could be typing at its tail. Without the fingerprint of
    exactly that text in the record, it is not signed: 130, nothing pasted or pressed."""
    box.put("composer", AGENT_OLD)
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []
    assert (box.state / "composer").read_text(encoding="utf-8") == AGENT_OLD


def test_c_a_message_of_ours_with_a_sentence_half_typed_after_it_is_not_signed(box):
    """The case that was measured: «[@a -> @b] [MSG] vecchio» followed by a person's half sentence. The fingerprint is of
    the message, not of the message and the words; the box is a person's, and the half sentence does not go out."""
    left = _left_by_us(box)
    box.put("composer", left + " mi sono dimenticato di dire che")
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert len(box.typed()) == 1, "nothing pasted after the first run"
    assert len(box.keys("Enter")) == 3, "only the three swallowed Enter of the first run: none for this one"
    assert "mi sono dimenticato" in (box.state / "composer").read_text(encoding="utf-8")


def test_c_a_fingerprint_older_than_a_day_is_no_fingerprint(box):
    _left_by_us(box)
    path = box.home / "locks" / "tmux-send-fingerprints-CAPITANO.log"
    old = int(__import__("time").time()) - 2 * 86400
    path.write_text("".join(f"{old} {line.split()[1]}\n" for line in path.read_text().splitlines()), encoding="utf-8")
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr


@pytest.mark.parametrize("draft", [
    "una bozza scritta da una persona",
    "ciao " + AGENT_OLD,                                              # a person's words before a head
    USER_OLD + " e poi aggiungo io questo",                         # typed after the closing mark
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12cd⟧ parole non chiuse",   # a mark that is not closed
    "[@utente -> @capitano] [CHAT] parole senza il recinto",       # the person's turn without its fence
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12cd⟧ x ⟦/UTENTE·ZZ⟧",   # closed by another id
    "⟦/UTENTE·ab12cd⟧ [@mentor -> @capitano] [MSG] hi",              # a closing mark with no opening one
    "[Pasted text #1 +4 lines]",                                      # a paste nobody's record explains
    "[Pasted Content 999 chars]",
], ids=["hand", "before-head", "after-close", "unclosed", "unfenced", "wrong-id", "stray-close", "claude-token", "codex-token"])
def test_c_text_that_is_not_all_signed_is_somebodys_typing_nothing_pasted_nothing_pressed(box, draft):
    box.put("composer", draft)
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []
    assert _pending_input(box)[-1]["reason"] == "composer_foreign"
    assert (box.state / "composer").read_text(encoding="utf-8") == draft, "the box is as it was"


def test_b_a_signed_text_that_changes_under_the_paste_gets_no_enter(box):
    """The base is checked again after the paste: if the old text changed (a person typed into it), no Enter."""
    box.put("composer", USER_OLD)
    box.put("draft_on_paste", " e io scrivo")
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert box.keys("Enter") == [] and box.keys("Escape") == []


def test_b_the_old_signed_text_taken_by_its_sender_meanwhile_leaves_ours_alone_in_the_box(box):
    """The relation accepts ours with no base at all: the sender of the old one pressed its Enter while we pasted."""
    box.put("composer", USER_OLD)
    box.put("foreign_until", "1")        # the box empties at the next look: its sender took it
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_b_ours_pasted_behind_signed_text_and_never_taken_is_still_ours_for_the_next_enter(box):
    """The record of what was pasted covers the two together: the flush that presses the Enter of a turn held for a
    busy agent recognises the box as ours (base and message), and a later delivery presses only that Enter."""
    box.put("composer", USER_OLD)
    box.put("enter_ignored")
    assert box.run(MESSAGE_2).returncode == 5
    record = _pending(box).read_text(encoding="utf-8").split()
    assert len(record) == 6, "time, hash of both, chars, newlines, hash and length of the base"
    (box.state / "enter_ignored").unlink()
    done = _flush(box)
    assert done.returncode == 0, done.stderr
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    assert USER_OLD.split("] ", 2)[2][:20] in transcript and BODY_2 in transcript
    assert not _pending(box).exists()


def test_b_a_claude_token_the_record_explains_inside_the_window_is_signed_text(box):
    """The long paste of an earlier delivery of ours that nobody submitted: Claude draws a token with the number of
    lines, which the record of the transport explains for JHT_TMUX_TOKEN_WINDOW seconds (600). Ours goes behind it."""
    _collapse(box, "claude")
    box.put("enter_ignored")
    assert box.run(BIG_LINES).returncode == 5
    (box.state / "enter_ignored").unlink()
    token = (box.state / "composer").read_text(encoding="utf-8")
    assert token.startswith("[Pasted text #1 +")
    box.put("composer", token.replace("#1", "#2"))   # not the one the transport itself knows, but the same lines
    enters, pastes = len(box.keys("Enter")), len(box.typed())
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == pastes + 1 and len(box.keys("Enter")) == enters + 1, "pasted behind it, one Enter"
    assert _body(box, "composer") == [], "nothing is left in the box"


def test_b_a_codex_token_the_record_explains_is_signed_text_whatever_its_age(box):
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run(BIG).returncode == 5
    (box.state / "enter_ignored").unlink()
    token = (box.state / "composer").read_text(encoding="utf-8")
    assert token.startswith("[Pasted Content ")
    box.put("composer", token)
    _age_the_pending(box, 86400)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("short", ["5", "6", "gpt", "high"])
def test_a_short_message_found_in_the_footer_of_the_box_is_still_pasted_and_pressed(box, short):
    """The reply «1» to the card was refused with "il testo e' gia' nella casella: premo solo l'Invio": its whole text is
    its signature, and a character of the model line under a Codex composer («gpt-5.6-sol high …») is not the text in the box."""
    box.put("layout", "codex")
    done = box.run(short)
    assert done.returncode == 0, done.stderr
    assert "gia' nella casella" not in done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_short_message_already_alone_in_the_box_is_not_typed_again(box):
    """The real «already there» case still works for a short text: the box holds exactly it, Enter is the only key."""
    box.put("layout", "codex")
    box.put("composer", "5")
    done = box.run("5")
    assert done.returncode == 0, done.stderr
    assert "gia' nella casella" in done.stderr
    assert box.typed() == [] and len(box.keys("Enter")) == 1


def test_a_short_message_next_to_a_draft_is_not_the_text_already_in_the_box(box):
    box.put("layout", "codex")
    box.put("composer", "una bozza della persona con un 5 dentro")
    done = box.run("5")
    assert done.returncode == 130, (done.returncode, done.stderr)
    assert box.typed() == [] and box.keys("Enter") == []
