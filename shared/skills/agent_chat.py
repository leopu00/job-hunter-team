#!/usr/bin/env python3
"""The user's chat with one agent, container side: the only way the app reaches it.

The desktop app runs this file with fixed arguments and nothing else (a VPS
team: `docker exec -i ... python3 /app/shared/skills/agent_chat.py ...` on the
pinned container; a local team goes through the attested `jht` wrapper):

    agent_chat.py read AGENT [CURSOR]
    agent_chat.py send AGENT CLIENT_ID        (the text on stdin)

An agent is a name from a closed list, a client id and a cursor have a closed
alphabet, and the text never travels in an argument. Nothing here takes a
command: it reads the chat file, or writes one user turn and hands it to the
agent's terminal through the same verified delivery as every other message.

The chat is the file `agents/<agent>/chat.jsonl` (the one `jht-send` writes the
agent's replies to): history and answers are read from it and never from the
screen of the terminal.

`send`, in this order, so that a refusal leaves nothing behind:
  1. the text is cleaned (controls, invisible direction marks) and bounded;
  2. an id already DELIVERED answers ok and delivers nothing: a link that fell
     after the delivery asks again with the same id, and the agent must not
     read the message twice;
  3. the agent's session is not there -> a closed code, NOTHING written and
     nothing started (this file never starts an agent);
  4. the agent's terminal must show an empty composer. A menu, sign-in,
     permission question or text already typed there is a closed code; a turn
     in progress is waited out for a few seconds (JHT_CHAT_BUSY_WAIT) and, past
     that, the turn is QUEUED (written to chat-queue.jsonl, not typed): the
     next read or send that finds the agent idle delivers it, oldest first;
     nothing is pasted while the agent works. NOTHING is typed over something
     that could take it as a choice or overwrite a draft;
  5. the turn is written once per client id (a repeat is not a second line),
     and one that was written but never delivered is delivered again from the
     line already there, with no new line;
  6. the turn goes to the terminal in the user's envelope, which the message
     fence (message_origin.py) puts between its own marks, and only if that
     fence is in this image (the delivery below would otherwise type the text
     as written); then the id is recorded as delivered. Delivered means the
     transport saw the CLI take the text: typed in the composer, then sent.
The whole of it runs under one lock per agent, so two asks with the same id
cannot both deliver. A dropped link does not stop it halfway (SIGHUP and SIGPIPE
are ignored): what was delivered is recorded.

Every answer is one JSON line on stdout. A failure exits with a closed code
(EXIT below) and says it as {"error": "<code>"}; the app turns it into a
sentence of its error catalog. python3 answers 2 for a missing file: an image
older than this chat, which the app says as «update the team».
"""
from __future__ import annotations

import collections
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - the container is Linux
    fcntl = None


# ── closed codes ────────────────────────────────────────────────────────────
# 0 is done. The 120 range stays clear of the pinned target's 70 and of the
# agent control panel's 100-112.
EXIT = {
    "chat_invalid": 120,
    "team_not_running": 121,
    "agent_not_running": 122,
    "agent_unavailable": 123,
    "agent_busy": 124,
    "agent_stuck": 125,
    "send_failed": 126,
    "read_failed": 127,
    "persist_failed": 128,
    "fence_missing": 129,
    # Below 120: from 128 up an exit is also a signal's (130 is an interrupt).
    # 130 is deliberately the one exception: the app needs to tell the person
    # that somebody has an unsent draft, rather than writing over it.
    "composer_has_text": 130,
    "agent_not_at_prompt": 119,
    # The answer to an agent's question (`answer`): the four codes the app knows, and an image
    # without the questions module or its database.
    "question_closed": 118,
    "invalid_choice": 117,
    "question_not_found": 116,
    "answer_failed": 115,
    "answer_unavailable": 114,
}

# jht-tmux-send's own exits: 2 no session, 3 the terminal never took the text,
# 4 busy (alive: try again), 5 text taken but never submitted (alive, stuck).
DELIVERY_EXIT = {2: "agent_not_running", 3: "agent_unavailable", 4: "agent_busy", 5: "agent_stuck",
                 8: "agent_busy", 130: "composer_has_text"}   # 8: another writer held the terminal too long; nothing was typed
# 0: the transport saw the CLI take the text (a proof). 7: the text left the composer but nothing proves
# the CLI took it. Both are delivered, and never typed again with the same id; the second says «not sure».
DELIVERY_UNCONFIRMED = 7
# 5 is the text left in the composer (taken false): the transport prints the signature of THAT text,
# with which an older transport may press Enter on it. 9 (only with --enter): no safe retry.
DELIVERY_PENDING = 5
DELIVERY_NOT_THERE = 9
ENTER_REASONS = frozenset({"menu", "empty_unseen", "not_ours", "retry_unattested"})
SIGNATURE = re.compile(r"^JHT_SIGNATURE ((?:[0-9a-f]{2}){1,64})$", re.M)
ENTER_REASON = re.compile(r"^JHT_REASON ([a-z_]{1,20})$", re.M)
# What the transport prints when it leaves the text in the composer without submitting it (half drawn, changed under
# the paste): from then on the turn is waiting THERE, and the chat submits it when the agent is free.
STUCK = re.compile(r"^JHT_STUCK$", re.M)
MESSAGE_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")

# The ids are the roles' keys; the value is the tmux session.
AGENTS = {
    "capitano": "CAPITANO",
    "assistente": "ASSISTENTE",
    "mentor": "MENTOR",
    "scout": "SCOUT-1",
    "analista": "ANALISTA-1",
    "scorer": "SCORER-1",
    "scrittore": "SCRITTORE-1",
    "critico": "CRITICO",
}

CLIENT_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")
# A byte offset into a chat file: 12 digits are a terabyte.
CURSOR = re.compile(r"^[0-9]{1,12}$")
MAX_TEXT = 4000
# 4 bytes a character is the most UTF-8 spends; one more byte tells «too long».
MAX_STDIN = MAX_TEXT * 4 + 1
HISTORY_TAIL = 131072
DEDUP_TAIL = 1048576
# The ids already delivered, next to the chat: one short line each.
DELIVERED_FILE = "chat-delivered.jsonl"
# The codes a system line of the chat may carry to the app; the app has a sentence for each.
SYSTEM_CODES = frozenset({"mail_not_taken", "message_too_long"})
LOCK_FILE = ".chat-send.lock"
MAX_LINE = 65536
PAGE_ROWS = 120
TMUX_TIMEOUT_S = 10
# The prompt is looked for in the last lines of the pane: the transcript scrolls above it.
PROMPT_TAIL = 15
DELIVERY_TIMEOUT_S = 100
PROMPT_WAIT_S = float(os.environ.get("JHT_CHAT_PROMPT_WAIT", "100"))
PROMPT_POLL_S = float(os.environ.get("JHT_CHAT_PROMPT_POLL", "2"))
# A turn in progress is waited out for a few seconds before anything is pasted: the layout of a working CLI
# changes under the paste, and text that cannot be attested would stay in its composer.  Past the wait the
# turn is QUEUED (written, not typed) and delivered by the next read or send that finds the agent idle.
BUSY_WAIT_S = float(os.environ.get("JHT_CHAT_BUSY_WAIT", "3"))
QUEUE_FILE = "chat-queue.jsonl"
# A turn whose text is in the composer and then finds it empty: a late draw is waited for this long.
TYPED_GONE_AFTER_S = 30.0
# The detached process that sees to the queue when nobody reads or writes: how often, and for how long
# (the life of a queued turn plus a margin).
DRAIN_EVERY_S = float(os.environ.get("JHT_CHAT_DRAIN_EVERY", "5"))
# A queued turn is typed only while it is fresh: past this it is NOT sent (never typed, whatever the agent
# does later) and the page says so.  Delivery and expiry are reported for a day, then forgotten.
QUEUE_TTL_S = float(os.environ.get("JHT_CHAT_QUEUE_TTL", "1200"))
QUEUE_REPORT_S = 86400.0
# Reads deliver the queue (the chat page reads every second or two).  "0": only a send does.
FLUSH_ON_READ = os.environ.get("JHT_CHAT_FLUSH_ON_READ", "1") != "0"

# Direction marks and zero-width characters read as nothing and rewrite what
# is around them. ZWNJ/ZWJ (U+200C/D) stay: Persian and emoji need them.
_INVISIBLE = frozenset(
    [0x061C, 0x200B, 0x200E, 0x200F, 0x2060, 0xFEFF]
    + list(range(0x202A, 0x202F))
    + list(range(0x2066, 0x206A))
    + list(range(0xE0000, 0xE0080))
)


class Refusal(Exception):
    def __init__(self, code: str, typed: bool = False):
        super().__init__(code)
        self.code = code
        # The transport said the text stayed in the composer (JHT_STUCK): the turn is ours there, not lost.
        self.typed = typed


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def chat_path(agent: str) -> Path:
    return jht_home() / "agents" / agent / "chat.jsonl"


def agent_of(value: str) -> str:
    if value not in AGENTS:
        raise Refusal("chat_invalid")
    return value


