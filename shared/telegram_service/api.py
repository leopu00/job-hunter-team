"""Small Bot API adapter whose exceptions never contain token-bearing URLs."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import BinaryIO, Iterator


class TelegramError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class BotAPI:
    def __init__(self, token: str, *, timeout: int = 35) -> None:
        self._base = f"https://api.telegram.org/bot{token}/"
        self._file_base = f"https://api.telegram.org/file/bot{token}/"
        self._timeout = timeout

    def call(self, method: str, payload: dict) -> dict:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self._base + method,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
        except (urllib.error.URLError, TimeoutError, OSError):
            raise TelegramError("telegram_unreachable") from None
        if len(raw) > 2 * 1024 * 1024:
            raise TelegramError("telegram_bad_response")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise TelegramError("telegram_bad_response") from None
        if not isinstance(value, dict) or value.get("ok") is not True:
            raise TelegramError("telegram_refused")
        result = value.get("result")
        return result if isinstance(result, dict) else {"value": result}

    def send_message(self, chat_id: str, text: str) -> int:
        result = self.call(
            "sendMessage",
            {"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        )
        message_id = result.get("message_id")
        if not isinstance(message_id, int) or isinstance(message_id, bool):
            raise TelegramError("telegram_bad_response")
        return message_id

    def get_updates(self, offset: int) -> list[dict]:
        result = self.call(
            "getUpdates",
            {"offset": offset, "timeout": 25, "allowed_updates": ["message", "edited_message"]},
        )
        value = result.get("value")
        if not isinstance(value, list):
            raise TelegramError("telegram_bad_response")
        return [item for item in value if isinstance(item, dict)]

    def file_meta(self, file_id: str) -> dict:
        result = self.call("getFile", {"file_id": file_id})
        path = result.get("file_path")
        if not isinstance(path, str) or not path or path.startswith("/") or ".." in path.split("/"):
            raise TelegramError("telegram_bad_response")
        return result

    def download_chunks(self, file_path: str, *, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
        # Telegram supplied file_path was validated by file_meta.  Quoting
        # components prevents query/fragment interpretation without changing
        # the path separators expected by the API.
        quoted = "/".join(urllib.parse.quote(part, safe="") for part in file_path.split("/"))
        try:
            response: BinaryIO = urllib.request.urlopen(self._file_base + quoted, timeout=60)
            with response:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
        except (urllib.error.URLError, TimeoutError, OSError):
            raise TelegramError("telegram_unreachable") from None
