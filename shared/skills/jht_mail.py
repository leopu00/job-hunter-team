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

Phase 1 has no caller in the running system: nothing here types into a terminal
unless a nudge function is passed in. The pieces that need the clock take it as an
argument, so the rules are tested without waiting.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
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
RETENTION = timedelta(days=7)
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

def _receipt(agent: str, message_id: str, state: str, at: datetime, **extra) -> None:
    line = {"id": message_id, "state": state, "at": _iso(at), **extra}
    path = box_dir(agent) / "receipts.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # One write of one line: appends of this size do not interleave.
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8"))
    finally:
        os.close(fd)


def receipts(agent: str, message_id: str | None = None) -> list[dict]:
    path = box_dir(agent) / "receipts.jsonl"
    if not path.exists():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue  # a torn line is not a receipt
        if isinstance(entry, dict) and (message_id is None or entry.get("id") == message_id):
            out.append(entry)
    return out


# -- messages --------------------------------------------------------------------

def strip_controls(text: str) -> str:
    """No terminal control reaches a reader: ESC and the other C0/C1 controls go, line breaks and tabs stay."""
    return "".join(
        ch for ch in str(text or "")
        if ch in "\n\t" or not (ord(ch) < 0x20 or ord(ch) == 0x7F or 0x80 <= ord(ch) <= 0x9F)
    )


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
    kind: str = "MSG",
    sender: tuple[str, str | None, str | None] = (LOCAL_TRUST, None, None),
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
    if trust not in (VERIFIED_TRUST, LOCAL_TRUST):
        raise MailError("refused", "only agents write to an agent's mailbox")
    mid = message_id or default_id(origin or claimed or trust, recipient, text, moment)
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
        "requires_done": kind in NEEDS_DONE if requires_done is None else bool(requires_done),
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
    _receipt(recipient, mid, "queued", moment, kind=kind)
    return {"id": mid, "state": "queued", "created": True}


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
    if record.get("trust") == VERIFIED_TRUST and isinstance(named, str) and CANONICAL_AGENT.match(named):
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
    if record.get("requires_done"):
        header += f" [answer needed: jht-mail ack {mid}]"
    lines = _LINE_BREAK.split(str(record.get("body", "")))
    return header + "\n" + "\n".join("> " + _defuse(line) for line in lines)


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
    if trust == VERIFIED_TRUST:
        return (isinstance(verified, str) and CANONICAL_AGENT.match(verified) is not None
                and claimed == verified)
    return (trust == LOCAL_TRUST and record.get("kind") == NOTICE_KIND
            and claimed == LOCAL_SENDER and verified is None)


def drain(agent: str, now: datetime | None = None) -> list[dict]:
    """Take every queued message, oldest first. The take is the acknowledgement."""
    moment = _utc(now)
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
                _receipt(agent, digest, "rejected", moment)
                continue
            os.replace(path, folders["taken"] / path.name)
            _receipt(agent, name, "taken", moment)
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


def sweep(agent: str, now: datetime | None = None) -> dict:
    """Expire what was not taken in time, tell who must know, and forget what is old.

    A queued message expires when its own deadline passed or when it has waited longer than its
    kind allows since the last nudge (or since it was written). It is never deleted here: it goes
    to `expired/`, with a receipt. Messages taken or expired more than a week ago are removed.
    """
    moment = _utc(now)
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
            _receipt(agent, record["id"], "expired", moment)
            expired.append(record["id"])
            if record.get("kind") != NOTICE_KIND:  # a notice that expires tells nobody: no loops
                notices.append(record)
        for name in ("taken", "expired", "rejected"):
            for path in folders[name].glob("*.json"):
                if moment - datetime.fromtimestamp(path.lstat().st_mtime, timezone.utc) > RETENTION:
                    path.unlink(missing_ok=True)
    told = []
    for record in notices:
        for target in notice_targets(record):
            try:
                result = send(
                    target,
                    f"Message {record['id']} to {record['to']} ({record['kind']}) was not taken "
                    f"after {NOT_TAKEN_AFTER.get(record['kind'], NOT_TAKEN_AFTER_DEFAULT)} seconds.",
                    kind=NOTICE_KIND,
                    sender=(LOCAL_TRUST, LOCAL_SENDER, None),
                    message_id=f"nt-{record['id']}-{target}"[:64],
                    now=moment,
                )
            except MailError:
                continue  # a full or unreachable box must not stop the sweep
            told.append({"to": target, "id": result["id"]})
    return {"expired": expired, "told": told}


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
    names the box with --agent."""
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
    sub.add_parser("sweep", help="expire what was not taken in time (the watchdog runs this)").add_argument("agents", nargs="*")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "send":
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
        if args.command == "sweep":
            names = args.agents or sorted(p.name for p in (home() / "mailbox").glob("*") if p.is_dir())
            _emit({name: sweep(name) for name in names})
            return EXIT["ok"]
    except MailError as error:
        _emit({"error": error.code, "detail": error.detail})
        return EXIT.get(error.code, EXIT["refused"])
    return EXIT["usage"]


if __name__ == "__main__":
    raise SystemExit(main())
