"""Telegram send/poll logic owned by the isolated service."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from . import store
from .api import BotAPI, TelegramError
from .protocol import AGENT_PREFIX, BOT_ROLES
from shared.broker import notary, telegram_client
from shared.skills.external_content import INVISIBLE_COMMANDS, WRITING_INVISIBLES

BURST_LIMIT = 10
DAILY_LIMIT = 300
BURST_SECONDS = 60
DAY_SECONDS = 86_400
QUESTION_TTL_SECONDS = 7 * DAY_SECONDS
LEASE_SECONDS = 30
MAX_EVENTS = 1_000
MAX_DISCARDED_UPDATES = 500
MAX_TELEGRAM_UTF16 = 4_096
MAX_AUTH_TITLE = 180
MAX_AUTH_COMPANY = 180
AUTH_QUESTION_STATE = "apply-authorisation-questions"
AUTH_CALLBACK = re.compile(r"jhta:([0-9a-f]{32}):yes\Z")
OTP_NUMERIC = re.compile(r"[0-9]{4,8}\Z")
OTP_SHORT_TOKEN = re.compile(r"(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9_-]{6,12}\Z")
ALLOWED_ATTACHMENT_MIME = frozenset({
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.oasis.opendocument.text",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
})


POLLER_REASON = re.compile(r"[a-z0-9_]{1,64}\Z")


class TransportRefusal(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _now_iso(unix: int | float | None = None) -> str:
    stamp = unix if isinstance(unix, (int, float)) and not isinstance(unix, bool) else time.time()
    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _notary_instant(unix: int | float | None = None) -> str:
    stamp = unix if isinstance(unix, (int, float)) and not isinstance(unix, bool) else time.time()
    now = datetime.fromtimestamp(stamp, timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _display_field(value: object, limit: int) -> str:
    """Reject hidden/control text before it can reach the fixed question."""
    if not isinstance(value, str):
        raise TransportRefusal("apply_question_invalid")
    normalized = unicodedata.normalize("NFKC", value)
    if any(
        char in INVISIBLE_COMMANDS
        or char in WRITING_INVISIBLES
        or unicodedata.category(char) in {"Cc", "Cf", "Zl", "Zp"}
        for char in normalized
    ):
        raise TransportRefusal("apply_question_invalid")
    cleaned = " ".join(normalized.split())
    if not cleaned or len(cleaned) > limit:
        raise TransportRefusal("apply_question_invalid")
    return cleaned


def _question_destination(value: object) -> tuple[str, str]:
    if not isinstance(value, str) or len(value) > 2_000:
        raise TransportRefusal("apply_question_invalid")
    try:
        parsed = urlsplit(value)
    except ValueError:
        raise TransportRefusal("apply_question_invalid") from None
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or not parsed.hostname:
        raise TransportRefusal("apply_question_invalid")
    host = parsed.hostname.lower()
    if any(unicodedata.category(char) in {"Cc", "Cf", "Zl", "Zp"} for char in host):
        raise TransportRefusal("apply_question_invalid")
    try:
        return host, notary.destination(f"web:{host}")
    except notary.NotaryRefusal:
        raise TransportRefusal("apply_question_invalid") from None


def _utf16_units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _prefix_index(text: str, budget: int) -> int:
    used = 0
    for index, char in enumerate(text):
        units = _utf16_units(char)
        if used + units > budget:
            return index
        used += units
    return len(text)


def _chunks(text: str) -> list[str]:
    size = MAX_TELEGRAM_UTF16 - _utf16_units(AGENT_PREFIX) - 1
    remaining = text
    chunks: list[str] = []
    while remaining:
        if _utf16_units(remaining) <= size:
            chunks.append(remaining)
            break
        hard_split = _prefix_index(remaining, size)
        split = max(remaining.rfind("\n", 0, hard_split + 1), remaining.rfind(" ", 0, hard_split + 1))
        if split < hard_split // 2:
            split = hard_split
        chunks.append(remaining[:split].rstrip())
        remaining = remaining[split:].lstrip()
    if len(chunks) > 3:
        raise TransportRefusal("text_too_large")
    return chunks


def _redact(text: str) -> str:
    override = os.environ.get("JHT_TELEGRAM_REDACTOR")
    candidates = [
        Path(override) if override else None,
        Path("/app/shared/redact-cli.mjs"),
        Path(__file__).resolve().parents[1] / "redact-cli.mjs",
    ]
    redactor = next((path for path in candidates if path and path.is_file()), None)
    if redactor is None:
        raise TransportRefusal("redactor_unavailable")
    try:
        result = subprocess.run(
            ["node", str(redactor), "--secrets"],
            input=text,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise TransportRefusal("redaction_failed") from None
    if result.returncode != 0:
        raise TransportRefusal("redaction_failed")
    return result.stdout.rstrip("\n")


def _fingerprint(args: dict) -> str:
    raw = json.dumps(args, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


class Runtime:
    def __init__(self, api_factory: Callable[[str], BotAPI] = BotAPI, *, enabled: bool = True) -> None:
        self.api_factory = api_factory
        self.enabled = enabled
        self.stop_event = threading.Event()
        self._poller_states: dict[str, tuple[str, str]] = {}
        self.burst_limit = self._limit("JHT_TELEGRAM_BURST_LIMIT", BURST_LIMIT, 1, 100)
        self.daily_limit = self._limit("JHT_TELEGRAM_DAILY_LIMIT", DAILY_LIMIT, 1, 2_000)

    @staticmethod
    def _limit(name: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(os.environ.get(name, str(default)))
        except ValueError:
            return default
        return value if minimum <= value <= maximum else default

    def status(self) -> dict:
        configured = []
        for role in BOT_ROLES:
            try:
                if store.read_bot(role):
                    configured.append(role)
            except store.StoreError:
                continue
        discarded = {}
        for role in BOT_ROLES:
            try:
                count = len(store.read_state(f"discarded-{role}", []))
            except store.StoreError:
                count = 0
            if count:
                discarded[role] = count
        return {"ok": True, "configured": configured, "discarded": discarded}

    @staticmethod
    def _record_discard(role: str, update_id: int, reason: str) -> None:
        name = f"discarded-{role}"
        try:
            with store.locked(name):
                discarded = store.read_state(name, [])
                discarded.append({"update_id": update_id, "reason": reason, "at": _now_iso()})
                store.write_state(name, discarded[-MAX_DISCARDED_UPDATES:])
        except store.StoreError:
            pass
        print(
            f"[jht-telegram] discarded role={role} update_id={update_id} reason={reason}",
            file=sys.stderr,
            flush=True,
        )

    def _bot(self, role: str) -> tuple[dict[str, str], BotAPI]:
        try:
            secret = store.read_bot(role)
        except store.StoreError as exc:
            raise TransportRefusal(exc.code) from None
        if not secret:
            raise TransportRefusal("bot_not_configured")
        return secret, self.api_factory(secret["bot_token"])

    def _reserve_send(self, role: str, source_id: str, digest: str, now: int) -> dict | None:
        with store.locked("outbound"):
            state = store.read_state("outbound", {})
            sent = state.setdefault("sent", {})
            previous = sent.get(source_id)
            if previous:
                if previous.get("digest") != digest:
                    raise TransportRefusal("source_id_collision")
                if isinstance(previous.get("result"), dict):
                    return previous["result"]
                if previous.get("pending_until", 0) > now:
                    raise TransportRefusal("send_in_progress")
            # Expired reservations have no useful idempotency result and must
            # not accumulate until the 4 MiB state cap blocks all sends.
            for key, value in list(sent.items()):
                if not isinstance(value, dict) or (
                    "result" not in value and value.get("pending_until", 0) <= now
                ):
                    sent.pop(key, None)
            rates = state.setdefault("rates", {}).setdefault(role, [])
            rates[:] = [stamp for stamp in rates if isinstance(stamp, int) and stamp > now - DAY_SECONDS]
            if sum(stamp > now - BURST_SECONDS for stamp in rates) >= self.burst_limit:
                raise TransportRefusal("rate_limited_burst")
            if len(rates) >= self.daily_limit:
                raise TransportRefusal("rate_limited_daily")
            # Every accepted attempt consumes quota, including Telegram or
            # redaction refusals. Otherwise a failing caller can retry without
            # bound and fill the reservation file.
            rates.append(now)
            # A reservation closes concurrent duplicate sends.  Stale pending
            # entries are retryable after the network timeout window.
            sent[source_id] = {"digest": digest, "pending_until": now + 90}
            store.write_state("outbound", state)
        return None

    def _finish_send(self, role: str, source_id: str, digest: str, result: dict, now: int) -> None:
        with store.locked("outbound"):
            state = store.read_state("outbound", {})
            sent = state.setdefault("sent", {})
            sent[source_id] = {"digest": digest, "result": result, "at": now}
            # Bound metadata without exposing message bodies.
            if len(sent) > 5_000:
                ordered = sorted(sent.items(), key=lambda item: item[1].get("at", 0))
                for key, _value in ordered[: len(sent) - 5_000]:
                    sent.pop(key, None)
            store.write_state("outbound", state)

    def _cancel_send(self, source_id: str, digest: str) -> None:
        with store.locked("outbound"):
            state = store.read_state("outbound", {})
            sent = state.setdefault("sent", {})
            current = sent.get(source_id)
            if isinstance(current, dict) and current.get("digest") == digest and "result" not in current:
                sent.pop(source_id, None)
                store.write_state("outbound", state)

    def send(self, args: dict) -> dict:
        role = args["bot_role"]
        digest = _fingerprint(args)
        now = int(time.time())
        previous = self._reserve_send(role, args["source_id"], digest, now)
        if previous is not None:
            return previous
        try:
            secret, api = self._bot(role)
            text = _redact(args["text"])
            message_ids = []
            for chunk in _chunks(text):
                message_ids.append(api.send_message(secret["chat_id"], f"{AGENT_PREFIX}\n{chunk}"))
        except TelegramError as exc:
            self._cancel_send(args["source_id"], digest)
            raise TransportRefusal(exc.code) from None
        except BaseException:
            self._cancel_send(args["source_id"], digest)
            raise
        result = {"ok": True, "status": "sent", "chunks": len(message_ids)}
        self._finish_send(role, args["source_id"], digest, result, now)
        if args.get("kind") == "question" and message_ids:
            with store.locked("questions"):
                questions = store.read_state("questions", {})
                for message_id in message_ids:
                    questions[f"{role}:{message_id}"] = now + QUESTION_TTL_SECONDS
                store.write_state("questions", questions)
        return result

    def pull(self, args: dict) -> dict:
        role = args["bot_role"]
        now = int(time.time())
        name = f"events-{role}"
        with store.locked(name):
            events = store.read_state(name, [])
            selected = []
            for event in events:
                if event.get("lease_until", 0) > now:
                    continue
                event["lease_until"] = now + LEASE_SECONDS
                selected.append({key: value for key, value in event.items() if key != "lease_until"})
                if len(selected) >= args["limit"]:
                    break
            store.write_state(name, events)
        return {"ok": True, "events": selected}

    def ack(self, args: dict) -> dict:
        role = args["bot_role"]
        wanted = set(args["event_ids"])
        attachments: list[str] = []
        name = f"events-{role}"
        with store.locked(name):
            events = store.read_state(name, [])
            kept = []
            for event in events:
                if event.get("event_id") in wanted:
                    opaque = (event.get("attachment") or {}).get("opaque")
                    if isinstance(opaque, str):
                        attachments.append(opaque)
                else:
                    kept.append(event)
            store.write_state(name, kept)
        for opaque in attachments:
            try:
                store.delete_inbox_file(opaque)
            except store.StoreError:
                pass
        return {"ok": True, "acked": len(wanted)}

    def dispatch(self, request: dict) -> dict:
        op = request["op"]
        if op == "telegram.status":
            return {**self.status(), "enabled": self.enabled}
        if not self.enabled:
            raise TransportRefusal("service_disabled")
        if op == "telegram.send":
            return self.send(request["args"])
        if op == "telegram.inbox.pull":
            return self.pull(request["args"])
        if op == "telegram.inbox.ack":
            return self.ack(request["args"])
        if op == "telegram.apply.request":
            return self.request_apply_authorisation(request["args"])
        raise TransportRefusal("unknown_operation")

    def request_apply_authorisation(self, args: dict) -> dict:
        """Ask from a service-owned template, with a service-owned callback.

        Fields from the agents' socket are untrusted data.  The service cleans
        them, selects the bot, creates the question identifier and calculates
        the closed destination. A pending question is reused to avoid turning
        agent retries into a stream of prompts.
        """
        title = _display_field(args.get("title"), MAX_AUTH_TITLE).replace("·", " ")
        company = _display_field(args.get("company"), MAX_AUTH_COMPANY).replace("·", " ")
        host, destination = _question_destination(args.get("url"))
        position_id = args["position_id"]
        now = int(time.time())
        with store.locked(AUTH_QUESTION_STATE):
            questions = store.read_state(AUTH_QUESTION_STATE, {})
            questions = {
                key: value for key, value in questions.items()
                if isinstance(value, dict) and value.get("expires_at", 0) > now and value.get("state") in {"sending", "pending"}
            }
            for question_id, value in questions.items():
                if value.get("position_id") == position_id:
                    store.write_state(AUTH_QUESTION_STATE, questions)
                    return {"ok": True, "status": "already_pending", "question_id": question_id}
            question_id = secrets.token_hex(16)
            questions[question_id] = {
                "position_id": position_id,
                "destination": destination,
                "expires_at": now + QUESTION_TTL_SECONDS,
                "state": "sending",
            }
            store.write_state(AUTH_QUESTION_STATE, questions)
        try:
            secret, api = self._bot("assistente")
            text = (
                "🔐 JHT · application authorisation\n\n"
                f"Do you want to apply to:\n{title} @ {company}\nDestination: {host}\n\n"
                "The authorisation is valid once, for this destination."
            )
            message_id = api.send_message(
                secret["chat_id"], text,
                {"inline_keyboard": [[{"text": "Yes, apply", "callback_data": f"jhta:{question_id}:yes"}]]},
            )
        except (TelegramError, TransportRefusal) as exc:
            with store.locked(AUTH_QUESTION_STATE):
                questions = store.read_state(AUTH_QUESTION_STATE, {})
                questions.pop(question_id, None)
                store.write_state(AUTH_QUESTION_STATE, questions)
            raise TransportRefusal(exc.code) from None
        with store.locked(AUTH_QUESTION_STATE):
            questions = store.read_state(AUTH_QUESTION_STATE, {})
            current = questions.get(question_id)
            if not isinstance(current, dict):
                raise TransportRefusal("apply_question_unavailable")
            questions[question_id] = {**current, "state": "pending", "message_id": message_id}
            store.write_state(AUTH_QUESTION_STATE, questions)
        return {"ok": True, "status": "asked", "question_id": question_id}

    def _enqueue_apply_authorisation(self, update_id: int, position_id: int, instant: str) -> None:
        """Make the broker-recorded click available to the read-only inbox."""
        event_id = f"telegram:assistente:{update_id}"
        event = {
            "event_id": event_id,
            "agent": "assistente",
            "kind": "apply_authorisation",
            "position_id": position_id,
            "instant": instant,
            "created_at": _now_iso(),
        }
        with store.locked("events-assistente"):
            events = store.read_state("events-assistente", [])
            if not any(item.get("event_id") == event_id for item in events):
                if len(events) >= MAX_EVENTS:
                    raise TransportRefusal("inbox_full")
                events.append(event)
                store.write_state("events-assistente", events)

    def _apply_callback(self, role: str, update_id: int, callback: dict, secret: dict[str, str], api: BotAPI) -> bool:
        callback_id = callback.get("id")
        message = callback.get("message")
        chat = message.get("chat") if isinstance(message, dict) else None
        matched = AUTH_CALLBACK.fullmatch(str(callback.get("data") or ""))
        if not isinstance(callback_id, str) or not isinstance(chat, dict) or str(chat.get("id")) != secret["chat_id"] or not matched:
            return False
        question_id = matched.group(1)
        now = int(time.time())
        with store.locked(AUTH_QUESTION_STATE):
            questions = store.read_state(AUTH_QUESTION_STATE, {})
            question = questions.get(question_id)
            if (
                not isinstance(question, dict)
                or question.get("state") != "pending"
                or question.get("expires_at", 0) <= now
                or role != "assistente"
                or not isinstance(message, dict)
                or message.get("message_id") != question.get("message_id")
            ):
                api.answer_callback_query(callback_id, "Questa autorizzazione non è più disponibile.")
                return True
            instant = _notary_instant()
            response = telegram_client.record(question["position_id"], instant, question["destination"])
            if not response.get("ok"):
                api.answer_callback_query(callback_id, "Autorizzazione non verificata: candidatura non inviata.")
                return True
            self._enqueue_apply_authorisation(update_id, question["position_id"], instant)
            questions[question_id] = {**question, "state": "used", "used_at": now}
            store.write_state(AUTH_QUESTION_STATE, questions)
        api.answer_callback_query(callback_id, "Autorizzazione registrata.")
        return True

    @staticmethod
    def _is_open_question(role: str, reply_id: object, now: int) -> bool:
        if not isinstance(reply_id, int) or isinstance(reply_id, bool):
            return False
        with store.locked("questions"):
            questions = store.read_state("questions", {})
            questions = {
                key: expiry for key, expiry in questions.items()
                if isinstance(expiry, int) and expiry > now
            }
            store.write_state("questions", questions)
        return questions.get(f"{role}:{reply_id}", 0) > now

    @staticmethod
    def _looks_like_otp(text: str) -> bool:
        compact = text.strip()
        return bool(OTP_NUMERIC.fullmatch(compact) or OTP_SHORT_TOKEN.fullmatch(compact))

    def _attachment(self, api: BotAPI, message: dict) -> dict | None:
        candidate = None
        original_name = "attachment"
        mime = "application/octet-stream"
        if isinstance(message.get("document"), dict):
            candidate = message["document"]
            original_name = str(candidate.get("file_name") or original_name)
            mime = str(candidate.get("mime_type") or mime)
        elif isinstance(message.get("voice"), dict):
            candidate = message["voice"]
            original_name = "voice.ogg"
            mime = str(candidate.get("mime_type") or "audio/ogg")
        elif isinstance(message.get("audio"), dict):
            candidate = message["audio"]
            original_name = str(candidate.get("file_name") or "audio")
            mime = str(candidate.get("mime_type") or "audio/mpeg")
        elif isinstance(message.get("photo"), list) and message["photo"]:
            photos = [item for item in message["photo"] if isinstance(item, dict)]
            candidate = max(
                photos,
                key=lambda item: item.get("file_size", 0)
                if isinstance(item.get("file_size", 0), int) else 0,
                default=None,
            )
            original_name = "photo.jpg"
            mime = "image/jpeg"
        if not candidate:
            return None
        file_id = candidate.get("file_id")
        declared = candidate.get("file_size")
        if not isinstance(file_id, str):
            raise TransportRefusal("attachment_invalid")
        mime = unicodedata.normalize("NFKC", mime).casefold().strip()
        if mime not in ALLOWED_ATTACHMENT_MIME:
            raise TransportRefusal("attachment_type_not_allowed")
        if isinstance(declared, int) and declared > store.MAX_ATTACHMENT_BYTES:
            raise TransportRefusal("attachment_too_large")
        try:
            meta = api.file_meta(file_id)
            meta_size = meta.get("file_size")
            if isinstance(meta_size, int) and meta_size > store.MAX_ATTACHMENT_BYTES:
                raise TransportRefusal("attachment_too_large")
            opaque, size = store.create_inbox_file(api.download_chunks(meta["file_path"]))
        except TelegramError as exc:
            raise TransportRefusal(exc.code) from None
        except store.StoreError as exc:
            raise TransportRefusal(exc.code) from None
        return {
            "opaque": opaque,
            "name": Path(original_name).name[:180] or "attachment",
            "mime": mime[:120],
            "size": size,
        }

    def _enqueue(self, role: str, update_id: int, message: dict, attachment: dict | None) -> None:
        event_id = f"telegram:{role}:{update_id}"
        event = {
            "event_id": event_id,
            "agent": role,
            "body": str(message.get("text") or message.get("caption") or ""),
            "created_at": _now_iso(message.get("date")),
        }
        if attachment:
            event["attachment"] = attachment
        name = f"events-{role}"
        with store.locked(name):
            events = store.read_state(name, [])
            if not any(item.get("event_id") == event_id for item in events):
                if len(events) >= MAX_EVENTS:
                    raise TransportRefusal("inbox_full")
                events.append(event)
                store.write_state(name, events)

    def process_update(self, role: str, update: dict, secret: dict[str, str], api: BotAPI) -> None:
        update_id = update.get("update_id")
        callback = update.get("callback_query")
        if isinstance(callback, dict) and isinstance(update_id, int) and not isinstance(update_id, bool) and self._apply_callback(role, update_id, callback, secret, api):
            return
        message = update.get("message") or update.get("edited_message")
        if not isinstance(update_id, int) or isinstance(update_id, bool) or not isinstance(message, dict):
            return
        chat = message.get("chat")
        if not isinstance(chat, dict) or str(chat.get("id")) != secret["chat_id"]:
            return
        text = str(message.get("text") or message.get("caption") or "").strip()
        reply = message.get("reply_to_message")
        reply_id = reply.get("message_id") if isinstance(reply, dict) else None
        now = int(time.time())
        if text and self._looks_like_otp(text) and not self._is_open_question(role, reply_id, now):
            api.send_message(
                secret["chat_id"],
                "I codici non si accettano qui; usa la finestra sicura di login.",
            )
            return
        attachment = self._attachment(api, message)
        if text or attachment:
            try:
                self._enqueue(role, update_id, message, attachment)
            except BaseException:
                if attachment:
                    try:
                        store.delete_inbox_file(attachment["opaque"])
                    except (KeyError, store.StoreError):
                        pass
                raise

    def _poller_state(self, role: str, state: str, reason: str) -> None:
        """Log and persist a poller's state only when it changes.

        A refused token, a conflicting consumer and a network problem must be
        told apart in the field, and `bots status` must show it; the line
        carries the role and a fixed code, never the token or the URL.
        """
        if not POLLER_REASON.fullmatch(reason):
            reason = "telegram_internal_error"
        if self._poller_states.get(role) == (state, reason):
            return
        self._poller_states[role] = (state, reason)
        try:
            store.record_poller_state(role, state, reason, _now_iso())
        except store.StoreError:
            pass
        print(f"[jht-telegram] poller role={role} state={state} reason={reason}", file=sys.stderr, flush=True)

    def poll_role(self, role: str) -> None:
        backoff = 1
        while not self.stop_event.is_set():
            try:
                if store.pairing_active(role, time.time()):
                    # The host is reading this bot's updates to verify a chat.
                    self._poller_state(role, "idle", "pairing")
                    self.stop_event.wait(2)
                    continue
                secret, api = self._bot(role)
                offsets = store.read_state("offsets", {})
                offset = int(offsets.get(role, 0))
                updates = api.get_updates(offset)
                self._poller_state(role, "ok", "polling")
                if store.pairing_active(role, time.time()):
                    # A pairing started during the long poll: leave these
                    # updates unconsumed, the code may be among them.
                    continue
                for update in updates:
                    update_id = update.get("update_id")
                    try:
                        self.process_update(role, update, secret, api)
                    except Exception as exc:
                        # A permanently bad update must not pin getUpdates.
                        # Its id is consumed below; later updates continue and
                        # the operator can see the bounded dead-letter trace.
                        if isinstance(update_id, int) and not isinstance(update_id, bool):
                            reason = getattr(exc, "code", "telegram_internal_error")
                            self._record_discard(role, update_id, str(reason))
                    finally:
                        if isinstance(update_id, int) and not isinstance(update_id, bool):
                            with store.locked("offsets"):
                                offsets = store.read_state("offsets", {})
                                offsets[role] = max(int(offsets.get(role, 0)), update_id + 1)
                                store.write_state("offsets", offsets)
                backoff = 1
            except TransportRefusal as exc:
                if exc.code == "bot_not_configured":
                    self._poller_state(role, "idle", exc.code)
                    self.stop_event.wait(5)
                else:
                    self._poller_state(role, "error", exc.code)
                    self.stop_event.wait(backoff)
                    backoff = min(backoff * 2, 30)
            except TelegramError as exc:
                self._poller_state(role, "error", exc.code)
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 30)
            except Exception:  # keep one malformed update from killing a role poller
                self._poller_state(role, "error", "telegram_internal_error")
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 30)

    def start_pollers(self) -> list[threading.Thread]:
        threads = []
        for role in BOT_ROLES:
            thread = threading.Thread(target=self.poll_role, args=(role,), daemon=True, name=f"telegram-{role}")
            thread.start()
            threads.append(thread)
        return threads
