"""Telegram send/poll logic owned by the isolated service."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import store
from .api import BotAPI, TelegramError
from .protocol import AGENT_PREFIX, BOT_ROLES

BURST_LIMIT = 10
DAILY_LIMIT = 300
BURST_SECONDS = 60
DAY_SECONDS = 86_400
QUESTION_TTL_SECONDS = 7 * DAY_SECONDS
LEASE_SECONDS = 30
MAX_EVENTS = 1_000
MAX_TELEGRAM_UTF16 = 4_096
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


class TransportRefusal(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _now_iso(unix: int | float | None = None) -> str:
    stamp = unix if isinstance(unix, (int, float)) and not isinstance(unix, bool) else time.time()
    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


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
        return {"ok": True, "configured": configured}

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
        raise TransportRefusal("unknown_operation")

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

    def poll_role(self, role: str) -> None:
        backoff = 1
        while not self.stop_event.is_set():
            try:
                secret, api = self._bot(role)
                offsets = store.read_state("offsets", {})
                offset = int(offsets.get(role, 0))
                updates = api.get_updates(offset)
                for update in updates:
                    update_id = update.get("update_id")
                    try:
                        self.process_update(role, update, secret, api)
                    except Exception:
                        # A permanently bad update must not pin getUpdates.
                        # Its id is consumed below; later updates continue.
                        pass
                    finally:
                        if isinstance(update_id, int) and not isinstance(update_id, bool):
                            with store.locked("offsets"):
                                offsets = store.read_state("offsets", {})
                                offsets[role] = max(int(offsets.get(role, 0)), update_id + 1)
                                store.write_state("offsets", offsets)
                backoff = 1
            except TransportRefusal as exc:
                if exc.code == "bot_not_configured":
                    self.stop_event.wait(5)
                else:
                    self.stop_event.wait(backoff)
                    backoff = min(backoff * 2, 30)
            except Exception:  # keep one malformed update from killing a role poller
                self.stop_event.wait(backoff)
                backoff = min(backoff * 2, 30)

    def start_pollers(self) -> list[threading.Thread]:
        threads = []
        for role in BOT_ROLES:
            thread = threading.Thread(target=self.poll_role, args=(role,), daemon=True, name=f"telegram-{role}")
            thread.start()
            threads.append(thread)
        return threads
