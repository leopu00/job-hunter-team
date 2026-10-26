"""What jht-tmux-send needs to know about a composer that holds a pasted paste token.

A TUI keeps a long paste out of sight: past a size its composer draws a token instead of the text.
Kept apart from agent_chat.py (the composer reader, which others edit): this only adds, on top of
`agent_chat.composer_text`, the question «is what the composer shows OUR paste?».
"""
from __future__ import annotations

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


def composer_relation(pane: str, expected: str, *, allow_placeholder: bool = False) -> tuple[str, int, int]:
    """How the composer stands against the text we pasted: ``ours`` (exactly it, spaces apart: a wrapped row
    loses the space at the wrap), ``partial`` (the start of it: the TUI is still drawing the paste) or ``other``.
    With ``allow_placeholder`` (only when the composer was empty before the paste) a single paste token that
    fits the text is ``ours`` too. The two lengths are the composer's and the text's, never the text."""
    actual = agent_chat.composer_text(pane)
    squash = lambda text: "".join(text.split())
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