def clean_text(raw: str) -> str:
    """The user's words with nothing in them that a terminal or a reader obeys."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n").replace(" ", "\n").replace(" ", "\n")
    kept = []
    for ch in text:
        code = ord(ch)
        if ch == "\n":
            kept.append(ch)
        elif ch == "\t":
            kept.append(" ")
        elif code in _INVISIBLE or unicodedata.category(ch) in ("Cc", "Cs", "Co"):
            continue
        else:
            kept.append(ch)
    return "".join(kept).strip()


# ── read ────────────────────────────────────────────────────────────────────
def read(agent: str, cursor_text: str | None) -> dict:
    if cursor_text not in (None, "") and not CURSOR.match(cursor_text):
        raise Refusal("chat_invalid")
    if FLUSH_ON_READ:
        flush_queue(agent, AGENTS[agent])
    page = _read_page(agent, cursor_text)
    if _queue_path(agent).is_file():
        waiting, settled = _queue_state(agent)
        page["queued"] = [str(held.get("message_id")) for held in waiting]
        page["settled"] = settled       # how each turn that left the queue ended, for the page to say
    if _awaiting_reply(agent):
        activity = activity_of(agent)
        if activity:
            page["activity"] = activity     # absent = not known; never read as idle
    return page


# The person's last turn is waiting for an answer: nothing from the agent after it, and young enough
# that what the agent does now is about it.  Only then does a read look at the terminal at all.
ACTIVITY_WINDOW_S = 1800.0
ACTIVITY_CAPTURE_TIMEOUT_S = 2.0


def _awaiting_reply(agent: str) -> bool:
    path = chat_path(agent)
    last_user = last_agent = None
    try:
        size = path.stat().st_size
        with open(path, "rb") as handle:
            handle.seek(max(0, size - HISTORY_TAIL))
            for raw in handle:
                if len(raw) > MAX_LINE:
                    continue
                try:
                    row = json.loads(raw.decode("utf-8"))
                except Exception:
                    continue
                at = row.get("ts") if isinstance(row, dict) else None
                if isinstance(at, bool) or not isinstance(at, (int, float)):
                    continue
                if row.get("role") == "user":
                    last_user = at
                elif row.get("role") == "assistant" and str(row.get("text") or "").strip():
                    last_agent = at
    except OSError:
        return False
    if last_user is None or (last_agent is not None and last_agent >= last_user):
        return False
    return 0 <= time.time() - last_user <= ACTIVITY_WINDOW_S


def activity_of(agent: str) -> str | None:
    """`working` while the agent's CLI shows a running turn, `idle` at an empty prompt, None when
    the screen cannot say (no session, a menu, a draft, a form this reader does not know)."""
    # A stuck tmux must not hold every read: the page reads every second or two.
    pane = capture_pane(AGENTS[agent], ACTIVITY_CAPTURE_TIMEOUT_S)
    if pane is None:
        return None
    state, busy = composer_snapshot(pane)
    if busy:
        return "working"
    return "idle" if state == "empty" else None


def _read_page(agent: str, cursor_text: str | None) -> dict:
    path = chat_path(agent)
    if not path.is_file():
        page = {"messages": [], "cursor": "0"}
        found = questions_of(agent)
        if found is not None:
            page["questions"] = found
        return page
    size = path.stat().st_size
    if cursor_text in (None, ""):
        cursor = max(0, size - HISTORY_TAIL)
    else:
        cursor = max(0, min(size, int(cursor_text)))
    # A first read (no cursor) is the newest page: the tail is read to its end and only its last
    # PAGE_ROWS rows are kept. A read from a cursor goes on from there, at most PAGE_ROWS rows.
    newest = cursor_text in (None, "")
    messages = collections.deque(maxlen=PAGE_ROWS) if newest else []
    try:
        with open(path, "rb") as handle:
            handle.seek(cursor)
            if cursor:
                handle.readline()
            while newest or len(messages) < PAGE_ROWS:
                start = handle.tell()
                raw = handle.readline()
                if not raw:
                    break
                if len(raw) > MAX_LINE:
                    continue
                try:
                    row = json.loads(raw.decode("utf-8"))
                except Exception:
                    continue
                if not isinstance(row, dict):
                    continue
                text = str(row.get("text") or "").strip()
                if not text:
                    continue
                role = str(row.get("role") or "").lower()
                role = "user" if role == "user" else ("agent" if role in ("assistant", "agent") else "system")
                try:
                    at = float(row.get("ts") or 0)
                except (TypeError, ValueError):
                    at = 0.0
                mid = str(row.get("message_id") or hashlib.sha256((agent + ":" + str(start) + ":").encode() + raw).hexdigest())
                shown = {"id": mid, "role": role, "text": text, "at": at}
                if role == "agent":
                    shown.update(_agent_fields(row))
                code = row.get("code")
                if role == "system" and isinstance(code, str) and code in SYSTEM_CODES:
                    shown["code"] = code        # a closed code the app may say in its own language
                messages.append(shown)
            cursor = handle.tell()
    except OSError:
        raise Refusal("read_failed")
    page = {"messages": list(messages), "cursor": str(cursor)}
    found = questions_of(agent)
    if found is not None:
        page["questions"] = found       # absent: an image without the questions (the app shows no answer)
    return page


# ── send ────────────────────────────────────────────────────────────────────
def _tmux(*args: str) -> int:
    try:
        done = subprocess.run(["tmux", *args], capture_output=True, timeout=TMUX_TIMEOUT_S, check=False)
    except (OSError, subprocess.SubprocessError):
        return 1
    return done.returncode


def check_session(session: str) -> None:
    """Refuses, writing nothing, when the agent is not there to be written to."""
    if _tmux("list-sessions") != 0:
        raise Refusal("team_not_running")
    if _tmux("has-session", "-t", "=" + session) != 0:
        raise Refusal("agent_not_running")


# ── at the prompt ───────────────────────────────────────────────────────────
# This is intentionally a *shape* reader.  Words in an empty composer change
# with every CLI release, whereas SGR dim is the terminal's explicit promise
# that the words are a suggestion rather than an unsent draft.
_CSI = re.compile(r"\x1b\[([0-?]*)([ -/]*)([@-~])")
_BORDER = re.compile(r"^\s*[╭╰┌└├]?[─━═┄╌]{20,}[╮╯┐┘┤]?\s*$")
_BOXED_COMPOSER = re.compile(r"^\s*[│┃╎|]\s*([❯›>▌])(.*?)(?:[│┃╎|]\s*)?$")
_PLAIN_COMPOSER = re.compile(r"^\s*([❯›▌])(.*?)\s*$")
# Codex at rest puts the model and folder under the composer (the «·» line); in the middle of a turn that line
# becomes «tab to queue message ... 80% context left», with no «·». Without these two phrases a composer in a
# working Codex is not a composer at all: the text pasted into it is «another draft» and nothing presses Enter.
_CODEX_HINT = re.compile(r"(?:\? for shortcuts\b|← for agents\b|^\s*tab to queue message\b|\s{6,}\d{1,3}% context left\s*$)")
_CODEX_DOT_FOOTER = re.compile(r"^\s+.*·.*$")
_NUMBERED_OPTION = re.compile(r"^\s*\d{1,3}[.)]\s+")


def strip_terminal_codes(value: str) -> str:
    """Visible text of a capture-pane -e screen, without changing its rows."""
    return _CSI.sub("", value or "")


def _sgr_sets_dim(params: str, dim: bool) -> bool:
    """Apply an SGR parameter list, not mistaking RGB's colour-space ``2`` for dim."""
    pieces = params.split(";") if params else ["0"]
    at = 0
    while at < len(pieces):
        whole = pieces[at]
        code = whole.split(":", 1)[0] or "0"
        if code in {"38", "48", "58"}:
            # Semicolon RGB is 38;2;R;G;B; colon RGB is one parameter.  In
            # both forms its 2 is a colour-space selector, never SGR faint.
            if ":" in whole:
                at += 1
            elif at + 1 < len(pieces) and pieces[at + 1] == "2":
                at += 5
            elif at + 1 < len(pieces) and pieces[at + 1] == "5":
                at += 3
            else:
                at += 1
            continue
        if code == "0":
            dim = False
        elif code == "2":
            dim = True
        elif code == "22":
            dim = False
        at += 1
    return dim


def _visible_with_dim(raw: str) -> tuple[str, list[bool]]:
    """Return visible characters and whether each was drawn faint (SGR 2)."""
    visible: list[str] = []
    faint: list[bool] = []
    dim = False
    at = 0
    for match in _CSI.finditer(raw or ""):
        chunk = (raw or "")[at:match.start()]
        visible.extend(chunk)
        faint.extend([dim] * len(chunk))
        if match.group(3) == "m":
            dim = _sgr_sets_dim(match.group(1), dim)
        at = match.end()
    chunk = (raw or "")[at:]
    visible.extend(chunk)
    faint.extend([dim] * len(chunk))
    return "".join(visible), faint


