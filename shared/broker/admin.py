"""`jht-broker-admin`: what only the host may do (P1 portal secrets, phase 1a).

Reached with `docker exec -i jht-broker jht-broker-admin …` (or `podman exec`)
by the `jht` wrapper on the host, never through the agents' socket. A secret
arrives on stdin, never in argv or env. Every answer is one JSON line with no
value, length or hash of a secret.

    secrets status
    secrets set <name>                      JSON on stdin
    secrets import-legacy <name>            the envelope of legacy.py on stdin
    secrets delete <name>
    mailbox show
    mailbox setup --user U [--imap-host H] [--smtp-host S] --admission P   password on stdin
    mailbox admission allowlist|whole_mailbox
    mailbox allow add|remove <address|@domain>
    mail drafts | mail approve <id> | mail discard <id> | mail journal [--limit N]
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import sys

from . import mailops, store
from .mailfilter import ADMISSION_POLICIES

# The repo's one list of characters that reorder or hide text (mailops has
# already put shared/skills on the path).
from external_content import INVISIBLE_COMMANDS, WRITING_INVISIBLES  # noqa: E402

MAX_STDIN = 64 * 1024
MAILBOX_KEYS = {"user", "password", "imap_host", "imap_port", "folder", "smtp_host", "smtp_port"}
TRANSPORT_KEYS = {"password"}


class AdminError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _out(obj: dict) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return 0 if obj.get("ok") else 1


def _stdin_bytes() -> bytes:
    data = sys.stdin.buffer.read(MAX_STDIN + 1)
    if len(data) > MAX_STDIN:
        raise AdminError("input_too_large")
    return data


def _parse_secret(name: str, raw: bytes) -> tuple[dict, list[str]]:
    """(the secret to store, the legacy `from_filters`). Unknown keys are
    refused rather than stored: the store keeps only what the broker uses."""
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AdminError("secret_not_json") from None
    if not isinstance(data, dict):
        raise AdminError("secret_not_object")
    filters = data.pop("from_filters", []) or []
    data.pop("savedAt", None)
    allowed = MAILBOX_KEYS if name == "email_monitor" else TRANSPORT_KEYS
    if set(data) - allowed:
        raise AdminError("secret_unexpected_field")
    if not isinstance(data.get("password"), str) or not data["password"]:
        raise AdminError("secret_password_missing")
    if name == "email_monitor" and (not isinstance(data.get("user"), str) or "@" not in data["user"]):
        raise AdminError("secret_user_missing")
    if not isinstance(filters, list) or not all(isinstance(f, str) for f in filters):
        raise AdminError("secret_from_filters_invalid")
    return data, filters


def _rotation(name: str) -> dict:
    return store.read_state("rotation", {}).get(name, {})


def _exposed(entry: dict) -> list[str]:
    """Digests of the passwords the agents could read (B2), oldest first. No
    cap: an exposed password stays refused for good, and only the host's
    import adds to the list (one digest per migrated name)."""
    seen = [d for d in entry.get("exposed", []) if isinstance(d, str)]
    if isinstance(entry.get("digest"), str) and entry["digest"] not in seen:
        seen.append(entry["digest"])  # the 1a shape: one digest, no list
    return seen


def _set_rotation(name: str, *, pending: bool, expose: str | None = None) -> None:
    """The rotation mark of `name`. The exposed digests are never dropped:
    not by a completed rotation, not by `secrets delete` (audit M4), so a
    password the agents could read is refused for good."""
    with store.locked("rotation"):
        rotation = store.read_state("rotation", {})
        exposed = _exposed(rotation.get(name, {}))
        if expose and expose not in exposed:
            exposed = exposed + [expose]
        rotation[name] = {"pending": pending, "exposed": exposed}
        store.write_state("rotation", rotation)


def secrets_set(name: str, raw: bytes) -> dict:
    data, filters = _parse_secret(name, raw)
    if mailops.password_digests(data["password"]) & set(_exposed(_rotation(name))):
        # B2: that password has been readable by the agents. Saving it again
        # (also after a delete, or after a rotation to another one) does not
        # end the rotation.
        raise AdminError("password_not_rotated")
    store.write_secret(name, data)
    if filters:
        _merge_allow(filters)
    _set_rotation(name, pending=False)
    return {"ok": True, "secret": name, "state": "present"}


def secrets_import_legacy(name: str, envelope_raw: bytes) -> dict:
    """The legacy file from `/jht_home/credentials`, piped by the host from
    `legacy.py read`. Imported **once**: after the first migration (or when
    the broker already holds this secret) a file found there again is not
    imported, because the agents can write that folder and would otherwise
    swap the user's account for theirs. Marked for rotation (B2)."""
    try:
        envelope = json.loads(envelope_raw.decode("utf-8"))
        raw = base64.b64decode(envelope["b64"], validate=True)
        expected = str(envelope["sha256"])
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, binascii.Error):
        raise AdminError("envelope_invalid") from None
    if hashlib.sha256(raw).hexdigest() != expected.lower():
        raise AdminError("digest_mismatch")
    with store.locked("legacy"):
        done = store.read_state("legacy", {})
        if done.get(name) or store.read_secret(name):
            done[name] = True
            store.write_state("legacy", done)
            return {"ok": True, "secret": name, "state": "already_migrated"}
        data, filters = _parse_secret(name, raw)
        store.write_secret(name, data)
        if store.read_secret(name) != data:
            raise AdminError("write_not_observed")
        if name == "email_monitor":
            # Audit M2: the agents could write this file, so only the account
            # and its hosts are taken from it. The policy starts at
            # `allowlist` until the host chooses, and the old sender filters
            # are only proposed: they enter the allowlist when the user
            # confirms each one (`jht mail allow add`), never on import.
            with store.locked("mailbox"):
                box = store.read_state("mailbox", {})
                box.setdefault("admission", "allowlist")
                proposed = {*box.get("imported_to_confirm", []), *filter(None, map(_proposed_entry, filters))}
                box["imported_to_confirm"] = sorted(proposed)
                store.write_state("mailbox", box)
        _set_rotation(name, pending=True, expose=mailops.password_digest(data["password"]))
        done[name] = True
        store.write_state("legacy", done)
    box = store.read_state("mailbox", {})
    return _with_rotation_warning({"ok": True, "secret": name, "state": "imported", "rotation_pending": True,
                                   "imported_to_confirm": box.get("imported_to_confirm", []) if name == "email_monitor" else []})


