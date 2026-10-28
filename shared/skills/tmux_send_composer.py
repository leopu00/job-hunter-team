"""What jht-tmux-send needs to know about a composer that holds a pasted paste token.

A TUI keeps a long paste out of sight: past a size its composer draws a token instead of the text.
Kept apart from agent_chat.py (the composer reader, which others edit): this only adds, on top of
`agent_chat.composer_text`, the question «is what the composer shows OUR paste?».
"""
from __future__ import annotations

import hashlib
import re

import agent_chat

# A paste the TUI keeps out of sight: past a size its composer draws a token instead of the text.
#   Codex   ``[Pasted Content 1024 chars]``  (the number of characters pasted; seen on a Codex 0.147 pane
#           whose paste was a 1024-character message)
#   Claude  ``[Pasted text #1 +12 lines]``    (a running id, then the number of extra lines; none for one line)
_CODEX_PASTE = re.compile(r"^\[Pasted Content (\d+) chars\]$")
_CLAUDE_PASTE = re.compile(r"^\[Pasted text #\d+(?: \+(\d+) lines)?\]$")


def paste_placeholder_fits(actual: str | None, chars: int, newlines: int, *, claude: bool = True) -> bool:
    """True when ``actual`` (a composer's whole text) is ONE paste token that a paste of ``chars`` characters
    and ``newlines`` line breaks would leave: Codex's number is the character count; Claude's is the line count
    (or nothing, for one line). Anything else, a token with other text beside it included, is False. With
    ``claude=False`` a Claude token never fits: its number is a line count, which proves nothing about WHOSE paste it is."""
    text = (actual or "").strip()
    codex = _CODEX_PASTE.match(text)
    if codex:
        return int(codex.group(1)) in {chars, chars - newlines}
    claude_token = _CLAUDE_PASTE.match(text)
    if claude_token and claude:
        shown = claude_token.group(1)
        return (shown is None and newlines == 0) or (shown is not None and int(shown) in {newlines, newlines + 1})
    return False


def squash(text: str) -> str:
    """The text without any space: a row that wraps loses the space at the wrap, so texts are compared this way."""
    return "".join((text or "").split())


def split_after(actual: str, squashed_chars: int) -> str:
    """What follows the first ``squashed_chars`` characters that are not a space (the rest of a composer after a base)."""
    seen = 0
    for index, char in enumerate(actual):
        if seen >= squashed_chars:
            return actual[index:]
        if not char.isspace():
            seen += 1
    return "" if seen >= squashed_chars else actual


def composer_relation(pane: str, expected: str, *, allow_placeholder: bool = False, base: str | None = None) -> tuple[str, int, int]:
    """How the composer stands against the text we pasted: ``ours`` (exactly it, spaces apart: a wrapped row
    loses the space at the wrap), ``partial`` (the start of it: the TUI is still drawing the paste) or ``other``.
    With ``allow_placeholder`` (only when the composer was empty before the paste) a single paste token that
    fits the text is ``ours`` too. The two lengths are the composer's and the text's, never the text.

    ``base``: what the composer held BEFORE the paste, squashed, when that was only signed text (``signed_only``)
    and our message was pasted behind it. The composer is then ``ours`` when it is that base unchanged followed
    by our text (or our token), ``partial`` while our text is still being drawn behind it, and ``none`` while
    nothing of ours is drawn yet. A base that has gone (its sender submitted it meanwhile) leaves the plain
    relation: our text alone. Anything else, a changed base included, is ``other``."""
    state, seen_length, wanted_length = _plain_relation(pane, expected, allow_placeholder)
    if base is None or state in {"ours", "partial"}:
        return state, seen_length, wanted_length
    actual = agent_chat.composer_text(pane)
    if actual is None or not squash(actual).startswith(base):
        return "other", seen_length, wanted_length
    rest = split_after(actual, len(base))
    wanted = squash(expected)
    seen = squash(rest)
    if not seen:
        return "none", 0, len(wanted)
    if seen == wanted:
        return "ours", len(seen), len(wanted)
    if allow_placeholder and paste_placeholder_fits(rest, len(expected), expected.count("\n")):
        return "ours", len(seen), len(wanted)
    if wanted.startswith(seen):
        return "partial", len(seen), len(wanted)
    return "other", len(seen), len(wanted)


def _plain_relation(pane: str, expected: str, allow_placeholder: bool) -> tuple[str, int, int]:
    actual = agent_chat.composer_text(pane)
    wanted = squash(expected)
    if actual is None:
        return "other", 0, len(wanted)
    seen = squash(actual)
    if seen == wanted:
        return "ours", len(seen), len(wanted)
    if allow_placeholder and paste_placeholder_fits(actual, len(expected), expected.count("\n")):
        return "ours", len(seen), len(wanted)
    if seen and wanted.startswith(seen):
        return "partial", len(seen), len(wanted)
    return "other", len(seen), len(wanted)