def _status_line_busy(line: str) -> bool:
    """A status line saying a turn is running, not prose that mentions it (the transport's own rule)."""
    lower = line.lower()
    if "esc to interrupt" not in lower:
        return False
    before, _, after = lower.partition("esc to interrupt")
    if before.rstrip().endswith(('"', "'", "“", "«")):
        return False
    if len(after) > 40:
        return False
    rest = after.rstrip(") ").lstrip()
    return rest == "" or rest[0] in "·•|,-"


def _composer_match(line: str):
    return _BOXED_COMPOSER.match(line) or _PLAIN_COMPOSER.match(line)


def _only_faint_content(raw: str, plain: str, marker_at: int, boxed: bool) -> bool:
    """True for an empty marker or a suggestion whose visible glyphs are all dim."""
    _, faint = _visible_with_dim(raw)
    end = len(plain)
    if boxed:
        while end > marker_at + 1 and plain[end - 1].isspace():
            end -= 1
        if end > marker_at + 1 and plain[end - 1] in "│┃╎|":
            end -= 1
    start = marker_at + 1
    while start < end and plain[start].isspace():
        start += 1
    while end > start and plain[end - 1].isspace():
        end -= 1
    if start == end:
        return True
    return all(faint[index] for index in range(start, end) if not plain[index].isspace())


def _codex_footer(lines: list[tuple[str, str]], index: int) -> bool:
    """Codex puts an indented model/path or a recognised hint below ``›``.

    A long draft wraps: its continuation rows sit between the marker and that
    footer.  They are skipped only when they look like wrapped text (see
    ``_wrapped_continuation``), never for a short menu row.
    """
    below = lines[index + 1:]
    if _footer_follows(below):
        return True
    return _footer_follows(below[_wrapped_continuation(lines, index):])


def _footer_follows(below: list[tuple[str, str]]) -> bool:
    footers: list[str] = []
    for _raw, plain in below:
        if not plain.strip():
            continue
        footers.append(plain)
        if len(footers) > 3:
            return False
    if not footers:
        return False
    first = footers[0]
    return bool(_CODEX_DOT_FOOTER.match(first) or _CODEX_HINT.search(first))


_WRAPPED_MARKER_MIN = 100
_WRAPPED_ROWS_MAX = 12
_WRAPPED_FULL_RATIO = 0.85


def _wrapped_continuation(lines: list[tuple[str, str]], index: int) -> int:
    """How many rows right under a long ``›`` row continue its wrapped text.

    The rows must be contiguous (a blank row ends them), and every one but the
    last nearly as long as the marker row, which is what a terminal wrap draws.
    Menu choices are short and never have this shape.
    """
    width = len(lines[index][1].strip())
    if width < _WRAPPED_MARKER_MIN:
        return 0
    run: list[str] = []
    for _raw, plain in lines[index + 1:]:
        if not plain.strip():
            break
        run.append(plain)
    if not run or len(run) > _WRAPPED_ROWS_MAX:
        return 0
    if any(_composer_match(row) or _BORDER.match(row) or _status_line_busy(row)
           or _NUMBERED_OPTION.match(row) for row in run):
        return 0
    if any(len(row.strip()) < _WRAPPED_FULL_RATIO * width for row in run[:-1]):
        return 0
    return len(run)


def _claude_box(lines: list[tuple[str, str]], index: int, boxed: bool) -> bool:
    """Claude's input mark lives in a box/rule; a menu never earns that shape."""
    if boxed:
        return True
    above = next((plain for _raw, plain in reversed(lines[:index]) if plain.strip()), "")
    below = next((plain for _raw, plain in lines[index + 1:] if plain.strip()), "")
    return bool(_BORDER.match(above) and _BORDER.match(below))


def composer_snapshot(pane: str) -> tuple[str, bool]:
    """Return ``(empty|text|none, busy)`` from the last coloured pane rows.

    ``busy`` is presentation/status only.  A visible empty composer remains
    safe to paste into while a CLI is processing a previous turn.
    """
    raw_lines = (pane or "").splitlines()
    rows = [(raw, strip_terminal_codes(raw).rstrip()) for raw in raw_lines]
    while rows and not rows[-1][1].strip():
        rows.pop()
    rows = rows[-PROMPT_TAIL:]
    busy = any(_status_line_busy(plain) for _raw, plain in rows[-10:])
    for index in range(len(rows) - 1, -1, -1):
        raw, plain = rows[index]
        match = _composer_match(plain)
        if not match:
            continue
        marker = match.group(1)
        # A permission/list option can be drawn inside a Claude box and has
        # the same glyph as the composer.  Its number is structural, never a
        # user draft (and never a safe target for paste or Enter).
        if _NUMBERED_OPTION.match(match.group(2)):
            continue
        marker_at = plain.index(marker)
        boxed = bool(_BOXED_COMPOSER.match(plain))
        if marker == "›":
            if not _codex_footer(rows, index):
                continue
        elif not _claude_box(rows, index, boxed):
            continue
        return ("empty" if _only_faint_content(raw, plain, marker_at, boxed) else "text"), busy
    return "none", busy


def composer_state(pane: str) -> str:
    """The guarded send gate: ``empty``, ``text`` or ``none``."""
    return composer_snapshot(pane)[0]


def _contiguous_neighbours(raw_lines: list[str], index: int, reach: int, gap: bool = False) -> list[int]:
    """Rows within ``reach`` of ``index`` that no blank row separates from it.

    A menu draws its choices together.  A cursor row with a footer or a hint
    behind a blank row is chrome around a composer, not two choices.  With
    ``gap`` one blank row between two rows is crossed (a spaced list); two in
    a row end the walk.
    """
    found: list[int] = []
    for step in (-1, 1):
        blanks = 0
        for at in range(index + step, index + step * (reach + 1), step):
            if not 0 <= at < len(raw_lines):
                break
            if not raw_lines[at].strip():
                blanks += 1
                if not gap or blanks > 1:
                    break
                continue
            blanks = 0
            found.append(at)
    return found


def _certain_interlock(pane: str) -> bool:
    """True only for a UI that is certainly asking the human to choose or sign in.

    The composer is presentation, not an authority.  A new Codex layout can
    legitimately have no marker that this parser knows; treating that as a
    refusal made chat unavailable every time the CLI changed its chrome.  We
    retain a closed gate for controls on which a paste or Enter has a meaning
    other than writing to the conversation: numbered choices, sign-in, and
    permission prompts.
    """
    raw_lines = [strip_terminal_codes(line).rstrip().casefold() for line in (pane or "").splitlines()]
    while raw_lines and not raw_lines[-1].strip():
        raw_lines.pop()
    # The unnumbered geometric rule below only looks where the composer
    # snapshot looks: a historic ``›`` echo of a past message, far up the
    # screen, with a short line near it, is transcript and never a menu.  The
    # numbered rule keeps the whole screen: a tall selector (two rows per
    # entry) can have its cursor above that tail, and Enter would pick it.
    tail_start = max(0, len(raw_lines) - PROMPT_TAIL)
    lines = [line.strip() for line in raw_lines]
    rows = list(zip(raw_lines, raw_lines))

    # A recognised composer and its Codex footer are UI chrome, never menu
    # choices.  In particular, a freshly changed Codex footer can be short
    # and adjacent to ``›``: counting it as a sibling would silence chat.
    composer_rows: set[int] = set()
    footer_rows: set[int] = set()
    for index, (_raw, plain) in enumerate(rows):
        numbered_option = bool(re.match(r"^\s*[›❯]?\s*\d+[.)]\s+\S", plain))
        if not numbered_option and (_CODEX_DOT_FOOTER.match(plain) or _CODEX_HINT.search(plain)):
            footer_rows.add(index)
        match = _composer_match(plain)
        if not match or _NUMBERED_OPTION.match(match.group(2)):
            continue
        marker = match.group(1)
        boxed = bool(_BOXED_COMPOSER.match(plain))
        if ((marker == "›" and _codex_footer(rows, index))
                or (marker != "›" and _claude_box(rows, index, boxed))):
            composer_rows.add(index)

    # A selected numbered row plus another numbered row is a choice list even
    # when its wording is new or localized.  Do not mistake ordinary numbered
    # prose for one: it needs the live selection mark as well.
    numbered = [line for index, line in enumerate(lines)
                if index not in composer_rows and index not in footer_rows
                and re.match(r"^(?:[›❯]\s*)?\d+[.)]\s+\S", line)]
    selected_numbered = any(index not in composer_rows and index not in footer_rows
                            and re.match(r"^[›❯]\s*\d+[.)]\s+\S", line)
                            for index, line in enumerate(lines))
    if selected_numbered and len(numbered) >= 2:
        return True

    # Localized action lists are often unnumbered, but their geometry is
    # still stable: one cursor row and another short sibling row, commonly
    # inside a box.  Inspect that structure, never the translated labels.
    def choice_body(line: str) -> str:
        return line.strip().strip("│┃╎|").strip()

    def option_shape(raw: str) -> str:
        return "boxed" if raw.strip().startswith(("│", "┃", "╎", "|")) else "plain"

    for index, raw in enumerate(raw_lines):
        if index < tail_start or index in composer_rows or index in footer_rows:
            continue
        selected = choice_body(raw)
        if not re.match(r"^[›❯]\s+\S", selected):
            continue
        # The echo of a long input of the conversation (Codex 0.147 draws what it was sent
        # with the same ``›``, wrapped over two rows or more): the rows under it are its own
        # continuation, not sibling choices.  It sits in the transcript, ABOVE the composer: a
        # live menu takes the composer's place, so a long first choice with one short sibling
        # and no composer under it stays a menu.
        if _wrapped_continuation(rows, index) and any(at > index for at in composer_rows):
            continue
        def sibling_rows(reach: int, gap: bool) -> list[int]:
            rows_found = []
            for sibling_index in _contiguous_neighbours(raw_lines, index, reach, gap):
                if sibling_index in composer_rows or sibling_index in footer_rows:
                    continue
                sibling_raw = raw_lines[sibling_index]
                sibling = choice_body(sibling_raw)
                if not sibling or sibling == selected or sibling.startswith(("›", "❯", "╭", "╰", "─")):
                    continue
                # A true localized menu has two option rows of the same form.  A
                # recognised composer/footer pair is excluded above before this
                # structural check can make it a false menu.
                if len(sibling) <= 80 and option_shape(sibling_raw) == option_shape(raw):
                    rows_found.append(sibling_index)
            return rows_found

        # Choices drawn together: one sibling is enough.  A spaced list (a blank row between choices) needs
        # two, so that a cursor row, a blank row and one footer hint stay what they are: a composer.
        if sibling_rows(3, False) or len(sibling_rows(6, True)) >= 2:
            return True

    # Transcript prose is never an interlock.  A completed permission or
    # login can remain visible above a fresh composer; only controls whose
    # CURRENT geometry is attestable may stop a chat send.
    return False