def mailbox_setup(user: str, imap_host: str, smtp_host: str, admission: str, password: str) -> dict:
    """`jht mail setup` from the host: the address and hosts in argv (not
    secret), the app password on stdin."""
    if admission not in ADMISSION_POLICIES:
        raise AdminError("admission_policy_unknown")
    user = user.strip()
    if "@" not in user:
        raise AdminError("secret_user_missing")
    domain = user.rsplit("@", 1)[1].lower()
    secret = {
        "user": user,
        "password": password,
        "imap_host": imap_host or ("imap.gmail.com" if domain in ("gmail.com", "googlemail.com") else f"imap.{domain}"),
        "imap_port": 993,
        "folder": "INBOX",
    }
    if smtp_host:
        secret["smtp_host"] = smtp_host
    result = secrets_set("email_monitor", json.dumps(secret).encode("utf-8"))
    mailbox_admission(admission)
    with store.locked("legacy"):
        done = store.read_state("legacy", {})
        done["email_monitor"] = True
        store.write_state("legacy", done)
    return {**result, "address": user, "admission": admission}


def _merge_allow(entries: list[str]) -> None:
    for entry in entries:
        mailbox_allow("add", entry)


def _allow_entry(entry: str) -> str | None:
    """`name@host` or `@domain`, lower-cased; None when it is neither."""
    entry = entry.strip().lower()
    is_domain = entry.startswith("@")
    value = entry[1:] if is_domain else entry
    if not value or any(ch.isspace() for ch in value) or (not is_domain and "@" not in value) or (is_domain and "@" in value):
        return None
    return entry


def _proposed_entry(legacy_filter: str) -> str | None:
    """A legacy filter as an allow entry: an address, `@domain`, or a bare
    `domain.tld` read as `@domain.tld`."""
    entry = legacy_filter.strip().lower()
    if "@" not in entry and "." in entry:
        entry = "@" + entry
    return _allow_entry(entry)


