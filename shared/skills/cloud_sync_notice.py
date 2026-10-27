#!/usr/bin/env python3
"""cloud_sync_notice.py — tell the user, once, that the box can no longer sync with the website.

The box pushes its positions to the website with its sync token. When the website refuses the
token (expired, or revoked) every push fails with 401 and nothing reaches the website again; the
website cannot say so itself, because it is the box that no longer reaches it. The box tells the
user on its own channel: a row in the app's panel, mirrored in the chat, and Telegram when it is
linked (jht-notify-user, as web_action_notice.py does).

A second code, `session_lost`, tells that the Supabase session the daemon listens to the website with
is gone (its refresh token was used twice): the box falls back to slower checks until the device is
paired again.

A closed code with a fixed sentence in the user's language, under `cloud_sync_notice.<code>` in
shared/locales/<lang>.json. One notice per token: the key is the token's public prefix, the one the
website lists, so a new token that is refused in its turn is told again.

    python3 cloud_sync_notice.py token_rejected jht_sync_AbCd

Prints one JSON line, {"notified": bool, ...}, and exits 0 also when it could not tell: a notice
never stops the sync that calls it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import web_action_notice as _shared  # noqa: E402  (language, catalog and notify tool of the box)

sys.path.pop(0)

SOURCE_ACTION = "cloud_sync_notice"
AGENT = "assistente"
CODES = frozenset({"token_rejected", "session_lost"})
# The public prefix of a sync token, as the website lists it: jht_sync_ and four characters.
KEY = re.compile(r"^jht_sync_[A-Za-z0-9_-]{4}$")
LANGUAGES = _shared.LANGUAGES


def text_for(code: str, lang: str) -> str:
    """The sentence of `code` in `lang`; English when that language has none."""
    return _shared._catalog(lang)[f"cloud_sync_notice.{code}"]


def notify(code: str, key: str, *, lang: str | None = None, run=subprocess.run) -> dict:
    """Tell the user once about `code` for the token `key`; the same key twice is one row."""
    if code not in CODES:
        return {"notified": False, "reason": "code_unknown"}
    if not isinstance(key, str) or not KEY.match(key):
        return {"notified": False, "reason": "key_invalid"}
    tool = _shared.notify_tool()
    if tool is None:
        return {"notified": False, "reason": "notify_tool_missing"}
    cmd = [sys.executable, str(tool), "--agent", AGENT, "--kind", "alert",
           "--source-id", f"cloud-sync:{code}:{key}", "--source-action", SOURCE_ACTION,
           "--source-payload", json.dumps({"code": code}, separators=(",", ":")),
           text_for(code, lang or _shared.user_language())]
    try:
        result = run(cmd, capture_output=True, text=True, timeout=60, env=os.environ.copy())
    except (OSError, subprocess.TimeoutExpired) as err:
        return {"notified": False, "reason": "notify_failed", "detail": type(err).__name__}
    if result.returncode != 0:
        return {"notified": False, "reason": "notify_failed", "detail": (result.stderr or "").strip()[-200:]}
    words = (result.stdout or "").split()
    row = int(words[-1]) if words and words[-1].isdigit() else None
    return {"notified": True, "code": code, "row_id": row}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cloud_sync_notice", description="Notice that the box can no longer sync with the website.")
    parser.add_argument("code", help="one of: " + ", ".join(sorted(CODES)))
    parser.add_argument("key", help="the token's public prefix: jht_sync_ and four characters")
    args = parser.parse_args(argv)
    print(json.dumps(notify(args.code, args.key), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
