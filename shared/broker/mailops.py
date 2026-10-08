"""The mailbox operations of the broker (P1 portal secrets, phase 1a).

The account comes from the broker's own volume, never from `/jht_home`. What
goes back to an agent is filtered and reduced (`mailfilter`), and a fixed
reason code replaces every failure.

- `mail.status`, `mail.count`, `mail.poll`: read side.
- `mail.send` kind `chat`: a draft the user approves from the host
  (`jht-broker-admin mail approve`), except a mail to the account's own
  address, which goes out at once.
- `mail.send` kind `application`: phase 1b (the authorisation register); until
  then it is refused with a code, never sent.
"""

from __future__ import annotations

import hashlib
import secrets as _secrets
import sys
import time
from pathlib import Path

from . import store
from .mailfilter import Admission, admitted, reduce_row, verdict

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills"))

import email_monitor  # noqa: E402

MAX_DRAFTS = 50
MAX_JOURNAL = 5000
MAX_SEEN = 10000
MAX_RECIPIENTS = 10


class BrokerRefusal(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def mailbox_account() -> dict:
    try:
        creds = store.read_secret("email_monitor")
    except store.StoreError as err:
        raise BrokerRefusal(err.code) from None
    if not creds or not creds.get("user") or not creds.get("password"):
        raise BrokerRefusal("not_configured")
    return creds


def mailbox_settings() -> dict:
    return store.read_state("mailbox", {})


def admission() -> Admission:
    """Built from the broker's state only: the policy and the senders the host
    set, plus the threads and recipients of applications the broker sent."""
    box = mailbox_settings()
    journal = store.read_state("journal", [])
    sent = [e for e in journal if isinstance(e, dict) and e.get("kind") == "application"]
    addresses = {str(a).lower() for a in box.get("allow_addresses", [])}
    addresses |= {str(a).lower() for e in sent for a in e.get("to", [])}
    domains = {str(d).lower().lstrip("@") for d in box.get("allow_domains", [])}
    authorised = store.read_state("authorisations", {})
    domains |= {str(v.get("host", "")).lower() for v in authorised.values() if isinstance(v, dict) and v.get("host")}
    threads = {str(e.get("message_id", "")).lower() for e in sent if e.get("message_id")}
    return Admission(
        policy=box.get("admission", "allowlist"),
        addresses=frozenset(addresses),
        domains=frozenset(d for d in domains if d),
        thread_ids=frozenset(threads),
    )


def rotation_pending() -> bool:
    return bool(store.read_state("rotation", {}).get("email_monitor", {}).get("pending"))


def password_digest(password: str) -> str:
    """Kept only in the broker's 0700 state, never returned or logged: it lets
    `secrets set` refuse the same password after a migration (B2)."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def status(args: dict, role: str) -> dict:
    try:
        creds = store.read_secret("email_monitor") or {}
    except store.StoreError as err:
        return {"ok": False, "reason": err.code}
    box = mailbox_settings()
    return {
        "ok": True,
        "configured": bool(creds.get("user") and creds.get("password")),
        "address": creds.get("user", ""),
        "admission": box.get("admission", "allowlist"),
        "rotation_pending": rotation_pending(),
        "seen_count": len(store.read_state("seen", [])),
        "legacy_migrated": legacy_migrated(),
    }


def legacy_migrated() -> dict[str, bool]:
    """Which legacy files are past their one migration: imported once, made
    pointless by a host setup, or replaced by a secret the broker holds. A
    copy that reappears in /jht_home after this is never read, and the
    runtime's guard deletes it unread (audit G1). Names only, never values."""
    done = store.read_state("legacy", {})
    migrated = {}
    for name in store.SECRET_NAMES:
        try:
            held = bool(store.read_secret(name))
        except store.StoreError:
            held = False  # unknown is "not yet": the guard then leaves the file alone
        migrated[name] = bool(done.get(name)) or held
    return migrated


def count(args: dict, role: str) -> dict:
    creds = mailbox_account()
    seen = set(store.read_state("seen", []))
    allowed = admission()

    def admit(msg) -> bool:
        # Audit M6: the same admission as `mail.poll`, so in `allowlist` the
        # senders of the rest of the mailbox never reach an agent.
        return admitted(
            allowed,
            str(msg.get("From", "") or ""),
            str(msg.get("In-Reply-To", "") or ""),
            str(msg.get("References", "") or ""),
        )

    try:
        result = email_monitor.count_mailbox(creds, seen, args["since_days"], admit)
    except email_monitor.CredentialsEncodingError:
        raise BrokerRefusal("credentials_unsupported_characters") from None
    except OSError:
        raise BrokerRefusal("imap_unavailable") from None
    except Exception:  # imaplib.IMAP4.error and friends: never the server's text
        raise BrokerRefusal("imap_failed") from None
    return {"ok": True, **result}


def poll(args: dict, role: str) -> dict:
    creds = mailbox_account()
    with store.locked("poll"):
        seen_list = store.read_state("seen", [])
        allowed = admission()

        def gate(msg, sender: str, subject: str, body: str) -> bool:
            return verdict(
                allowed,
                sender=sender,
                subject=subject,
                body=body,
                in_reply_to=str(msg.get("In-Reply-To", "") or ""),
                references=str(msg.get("References", "") or ""),
            ) == "ok"

        try:
            jobs, new_seen, withheld = email_monitor.poll_mailbox(creds, set(seen_list), args["since_days"], gate)
        except email_monitor.CredentialsEncodingError:
            raise BrokerRefusal("credentials_unsupported_characters") from None
        except OSError:
            raise BrokerRefusal("imap_unavailable") from None
        except Exception:
            raise BrokerRefusal("imap_failed") from None
        if new_seen:
            store.write_state("seen", (seen_list + new_seen)[-MAX_SEEN:])
    return {"ok": True, "jobs": [reduce_row(j) for j in jobs], "withheld": withheld}


def _valid_message(to: list[str], subject: str) -> None:
    if not to or len(to) > MAX_RECIPIENTS:
        raise BrokerRefusal("too_many_recipients" if to else "invalid_recipient")
    if any(not email_monitor._ADDRESS.match(addr) for addr in to):
        raise BrokerRefusal("invalid_recipient")
    if "\r" in subject or "\n" in subject:
        raise BrokerRefusal("invalid_subject")


def journal_append(entry: dict) -> None:
    with store.locked("journal"):
        journal = store.read_state("journal", [])
        journal.append({"at": _now(), **entry})
        store.write_state("journal", journal[-MAX_JOURNAL:])


def deliver(creds: dict, to: list[str], subject: str, body: str, kind: str, role: str, **extra) -> dict:
    result = email_monitor.send_message(creds, to, subject, body)
    if result.get("ok"):
        journal_append({"kind": kind, "role": role, "to": to, "subject": subject,
                        "message_id": result.get("message_id", ""), **extra})
    return result


def send(args: dict, role: str) -> dict:
    if args["kind"] == "application":
        # Phase 1b: the authorisation register decides where an application
        # may go. Until it exists the broker does not send one.
        raise BrokerRefusal("application_channel_not_ready")
    creds = mailbox_account()
    if rotation_pending():
        raise BrokerRefusal("mail_rotation_pending")
    to = [a.strip() for a in args["to"]]
    subject, body = args["subject"], args["body"]
    _valid_message(to, subject)
    own = str(creds.get("user", "")).strip().lower()
    if [a.lower() for a in to] == [own]:
        result = deliver(creds, to, subject, body, "self", role)
        if not result.get("ok"):
            raise BrokerRefusal(result.get("reason", "smtp_failed"))
        return {"ok": True, "status": "sent", "to": to, "subject": subject}
    with store.locked("drafts"):
        drafts = store.read_state("drafts", {})
        if len(drafts) >= MAX_DRAFTS:
            raise BrokerRefusal("drafts_full")
        draft_id = _secrets.token_hex(6)
        drafts[draft_id] = {"to": to, "subject": subject, "body": body, "role": role, "created_at": _now()}
        store.write_state("drafts", drafts)
    return {"ok": True, "status": "pending_user_approval", "draft_id": draft_id, "to": to, "subject": subject}