# ── Signed text left in the composer ────────────────────────────────────────────────────────────────
# Every message that reaches an agent's terminal is signed: an envelope ``[@from -> @to]`` (the same head as
# message_origin.ENVELOPE_RE) and, for the person's own words, the marks ``⟦UTENTE·id⟧ … ⟦/UTENTE·id⟧`` that say
# where they begin and end. A composer that holds nothing BUT such text (one message or several, whoever sent
# them) is a message waiting for its Enter, not somebody typing: ours goes in behind it and one Enter takes both.
_HEAD = re.compile(r"\[@([A-Za-z0-9_-]+)\s*->\s*@[A-Za-z0-9_-]+\]")
_OPEN = re.compile(r"⟦UTENTE·([^⟦⟧\s]*)⟧")
_CLOSE = re.compile(r"⟦/UTENTE·([^⟦⟧\s]*)⟧")
_TOKEN = re.compile(r"\[Pasted Content \d+ chars\]|\[Pasted text #\d+(?: \+\d+ lines)?\]")


def signed_only(actual: str | None, token_ok=None, known=None) -> bool:
    """True when the composer's whole text is one or more complete signed messages and nothing else.

    A message starts with an envelope head. The person's words (a sender ``utente``, which the fence marks) must have
    their opening mark, closed by the same id, and after the closing mark only another message may follow: the marks
    say where the message ends. An envelope WITHOUT marks (a message between agents) has no end of its own: it runs to
    the next head, so a person could go on typing at its tail and it would still read as one message. It counts only
    when ``known(squashed text of the message)`` says the transport pasted exactly that text (its fingerprint is in the
    record of what it pasted); with no ``known`` it never counts, and the box is somebody's typing.
    A paste token (the TUI keeps a long paste out of sight) is a message only when ``token_ok(token)`` says the record
    of the transport explains it; otherwise, or with no ``token_ok``, it is somebody's paste. Text before the first head,
    after a closing mark, a mark that is not closed, a closing mark with no opening one: not signed."""
    text = (actual or "").strip()
    if not text:
        return False
    length = len(text)
    index = 0
    while index < length:
        while index < length and text[index].isspace():
            index += 1
        if index >= length:
            break
        token = _TOKEN.match(text, index)
        if token:
            if token_ok is None or not token_ok(token.group(0)):
                return False
            index = token.end()
            continue
        head = _HEAD.match(text, index)
        if not head:
            return False
        needs_marks = head.group(1).lower() == "utente"
        item_start = head.start()
        index = head.end()
        item_end = length
        marked = False
        while index < length:
            opening, closing, next_head, next_token = (
                pattern.search(text, index) for pattern in (_OPEN, _CLOSE, _HEAD, _TOKEN)
            )
            starts = [m.start() for m in (opening, closing, next_head, next_token) if m]
            if not starts:
                index = length
                item_end = length
                break
            first = min(starts)
            if closing and closing.start() == first:
                return False              # a closing mark with no opening one
            if opening and opening.start() == first:
                end = next((m for m in _CLOSE.finditer(text, opening.end()) if m.group(1) == opening.group(1)), None)
                if end is None:
                    return False          # the words are not closed: cut short
                marked = True
                index = end.end()
                item_end = index
                # after the closing mark only another message may follow
                tail = text[index:].lstrip()
                if tail and not (_HEAD.match(tail) or _TOKEN.match(tail)):
                    return False
                break
            if next_head and next_head.start() == first:
                index = next_head.start()
                item_end = index
                break
            # a paste token inside a message: the start of another message if it is explained, else somebody's
            if token_ok is None or not token_ok(next_token.group(0)):
                return False
            index = next_token.start()
            item_end = index
            break
        if needs_marks and not marked:
            return False                  # the person's words without their fence: not what the app sends
        if not marked and (known is None or not known(squash(text[item_start:item_end]))):
            return False                  # no marks and not a text the transport pasted: it may be somebody's typing
    return True


def registry_token_ok(record: list[str], now: float, window: float):
    """``token_ok`` for ``signed_only`` from the transport's record of what it pasted last
    (``time sha chars newlines``): a token of Codex counts our characters, so it is explained whatever its age;
    one of Claude counts lines, which a person can paste too, so it is explained only inside ``window`` seconds."""
    if len(record) not in (4, 6):
        return lambda token: False
    try:
        age = now - int(record[0])
        chars, newlines = int(record[2]), int(record[3])
    except ValueError:
        return lambda token: False

    def explained(token: str) -> bool:
        if _CODEX_PASTE.match(token):
            return paste_placeholder_fits(token, chars, newlines, claude=False)
        return 0 <= age <= window and paste_placeholder_fits(token, chars, newlines, claude=True)

    return explained


def signed_base(pane: str, token_ok=None, known=None) -> str | None:
    """The composer's text, squashed, when it holds only signed text (``signed_only``); else ``None``."""
    actual = agent_chat.composer_text(pane)
    return squash(actual) if signed_only(actual, token_ok, known) else None


def fingerprints_known(lines: list[str], now: float, ttl: float):
    """``known`` for ``signed_only`` from the transport's fingerprints of what it pasted (``time sha`` per line,
    the sha of the message without spaces): a text is known when its fingerprint is there and not older than
    ``ttl`` seconds. A line that cannot be read is no fingerprint."""
    shas = set()
    for line in lines:
        parts = line.split()
        if len(parts) == 2 and len(parts[1]) == 64:
            try:
                if 0 <= now - int(parts[0]) <= ttl:
                    shas.add(parts[1])
            except ValueError:
                continue

    def known(squashed: str) -> bool:
        return hashlib.sha256(squashed.encode()).hexdigest() in shas

    return known