def delivery_gate(pane: str) -> str:
    """Return ``empty``, ``none``, ``text`` or ``blocked`` for a chat send.

    ``none`` intentionally stays writable: after paste the transport must
    prove the submit, but an unknown Codex form is not itself a menu.  A real
    draft still wins over all other states and is never overwritten.
    """
    state, _busy = composer_snapshot(pane)
    if state == "text":
        return "text"
    if _certain_interlock(pane):
        return "blocked"
    return state


def composer_text(pane: str) -> str | None:
    """The visible draft in the last recognised composer, or ``None``.

    The transport uses this after paste and before Enter: the signature alone
    cannot prove that another draft did not join the paste in the meantime.
    """
    raw_lines = (pane or "").splitlines()
    rows = [(raw, strip_terminal_codes(raw).rstrip()) for raw in raw_lines]
    while rows and not rows[-1][1].strip():
        rows.pop()
    rows = rows[-PROMPT_TAIL:]
    for index in range(len(rows) - 1, -1, -1):
        _raw, plain = rows[index]
        match = _composer_match(plain)
        if not match or _NUMBERED_OPTION.match(match.group(2)):
            continue
        marker = match.group(1)
        marker_at = plain.index(marker)
        boxed = bool(_BOXED_COMPOSER.match(plain))
        if marker == "›":
            if not _codex_footer(rows, index):
                continue
        elif not _claude_box(rows, index, boxed):
            continue

        def fragment(value: str, *, first: bool = False) -> str:
            value = value[marker_at + len(marker):] if first else value.strip()
            if boxed:
                value = value.rstrip()
                if value.endswith(("│", "┃", "╎", "|")):
                    value = value[:-1]
            return value.strip()

        # The rows a long draft wraps onto are its text, whatever they hold: the user's turn is fenced with
        # ``⟦UTENTE·id⟧``, and the closing mark lands on the second row, where a «·» made it look like the
        # model/path footer. They count only when a footer really follows them.
        wrapped = 0 if boxed or marker != "›" else _wrapped_continuation(rows, index)
        if wrapped and not _footer_follows(rows[index + 1 + wrapped:]):
            wrapped = 0
        parts = [fragment(plain, first=True)]
        for offset, (_following_raw, following) in enumerate(rows[index + 1:]):
            if boxed:
                if _BORDER.match(following):
                    break
                stripped = following.strip()
                if not stripped.startswith(("│", "┃", "╎", "|")):
                    break
                parts.append(fragment(stripped[1:]))
            else:
                if offset >= wrapped and (_CODEX_DOT_FOOTER.match(following) or _CODEX_HINT.search(following)):
                    break
                if following.strip():
                    parts.append(following.strip())
        return "".join(parts)
    return None


def prompt_state(pane: str) -> str:
    """Compatibility view for mail nudges and callers that display activity."""
    state, busy = composer_snapshot(pane)
    if busy:
        return "busy"
    return "ready" if state == "empty" else "not_at_prompt"


