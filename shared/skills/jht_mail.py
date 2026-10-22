#!/usr/bin/env python3
"""jht_mail.py - one mailbox per agent, with a receipt for every message (JHT-T09, phase 1).

A message typed into a terminal is "delivered" when the keys went in; nobody knows
whether the agent took it. Here a message is a file, and its life is on disk:

    $JHT_HOME/mailbox/<agent>/new/<id>.json       queued, not taken yet
    $JHT_HOME/mailbox/<agent>/taken/<id>.json     taken: the agent ran `drain`
    $JHT_HOME/mailbox/<agent>/expired/<id>.json   not taken in time ("not taken" state)
    $JHT_HOME/mailbox/<agent>/rejected/<id>.json  a file that is not a message of this box
    $JHT_HOME/mailbox/<agent>/receipts.jsonl      append-only: queued, nudged, taken, done, expired

Two levels of acknowledgement, never mixed up:
  - "taken" is automatic: the agent's own turn read the text (`drain`);
  - "done" is explicit (`ack`), asked only for messages that need an answer.

A message file is never rewritten: its state is the folder it is in, plus the receipts.
The id is the idempotency key: sending the same id twice leaves one message, in
whatever state it already reached.

The text of a peer is model output, so it is handed to the reader quoted, line by
line, under a header that the mailbox itself writes (see `render`).

Who may write: agents, between themselves. The sender is worked out by this module from
the ancestry of the process that runs it (tmux knows which pane started it), never from an
argument, the environment or the text. The user, a bridge and the system keep to the
channels they use today: a file that claims one of them is moved to `rejected/`, unread.
The one exception is the mailbox's own "not taken" notice (trust `local`). All agents share
one uid, so a file written by hand into `new/` cannot be told from one this module wrote;
what the reader gets is bounded (see `_read_message`), not authenticated.

Phase 2 wires it to the transport (`agents/_skills/tmux-send/jht-tmux-send`) for the agents
listed under `mail_receivers` in `$JHT_HOME/jht.config.json` (empty or unreadable means none:
fail closed). For those, a message between two agents becomes a file and the terminal gets only a
short nudge with no content; everybody else keeps today's path. The pieces that need the clock take
it as an argument, so the rules are tested without waiting.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - the container is Linux
    fcntl = None

HERE = Path(__file__).resolve().parent

CANONICAL_AGENT = re.compile(r"^[a-z][a-z0-9_-]{0,39}-\d{1,3}\Z")
MESSAGE_ID = re.compile(r"^[A-Za-z0-9-]{1,64}\Z")
KIND = re.compile(r"^[A-Z][A-Z0-9_-]{0,15}\Z")

MAX_BODY = 4096
MAX_BODY_BYTES = 12288
# A message file is read up to here; a bigger one is not a message of ours (a body is at most
# MAX_BODY_BYTES, the rest of the JSON is short).
MAX_FILE = 16384
MAX_PENDING = 200
# The receipts are read from their tail, up to here, and rewritten when they grow past the second.
RECEIPTS_READ_CAP = 1048576
RECEIPTS_TRIM_AT = 262144
RETENTION = timedelta(days=7)
# The user's chat turns (and whatever was set aside as not a message) are forgotten after a day.
CHAT_RETENTION = timedelta(days=1)
# How long a message may stay queued after its last nudge (or its creation), by kind.
NOT_TAKEN_AFTER = {"URG": 120, "CHAT": 120}
NOT_TAKEN_AFTER_DEFAULT = 600
# Kinds that ask for an explicit "done".
NEEDS_DONE = frozenset({"URG", "REQ"})
NOTICE_KIND = "NOT_TAKEN"
SENTINEL = "sentinella-1"
CAPTAIN = "capitano-1"
# Senders that are not agents: nobody can show a session for them.
RELAY_NAMES = frozenset({"utente", "user", "sistema", "system", "bridge", "pacing"})
VERIFIED_TRUST = "verified"
LOCAL_TRUST = "local"  # written by the mailbox itself, and only for the "not taken" notices
LOCAL_SENDER = "mailbox"

# Every way a reader may break a line, CRLF first so it counts once. The same set as the
# harness uses to quote a peer's text (agent-harness/runtime/src/parity/product-role.ts);
# tests/test_jht_mail.py pins the two against each other.
_LINE_BREAK = re.compile(r"\r\n|[\n\r\v\f\u0085\u2028\u2029]")
_ENVELOPE = re.compile(r"\[\s*@[A-Za-z0-9_-]+\s*->[^\]\n]*\]")
_USER_REPLY = re.compile(r"\[\s*USER\s+REPLY[^\]\n]*\]", re.IGNORECASE)

EXIT = {
    "ok": 0,
    "usage": 2,
    "bad_agent": 3,
    "impersonation": 6,
    "queued": 10,
    "expired": 11,
    "not_found": 12,
    "refused": 13,
    "not_applicable": 20,
    "held": 21,
}


class MailError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


# -- names and paths ---------------------------------------------------------

def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def agent_id(name: str) -> str:
    """Lowercase, and a bare role name as instance 1 (`scout` -> `scout-1`), as the harness numbers it."""
    value = str(name or "").lower()
    if not value:
        raise MailError("bad_agent", "empty name")
    if not re.search(r"-\d+\Z", value):
        value = f"{value}-1"
    if not CANONICAL_AGENT.match(value):
        raise MailError("bad_agent", value[:40])
    return value


def box_dir(agent: str) -> Path:
    return home() / "mailbox" / agent_id(agent)


def _folders(agent: str) -> dict[str, Path]:
    base = box_dir(agent)
    return {name: base / name for name in ("new", "taken", "expired", "rejected", ".tmp")}


def _real_folder(path: Path) -> None:
    """A folder of the mailbox is a real directory of ours: not a link to somewhere else."""
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or (hasattr(os, "getuid") and info.st_uid != os.getuid()):
        raise MailError("refused", "unsafe mailbox folder")


def _ensure(agent: str) -> dict[str, Path]:
    folders = _folders(agent)
    root = home() / "mailbox"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    _real_folder(root)
    box_dir(agent).mkdir(parents=True, exist_ok=True, mode=0o700)
    _real_folder(box_dir(agent))
    for folder in folders.values():
        folder.mkdir(exist_ok=True, mode=0o700)
        _real_folder(folder)
    return folders


def _utc(now: datetime | None) -> datetime:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


class _Lock:
    """One lock per box: two `drain` calls (or a `drain` and a sweep) never interleave."""

    def __init__(self, agent: str):
        self.path = box_dir(agent) / ".lock"
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.handle = open(self.path, "a+")
        if fcntl is not None:
            fcntl.flock(self.handle, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        if fcntl is not None:
            fcntl.flock(self.handle, fcntl.LOCK_UN)
        self.handle.close()


# -- receipts ------------------------------------------------------------------

def _receipt(agent: str, message_id: str, state: str, at: datetime, *, held: bool = False, **extra) -> None:
    """Append a receipt. Under the box lock, like `_trim_receipts`, so a rewrite never loses one;
    `held` says the caller already holds it (the lock is not re-entrant)."""
    line = {"id": message_id, "state": state, "at": _iso(at), **extra}
    path = box_dir(agent) / "receipts.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8")

    def append() -> None:
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.write(fd, payload)
        finally:
            os.close(fd)

    if held:
        append()
    else:
        with _Lock(agent):
            append()


def _read_tail(path: Path, cap: int) -> str:
    """The last `cap` bytes of a regular file (not a link), from a whole line; '' when it is not one."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return ""
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return ""
        start = max(0, info.st_size - cap)
        os.lseek(fd, start, os.SEEK_SET)
        raw = os.read(fd, cap)
    except OSError:
        return ""
    finally:
        os.close(fd)
    text = raw.decode("utf-8", errors="replace")
    return text.split("\n", 1)[1] if start > 0 and "\n" in text else text