def mailbox_allow(action: str, entry: str) -> dict:
    """Add or remove one sender. Either answer settles a filter proposed by
    the legacy import (audit M2): add confirms it, remove dismisses it."""
    entry = _allow_entry(entry) or ""
    if not entry:
        raise AdminError("allow_entry_invalid")
    is_domain = entry.startswith("@")
    value = entry[1:] if is_domain else entry
    key = "allow_domains" if is_domain else "allow_addresses"
    with store.locked("mailbox"):
        box = store.read_state("mailbox", {})
        current = set(box.get(key, []))
        if action == "add":
            current.add(value)
        else:
            current.discard(value)
        box[key] = sorted(current)
        if entry in box.get("imported_to_confirm", []):
            box["imported_to_confirm"] = [e for e in box["imported_to_confirm"] if e != entry]
        store.write_state("mailbox", box)
    return {"ok": True, key: box[key], "imported_to_confirm": box.get("imported_to_confirm", [])}


def _with_rotation_warning(answer: dict) -> dict:
    """The host's answers carry the warning while a rotation is pending: it
    goes away only when a new password is saved (operator decision, 08/10)."""
    if mailops.rotation_pending():
        answer["warning"] = mailops.ROTATION_WARNING
    return answer


def mailbox_show() -> dict:
    box = store.read_state("mailbox", {})
    account = store.read_secret("email_monitor") or {}
    return _with_rotation_warning({
        "ok": True,
        # The address only, for the desktop's Mail screen; null when no
        # mailbox is saved. Never the password.
        "address": account.get("user") or None,
        "admission": box.get("admission", "allowlist"),
        "allow_addresses": box.get("allow_addresses", []),
        "allow_domains": box.get("allow_domains", []),
        # Old sender filters from the legacy file, NOT in effect until the
        # user confirms each one with `jht mail allow add` (audit M2).
        "imported_to_confirm": box.get("imported_to_confirm", []),
        "rotation_pending": sorted(n for n, v in store.read_state("rotation", {}).items() if v.get("pending")),
    })


def mailbox_admission(policy: str) -> dict:
    if policy not in ADMISSION_POLICIES:
        raise AdminError("admission_policy_unknown")
    with store.locked("mailbox"):
        box = store.read_state("mailbox", {})
        box["admission"] = policy
        store.write_state("mailbox", box)
    return {"ok": True, "admission": policy}


def _shown(text: str, keep_newlines: bool = True) -> tuple[str, int]:
    """(text as the terminal must show it, how many characters were made
    visible). An agent writes the drafts: a bidi override, a direction mark
    (LRM, RLM, ALM), a joiner, a C0/C1 control or another invisible character
    could make the user approve a mail other than the one they read (audit M9). Each becomes a visible `⟨U+XXXX⟩`; the draft that
    is sent is not changed, the user sees what it holds."""
    out, hidden = [], 0
    for ch in str(text):
        code = ord(ch)
        if ch == "\n" and keep_newlines or ch == "\t":
            out.append(ch)
        elif (ch in INVISIBLE_COMMANDS or ch in WRITING_INVISIBLES
              or code < 0x20 or 0x7F <= code <= 0x9F or ch in "\u2028\u2029"):
            out.append(f"⟨U+{code:04X}⟩")
            hidden += 1
        else:
            out.append(ch)
    return "".join(out), hidden


def _shown_mail(entry: dict) -> dict:
    shown, hidden = dict(entry), 0
    for key, multiline in (("subject", False), ("body", True)):
        if isinstance(shown.get(key), str):
            shown[key], n = _shown(shown[key], multiline)
            hidden += n
    if isinstance(shown.get("to"), list):
        pairs = [_shown(a, False) for a in shown["to"]]
        shown["to"] = [a for a, _ in pairs]
        hidden += sum(n for _, n in pairs)
    if hidden:
        shown["hidden_characters"] = hidden
    return shown


def mail_drafts() -> dict:
    drafts = store.read_state("drafts", {})
    ordered = sorted(drafts.items(), key=lambda kv: kv[1].get("created_at", ""))
    return {"ok": True, "drafts": [_shown_mail({"id": k, **v}) for k, v in ordered]}


