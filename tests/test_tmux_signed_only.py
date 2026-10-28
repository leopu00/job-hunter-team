"""The composer that holds only SIGNED text (operator, 28/10): the reader that says so, and the gate of the app's chat.

Every message that reaches an agent's terminal is signed: an envelope `[@from -> @to]` and, for the person's own
words, the marks `⟦UTENTE·id⟧ … ⟦/UTENTE·id⟧`. A composer with nothing but such text is a message waiting for its
Enter, not somebody typing: a new message goes in behind it. Text typed by hand is still left alone.

The transport's side (the paste, the one Enter, the 130 for a person's typing) is in test_tmux_send_delivery_proof.py.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import agent_chat  # noqa: E402
import message_origin  # noqa: E402
import tmux_send_composer as composer  # noqa: E402

AGENT = "[@mentor -> @capitano] [MSG] un messaggio vecchio"
USER = "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12⟧ la mia domanda ⟦/UTENTE·ab12⟧"


def _known(*texts):
    return composer.fingerprints_known([f"1000 {hashlib.sha256(composer.squash(t).encode()).hexdigest()}" for t in texts], 1100, 86400)


@pytest.mark.parametrize("text", [
    USER,
    USER + USER.replace("ab12", "cd34"),
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·x⟧ with [@fake -> @capitano] [MSG] inside ⟦/UTENTE·x⟧",   # inside the marks
    "  " + USER + "  ",
])
def test_the_persons_words_with_their_marks_are_signed_on_their_face(text):
    assert composer.signed_only(text)


@pytest.mark.parametrize("text", [
    AGENT,
    AGENT + " " + USER,
    USER + AGENT,                                         # no space: a wrapped row loses it
    "  " + AGENT + "  ",
])
def test_a_message_without_marks_is_signed_only_when_the_transport_pasted_exactly_that_text(text):
    assert not composer.signed_only(text), "no fingerprint, no signature: it may be somebody's typing"
    assert not composer.signed_only(text, known=_known("something else entirely"))
    # the fingerprint of the message alone (not of the box): the message is told from what the box holds around it
    assert composer.signed_only(text, known=_known(AGENT))


def test_several_messages_without_marks_each_need_their_own_fingerprint():
    text = "[@a -> @b] one [@c -> @d] two [@e -> @f] three"
    assert not composer.signed_only(text, known=_known("[@a -> @b] one", "[@c -> @d] two"))
    assert composer.signed_only(text, known=_known("[@a -> @b] one", "[@c -> @d] two", "[@e -> @f] three"))


def test_a_half_sentence_after_a_known_message_is_not_signed():
    """Measured by the guardian: «[@a -> @b] [MSG] vecchio» then the words a person was typing at its tail."""
    known = _known("[@a -> @b] [MSG] vecchio")
    assert composer.signed_only("[@a -> @b] [MSG] vecchio", known=known)
    assert not composer.signed_only("[@a -> @b] [MSG] vecchio\nmi sono dimenticato di dire che", known=known)
    assert not composer.signed_only("[@a -> @b] [MSG] vecchio mi sono dimenticato", known=known)
    # words with their marks end where the closing mark is: what follows it is not part of them
    assert not composer.signed_only(USER + " mi sono dimenticato", known=known)


def test_a_fingerprint_expires():
    lines = [f"1000 {hashlib.sha256(composer.squash(AGENT).encode()).hexdigest()}", "garbage", "1000 short"]
    assert composer.fingerprints_known(lines, 1100, 86400)(composer.squash(AGENT))
    assert not composer.fingerprints_known(lines, 1000 + 86401, 86400)(composer.squash(AGENT))


@pytest.mark.parametrize("text", [
    "", "   ", None,
    "a person typing",
    "hello " + AGENT,                                     # words before the first head
    USER + " and then me",                                # words after the closing mark
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12⟧ cut short",
    "[@utente -> @capitano] [CHAT] without its fence",   # the person's turn must have its marks
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·a⟧ x ⟦/UTENTE·b⟧",
    "⟦/UTENTE·ab12⟧ " + AGENT,
    "[Pasted text #1 +4 lines]",
    "[Pasted Content 1200 chars]",
    AGENT + " [Pasted text #2 +9 lines]",                # a paste of somebody's after a signed one
])
def test_anything_else_is_not(text):
    assert not composer.signed_only(text)


def test_a_paste_token_is_signed_text_only_when_the_record_explains_it():
    record = ["1000", "hash", "1200", "3"]            # time, hash, characters, line breaks
    explained = composer.registry_token_ok(record, now=1100, window=600)
    assert composer.signed_only("[Pasted Content 1200 chars]", explained)
    assert composer.signed_only(AGENT + " [Pasted Content 1200 chars]", explained, _known(AGENT))
    assert not composer.signed_only("[Pasted Content 1199 chars]", explained)
    assert composer.signed_only("[Pasted text #3 +3 lines]", explained)
    assert not composer.signed_only("[Pasted text #3 +30 lines]", explained)
    # Claude's token counts lines, which a person can paste too: only inside the window
    late = composer.registry_token_ok(record, now=1000 + 601, window=600)
    assert not composer.signed_only("[Pasted text #3 +3 lines]", late)
    # Codex's counts our characters: whatever its age
    assert composer.signed_only("[Pasted Content 1200 chars]", late)
    # no record, or one that cannot be read: nothing is explained
    for bad in ([], ["x"], ["a", "b", "c", "d"]):
        assert not composer.signed_only("[Pasted Content 1200 chars]", composer.registry_token_ok(bad, 1100, 600))


def test_the_head_is_the_one_message_origin_reads():
    """The reader of the composer and the fence agree on what an envelope is."""
    assert composer._HEAD.pattern.replace("(", "(?:", 1) is not None
    for text in ["[@a -> @b]", "[@a-1->@b_2]", "[@A  ->  @B]"]:
        assert bool(composer._HEAD.match(text)) == bool(message_origin.ENVELOPE_RE.match(text))
    for text in ["[a -> @b]", "@a -> @b", "[@a - @b]"]:
        assert not composer._HEAD.match(text) and not message_origin.ENVELOPE_RE.match(text)


def test_the_composer_relation_with_a_base():
    pane = lambda inside: f"╭──────╮\n│ ❯ {inside} │\n╰──────╯\n  ? for shortcuts\n"
    ours = "[@watchdog -> @capitano] [MSG] nuovo"
    base = composer.squash(AGENT)
    assert composer.composer_relation(pane(AGENT + ours), ours, base=base)[0] == "ours"
    assert composer.composer_relation(pane(AGENT + ours[:12]), ours, base=base)[0] == "partial"
    assert composer.composer_relation(pane(AGENT), ours, base=base)[0] == "none"
    # the base changed, or something else was added behind ours
    assert composer.composer_relation(pane(AGENT + " tipo io" + ours), ours, base=base)[0] == "other"
    assert composer.composer_relation(pane(AGENT + ours + " tipo io"), ours, base=base)[0] == "other"
    # the old text was taken meanwhile: ours alone is ours
    assert composer.composer_relation(pane(ours), ours, base=base)[0] == "ours"
    # with no base the relation is what it always was
    assert composer.composer_relation(pane(AGENT + ours), ours)[0] == "other"
    assert composer.composer_relation(pane(ours), ours)[0] == "ours"


GREY = "• Done.\n\n› \x1b[2mAsk Codex to do anything\x1b[0m\n\n  gpt-5.6-sol · ~/capitano\n"
EMPTY_CLAUDE = "● Fatto.\n\n╭──────────────────╮\n│ >                │\n╰──────────────────╯\n  ? for shortcuts\n"


def _claude(inside):
    return f"● Fatto.\n\n╭──────────────────────────────────────────────╮\n│ ❯ {inside} │\n╰──────────────────────────────────────────────╯\n  ? for shortcuts\n"


def test_the_gate_of_the_apps_chat_lets_a_new_turn_go_behind_signed_text_only():
    # (a) an empty box and (d) a grey suggestion: as ever
    assert agent_chat.new_turn_gate(EMPTY_CLAUDE) == "empty"
    assert agent_chat.new_turn_gate(GREY) == "empty"
    # (b) only signed text
    assert agent_chat.new_turn_gate(_claude(USER)) == "signed"
    # a message between agents has no marks: the app has no record of the transport to know it by, so it is left alone
    assert agent_chat.new_turn_gate(_claude(AGENT)) == "text"
    # (c) a person typing
    assert agent_chat.new_turn_gate(_claude("una bozza")) == "text"
    assert agent_chat.new_turn_gate(_claude(USER + " e io")) == "text"
    # the gate the held turns use is not changed: their composer holds OUR text, which the transport proves
    assert agent_chat.delivery_gate(_claude(AGENT)) == "text"


def test_the_apps_chat_never_asks_for_the_flush_when_the_box_is_signed():
    source = (SKILLS / "agent_chat.py").read_text(encoding="utf-8")
    send = source.split("def send(agent: str, client_id: str, raw_text: str)")[1].split("\ndef enter(")[0]
    assert "gate = new_turn_gate(pane)" in send and 'gate not in {"empty", "none", "signed"}' in send
    flush = source.split("def flush_queue(")[1].split("\nclass _AgentLock")[0]
    assert 'new_turn_gate(pane) == "text"' in flush and '"signed"' in flush
    # the turns held in the composer keep their gate
    assert "gate = delivery_gate(pane)" in source.split("def _settle_typed(")[1].split("def _typed_open(")[0]