def receipts(agent: str, message_id: str | None = None) -> list[dict]:
    out = []
    for raw in _read_tail(box_dir(agent) / "receipts.jsonl", RECEIPTS_READ_CAP).splitlines():
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue  # a torn line is not a receipt
        if isinstance(entry, dict) and (message_id is None or entry.get("id") == message_id):
            out.append(entry)
    return out


def _trim_receipts(agent: str, moment: datetime) -> None:
    """Receipts older than the retention go: the file is rewritten only when it has grown."""
    path = box_dir(agent) / "receipts.jsonl"
    try:
        info = os.lstat(path)
    except OSError:
        return
    if not stat.S_ISREG(info.st_mode) or info.st_size <= RECEIPTS_TRIM_AT:
        return
    keep = []
    for raw in _read_tail(path, RECEIPTS_READ_CAP).splitlines():
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue
        at = _parse(entry.get("at")) if isinstance(entry, dict) else None
        if at and moment - at <= RETENTION:
            keep.append(raw)
    temp = box_dir(agent) / ".tmp" / f"receipts.{os.getpid()}.{uuid.uuid4().hex[:8]}"
    temp.write_text("".join(line + "\n" for line in keep), encoding="utf-8")
    os.replace(temp, path)


# -- messages --------------------------------------------------------------------

def _external():
    sys.path.insert(0, str(HERE))
    try:
        import external_content
    except Exception:
        # Without the shared cleaning nothing is queued or shown: fail closed.
        raise MailError("refused", "the shared text cleaning is missing")
    finally:
        sys.path.pop(0)
    return external_content


def strip_controls(text: str) -> str:
    """The text without terminal controls and sequences, and without the invisible characters that
    hide a command, by the shared rules (external_content). Persian and emoji joiners stay."""
    shared = _external()
    cleaned = shared.strip_terminal_controls(text)
    hidden = frozenset(shared.INVISIBLE_COMMANDS) - shared.WRITING_INVISIBLES
    return "".join(ch for ch in cleaned if ch not in hidden)