def mail_approve(draft_id: str) -> dict:
    with store.locked("drafts"):
        drafts = store.read_state("drafts", {})
        draft = drafts.get(draft_id)
        if draft is None:
            raise AdminError("draft_not_found")
        try:
            creds = mailops.mailbox_account()
        except mailops.BrokerRefusal as err:
            raise AdminError(err.code) from None
        result = mailops.deliver(creds, draft["to"], draft["subject"], draft["body"], "chat", draft.get("role", ""),
                                 draft_id=draft_id)
        if not result.get("ok"):
            raise AdminError(result.get("reason", "smtp_failed"))
        drafts.pop(draft_id)
        store.write_state("drafts", drafts)
    return _with_rotation_warning(
        {"ok": True, "status": "sent", "draft_id": draft_id, "to": _shown_mail({"to": draft["to"]})["to"]})


def mail_discard(draft_id: str) -> dict:
    with store.locked("drafts"):
        drafts = store.read_state("drafts", {})
        if drafts.pop(draft_id, None) is None:
            raise AdminError("draft_not_found")
        store.write_state("drafts", drafts)
    return {"ok": True, "status": "discarded", "draft_id": draft_id}


def mail_journal(limit: int) -> dict:
    journal = store.read_state("journal", [])
    return {"ok": True, "journal": [_shown_mail(e) if isinstance(e, dict) else e for e in journal[-limit:]]}


def secrets_status() -> dict:
    out = {}
    for name in store.SECRET_NAMES:
        out[name] = "present" if store.read_secret(name) else "absent"
    return _with_rotation_warning({"ok": True, "secrets": out})


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="jht-broker-admin")
    sub = p.add_subparsers(dest="area", required=True)

    sp = sub.add_parser("secrets").add_subparsers(dest="cmd", required=True)
    sp.add_parser("status")
    for cmd in ("set", "delete"):
        sp.add_parser(cmd).add_argument("name", choices=store.SECRET_NAMES)
    sp.add_parser("import-legacy").add_argument("name", choices=store.SECRET_NAMES)

    mp = sub.add_parser("mailbox").add_subparsers(dest="cmd", required=True)
    mp.add_parser("show")
    setup = mp.add_parser("setup")
    setup.add_argument("--user", required=True)
    setup.add_argument("--imap-host", default="")
    setup.add_argument("--smtp-host", default="")
    setup.add_argument("--admission", required=True)
    mp.add_parser("admission").add_argument("policy")
    allow = mp.add_parser("allow")
    allow.add_argument("action", choices=("add", "remove"))
    allow.add_argument("entry")

    ml = sub.add_parser("mail").add_subparsers(dest="cmd", required=True)
    ml.add_parser("drafts")
    ml.add_parser("approve").add_argument("draft_id")
    ml.add_parser("discard").add_argument("draft_id")
    ml.add_parser("journal").add_argument("--limit", type=int, default=50)

    args = p.parse_args(argv)
    try:
        if args.area == "secrets":
            if args.cmd == "status":
                return _out(secrets_status())
            if args.cmd == "set":
                return _out(secrets_set(args.name, _stdin_bytes()))
            if args.cmd == "import-legacy":
                return _out(secrets_import_legacy(args.name, _stdin_bytes()))
            if args.cmd == "delete":
                # The rotation mark stays (audit M4): delete + setup with the
                # exposed password must not end the rotation.
                existed = store.delete_secret(args.name)
                return _out({"ok": True, "secret": args.name, "state": "deleted" if existed else "absent"})
        if args.area == "mailbox":
            if args.cmd == "show":
                return _out(mailbox_show())
            if args.cmd == "setup":
                try:
                    password = _stdin_bytes().decode("utf-8", "strict").rstrip("\r\n")
                except UnicodeDecodeError:
                    raise AdminError("password_not_utf8") from None
                return _out(mailbox_setup(args.user, args.imap_host, args.smtp_host, args.admission, password))
            if args.cmd == "admission":
                return _out(mailbox_admission(args.policy))
            if args.cmd == "allow":
                return _out(mailbox_allow(args.action, args.entry))
        if args.area == "mail":
            if args.cmd == "drafts":
                return _out(mail_drafts())
            if args.cmd == "approve":
                return _out(mail_approve(args.draft_id))
            if args.cmd == "discard":
                return _out(mail_discard(args.draft_id))
            if args.cmd == "journal":
                return _out(mail_journal(max(1, min(args.limit, 1000))))
    except (AdminError, store.StoreError) as err:
        return _out({"ok": False, "reason": err.code})
    return 2
