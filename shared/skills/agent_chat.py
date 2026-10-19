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
  4. the turn is written once per client id (a repeat is not a second line),
     and one that was written but never delivered is delivered again from the
     line already there, with no new line;
  5. the turn goes to the terminal in the user's envelope, which the message
     fence (message_origin.py) puts between its own marks, and only if that
     fence is in this image (the delivery below would otherwise type the text
     as written); then the id is recorded as delivered.
The whole of it runs under one lock per agent, so two asks with the same id
cannot both deliver. A dropped link does not stop it halfway (SIGHUP and SIGPIPE
are ignored): what was delivered is recorded.

Every answer is one JSON line on stdout. A failure exits with a closed code
(EXIT below) and says it as {"error": "<code>"}; the app turns it into a
sentence of its error catalog. python3 answers 2 for a missing file: an image
older than this chat, which the app says as «update the team».
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
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
}

# jht-tmux-send's own exits: 2 no session, 3 the terminal never took the text,
# 4 busy (alive: try again), 5 text taken but never submitted (alive, stuck).
DELIVERY_EXIT = {2: "agent_not_running", 3: "agent_unavailable", 4: "agent_busy", 5: "agent_stuck"}

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
LOCK_FILE = ".chat-send.lock"
MAX_LINE = 65536
PAGE_ROWS = 120
TMUX_TIMEOUT_S = 10
DELIVERY_TIMEOUT_S = 100

# Direction marks and zero-width characters read as nothing and rewrite what
# is around them. ZWNJ/ZWJ (U+200C/D) stay: Persian and emoji need them.
_INVISIBLE = frozenset(
    [0x061C, 0x200B, 0x200E, 0x200F, 0x2060, 0xFEFF]
    + list(range(0x202A, 0x202F))
    + list(range(0x2066, 0x206A))
    + list(range(0xE0000, 0xE0080))
)


class Refusal(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


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
    path = chat_path(agent)
    if not path.is_file():
        return {"messages": [], "cursor": "0"}
    size = path.stat().st_size
    if cursor_text in (None, ""):
        cursor = max(0, size - HISTORY_TAIL)
    else:
        cursor = max(0, min(size, int(cursor_text)))
    messages = []
    try:
        with open(path, "rb") as handle:
            handle.seek(cursor)
            if cursor:
                handle.readline()
            while len(messages) < PAGE_ROWS:
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
                messages.append({"id": mid, "role": role, "text": text, "at": at})
            cursor = handle.tell()
    except OSError:
        raise Refusal("read_failed")
    return {"messages": messages, "cursor": str(cursor)}


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


def _found(path: Path, client_id: str) -> dict | None:
    if not path.is_file():
        return None
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
            if isinstance(row, dict) and row.get("client_message_id") == client_id:
                return row
    return None


def _receipt(client_id: str, message_id, at) -> dict:
    return {"accepted": True, "clientMessageId": client_id, "messageId": message_id, "at": at}


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


def mark_delivered(agent: str, row: dict) -> None:
    """The id is delivered. A failure to say so is not a failure to deliver: the text is already typed."""
    line = {"client_message_id": row.get("client_message_id"), "message_id": row.get("message_id"),
            "at": row.get("ts"), "delivered_at": time.time()}
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


def deliver(agent: str, session: str, text: str) -> None:
    binary = require_fence(agent, text)
    envelope = envelope_of(agent, text)
    try:
        done = subprocess.run([binary, session, envelope], capture_output=True,
                              timeout=DELIVERY_TIMEOUT_S, check=False)
    except (OSError, subprocess.SubprocessError):
        raise Refusal("send_failed")
    if done.returncode != 0:
        raise Refusal(DELIVERY_EXIT.get(done.returncode, "send_failed"))


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
        return _receipt(client_id, done.get("message_id"), done.get("at"))
    # Both checks come before anything is created, the lock's folder included: a refusal leaves nothing behind.
    check_session(session)
    require_fence(agent, text)
    with _AgentLock(agent):
        done = _found(delivered, client_id)         # another ask with this id may have finished while we waited
        if done is not None:
            return _receipt(client_id, done.get("message_id"), done.get("at"))
        row = persist(agent, client_id, text)
        # A line already there is what the agent is sent, not this ask's text: the id is the message.
        deliver(agent, session, str(row.get("text") or text))
        mark_delivered(agent, row)
        return _receipt(client_id, row.get("message_id"), row.get("ts"))


# ── entry ───────────────────────────────────────────────────────────────────
def _stdin_text() -> str:
    data = sys.stdin.buffer.read(MAX_STDIN)
    if len(data) >= MAX_STDIN:
        raise Refusal("chat_invalid")
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