def default_id(sender: str, to: str, body: str, now: datetime) -> str:
    """Same sender, same recipient, same text inside ten seconds is the same message."""
    bucket = int(now.timestamp() // 10)
    digest = hashlib.sha256(f"{sender}\0{to}\0{body}\0{bucket}".encode("utf-8")).hexdigest()
    return digest[:24]


def _find(agent: str, message_id: str) -> tuple[str, Path] | None:
    # Order matters: a message only moves new -> taken or new -> expired, so a file that
    # moves while we look is found in the next folder, never in none.
    for name in ("new", "taken", "expired", "rejected"):
        candidate = box_dir(agent) / name / f"{message_id}.json"
        if candidate.exists():
            return name, candidate
    return None


def _read_message(path: Path) -> dict | None:
    """The message a file holds, or None when it is not one: a link, a pipe, a directory, a file
    over MAX_FILE, text that is not a JSON object. Only the fields a message has come out, with
    the text cleaned again: a file on disk is not trusted to have been written by `send`."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
            return None
        raw = os.read(fd, MAX_FILE + 1)
    except OSError:
        return None
    finally:
        os.close(fd)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    out = {key: data.get(key) for key in (
        "v", "id", "to", "kind", "from_claimed", "from_verified", "trust", "body",
        "created_at", "expires_at", "requires_done")}
    if isinstance(out["body"], str):
        out["body"] = strip_controls(out["body"])
    return out


_load = _read_message


def send(
    to: str,
    body: str,
    *,
    sender: tuple[str, str | None, str | None],
    kind: str = "MSG",
    message_id: str | None = None,
    requires_done: bool | None = None,
    ttl_seconds: int | None = None,
    now: datetime | None = None,
) -> dict:
    """Queue a message. `sender` is `(trust, claimed, verified origin)`, already decided by the caller.

    Returns `{"id", "state", "created": bool}`. An id that already exists is not written
    again: the answer is the state it has reached.
    """
    recipient = agent_id(to)
    moment = _utc(now)
    kind = str(kind or "MSG").upper()
    if not KIND.match(kind):
        raise MailError("refused", "bad kind")
    text = strip_controls(body)
    if not text.strip():
        raise MailError("refused", "empty message")
    if len(text) > MAX_BODY or len(text.encode("utf-8")) > MAX_BODY_BYTES:
        raise MailError("refused", f"message longer than {MAX_BODY} characters")
    trust, claimed, origin = sender
    if trust == VERIFIED_TRUST:
        if not (isinstance(origin, str) and CANONICAL_AGENT.match(origin) and claimed == origin):
            raise MailError("refused", "a verified sender is an agent, named once")
    elif not (trust == LOCAL_TRUST and kind == NOTICE_KIND and claimed == LOCAL_SENDER and origin is None):
        raise MailError("refused", "only agents write to an agent's mailbox")
    mid = message_id or default_id(origin or claimed or trust, recipient, text, moment)
    return _queue(recipient, mid, kind, trust, claimed, origin, text, moment,
                  requires_done=kind in NEEDS_DONE if requires_done is None else bool(requires_done),
                  ttl_seconds=ttl_seconds)


def _queue(recipient: str, mid: str, kind: str, trust: str, claimed, origin, text: str, moment: datetime,
           *, requires_done: bool, ttl_seconds: int | None = None) -> dict:
    """Write the message file, once per id. The caller has decided who may write it: nothing here does."""
    if not MESSAGE_ID.match(mid):
        raise MailError("refused", "bad id")

    folders = _ensure(recipient)
    existing = _find(recipient, mid)
    if existing:
        return {"id": mid, "state": state_of(recipient, mid), "created": False}
    if sum(1 for _ in folders["new"].glob("*.json")) >= MAX_PENDING:
        raise MailError("refused", "mailbox full")

    record = {
        "v": 1,
        "id": mid,
        "to": recipient,
        "kind": kind,
        "from_claimed": claimed,
        "from_verified": origin,
        "trust": trust,
        "body": text,
        "created_at": _iso(moment),
        "requires_done": requires_done,
    }
    if ttl_seconds:
        record["expires_at"] = _iso(moment + timedelta(seconds=int(ttl_seconds)))

    temp = folders[".tmp"] / f"{mid}.{os.getpid()}.{uuid.uuid4().hex[:8]}"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(record, handle, ensure_ascii=False)
    try:
        # link() fails when the name is taken: two senders with the same id write one file.
        os.link(temp, folders["new"] / f"{mid}.json")
    except FileExistsError:
        return {"id": mid, "state": state_of(recipient, mid), "created": False}
    finally:
        os.unlink(temp)
    try:
        _receipt(recipient, mid, "queued", moment, kind=kind)
    except OSError:
        pass  # the file is there: a message that exists is queued, with or without its first receipt
    return {"id": mid, "state": "queued", "created": True}


# The user's chat turn (phase 3c). The user is not an agent and nobody can verify them: the file says
# so with the least trust there is, and the reader gets it fenced. `send_user` is the only door; `send`,
# `route` and the command refuse this form.
USER_SENDER = "utente"
USER_KIND = "CHAT"
USER_TRUST = "unverified"


def is_user_turn(record: dict) -> bool:
    return (record.get("kind") == USER_KIND and record.get("from_claimed") == USER_SENDER
            and record.get("trust") == USER_TRUST and record.get("from_verified") is None
            and not record.get("requires_done"))


def send_user(agent: str, client_id: str, text: str, *, now: datetime | None = None, origin_of=None) -> dict:
    """Queue the user's chat turn for `agent`, which must be a mail receiver. The id is the chat's
    `client_id`: asking twice leaves one message. Refused when the caller is a process that tmux can
    place in an agent's pane (a filter: the real limit is the one every file of the team has).
    The text arrives already cleaned by the chat; it is cleaned again here."""
    recipient = agent_id(agent)
    if recipient not in load_receivers():
        raise MailError("refused", "not a mail receiver")
    placed = (origin_of or _verified_origin)()
    if placed:
        raise MailError("refused", "the user's turn is not written from an agent's terminal")
    if not MESSAGE_ID.match(str(client_id)):
        raise MailError("refused", "bad id")
    cleaned = strip_controls(text)
    if not cleaned.strip():
        raise MailError("refused", "empty message")
    if len(cleaned) > MAX_BODY or len(cleaned.encode("utf-8")) > MAX_BODY_BYTES:
        raise MailError("refused", f"message longer than {MAX_BODY} characters")
    return _queue(recipient, str(client_id), USER_KIND, USER_TRUST, USER_SENDER, None, cleaned, _utc(now),
                  requires_done=False)


def state_of(agent: str, message_id: str) -> str:
    """queued | taken | done | expired | rejected | unknown."""
    found = _find(agent, message_id)
    if not found:
        return "unknown"
    folder = found[0]
    if folder == "new":
        return "queued"
    if folder == "taken":
        done = any(r.get("state") == "done" for r in receipts(agent, message_id))
        return "done" if done else "taken"
    return folder


def pending(agent: str, now: datetime | None = None) -> list[dict]:
    """The queued messages, oldest first, with their age in seconds. Nothing is changed."""
    moment = _utc(now)
    out = []
    for path in sorted(_folders(agent)["new"].glob("*.json")):
        data = _load(path)
        if not data:
            continue
        created = _parse(data.get("created_at")) or moment
        out.append({"id": data.get("id", path.stem), "kind": data.get("kind"), "trust": data.get("trust"),
                    "age_seconds": int((moment - created).total_seconds())})
    return sorted(out, key=lambda item: -item["age_seconds"])


# -- reading ----------------------------------------------------------------------

def _defuse(line: str) -> str:
    """An envelope or a reply marker inside a peer's text is quoted, never left as a header."""
    line = _ENVELOPE.sub(lambda m: "[quoted envelope: " + m.group(0)[1:-1] + "]", line)
    return _USER_REPLY.sub(lambda m: "[quoted reply marker: " + m.group(0)[1:-1] + "]", line)


def render(record: dict, *, reread: bool = False) -> str:
    """One message as the agent reads it: our header, then the sender's text, every line quoted.
    Every field of the header passes a closed shape first; the text never reaches it."""
    named = record.get("from_verified")
    user_turn = is_user_turn(record)
    if user_turn:
        who, trust = USER_SENDER, USER_TRUST
    elif record.get("trust") == VERIFIED_TRUST and isinstance(named, str) and CANONICAL_AGENT.match(named):
        who, trust = named, VERIFIED_TRUST
    elif record.get("trust") == LOCAL_TRUST:
        who, trust = LOCAL_SENDER, LOCAL_TRUST
    else:
        who, trust = "unknown", "unknown"
    kind = record.get("kind") if KIND.match(str(record.get("kind", ""))) else "MSG"
    mid = record.get("id") if MESSAGE_ID.match(str(record.get("id", ""))) else "unknown"
    created = _parse(record.get("created_at"))
    header = f"[from {who} - {trust} - {kind} - id={mid} - {_iso(created) if created else 'unknown time'}]"
    if reread:
        header += " [re-read]"
    if user_turn:
        header += " [!UNVERIFIED SENDER]"
        return header + "\n> " + _fenced_user_text(record)
    if record.get("requires_done"):
        header += f" [answer needed: jht-mail ack {mid}]"
    lines = _LINE_BREAK.split(str(record.get("body", "")))
    return header + "\n" + "\n".join("> " + _defuse(line) for line in lines)


def _fenced_user_text(record: dict) -> str:
    """The user's words as the team has always read them: on one line between the user-text markers,
    commands and look-alike markers taken out. The same functions the transport fences a chat turn with
    (`message_origin.prepare_message`), run here at the reading, after the cleaning. If the fence cannot
    be shown to have fenced, the text is not shown."""
    withheld = "[the text of this message is withheld: the fence is not available]"
    try:
        sys.path.insert(0, str(HERE))
        try:
            import message_origin
        finally:
            sys.path.pop(0)
        head = f"[@{USER_SENDER} -> @{record.get('to')}] [{USER_KIND}]"
        fenced = message_origin.prepare_message(f"{head} {record.get('body', '')}")
        if not fenced.startswith(head) or fenced == f"{head} {record.get('body', '')}" or "[!UNFENCED]" in fenced:
            return withheld
        return fenced[len(head):].strip() or withheld
    except Exception:
        return withheld


def _shape_ok(agent: str, record: dict, name: str) -> bool:
    """A SHAPE check, not a verification: the file is named after its id, it is addressed to this
    box, its fields have the closed shapes, and a "verified" sender says the same name twice.
    Anybody with the uid can write a file that passes; this keeps out what is not a message of
    ours, and the senders that do not belong in an agent's mailbox (user, bridge, system)."""
    if record.get("id") != name or not MESSAGE_ID.match(name) or record.get("v") != 1:
        return False
    if record.get("to") != agent_id(agent):
        return False
    if not isinstance(record.get("body"), str) or not KIND.match(str(record.get("kind", ""))):
        return False
    trust, verified, claimed = record.get("trust"), record.get("from_verified"), record.get("from_claimed")
    if trust == USER_TRUST:
        return is_user_turn(record)
    if trust == VERIFIED_TRUST:
        return (isinstance(verified, str) and CANONICAL_AGENT.match(verified) is not None
                and claimed == verified)
    return (trust == LOCAL_TRUST and record.get("kind") == NOTICE_KIND
            and claimed == LOCAL_SENDER and verified is None)


def drain(agent: str, now: datetime | None = None) -> list[dict]:
    """Take every queued message, oldest first. The take is the acknowledgement.

    A box that nobody wrote to does not exist, and reading it does not create it: only a send to a
    mail receiver makes a folder, so an agent that is not one leaves nothing behind by draining."""
    moment = _utc(now)
    if not box_dir(agent).is_dir():
        return []
    folders = _ensure(agent)
    taken: list[dict] = []
    with _Lock(agent):
        entries = []
        for path in folders["new"].glob("*.json"):
            record = _load(path)
            entries.append((str((record or {}).get("created_at", "")), path.stem, path, record))
        for _, name, path, record in sorted(entries, key=lambda item: item[:2]):
            if record is None or not _shape_ok(agent, record, name):
                # Never printed. The receipt carries a digest of the name, not the name.
                digest = hashlib.sha256(str(name).encode("utf-8", "replace")).hexdigest()[:16]
                try:
                    os.replace(path, folders["rejected"] / f"{digest}.json")
                except OSError:
                    continue
                _receipt(agent, digest, "rejected", moment, held=True)
                continue
            os.replace(path, folders["taken"] / path.name)
            _receipt(agent, name, "taken", moment, held=True)
            taken.append(record)
    return taken


def recent(agent: str, count: int = 5) -> list[dict]:
    """The last messages that were taken, oldest first: what a restarted agent may have lost."""
    ids = [r["id"] for r in receipts(agent) if r.get("state") == "taken"]
    out = []
    for message_id in dict.fromkeys(reversed(ids)):
        found = _find(agent, message_id)
        record = _load(found[1]) if found and found[0] == "taken" else None
        if record:
            out.append(record)
        if len(out) >= max(1, int(count)):
            break
    return list(reversed(out))


def ack(agent: str, message_id: str, *, now: datetime | None = None) -> dict:
    """The explicit "done". Only a message that was taken can be done; doing it twice is not an error."""
    found = _find(agent, message_id) if MESSAGE_ID.match(str(message_id)) else None
    if not found:
        raise MailError("not_found", str(message_id)[:64])
    if found[0] != "taken":
        raise MailError("refused", f"the message is {state_of(agent, message_id)}, not taken")
    if state_of(agent, message_id) != "done":
        _receipt(agent, message_id, "done", _utc(now))
    return {"id": message_id, "state": "done"}


def record_nudge(agent: str, message_ids, *, now: datetime | None = None) -> None:
    """Note that the reader was woken for these messages: the not-taken clock restarts from here."""
    moment = _utc(now)
    for message_id in message_ids:
        _receipt(agent, message_id, "nudged", moment)


# -- the "not taken" state -----------------------------------------------------------

def _reference(agent: str, record: dict) -> datetime | None:
    stamps = [_parse(r.get("at")) for r in receipts(agent, record.get("id")) if r.get("state") == "nudged"]
    stamps.append(_parse(record.get("created_at")))
    stamps = [s for s in stamps if s]
    return max(stamps) if stamps else None


def notice_targets(record: dict) -> list[str]:
    """Who is told that a message was not taken: its sender, the sentinel, and the captain unless
    the captain is the one who did not take it. Never the recipient, never a name that is not an agent."""
    recipient = record.get("to")
    # The sender's name only chooses who is told; it decides nothing else (nobody has more rights for it).
    sender = str(record.get("from_verified") or "").lower()
    names = []
    if sender and sender not in RELAY_NAMES and CANONICAL_AGENT.match(sender):
        names.append(sender)
    names.append(SENTINEL)
    if recipient != CAPTAIN:
        names.append(CAPTAIN)
    return [name for name in dict.fromkeys(names) if name != recipient]


NOT_TAKEN_CODE = "mail_not_taken"


def _chat_system_line(agent: str, client_id: str, moment: datetime) -> bool:
    """Say in the user's chat with `agent` that the turn was not taken: a system line with a closed
    code and the id it refers to, never the user's words. Once per turn (the id is the line's id)."""
    name = agent_id(agent)
    if not name.endswith("-1"):
        return False
    path = home() / "agents" / name[:-2] / "chat.jsonl"
    line_id = f"nt-{client_id}"[:64]
    try:
        if path.exists() and line_id in _read_tail(path, 262144):
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {"role": "system", "text": "The agent has not taken your message yet.", "code": NOT_TAKEN_CODE,
               "refs": client_id, "ts": moment.timestamp(), "done": True, "message_id": line_id}
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.write(fd, (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        finally:
            os.close(fd)
    except OSError:
        return False
    return True


def sweep(agent: str, now: datetime | None = None, receivers=None) -> dict:
    """Expire what was not taken in time, tell who must know, and forget what is old.

    A queued message expires when its own deadline passed or when it has waited longer than its
    kind allows since the last nudge (or since it was written). It is never deleted here: it goes
    to `expired/`, with a receipt. Messages taken or expired more than a week ago are removed.

    The notices go into the mailbox of whoever is a mail receiver (`receivers`, or everybody when
    it is None); for anybody else no folder is created and the notice comes back under "typed",
    to be typed into that agent's terminal by the caller.
    """
    moment = _utc(now)
    if not box_dir(agent).is_dir():
        return {"expired": [], "told": [], "typed": [], "chat": []}
    folders = _ensure(agent)
    expired: list[str] = []
    notices: list[dict] = []
    with _Lock(agent):
        for path in sorted(folders["new"].glob("*.json")):
            record = _load(path)
            if record is None or not _shape_ok(agent, record, path.stem):
                continue  # `drain` moves what is not a message to rejected/; the clock does not touch it
            deadline = _parse(record.get("expires_at"))
            reference = _reference(agent, record)
            limit = NOT_TAKEN_AFTER.get(record.get("kind"), NOT_TAKEN_AFTER_DEFAULT)
            late = reference is not None and (moment - reference).total_seconds() >= limit
            if not (late or (deadline and moment >= deadline)):
                continue
            os.replace(path, folders["expired"] / path.name)
            _receipt(agent, record["id"], "expired", moment, held=True)
            expired.append(record["id"])
            if record.get("kind") != NOTICE_KIND:  # a notice that expires tells nobody: no loops
                notices.append(record)
        for name in ("taken", "expired", "rejected"):
            for path in folders[name].glob("*.json"):
                try:
                    info = path.lstat()
                    # Only plain files are forgotten; a folder or a link that got here is left for a person.
                    if not stat.S_ISREG(info.st_mode):
                        continue
                    keep_for = RETENTION
                    if name == "rejected":
                        keep_for = CHAT_RETENTION  # what is not a message of ours is not kept long
                    else:
                        held = _read_message(path)
                        if held and held.get("kind") == USER_KIND:
                            keep_for = CHAT_RETENTION  # the user's words stay a day, not a week
                    if moment - datetime.fromtimestamp(info.st_mtime, timezone.utc) > keep_for:
                        path.unlink()
                except OSError:
                    continue
        _trim_receipts(agent, moment)
    told = []
    typed = []
    said = []
    for record in notices:
        if is_user_turn(record):
            # The user's turn that was not taken: one system line in the user's own chat, no text of
            # the message, nothing to the agents (the sender is the user).
            if _chat_system_line(record["to"], record["id"], moment):
                said.append(record["id"])
            continue
        for target in notice_targets(record):
            text = (f"Message {record['id']} to {record['to']} ({record['kind']}) was not taken "
                    f"after {NOT_TAKEN_AFTER.get(record['kind'], NOT_TAKEN_AFTER_DEFAULT)} seconds.")
            if receivers is not None and target not in receivers:
                typed.append({"session": session_of(target), "text": f"[@watchdog -> @{target}] [MSG] {text}"})
                continue
            try:
                result = send(
                    target,
                    text,
                    kind=NOTICE_KIND,
                    sender=(LOCAL_TRUST, LOCAL_SENDER, None),
                    message_id=f"nt-{record['id']}-{target}"[:64],
                    now=moment,
                )
            except MailError:
                continue  # a full or unreachable box must not stop the sweep
            told.append({"to": target, "id": result["id"]})
    return {"expired": expired, "told": told, "typed": typed, "chat": said}


# -- the transport's side (phase 2) -------------------------------------------------------------------

# The tmux session of an agent: the roles that run once have a bare session name.
SINGLE_SESSIONS = {"capitano-1": "CAPITANO", "assistente-1": "ASSISTENTE", "mentor-1": "MENTOR",
                   "critico-1": "CRITICO", "sentinella-1": "SENTINELLA"}
# After the first nudge (which the transport gives), a queued message is nudged again this long
# after the previous one, up to three times in all.
RENEWAL_AFTER = (60, 300)
_ENVELOPE_HEAD = re.compile(
    r"^\s*\[@([A-Za-z0-9_-]+)\s*->\s*@([A-Za-z0-9_-]+)\]\s*(?:\[([A-Z][A-Z0-9_-]{0,15})\])?\s*(.*)\Z", re.DOTALL)


def session_of(agent: str) -> str:
    name = agent_id(agent)
    return SINGLE_SESSIONS.get(name, name.upper())


def load_receivers(path: Path | None = None) -> frozenset:
    """The agents whose messages travel by mailbox: `mail_receivers` in the config file.
    Missing file, unreadable file, wrong shape or an invalid name: nobody (fail closed)."""
    config = path or (home() / "jht.config.json")
    try:
        info = os.lstat(config)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 262144:
            return frozenset()
        data = json.loads(config.read_text(encoding="utf-8"))
        listed = data.get("mail_receivers") if isinstance(data, dict) else None
        if not isinstance(listed, list) or not all(isinstance(name, str) for name in listed):
            return frozenset()
        return frozenset(agent_id(name) for name in listed)
    except (OSError, ValueError, MailError):
        return frozenset()


def route(session: str, message: str, *, identity=None, receivers=None, now: datetime | None = None) -> dict | None:
    """Turn a message addressed to `session` into a mailbox file, or say it does not apply (None).

    It applies only when: the recipient is a mail receiver; the message is `[@a -> @b] [TYPE] text`
    with `b` the recipient; and the sender is an agent that tmux can place in its own pane as `a`
    (`identity` is `(trust, claimed, origin)` as message_origin works it out). Everything else keeps
    to the terminal: the user, the bridges, the watchdog and any sender nobody can verify.
    The nudge is NOT recorded here: the transport asks `nudge` for it, which records it only when the
    terminal is at its prompt.
    """
    wanted = load_receivers() if receivers is None else receivers
    try:
        recipient = agent_id(session)
    except MailError:
        return None
    if recipient not in wanted:
        return None
    found = _ENVELOPE_HEAD.match(message or "")
    if not found:
        return None
    try:
        claimed, addressed = agent_id(found.group(1)), agent_id(found.group(2))
    except MailError:
        return None
    if addressed != recipient or claimed in RELAY_NAMES or claimed == recipient:
        return None
    trust, said, origin = identity if identity is not None else _identity(message)
    if trust != "verified" or not origin:
        return None
    try:
        if agent_id(origin) != claimed or agent_id(said or "") != claimed:
            return None
    except MailError:
        return None
    body = found.group(4)
    if not body.strip():
        return None
    moment = _utc(now)
    result = send(recipient, body, kind=found.group(3) or "MSG", sender=(VERIFIED_TRUST, claimed, claimed), now=moment)
    return {"id": result["id"], "state": result["state"], "recipient": recipient,
            "session": session_of(recipient), "created": result["created"]}


def _identity(message: str):
    sys.path.insert(0, str(HERE))
    try:
        import message_origin as lib
        return lib.inspect_message(os.getpid(), message)
    except Exception:
        return ("unverified", None, None)
    finally:
        sys.path.pop(0)


def _agent_chat():
    sys.path.insert(0, str(HERE))
    try:
        import agent_chat
    finally:
        sys.path.pop(0)
    return agent_chat


def session_ready(session: str, capture=None) -> bool:
    """True only when the terminal of `session` is shown to wait at its prompt, by the rule the user's
    chat already uses (`agent_chat.prompt_state`: imported, not copied). A busy terminal is not ready
    either: a menu or a permission question can open during a turn, and a key typed over it answers it.
    Anything that cannot be shown is "no"."""
    try:
        chat = _agent_chat()
        pane = (capture or chat.capture_pane)(session)
        return pane is not None and chat.prompt_state(pane) == "ready"
    except Exception:
        return False


def nudge(session: str, message_id: str, *, now: datetime | None = None, capture=None) -> bool:
    """Whether the transport may type the nudge for this message now. If so, the nudge is recorded
    (the not-taken clock and the schedule of the next ones start from here); if not, nothing is
    recorded and nothing is typed: the message waits in the box and the next round tries again."""
    agent = agent_id(session)
    if not MESSAGE_ID.match(str(message_id)) or not session_ready(session, capture):
        return False
    try:
        record_nudge(agent, [message_id], now=now)
    except OSError:
        pass  # the receipt is bookkeeping; the nudge itself is still worth typing
    return True


def nudge_through(binary: str, session: str, message_id: str, *, timeout: int = 100) -> str:
    """For a caller that is not the transport (the chat): type the nudge with the transport's own
    typing, if the terminal is at its prompt. "nudged" or "held"; a failure of the typing is "held"
    too, because the message is safe and the watchdog will wake the agent again."""
    if not nudge(session, message_id):
        return "held"
    try:
        done = subprocess.run([binary, session, nudge_text(1)], capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return "held"
    return "nudged" if done.returncode == 0 else "held"


def nudge_text(count: int) -> str:
    """What is typed into a terminal to wake its agent: fixed words, no content of any message."""
    return f"[MAIL] {int(count)} new message(s) in your mailbox. Run: jht-mail drain"


def _nudges(agent: str, message_id: str) -> list[datetime]:
    return sorted(t for t in (_parse(r.get("at")) for r in receipts(agent, message_id) if r.get("state") == "nudged") if t)


def remind(receivers, now: datetime | None = None, ready=None) -> list[dict]:
    """Nudges that are due: a queued message that has none yet (the first was held) as soon as the
    terminal is ready; then 60 seconds after its first nudge, and 5 minutes after the second; never
    more than three times. One line per box, and only when the
    terminal is at its prompt (`ready(session)`; the real check when None): otherwise nothing is
    recorded and the next round looks again."""
    moment = _utc(now)
    due = []
    gate = ready or session_ready
    for agent in sorted(receivers):
        if not box_dir(agent).is_dir():
            continue  # no folder is created for a receiver nobody wrote to
        waiting = []
        for item in pending(agent, now=moment):
            sent = _nudges(agent, item["id"])
            # No nudge yet (the first was held: the terminal was busy): it goes as soon as the terminal is
            # ready. After one or two, the schedule; after three, no more.
            if not sent or (len(sent) <= len(RENEWAL_AFTER)
                            and (moment - sent[-1]).total_seconds() >= RENEWAL_AFTER[len(sent) - 1]):
                waiting.append(item["id"])
        if waiting and gate(session_of(agent)):
            record_nudge(agent, waiting, now=moment)
            due.append({"session": session_of(agent), "text": nudge_text(len(pending(agent, now=moment)))})
    return due


def tick(receivers, now: datetime | None = None, ready=None) -> list[dict]:
    """What the watchdog does on each round: expire, tell, and wake again. Returns the lines to type."""
    moment = _utc(now)
    lines: list[dict] = []
    for agent in sorted(receivers):
        if not box_dir(agent).is_dir():
            continue
        lines.extend(sweep(agent, now=moment, receivers=receivers)["typed"])
    lines.extend(remind(receivers, now=moment, ready=ready))
    return lines


# -- command line -----------------------------------------------------------------------

def _verified_origin() -> str | None:
    """The agent whose tmux pane started this process, or None. Worked out here, from the ancestry
    of the process: not from an argument, the environment or the text of the message."""
    sys.path.insert(0, str(HERE))
    try:
        import message_origin as lib
        panes = lib.tmux_pane_owners()
        return lib.session_from_ancestry(os.getpid(), lib.parent_of, panes.get) if panes else None
    except Exception:
        return None
    finally:
        sys.path.pop(0)


def _reader(explicit: str | None) -> str:
    """Whose box this process reads: its own, as tmux says. A process that tmux can place in another
    agent's pane never reads somebody else's box; one outside any pane (the person at a shell)
    names the box with --agent.

    Declared limit, the same as for every other file of the team: a process that tmux cannot place
    (one that detached itself with setsid) chooses the box with --agent or the environment, and can
    take the mail of another agent. All agents share one uid; the mailbox bounds what a reader
    receives, it does not keep one agent out of another's folder."""
    origin = _verified_origin()
    named = explicit or os.environ.get("JHT_AGENT_NAME")
    if origin and named and agent_id(origin) != agent_id(named):
        raise MailError("refused", "a box is read by its own agent")
    chosen = origin or named
    if not chosen:
        raise MailError("usage", "say whose box with --agent")
    return agent_id(chosen)


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _wait_for(to: str, message_id: str, seconds: float, poll: float = 0.5) -> str:
    deadline = time.monotonic() + seconds
    while True:
        state = state_of(to, message_id)
        if state not in ("queued", "unknown") or time.monotonic() >= deadline:
            return state
        time.sleep(poll)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jht-mail",
        description="The mailbox of an agent: messages are files, and every one has a receipt.")
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("send", help="queue a message (the text on stdin)")
    s.add_argument("to")
    s.add_argument("--kind", default="MSG")
    s.add_argument("--id", dest="message_id")
    s.add_argument("--ttl", type=int, help="seconds after which it is not worth reading any more")
    s.add_argument("--wait", type=float, help="wait this many seconds for it to be taken")
    d = sub.add_parser("drain", help="take the new messages (what an agent runs first in every turn)")
    d.add_argument("--agent")
    r = sub.add_parser("recent", help="read again the last messages that were taken")
    r.add_argument("count", nargs="?", type=int, default=5)
    r.add_argument("--agent")
    a = sub.add_parser("ack", help="say that a message you took is done")
    a.add_argument("message_id")
    a.add_argument("--agent")
    st = sub.add_parser("status", help="where a message is")
    st.add_argument("to")
    st.add_argument("message_id")
    p = sub.add_parser("pending", help="the queued messages of a box")
    p.add_argument("--agent")
    sub.add_parser("sweep", help="expire what was not taken in time").add_argument("agents", nargs="*")
    sub.add_parser("tick", help="sweep and wake again; prints 'SESSION<TAB>TEXT' lines to type (the watchdog runs this)")
    sub.add_parser("route", help="(the transport) queue the message on stdin when it applies").add_argument("session")
    n = sub.add_parser("nudge", help="(the transport) may the nudge for this message be typed now?")
    n.add_argument("session")
    n.add_argument("message_id")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "send":
            if agent_id(args.to) not in load_receivers():
                raise MailError("refused", "not a mail receiver")  # no folder for a name nobody listed
            origin = _verified_origin()
            if not origin:
                raise MailError("refused", "the sender could not be verified from its tmux pane")
            body = sys.stdin.read(MAX_BODY * 4 + 1)
            result = send(args.to, body, kind=args.kind, sender=(VERIFIED_TRUST, origin, origin),
                          message_id=args.message_id, ttl_seconds=args.ttl)
            if args.wait:
                result["state"] = _wait_for(agent_id(args.to), result["id"], args.wait)
            _emit(result)
            return {"queued": EXIT["queued"], "expired": EXIT["expired"]}.get(result["state"], EXIT["ok"]) \
                if args.wait else EXIT["ok"]
        if args.command == "drain":
            records = drain(_reader(args.agent))
            print("\n\n".join(render(r) for r in records) if records else "[mail] no new messages")
            return EXIT["ok"]
        if args.command == "recent":
            records = recent(_reader(args.agent), args.count)
            print("\n\n".join(render(r, reread=True) for r in records) if records else "[mail] nothing taken yet")
            return EXIT["ok"]
        if args.command == "ack":
            _emit(ack(_reader(args.agent), args.message_id))
            return EXIT["ok"]
        if args.command == "status":
            to = agent_id(args.to)
            _emit({"id": args.message_id, "state": state_of(to, args.message_id),
                   "receipts": receipts(to, args.message_id)})
            return EXIT["ok"]
        if args.command == "pending":
            _emit({"pending": pending(_reader(args.agent))})
            return EXIT["ok"]
        if args.command == "route":
            routed = route(args.session, sys.stdin.read(MAX_BODY * 4 + 512))
            if routed is None:
                return EXIT["not_applicable"]
            print("\t".join((routed["id"], routed["session"], routed["recipient"], "new" if routed["created"] else "again")))
            return EXIT["ok"]
        if args.command == "nudge":
            return EXIT["ok"] if nudge(args.session, args.message_id) else EXIT["held"]
        if args.command == "tick":
            for line in tick(load_receivers()):
                text = " ".join(_LINE_BREAK.split(line["text"])).replace("\t", " ")
                print(f"{line['session']}\t{text}")
            return EXIT["ok"]
        if args.command == "sweep":
            names = args.agents or sorted(
                p.name for p in (home() / "mailbox").glob("*")
                if p.is_dir() and not p.is_symlink() and CANONICAL_AGENT.match(p.name))
            report: dict = {}
            for name in names:
                try:
                    report[name] = sweep(name, receivers=load_receivers())
                except (MailError, OSError) as error:  # one bad box must not stop the others
                    report[name] = {"error": getattr(error, "code", "io_error")}
            _emit(report)
            return EXIT["ok"]
    except MailError as error:
        _emit({"error": error.code, "detail": error.detail})
        return EXIT.get(error.code, EXIT["refused"])
    return EXIT["usage"]


if __name__ == "__main__":
    raise SystemExit(main())
