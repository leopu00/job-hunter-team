"""The composer of Pi's TUI (`--tui-mode regular`), read from a pane capture.

Kept apart from agent_chat.py, which reads the composers of Claude Code and Codex by their marker (`❯`, `›`).
Pi's has none: the draft sits between two horizontal rules, with the folder and the totals line under them.

    ── ⠹ Working ─────────────  top rule; the label is there only while a turn (or a retry) runs
    <the draft, one row or more, blank when empty>
    ─────────────────────────  bottom rule
    <folder>                    (and more rows an extension may add)
    ↑827 ↓5 $0.002 0.3%/272k (auto)        gpt-5.6-terra • low      the totals line, always the last row

Seen on Pi 1.5.0 in tmux (live captures of 09/11/2026); the footer is the same code
in the pinned 1.3.0 (components/footer.js). The totals line is the signature: `<share>%/<window>` (or `?/<window>` when the
share is not known yet) is not drawn by Claude Code or Codex, so their composers are never taken for Pi's.

A screen that does not have exactly this shape (a menu or a list under the draft, the footer cut by the window)
is NOT Pi's composer: `read` answers None and the caller goes on as it did.
"""
from __future__ import annotations

import re

_RULE = re.compile(r"^\s*─{2,}(?:\s+[^─]{1,80}?\s+)?─{10,}\s*$")
# `0.3%/272k (auto)`, `?/272k`, `12.5%/1.0M`, `100.0%/8192`; the model and the thinking level close the line.
_TOTALS = re.compile(r"(?:^|\s)(?:\d+(?:\.\d+)?%|\?)/\d+(?:\.\d+)?[kM]?(?:\s|$)")
_SPINNER = re.compile(r"[⠀-⣿]")
# The footer of every selector Pi opens in place of the composer: /login, /model, the "Trust project folder?" dialog.
_MENU = re.compile(r"^\s*↑↓ navigate\b.*\bescape\b")
_CODES = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_WORKING = re.compile(r"\bWorking\b")
# Rows an extension may draw between the bottom rule and the totals line (folder, git branch, statuses).
_FOOTER_ROWS_MAX = 4
_DRAFT_ROWS_MAX = 40


def _menu_rows(rows):
    return any(_MENU.match(plain) for _raw, plain in rows[-8:])


def menu(pane):
    """True when the screen ends with a selector of Pi (sign-in, model, trust): a paste or an Enter would pick a choice."""
    rows = [("", _CODES.sub("", raw).rstrip()) for raw in (pane or "").splitlines()]
    rows = rows[:max((at + 1 for at, row in enumerate(rows) if row[1].strip()), default=0)]
    return bool(rows) and _menu_rows(rows)


def read(rows):
    """``(kind, busy, text)`` for the last Pi composer in ``rows`` (``[(raw, plain)]``, trailing blanks already
    dropped), or ``None`` when the bottom of the screen is not Pi's. ``kind`` is ``empty`` or ``text``."""
    last = len(rows) - 1
    if last < 3 or not _TOTALS.search(rows[last][1]) or _menu_rows(rows):
        return None
    bottom = next((at for at in range(last - 1, max(-1, last - 1 - _FOOTER_ROWS_MAX), -1)
                   if _RULE.match(rows[at][1])), None)
    if bottom is None:
        return None
    top = next((at for at in range(bottom - 1, max(-1, bottom - 2 - _DRAFT_ROWS_MAX), -1)
                if _RULE.match(rows[at][1])), None)
    if top is None or top == bottom - 1:
        return None
    draft = [plain.strip() for _raw, plain in rows[top + 1:bottom]]
    label = rows[top][1]
    busy = bool(_SPINNER.search(label) or _WORKING.search(label))
    text = "".join(draft)
    return ("text" if text else "empty"), busy, text


def screen(pane, strip, tail):
    """``(rows, pi)``: the last ``tail`` rows ``(raw, plain)`` of a pane (``strip`` takes the escape codes off, the blank
    rows at the end are dropped), and what ``read`` makes of the whole screen."""
    rows = [(raw, strip(raw).rstrip()) for raw in (pane or "").splitlines()]
    rows = rows[:max((at + 1 for at, row in enumerate(rows) if row[1].strip()), default=0)]
    return rows[-tail:], read(rows)
