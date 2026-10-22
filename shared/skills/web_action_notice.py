#!/usr/bin/env python3
"""web_action_notice.py — tell the user, out of band, that the website changed something on the box.

An action taken on the website with the user's session (an application authorised, the team
stopped, a team order added or changed) reaches the box through the cloud. Whoever holds that
session can take it; the user learns of it here, on a channel the website does not hold: Telegram
when it is linked, and in any case a row in the app's panel, mirrored in the chat.

The notice is a CLOSED code with a fixed sentence in the user's language. No text from the website
or from the position goes in it: only the position's number. One notice per event: the key names
the event (the position and the instant of its authorisation), and the same key twice is one row.

    python3 web_action_notice.py apply_authorized_from_web apply:42:1757669400000 --position-id 42

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
SOURCE_ACTION = "web_action_notice"
# Who speaks: the general interlocutor, whose bot is the default one.
AGENT = "assistente"
KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
LANGUAGES = ("en", "it", "de", "fr", "es", "pt", "hu")

# The codes; each one's sentence lives in the shared catalogs, under
# `web_action_notice.<code>` in shared/locales/<lang>.json, with the rest of the
# user-facing copy of the box.
CODES = frozenset({
    "apply_authorized_from_web",
    "apply_revoked_from_web",
    "apply_revoked_many_from_web",
    "team_stopped_from_web",
    "team_started_from_web",
    "team_restarted_from_web",
    "directive_changed_from_web",
})
POSITION_CODES = frozenset({"apply_authorized_from_web", "apply_revoked_from_web"})


def user_language() -> str:
    """The user's language (shared/i18n.py, the same resolution as the rest of the box), or en."""
    sys.path.insert(0, str(HERE.parent))
    try:
        import i18n

        lang = i18n.current_lang()
    except Exception:
        lang = "en"
    finally:
        sys.path.pop(0)
    return lang if lang in LANGUAGES else "en"


def _catalog(lang: str) -> dict:
    """The shared catalog of `lang` over the English one (shared/i18n.py)."""
    sys.path.insert(0, str(HERE.parent))
    try:
        import i18n

        return i18n._load_catalog(lang if lang in LANGUAGES else "en")
    finally:
        sys.path.pop(0)


def text_for(code: str, lang: str) -> str:
    """The sentence of `code` in `lang`; English when that language has none."""
    return _catalog(lang)[f"web_action_notice.{code}"]


def body_for(code: str, position_id: int | None, lang: str) -> str:
    return text_for(code, lang).format(position=position_id if position_id is not None else "")


def notify_tool() -> Path | None:
    for candidate in (Path("/app/agents/_tools/jht-notify-user"), HERE.parent.parent / "agents" / "_tools" / "jht-notify-user"):
        if candidate.is_file():
            return candidate
    return None


def notify(code: str, key: str, position_id: int | None = None, *, lang: str | None = None, run=subprocess.run) -> dict:
    """Tell the user once about `code`; the same `key` twice is the same row, delivered once."""
    if code not in CODES:
        return {"notified": False, "reason": "code_unknown"}
    if not isinstance(key, str) or not KEY.match(key):
        return {"notified": False, "reason": "key_invalid"}
    if position_id is not None and (isinstance(position_id, bool) or not isinstance(position_id, int) or position_id <= 0):
        return {"notified": False, "reason": "position_invalid"}
    if code in POSITION_CODES and position_id is None:
        return {"notified": False, "reason": "position_missing"}
    tool = notify_tool()
    if tool is None:
        return {"notified": False, "reason": "notify_tool_missing"}
    payload = {"code": code}
    if position_id is not None:
        payload["position_id"] = position_id
    cmd = [sys.executable, str(tool), "--agent", AGENT, "--kind", "alert",
           "--source-id", f"web-action:{code}:{key}", "--source-action", SOURCE_ACTION,
           "--source-payload", json.dumps(payload, separators=(",", ":"))]
    if position_id is not None:
        cmd += ["--position-id", str(position_id)]
    cmd.append(body_for(code, position_id, lang or user_language()))
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
    parser = argparse.ArgumentParser(prog="web_action_notice", description="Out-of-band notice of an action taken from the website.")
    parser.add_argument("code", help="one of: " + ", ".join(sorted(CODES)))
    parser.add_argument("key", help="what makes this event one: [A-Za-z0-9_.:-], up to 120")
    parser.add_argument("--position-id", type=int, default=None)
    args = parser.parse_args(argv)
    print(json.dumps(notify(args.code, args.key, args.position_id), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
