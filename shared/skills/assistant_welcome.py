#!/usr/bin/env python3
"""The Assistente's welcome, delivered in the chat of the app.

    assistant_welcome.py deliver

The welcome goes to the chat the app reads (`agents/assistente/chat.jsonl`,
the file `jht-send` writes) ALWAYS; Telegram is an extra, only when a bot is
configured. The flag `profile/welcomed.flag` says "the user has been welcomed",
and this command is the only thing that writes it, and only after the line is
in the chat and has been read back: a welcome that skipped the app, or that
failed, leaves no flag, and whoever asked (the launcher watchdog) asks again.

The first question of the onboarding travels in the same message when the
profile is not ready (no `profile/ready.flag`), so it never arrives minutes
after the greeting.

Safe to run again: a welcome already in the chat is not sent twice (nor on
Telegram), the flag is just refreshed. Two callers at once (the container boot
and the agent) take one lock.

One line on stdout:
    WELCOME_DELIVERED chat=posted|already telegram=sent|failed|skipped|replay flag=ok|not_written
    WELCOME_NOT_DELIVERED <reason>
Exit 0 when delivered, 3 when not, 2 for a wrong call.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

AGENT = "assistente"
FLAG = "welcomed.flag"
READY_FLAG = "ready.flag"
SEND_TIMEOUT_S = 30
TELEGRAM_TIMEOUT_S = 60

HERE = Path(__file__).resolve().parent


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def chat_path() -> Path:
    return jht_home() / "agents" / AGENT / "chat.jsonl"


def _tool(env_name: str, name: str) -> Path:
    given = os.environ.get(env_name)
    if given:
        return Path(given)
    return HERE.parent.parent / "agents" / "_tools" / name


def _catalog():
    spec = importlib.util.spec_from_file_location("jht_i18n", HERE.parent / "i18n.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.t


def _lookup(t, key: str) -> str:
    value = t(key)
    return "" if not value or value == key else value


def welcome_texts() -> tuple[str, str]:
    """(the greeting, the greeting with the first question when the profile is not ready)."""
    t = _catalog()
    base = _lookup(t, "welcome.assistente")
    if not base:
        return "", ""
    first = _lookup(t, "welcome.assistente_first")
    ready = (jht_home() / "profile" / READY_FLAG).exists()
    return base, base if ready or not first else f"{base}\n\n{first}"


def _in_chat(base: str) -> bool:
    try:
        raw = chat_path().read_text(encoding="utf-8")
    except OSError:
        return False
    for line in raw.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("role") == "assistant" and str(row.get("text", "")).startswith(base):
            return True
    return False


def post_to_chat(text: str, base: str) -> str | None:
    """Write the text with `jht-send` and read it back. None on success, else the reason."""
    sender = _tool("JHT_WELCOME_SEND", "jht-send")
    env = dict(os.environ, JHT_HOME=str(jht_home()))
    env.pop("JHT_AGENT_DIR", None)
    try:
        done = subprocess.run(
            [sys.executable, str(sender), "--agent", AGENT, "--raw", text],
            env=env, capture_output=True, text=True, timeout=SEND_TIMEOUT_S, stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError) as err:
        return f"chat_send_failed:{type(err).__name__}"
    if done.returncode != 0:
        return f"chat_send_failed:rc={done.returncode}"
    if not _in_chat(base):
        return "chat_line_not_found_after_send"
    return None


def _telegram_configured() -> bool:
    try:
        config = json.loads((jht_home() / "jht.config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    channels = config.get("channels") if isinstance(config, dict) else None
    telegram = channels.get("telegram") if isinstance(channels, dict) else None
    bots = telegram.get("bots") if isinstance(telegram, dict) else None
    if not isinstance(bots, dict):
        return False
    return any(isinstance(b, dict) and str(b.get("bot_token", "")).strip() for b in bots.values())


def send_telegram(text: str) -> str:
    if not _telegram_configured():
        return "skipped"
    sender = _tool("JHT_WELCOME_TELEGRAM", "jht-telegram-send")
    try:
        done = subprocess.run(
            [str(sender), "--from", AGENT, text],
            capture_output=True, text=True, timeout=TELEGRAM_TIMEOUT_S, stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError) as err:
        _log_error(f"telegram send failed: {type(err).__name__}")
        return "failed"
    if done.returncode != 0:
        _log_error(f"telegram send failed: rc={done.returncode}")
        return "failed"
    return "sent"


def _log_error(message: str) -> None:
    try:
        path = jht_home() / "agents" / AGENT / "welcome-error.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(message + "\n")
    except OSError:
        pass


def touch_flag() -> bool:
    flag = jht_home() / "profile" / FLAG
    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.touch()
        os.utime(flag, None)
    except OSError as err:
        _log_error(f"flag not written: {type(err).__name__}")
        return False
    return True


class _Lock:
    """One welcome at a time: the container boot and the agent can both ask."""

    def __init__(self):
        self.handle = None

    def __enter__(self):
        try:
            import fcntl

            path = jht_home() / "agents" / AGENT / ".welcome.lock"
            path.parent.mkdir(parents=True, exist_ok=True)
            self.handle = path.open("a")
            fcntl.flock(self.handle, fcntl.LOCK_EX)
        except (ImportError, OSError):
            self.handle = None
        return self

    def __exit__(self, *_exc):
        if self.handle is not None:
            self.handle.close()


def deliver() -> int:
    base, text = welcome_texts()
    if not base:
        print("WELCOME_NOT_DELIVERED no_welcome_text")
        return 3
    with _Lock():
        if _in_chat(base):
            chat, telegram = "already", "replay"
        else:
            failure = post_to_chat(text, base)
            if failure:
                _log_error(failure)
                print(f"WELCOME_NOT_DELIVERED {failure}")
                return 3
            chat, telegram = "posted", send_telegram(text)
        flag = "ok" if touch_flag() else "not_written"
    print(f"WELCOME_DELIVERED chat={chat} telegram={telegram} flag={flag}")
    return 0


def main(argv: list[str]) -> int:
    if argv != ["deliver"]:
        print("usage: assistant_welcome.py deliver", file=sys.stderr)
        return 2
    return deliver()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