def capture_pane(session: str, timeout: float = TMUX_TIMEOUT_S) -> str | None:
    try:
        done = subprocess.run(["tmux", "capture-pane", "-e", "-p", "-t", "=" + session + ":"],
                              capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.decode("utf-8", errors="replace")


def require_prompt(session: str, *, wait: bool = True) -> None:
    """Wait only for a known transient control; unknown Codex forms are writable."""
    deadline = time.monotonic() + (PROMPT_WAIT_S if wait else 0)
    saw_busy = False
    while True:
        pane = capture_pane(session)
        if pane is None:
            raise Refusal("agent_unavailable")
        state, busy = composer_snapshot(pane)
        gate = delivery_gate(pane)
        saw_busy = saw_busy or busy
        if gate in {"empty", "none"}:
            return
        if gate == "text":
            raise Refusal("composer_has_text")
        if gate == "blocked":
            raise Refusal("agent_not_at_prompt")
        if not wait or time.monotonic() >= deadline:
            raise Refusal("agent_busy" if saw_busy else "agent_not_at_prompt")
        time.sleep(PROMPT_POLL_S)


def require_idle(session: str, deadline: float) -> None:
    """Nothing is pasted while the agent works: wait for its turn to end, up to ``deadline``."""
    while True:
        pane = capture_pane(session)
        if pane is None:
            raise Refusal("agent_unavailable")
        if not composer_snapshot(pane)[1]:
            return
        if time.monotonic() >= deadline:
            raise Refusal("agent_busy")
        time.sleep(PROMPT_POLL_S)


def _found(path: Path, client_id: str) -> dict | None:
    if not path.is_file():
        return None
    size = path.stat().st_size
    found = None
    with open(path, "rb") as handle:
        handle.seek(max(0, size - DEDUP_TAIL))
        if handle.tell():
            handle.readline()
        for raw in handle:
            try:
                row = json.loads(raw.decode("utf-8"))
            except Exception:
                continue
            if isinstance(row, dict) and row.get("client_message_id") == client_id:
                found = row             # the last record wins: «enter» appends the new outcome
    return found


def _receipt(client_id: str, message_id, at, state: str | None = None, taken: str | None = None) -> dict:
    out = {"accepted": True, "clientMessageId": client_id, "messageId": message_id, "at": at}
    if state:
        out["state"] = state        # "queued": the turn is in the agent's mailbox, not yet taken
    if taken == "taken":
        out["taken"] = True         # the transport saw the CLI take it
    elif taken == "pending":
        out["taken"] = False        # still in the composer: «enter» may press Enter on it
    elif taken == "unconfirmed":
        out["taken"] = None         # typed once, gone from the composer, no proof it was taken
        out["reason"] = "unconfirmed"
    elif taken in ENTER_REASONS:
        out["taken"] = None         # «enter» found something else in the composer and pressed nothing
        out["reason"] = taken
    return out


def persist(agent: str, client_id: str, text: str) -> dict:
    """The user's turn, once per client id; the line that holds it (the existing one on a repeat)."""
    path = chat_path(agent)
    existing = _found(path, client_id)
    if existing is not None:
        return existing
    at = time.time()
    mid = hashlib.sha256((client_id + ":" + str(at)).encode()).hexdigest()
    row = {"role": "user", "text": text, "ts": at, "done": True, "client_message_id": client_id, "message_id": mid}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        raise Refusal("persist_failed")
    return row


def mark_delivered(agent: str, row: dict, taken: str | None = None, signature: str | None = None) -> None:
    """The id is delivered. A failure to say so is not a failure to deliver: the text is already typed."""
    line = {"client_message_id": row.get("client_message_id"), "message_id": row.get("message_id"),
            "at": row.get("ts"), "delivered_at": time.time()}
    if taken:
        line["taken"] = taken
    if signature:
        line["signature"] = signature
    try:
        fd = os.open(chat_path(agent).parent / DELIVERED_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, (json.dumps(line, separators=(",", ":")) + "\n").encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _delivery_binary() -> str:
    found = shutil.which("jht-tmux-send")
    if found:
        return found
    for candidate in (Path("/app/agents/_skills/tmux-send/jht-tmux-send"),
                      Path(__file__).resolve().parents[2] / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"):
        if candidate.is_file():
            return str(candidate)
    raise Refusal("send_failed")


# What `jht-tmux-send --flush-ours` answers when a text sits in the composer: the transport presses Enter
# ONLY on a text it can prove is its own (a delivery of ours that was not submitted, such as the bridge's
# [HEARTBEAT]); it never writes and never deletes.  0: the box is free (nothing there, or ours was taken).
FLUSH_TIMEOUT_S = 60
FLUSH_EXIT = {3: "agent_not_at_prompt", 8: "agent_busy", 2: "agent_unavailable"}


def flush_ours(session: str) -> None:
    """Let the transport submit a text of OURS left in the composer, so that the user's turn can follow it.

    Returns when the transport says the box is free; otherwise raises the closed code of the refusal the
    chat would have given anyway.  An old transport without the mode answers a usage error: the draft
    stays «a draft» (``composer_has_text``), as it always was.
    """
    try:
        binary = _delivery_binary()
        done = subprocess.run([binary, "--flush-ours", session], capture_output=True,
                              timeout=FLUSH_TIMEOUT_S, check=False)
    except (Refusal, OSError, subprocess.SubprocessError):
        raise Refusal("composer_has_text")
    if done.returncode == 0:
        return
    if done.returncode == 2 and b"'--flush-ours'" in (done.stderr or b""):
        # A transport without the mode takes the flag for a session name and answers «no such session»:
        # that is not the agent being gone, it is an old transport; the draft stays a draft.
        raise Refusal("composer_has_text")
    raise Refusal(FLUSH_EXIT.get(done.returncode, "composer_has_text"))


def _origin_module():
    for candidate in (Path(__file__).resolve().parent / "message_origin.py", Path("/app/shared/skills/message_origin.py")):
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("agent_chat_message_origin", candidate)
            module = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            sys.path.insert(0, str(candidate.parent))
            try:
                spec.loader.exec_module(module)
            finally:
                sys.path.remove(str(candidate.parent))
            return module
    return None


def fence_in_this_image(binary: str, envelope: str) -> bool:
    """True only if the transport of THIS image fences the user's turn (JHT-T21).

    The chat types the user's words into an agent's terminal. If the image is older than the fence,
    the transport would type them as written: an ESC or a forged colleague line would reach the
    agent as keys. So the chat refuses to deliver unless (1) the transport calls the message
    origin's `prepare` and (2) that module fences this very envelope. Anything that cannot be
    shown is «no»; the app says it as «update the team».
    """
    try:
        if "message_origin" not in Path(binary).read_text(encoding="utf-8", errors="replace"):
            return False
        module = _origin_module()
        if module is None:
            return False
        probe = module.prepare_message(envelope)
        return isinstance(probe, str) and probe != envelope
    except Exception:
        return False


def envelope_of(agent: str, text: str) -> str:
    # The user's envelope, byte for byte what the app always sent: the fence
    # recognises it by this head and puts the text between its own marks.
    return f"[@utente -> @{agent}] [CHAT] {text}"


def require_fence(agent: str, text: str) -> str:
    """The transport of this image, once it is shown to fence the user's turn; else a refusal."""
    binary = _delivery_binary()
    if not fence_in_this_image(binary, envelope_of(agent, text)):
        raise Refusal("fence_missing")
    return binary


def deliver(agent: str, session: str, text: str) -> tuple[str, str | None]:
    binary = require_fence(agent, text)
    envelope = envelope_of(agent, text)
    try:
        done = subprocess.run([binary, session, envelope], capture_output=True,
                              timeout=DELIVERY_TIMEOUT_S, check=False)
    except (OSError, subprocess.SubprocessError):
        raise Refusal("send_failed")
    if done.returncode == 0:
        return "taken", None
    if done.returncode == DELIVERY_UNCONFIRMED:
        return "unconfirmed", None
    said = done.stdout.decode("utf-8", "replace")
    if done.returncode == DELIVERY_PENDING:
        found = SIGNATURE.search(said)
        if found:
            return "pending", found.group(1)
    raise Refusal(DELIVERY_EXIT.get(done.returncode, "send_failed"), typed=bool(STUCK.search(said)))


def _mail_module():
    """The mailbox of this image (shared/skills/jht_mail.py), or None when the image does not have it."""
    for candidate in (Path(__file__).resolve().parent / "jht_mail.py", Path("/app/shared/skills/jht_mail.py")):
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("agent_chat_jht_mail", candidate)
            module = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(module)
            return module
    return None


def mail_for(agent: str):
    """The mailbox module when `agent` is a mail receiver (the team's config says so), else None: the
    turn then goes to the terminal as it always did. Anything that cannot be shown is «not a receiver»."""
    try:
        mail = _mail_module()
        if mail is not None and mail.agent_id(agent) in mail.load_receivers():
            return mail
    except Exception:
        pass
    return None


def require_mail_fence(agent: str, text: str) -> None:
    """The mailbox fences the user's words when the agent reads them; refuse, writing nothing, unless the
    fence of this image is shown to fence this very turn (the same proof the terminal path asks for)."""
    module = _origin_module()
    envelope = envelope_of(agent, text)
    try:
        if module is None or module.prepare_message(envelope) == envelope:
            raise Refusal("fence_missing")
    except Refusal:
        raise
    except Exception:
        raise Refusal("fence_missing")


def deliver_by_mail(mail, agent: str, session: str, row: dict, text: str) -> dict:
    """Queue the turn in the agent's mailbox and wake the agent if its terminal is at its prompt."""
    try:
        queued = mail.send_user(agent, str(row.get("client_message_id")), str(row.get("text") or text))
    except mail.MailError:
        raise Refusal("send_failed")
    if queued.get("created"):
        try:
            binary = _delivery_binary()
        except Refusal:
            return queued
        mail.nudge_through(binary, session, queued["id"])
    return queued


def _queue_path(agent: str) -> Path:
    return chat_path(agent).parent / QUEUE_FILE


def _queue_lines(agent: str) -> list[dict]:
    path = _queue_path(agent)
    if not path.is_file():
        return []
    lines = []
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(raw)
            except Exception:
                continue
            if isinstance(row, dict) and CLIENT_ID.match(str(row.get("client_message_id") or "")):
                lines.append(row)
    except OSError:
        return []
    return lines


def _queue_state(agent: str) -> tuple[list[dict], list[dict]]:
    """``(waiting, settled)`` for the queued turns of the last day, oldest first.

    ``waiting``: fresh and not delivered, the turns a flush may type.  ``settled``: what became of the others,
    ``{"id": message_id, "how": taken|pending|unconfirmed|expired}``; a turn past QUEUE_TTL_S and never
    delivered is ``expired``, whatever the agent shows now.
    """
    delivered = chat_path(agent).parent / DELIVERED_FILE
    now = time.time()
    seen: set[str] = set()
    waiting: list[dict] = []
    settled: list[dict] = []
    for row in _queue_lines(agent):
        client_id = row["client_message_id"]
        if client_id in seen:
            continue
        seen.add(client_id)
        try:
            age = now - float(row.get("queued_at") or 0)
        except (TypeError, ValueError):
            age = QUEUE_REPORT_S + 1
        record = _found(delivered, client_id)
        if record is not None:
            if age <= QUEUE_REPORT_S:
                how = record.get("taken") if record.get("taken") in ("taken", "pending") else "unconfirmed"
                settled.append({"id": str(row.get("message_id")), "how": how})
        elif age > QUEUE_TTL_S:
            if age <= QUEUE_REPORT_S:
                settled.append({"id": str(row.get("message_id")), "how": "expired"})
        else:
            waiting.append(row)
    return waiting, settled[-64:]


def queued_turns(agent: str) -> list[dict]:
    """The turns written but held back because the agent was working: fresh, not delivered, oldest first."""
    return _queue_state(agent)[0]


def _queue_locked(agent: str, client_id: str, text: str, typed: bool = False) -> dict:
    """Write the turn and queue it (once per client id). The caller holds the agent's lock.

    ``typed``: the text is already in the agent's composer and nothing submitted it; the flush presses Enter on
    it (never types it again) when the agent is free.
    """
    row = persist(agent, client_id, text)
    if not any(held["client_message_id"] == client_id for held in _queue_lines(agent)):
        line = {"client_message_id": client_id, "message_id": row.get("message_id"), "queued_at": time.time()}
        if typed:
            line["typed"] = True
        try:
            fd = os.open(_queue_path(agent), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            try:
                os.write(fd, (json.dumps(line, separators=(",", ":")) + "\n").encode("utf-8"))
                os.fsync(fd)
            finally:
                os.close(fd)
        except OSError:
            raise Refusal("persist_failed")
    out = _receipt(client_id, row.get("message_id"), row.get("ts"), "queued")
    out["queue"] = "terminal"       # held here until the agent is idle, then typed: the page watches it
    _spawn_drain(agent)             # and a process of its own sees to it even if nobody writes or reads again
    return out


def _settle_typed(agent: str, session: str, row: dict, held: dict, pane: str | None) -> bool:
    """A turn whose text is already in the composer: submit it there. True when it is settled (go on to the
    next turn), False when it has to wait. It is never typed again, and a text that is not provably ours is
    never touched (the transport decides that, as for every flush)."""
    if pane is None or composer_snapshot(pane)[1]:
        return False                               # a turn is running: not now
    gate = delivery_gate(pane)
    if gate == "text":
        try:
            flush_ours(session)                    # Enter only on a text it can prove is ours
        except Refusal:
            return False
        mark_delivered(agent, row, "taken")
        return True
    if gate in {"empty", "none"}:
        # The box is empty: someone submitted it (the bridge's flush) or the paste never drew. A late draw is waited
        # for a few seconds; after that nothing proves it, and it is not typed a second time.
        try:
            waited = time.time() - float(held.get("queued_at") or 0)
        except (TypeError, ValueError):
            waited = TYPED_GONE_AFTER_S
        if waited < TYPED_GONE_AFTER_S:
            return False
        mark_delivered(agent, row, "unconfirmed")
        return True
    return False


def flush_queue(agent: str, session: str) -> None:
    """Deliver the queued turns in order while the agent is idle; stop at the first that cannot go now.

    Never waits for the agent: the same gate as a send (a draft, a menu or a working turn leaves the
    turn queued) and the same guarded transport.  Called by every send and, unless FLUSH_ON_READ is off,
    every read, under the agent's lock.  An expired turn is never typed.
    """
    if not queued_turns(agent):
        return
    try:
        check_session(session)
        with _AgentLock(agent):
            for held in queued_turns(agent):
                row = _found(chat_path(agent), held["client_message_id"])
                if row is None:
                    continue
                pane = capture_pane(session)
                if held.get("typed"):
                    if _settle_typed(agent, session, row, held, pane):
                        continue
                    return
                if pane is not None and not composer_snapshot(pane)[1] and delivery_gate(pane) == "text":
                    # A text of ours left in the box (a bridge's paste nobody submitted) would hold the turn for
                    # ever: once, the transport submits it if it can prove it is its own, then the box is looked at again.
                    try:
                        flush_ours(session)
                    except Refusal:
                        return
                    pane = capture_pane(session)
                if pane is None or composer_snapshot(pane)[1] or delivery_gate(pane) not in {"empty", "none"}:
                    return
                try:
                    taken, signature = deliver(agent, session, str(row.get("text") or ""))
                except Refusal as refusal:
                    if refusal.code in {"send_failed", "agent_stuck"}:
                        # The text may be typed: say «not confirmed» so no later flush types it twice.
                        mark_delivered(agent, row, "unconfirmed")
                    return
                mark_delivered(agent, row, taken, signature)
    except Refusal:
        return


class _AgentLock:
    """One send at a time per agent: two asks with the same id cannot both deliver."""

    def __init__(self, agent: str):
        self.path = chat_path(agent).parent / LOCK_FILE
        self.fd = None

    def __enter__(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT, 0o600)
            if fcntl is not None:
                fcntl.flock(self.fd, fcntl.LOCK_EX)
        except OSError:
            raise Refusal("persist_failed")
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)


def send(agent: str, client_id: str, raw_text: str) -> dict:
    if not CLIENT_ID.match(client_id):
        raise Refusal("chat_invalid")
    text = clean_text(raw_text)
    if not text or len(text) > MAX_TEXT:
        raise Refusal("chat_invalid")
    session = AGENTS[agent]
    # A dropped link must not stop this halfway: what was delivered has to be recorded.
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)
    delivered = chat_path(agent).parent / DELIVERED_FILE
    done = _found(delivered, client_id)
    if done is not None:
        return _receipt(client_id, done.get("message_id"), done.get("at"), taken=done.get("taken"))
    # The checks come before anything is created, the lock's folder included: a refusal leaves nothing behind.
    check_session(session)
    # A receiver of the mailbox is sent the turn as a file, whatever its terminal shows: nothing is typed
    # over a menu or a sign-in, because what is typed is a nudge, and only at the prompt. Every other
    # agent is sent the turn as it always was, and only at its prompt.
    mail = mail_for(agent)
    if mail is None:
        require_fence(agent, text)
    else:
        require_mail_fence(agent, text)
    if mail is not None:
        with _AgentLock(agent):
            done = _found(delivered, client_id)
            if done is not None:
                return _receipt(client_id, done.get("message_id"), done.get("at"), taken=done.get("taken"))
            row = persist(agent, client_id, text)
            deliver_by_mail(mail, agent, session, row, text)
            mark_delivered(agent, row)
            return _receipt(client_id, row.get("message_id"), row.get("ts"), "queued")

    # The potentially long wait happens before acquiring the writer lock.  If
    # another writer changes the pane while we waited, release and start that
    # wait again instead of holding every other sender behind a busy terminal.
    # An older queued turn goes first: order is kept, so a new turn waits behind it.
    flush_queue(agent, session)
    if queued_turns(agent):
        with _AgentLock(agent):
            return _queue_locked(agent, client_id, text)
    busy_deadline = time.monotonic() + BUSY_WAIT_S
    flushed = False
    while True:
        try:
            require_prompt(session)
        except Refusal as refusal:
            # A text of ours left in the composer (a [HEARTBEAT] nobody submitted) would shut the user's
            # chat for ever: once, the transport submits it if it can prove it is its own.
            if refusal.code != "composer_has_text" or flushed:
                raise
            flushed = True
            flush_ours(session)
            continue
        try:
            require_idle(session, busy_deadline)
        except Refusal as refusal:
            if refusal.code != "agent_busy":
                raise
            with _AgentLock(agent):
                done = _found(delivered, client_id)
                if done is not None:
                    return _receipt(client_id, done.get("message_id"), done.get("at"), taken=done.get("taken"))
                return _queue_locked(agent, client_id, text)
        retry_outside_lock = False
        with _AgentLock(agent):
            done = _found(delivered, client_id)
            if done is not None:
                return _receipt(client_id, done.get("message_id"), done.get("at"), taken=done.get("taken"))
            pane = capture_pane(session)
            if pane is None:
                raise Refusal("agent_unavailable")
            gate = delivery_gate(pane)
            if gate == "text":
                # The text may have appeared while we waited: the same single try, outside the lock.
                if flushed:
                    raise Refusal("composer_has_text")
                retry_outside_lock = True
            elif gate == "blocked":
                raise Refusal("agent_not_at_prompt")
            elif gate not in {"empty", "none"}:
                retry_outside_lock = True
            elif composer_snapshot(pane)[1]:
                # The turn started while we waited for the lock: not now, and not past the deadline.
                if time.monotonic() >= busy_deadline:
                    return _queue_locked(agent, client_id, text)
                retry_outside_lock = True
            else:
                row = persist(agent, client_id, text)
                try:
                    taken, signature = deliver(agent, session, str(row.get("text") or text))
                except Refusal as refusal:
                    if not refusal.typed:
                        raise
                    # The text stayed in the composer (half drawn under a working agent): it is held, as a turn
                    # waiting there, not lost and not typed again; the flush submits it when the agent is free.
                    return _queue_locked(agent, client_id, text, typed=True)
                mark_delivered(agent, row, taken, signature)
                return _receipt(client_id, row.get("message_id"), row.get("ts"), taken=taken)
        if retry_outside_lock:
            continue


def enter(agent: str, message_id: str) -> dict:
    """Return the retry receipt without risking an Enter on an unattested draft.

    New transports refuse a signature-only retry: a suffix cannot prove the composer contains no
    other words. Older transports may retain their closed answer, but a new receipt never retries.
    """
    if not MESSAGE_ID.match(message_id or ""):
        raise Refusal("chat_invalid")
    session = AGENTS[agent]
    delivered = chat_path(agent).parent / DELIVERED_FILE
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)
    with _AgentLock(agent):
        record = _record_by_message(delivered, message_id)
        if record is None:
            raise Refusal("chat_invalid")
        client_id = str(record.get("client_message_id") or "")
        receipt = lambda taken: _receipt(client_id, record.get("message_id"), record.get("at"), taken=taken)  # noqa: E731
        if record.get("taken") != "pending" or not record.get("signature"):
            return receipt(record.get("taken"))
        check_session(session)
        binary = _delivery_binary()
        try:
            done = subprocess.run([binary, "--enter", session, str(record["signature"])], capture_output=True,
                                  timeout=DELIVERY_TIMEOUT_S, check=False)
        except (OSError, subprocess.SubprocessError):
            raise Refusal("send_failed")
        if done.returncode == 0:
            outcome = "taken"
        elif done.returncode == DELIVERY_PENDING:
            outcome = "pending"
        elif done.returncode == DELIVERY_UNCONFIRMED:
            outcome = "unconfirmed"
        elif done.returncode == DELIVERY_NOT_THERE:
            said = ENTER_REASON.search(done.stdout.decode("utf-8", "replace"))
            outcome = said.group(1) if said and said.group(1) in ENTER_REASONS else "not_ours"
        else:
            raise Refusal(DELIVERY_EXIT.get(done.returncode, "send_failed"))
        updated = dict(record, taken=outcome)
        if outcome != "pending":
            updated.pop("signature", None)
        _append_record(delivered, updated)
        return receipt(outcome)


def _record_by_message(path: Path, message_id: str) -> dict | None:
    """The last delivery record of this message id."""
    if not path.is_file():
        return None
    found = None
    size = path.stat().st_size
    with open(path, "rb") as handle:
        handle.seek(max(0, size - DEDUP_TAIL))
        if handle.tell():
            handle.readline()
        for raw in handle:
            try:
                row = json.loads(raw.decode("utf-8"))
            except Exception:
                continue
            if isinstance(row, dict) and row.get("message_id") == message_id:
                found = row
    return found


def _append_record(path: Path, record: dict) -> None:
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


# ── entry ───────────────────────────────────────────────────────────────────
def _stdin_text() -> str:
    data = sys.stdin.buffer.read(MAX_STDIN)
    if len(data) >= MAX_STDIN:
        raise Refusal("chat_invalid")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise Refusal("chat_invalid")


# ── the contract with the app, in one place (tests/test_agent_chat_contract.py holds it) ──────
# A message of the agent may carry a kind (jht-send --kind); a question carries the tipo of
# agent_questions, in Italian, and its answer an origin. The app only ever gets these codes.
MESSAGE_KINDS = frozenset({"urgent", "blocked", "completed", "info"})
QUESTION_KIND_OF_TIPO = {
    "urgente": "urgent",
    "blocco": "blocked",
    "domanda": "question",
    "completamento": "completed",
    "comunicazione": "info",
}
ORIGIN_OF = {"utente": "user", "scadenza": "expiry"}      # anything else is "unknown", never "user"
MAX_SUGGESTIONS = 5
MAX_SUGGESTION = 240
QUESTIONS_SHOWN = 40
QUESTION_ID = re.compile(r"^[A-Za-z0-9:_-]{1,96}$")
CHOICE_ID = re.compile(r"^[a-z0-9_-]{1,32}$")
MAX_CHOICES = 8
MAX_ANSWER_TEXT = 2000
MAX_ANSWER_STDIN = MAX_ANSWER_TEXT * 4 + 1024
# What agent_questions refuses, said as the four codes of the app; any other code is answer_failed.
ANSWER_REFUSAL = {
    "choices_invalid": "invalid_choice",
    "choice_unknown": "invalid_choice",
    "choice_duplicate": "invalid_choice",
    "single_choice_only": "invalid_choice",
    "postpone_goes_alone": "invalid_choice",
    "text_invalid": "invalid_choice",
    "free_text_not_allowed": "invalid_choice",
    "text_too_long": "invalid_choice",
    "empty_answer": "invalid_choice",
    "question_unknown": "question_not_found",
    "question_invalid": "question_not_found",
}
# The one line the agent gets when its question is answered: fixed words, nothing the person wrote.
ANSWER_WAKE = "[ANSWER] The user answered one of your questions. Run: jht-check-user-replies --agent {agent}"


def _agent_fields(row: dict) -> dict:
    """The kind and the suggested replies of an agent's line, only from the closed lists."""
    out: dict = {}
    kind = row.get("kind")
    if isinstance(kind, str) and kind in MESSAGE_KINDS and kind != "info":
        out["kind"] = kind
    choices = row.get("choices")
    if isinstance(choices, list):
        labels = []
        for choice in choices[:MAX_SUGGESTIONS]:
            label = choice.get("label") if isinstance(choice, dict) else None
            if isinstance(label, str) and label.strip() and len(label) <= MAX_SUGGESTION and "\n" not in label:
                labels.append(clean_text(label))
        if len(labels) >= 2:
            out["suggestions"] = labels
    return out


def _seconds(value) -> float | None:
    """An instant of jobs.db (ISO with Z, or SQLite's UTC «YYYY-MM-DD HH:MM:SS») in UTC seconds."""
    if not isinstance(value, str) or not value.strip():
        return None
    from datetime import datetime, timezone
    text = value.strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.timestamp()


def _questions_module():
    """shared/skills/agent_questions.py of this image, or None (an older image)."""
    for directory in (Path(__file__).resolve().parent, Path("/app/shared/skills")):
        if (directory / "agent_questions.py").is_file():
            if str(directory) not in sys.path:
                sys.path.insert(0, str(directory))
            try:
                import agent_questions  # noqa: PLC0415
            except Exception:
                return None
            return agent_questions
    return None


def _db_path() -> Path:
    return Path(os.environ.get("JHT_DB") or (jht_home() / "jobs.db"))


def _question_view(aq, conn, source_id: str, created_at) -> dict | None:
    try:
        found = aq.load_question(conn, source_id)
    except Exception:
        return None
    if not found:
        return None
    payload = found["payload"]
    options = [{"id": o["id"], "label": o["label"]} for o in payload.get("opzioni", [])
               if isinstance(o, dict) and isinstance(o.get("id"), str) and isinstance(o.get("label"), str)]
    expires = _seconds(payload.get("scadenza"))
    view = {
        "id": source_id,
        "at": _seconds(created_at) or 0.0,
        "kind": QUESTION_KIND_OF_TIPO.get(payload.get("tipo"), "info"),
        "subject": payload.get("oggetto") or "",
        "text": payload.get("testo") or "",
        "options": options,
        "multiple": bool(payload.get("multipla")),
        "free": bool(payload.get("libera")),
        "expiresAt": expires,
        "state": "open",
    }
    stored = aq.existing_answer(conn, source_id)
    if stored:
        origin = ORIGIN_OF.get(stored.get("origine"), "unknown")
        seen = conn.execute("SELECT agent_seen_reply_at FROM pending_user_messages WHERE source_id = ?",
                            (aq.ANSWER_PREFIX + source_id,)).fetchone()
        answer = {
            "choices": [c for c in stored.get("scelte", []) if isinstance(c, str)],
            "at": _seconds(stored.get("ts")) or 0.0,
            "origin": origin,
            "seenAt": _seconds(seen[0]) if seen else None,
        }
        if isinstance(stored.get("testo"), str) and stored["testo"]:
            answer["text"] = stored["testo"]
        view["answer"] = answer
        view["state"] = "expired" if origin == "expiry" else "answered"
    elif expires is not None and expires <= time.time():
        view["state"] = "expired"
    return view


def questions_of(agent: str) -> list | None:
    """The agent's latest questions, newest first, read-only. None when this image has none to give."""
    aq = _questions_module()
    path = _db_path()
    if aq is None or not path.is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        rows = conn.execute(
            "SELECT source_id, created_at FROM pending_user_messages WHERE agent = ? AND source_action = ? "
            "ORDER BY id DESC LIMIT ?",
            (agent, aq.SOURCE_ACTION, QUESTIONS_SHOWN),
        ).fetchall()
        return [view for view in (_question_view(aq, conn, sid, at) for sid, at in rows) if view]
    except sqlite3.Error:
        return None
    finally:
        conn.close()


# The wake is tried again while the agent has not read the answer: it is ONE fixed line typed into a terminal that
# may be mid-turn, or holding a text, at the instant the person answers (the Capitano finished its turn two seconds
# before the click and never heard of the answer).  A try that does not land says why, with a fixed word, in
# logs/answer-wake.log (no question, no text, nothing the person wrote).
WAKE_RETRY_EVERY_S = float(os.environ.get("JHT_ANSWER_WAKE_EVERY", "30"))
WAKE_RETRY_FOR_S = float(os.environ.get("JHT_ANSWER_WAKE_FOR", "600"))
WAKE_QUIET_AFTER_SENT_S = float(os.environ.get("JHT_ANSWER_WAKE_QUIET", "120"))
WAKE_CODES = {"sent", "no_pane", "blocked", "busy", "text", "failed"}
# What the transport answers to a delivery that did not land, as the code a retry reads.
WAKE_EXIT = {8: "busy", 3: "blocked", 2: "no_pane", 5: "text", 130: "text"}


def _wake_log(agent: str, code: str) -> None:
    """One fixed line for a try that did not land; never raises."""
    try:
        logs = jht_home() / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        with open(logs / "answer-wake.log", "a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {agent} wake_{code}\n")
    except OSError:
        pass


def _wake_attempt(agent: str, session: str) -> str:
    """One try to wake the agent: ``sent`` or the closed code of why not.

    The composer decides, as it does for a chat send (``delivery_gate``): a RECOGNISED empty one takes the line even
    while the agent works (the CLI queues it).  A text in it is first handed to the transport's ``--flush-ours``, which
    presses Enter ONLY on a text it can prove is its own; a text of anyone else is never touched.
    """
    try:
        pane = capture_pane(session)
        if pane is None:
            return "no_pane"
        gate = delivery_gate(pane)
        if gate == "text":
            try:
                flush_ours(session)
            except Refusal:
                return "text"
            pane = capture_pane(session)
            if pane is None:
                return "no_pane"
            gate = delivery_gate(pane)
        if gate == "text":
            return "text"
        if gate != "empty":
            # a menu, a sign-in, or a screen with no composer to be seen: nothing is typed on a guess (a chat send
            # may go on over an unknown composer because it proves the submit; this line is not worth that)
            return "blocked"
        binary = _delivery_binary()
        done = subprocess.run([binary, session, ANSWER_WAKE.format(agent=agent)], capture_output=True,
                              timeout=DELIVERY_TIMEOUT_S, check=False)
        if done.returncode == 0:
            return "sent"
        return WAKE_EXIT.get(done.returncode, "failed")
    except (Refusal, OSError, subprocess.SubprocessError):
        return "failed"


def _wake_for_answer(agent: str, session: str) -> str:
    """The first try, made by the answer itself; says why when it does not land."""
    code = _wake_attempt(agent, session)
    if code != "sent":
        _wake_log(agent, code)
    return code


def _answer_seen(question_id: str) -> bool:
    """True when the agent has read the answer (the same mark the app shows as seen)."""
    aq = _questions_module()
    path = _db_path()
    if aq is None or not path.is_file():
        return False
    try:
        conn = sqlite3.connect(str(path), timeout=10)
        try:
            row = conn.execute("SELECT agent_seen_reply_at FROM pending_user_messages WHERE source_id = ?",
                               (aq.ANSWER_PREFIX + question_id,)).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return False
    return bool(row and row[0])


def wake_until_seen(agent: str, question_id: str, session: str, *, attempt=_wake_attempt, seen=_answer_seen,
                    sleep=time.sleep, clock=time.monotonic, every: float | None = None,
                    window: float | None = None, quiet: float | None = None) -> str:
    """Wake the agent again until it has read the answer, or the window is over: ``seen`` or ``gave_up``.

    After a line that landed it waits ``quiet`` before another (the agent may be working through its queue);
    a try that did not land is repeated every ``every`` seconds.
    """
    every = WAKE_RETRY_EVERY_S if every is None else every
    window = WAKE_RETRY_FOR_S if window is None else window
    quiet = WAKE_QUIET_AFTER_SENT_S if quiet is None else quiet
    deadline = clock() + window
    next_try = clock()
    while True:
        if seen(question_id):
            return "seen"
        now = clock()
        if now >= deadline:
            return "gave_up"
        if now >= next_try:
            code = attempt(agent, session)
            if code != "sent":
                _wake_log(agent, code)
            next_try = clock() + (quiet if code == "sent" else every)
        sleep(min(every, max(0.0, deadline - clock())))


def _wake_lock(question_id: str):
    """One retrying process per question; returns the lock path, or None when another one holds it."""
    folder = jht_home() / "locks"
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    path = folder / f"answer-wake-{question_id}.lock"
    for _ in range(2):
        try:
            os.close(os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
            return path
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime < WAKE_RETRY_FOR_S + 60:
                    return None
                path.unlink()          # a holder that died without cleaning up
            except OSError:
                return None
        except OSError:
            return None
    return None


def wake(agent: str, question_id: str) -> dict:
    """``agent_chat.py wake <agent> <question>``: the retrying process the answer starts (detached)."""
    if not QUESTION_ID.match(question_id or ""):
        raise Refusal("chat_invalid")
    lock = _wake_lock(question_id)
    if lock is None:
        return {"result": "running"}
    try:
        return {"result": wake_until_seen(agent, question_id, AGENTS[agent])}
    finally:
        try:
            lock.unlink()
        except OSError:
            pass


def _spawn_wake_retry(agent: str, question_id: str) -> None:
    """Start the retrying process without waiting for it: the app's answer must not wait ten minutes."""
    if os.environ.get("JHT_ANSWER_WAKE_RETRY", "1") == "0":
        return
    try:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "wake", agent, question_id],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
    except OSError:
        pass


def _drain_lock(agent: str):
    """One draining process per agent; returns the lock path, or None when another one holds it."""
    folder = jht_home() / "locks"
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    path = folder / f"chat-drain-{agent}.lock"
    for _ in range(2):
        try:
            os.close(os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
            return path
        except FileExistsError:
            try:
                if time.time() - path.stat().st_mtime < QUEUE_TTL_S + 120:
                    return None
                path.unlink()          # a holder that died without cleaning up
            except OSError:
                return None
        except OSError:
            return None
    return None


def drain(agent: str) -> dict:
    """``agent_chat.py drain <agent>``: deliver the queued turns as the agent frees up, without anybody asking.

    The page flushes the queue by reading; this is for when nobody reads (the app closed, the person gone to
    another page): a turn that is queued, or typed and stuck in the composer, still goes. Ends when nothing
    waits any more, or after the life of a queued turn.
    """
    lock = _drain_lock(agent)
    if lock is None:
        return {"result": "running"}
    try:
        deadline = time.monotonic() + QUEUE_TTL_S + 60
        while queued_turns(agent):
            flush_queue(agent, AGENTS[agent])
            if not queued_turns(agent):
                break
            if time.monotonic() >= deadline:
                return {"result": "gave_up"}
            time.sleep(DRAIN_EVERY_S)
        return {"result": "empty"}
    finally:
        try:
            lock.unlink()
        except OSError:
            pass


def _spawn_drain(agent: str) -> None:
    """Start the draining process without waiting for it. ``JHT_CHAT_DRAIN=0`` turns it off (the tests')."""
    if os.environ.get("JHT_CHAT_DRAIN", "1") == "0":
        return
    try:
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "drain", agent],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
    except OSError:
        pass


def answer(agent: str, question_id: str, raw: str) -> dict:
    """The person's answer to one of this agent's questions, from the app. The first answer wins."""
    if not QUESTION_ID.match(question_id or ""):
        raise Refusal("chat_invalid")
    try:
        request = json.loads(raw)
    except (ValueError, TypeError):
        raise Refusal("chat_invalid")
    if not isinstance(request, dict):
        raise Refusal("chat_invalid")
    choices = request.get("choices", [])
    text = request.get("text")
    if (not isinstance(choices, list) or len(choices) > MAX_CHOICES
            or not all(isinstance(c, str) and CHOICE_ID.match(c) for c in choices)):
        raise Refusal("invalid_choice")
    if text is not None and (not isinstance(text, str) or len(text) > MAX_ANSWER_TEXT or "\x00" in text):
        raise Refusal("invalid_choice")
    aq = _questions_module()
    path = _db_path()
    if aq is None or not path.is_file():
        raise Refusal("answer_unavailable")
    try:
        conn = sqlite3.connect(str(path), timeout=10)
    except sqlite3.Error:
        raise Refusal("answer_failed")
    try:
        try:
            found = aq.load_question(conn, question_id)
        except aq.QuestionRejected:
            raise Refusal("question_not_found")
        if not found or found["row"].get("agent") != agent:
            raise Refusal("question_not_found")
        try:
            recorded = aq.record_answer(conn, question_id, choices, clean_text(text) if text else "", canale="desktop")
        except aq.AnswerRejected as error:
            raise Refusal(ANSWER_REFUSAL.get(error.code, "answer_failed"))
        if recorded.status != "recorded":
            raise Refusal("question_closed")      # answered already, or expired with its default
        at = _seconds(recorded.answer.get("ts")) or time.time()
    except sqlite3.Error:
        raise Refusal("answer_failed")
    finally:
        conn.close()
    if _wake_for_answer(agent, AGENTS[agent]) != "sent":
        _spawn_wake_retry(agent, question_id)
    return {"questionId": question_id, "accepted": True, "at": at}


def _answer_stdin() -> str:
    data = sys.stdin.buffer.read(MAX_ANSWER_STDIN + 1)
    if len(data) > MAX_ANSWER_STDIN:
        raise Refusal("invalid_choice")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise Refusal("chat_invalid")


def run(argv: list[str]) -> dict:
    if len(argv) >= 2 and argv[0] == "read" and len(argv) in (2, 3):
        return read(agent_of(argv[1]), argv[2] if len(argv) == 3 else None)
    if len(argv) == 3 and argv[0] == "send":
        agent = agent_of(argv[1])
        return send(agent, argv[2], _stdin_text())
    if len(argv) == 3 and argv[0] == "enter":
        return enter(agent_of(argv[1]), argv[2])
    if len(argv) == 3 and argv[0] == "answer":
        return answer(agent_of(argv[1]), argv[2], _answer_stdin())
    if len(argv) == 3 and argv[0] == "wake":
        return wake(agent_of(argv[1]), argv[2])
    if len(argv) == 2 and argv[0] == "drain":
        return drain(agent_of(argv[1]))
    raise Refusal("chat_invalid")


def main(argv: list[str]) -> int:
    try:
        answer = run(argv)
    except Refusal as refusal:
        print(json.dumps({"error": refusal.code}))
        return EXIT[refusal.code]
    try:
        print(json.dumps(answer, ensure_ascii=False, separators=(",", ":")))
        sys.stdout.flush()
    except BrokenPipeError:
        pass            # the link fell after the work was done; the work stands
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
