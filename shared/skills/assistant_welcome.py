#!/usr/bin/env python3
"""The Assistente's welcome, delivered in the chat of the app.

    assistant_welcome.py deliver
    assistant_welcome.py settled

The welcome goes to the chat the app reads (`agents/assistente/chat.jsonl`,
the file `jht-send` writes) ALWAYS; Telegram is an extra, only when a bot is
configured. The flag `profile/welcomed.flag` says "the user has been welcomed",
and this command is the only thing that writes it, and only after the line is
in the chat and has been read back: a welcome that skipped the app, or that
failed, leaves no flag, and whoever asked (the launcher watchdog) asks again.

The first question of the onboarding travels in the same message when the
profile is not ready (no `profile/ready.flag`), so it never arrives minutes
after the greeting. With the profile ready the welcome does not ask for the CV
(nothing is left to send): it is the greeting and one line saying so.

Safe to run again: a welcome already in the chat is not sent twice (nor on
Telegram), the flag is just refreshed. «A welcome already in the chat» is any
welcome the Assistente ever posted, whatever its text was then, in whatever
language and whichever version of the catalog (the text has changed since the
first installs): it is known by its opening, not by today's whole text. Two
callers at once (the container boot and the agent) take one lock.

`settled` asks, without the model, whether a start of the Assistente has
anything left for its welcome message to do: the flag is there, a welcome is in
the chat, and the onboarding is over (`profile/onboarding-done.flag`, or a
profile that has nothing left to ask: the eight fields and the questionnaire
done, as the Assistente itself would find after a restart; a profile made
before the flag existed has none). Then the launcher sends nothing: a restart
(a `jht up` during the pause of the budget, an update too) costs no call.
Exit 0 and `WELCOME_SETTLED`, else exit 1 and `WELCOME_PENDING <what is missing>`.

One line on stdout:
    WELCOME_DELIVERED chat=posted|already telegram=sent|failed|skipped|replay flag=ok|not_written
    WELCOME_NOT_DELIVERED <reason>
Exit 0 when delivered, 3 when not, 2 for a wrong call.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

AGENT = "assistente"
FLAG = "welcomed.flag"
READY_FLAG = "ready.flag"
ONBOARDING_DONE_FLAG = "onboarding-done.flag"
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


def _opening(text: str) -> str:
    """The greeting and the line that says who the Assistente is: the first two paragraphs. They are the same in every version
    of the text since the first one (what follows is what changed: the upload command, the question)."""
    return "\n\n".join(text.split("\n\n")[:2])


# The first line of a welcome, in each of the seven languages, and the words that make it THIS welcome: the brand's name in
# the lines that follow. A welcome is known by these, so one posted with an older text, or in another language than the
# one the catalog speaks today, is still the welcome.
_BRAND = "Job Hunter Team"
_BRAND_WITHIN = 240


def _greetings() -> set[str]:
    """The first line of `welcome.assistente` in every catalog next to the one in use."""
    found: set[str] = set()
    for path in sorted((HERE.parent / "locales").glob("*.json")):
        try:
            text = json.loads(path.read_text(encoding="utf-8")).get("welcome.assistente")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(text, str) and text.strip():
            found.add(text.strip().split("\n", 1)[0].strip())
    return found


def looks_like_the_welcome(text: str, greetings: set[str] | None = None) -> bool:
    """True for a line that is the Assistente's welcome, of any version and any language."""
    text = text.strip()
    if not text:
        return False
    first = text.split("\n", 1)[0].strip()
    return first in (greetings if greetings is not None else _greetings()) and _BRAND in text[:_BRAND_WITHIN]


# Where the team runs, for the way the welcome gives to hand over a file (JHT-T354): the same reading as `jht team status --json`
# (cli/src/lib/host-where.js). On a VPS the folder is on the server and the person is in its terminal; at home the folder of
# the person is mounted at /jht_user from the share of the machine (virtiofs = macOS, 9p/drvfs = Windows, a disk = Linux).
# When it cannot be told the welcome gives only the upload command, never the paths of every system together.
_MAC_SHARES = {"virtiofs", "fakeowner", "fuse.grpcfuse", "osxfs"}
_WINDOWS_SHARES = {"9p", "drvfs", "v9fs"}


def host_type() -> str:
    given = str(os.environ.get("JHT_HOST_TYPE") or "").strip().lower()
    if given:
        return "vps" if given == "vps" else "local"
    try:
        for line in (jht_home() / "host.env").read_text(encoding="utf-8").splitlines():
            key, _, value = line.strip().removeprefix("export ").partition("=")
            if key == "JHT_HOST_TYPE":
                return "vps" if value.strip().strip("'\"").lower() == "vps" else "local"
    except OSError:
        pass
    return "local"


def mount_fs_type(mountinfo: str, point: str = "/jht_user") -> str | None:
    for line in mountinfo.splitlines():
        left, sep, right = line.partition(" - ")
        fields = left.split(" ")
        if sep and len(fields) > 4 and fields[4] == point:
            return right.split(" ")[0] or None
    return None


def host_kind() -> str:
    """vps, macos, windows, linux, or unknown."""
    if host_type() == "vps":
        return "vps"
    try:
        fs = mount_fs_type(Path(os.environ.get("JHT_WELCOME_MOUNTINFO") or "/proc/self/mountinfo").read_text(encoding="utf-8"))
    except OSError:
        fs = None
    if fs is None:
        return "unknown"
    if fs in _MAC_SHARES:
        return "macos"
    if fs in _WINDOWS_SHARES:
        return "windows"
    return "linux"


def render_welcome(base: str, t) -> str:
    """`welcome.assistente` with its {file_way}: the way to hand over a file that works where the team runs."""
    if "{file_way}" not in base:
        return base
    way = _lookup(t, f"welcome.assistente_file_{host_kind()}") or _lookup(t, "welcome.assistente_file_unknown")
    return base.replace("{file_way}", way)


def welcome_texts() -> tuple[str, str]:
    """(the opening that makes it the welcome, the text to post).

    The text is the whole welcome with the first question of the onboarding while the profile is not ready; with the
    profile ready it is the opening and one line that says there is nothing to send, never the request for the CV."""
    t = _catalog()
    base = render_welcome(_lookup(t, "welcome.assistente"), t)
    if not base:
        return "", ""
    opening = _opening(base)
    if (jht_home() / "profile" / READY_FLAG).exists():
        ready = _lookup(t, "welcome.assistente_ready")
        # the greeting and a line on who she is that does not say the team is about to start (it is working): the
        # welcome is known by the greeting and the brand's name, so it stays the welcome
        who = _lookup(t, "welcome.assistente_ready_who")
        head = f"{base.split(chr(10) * 2)[0]}\n\n{who}" if who else opening
        return opening, f"{head}\n\n{ready}" if ready else head
    first = _lookup(t, "welcome.assistente_first")
    return opening, f"{base}\n\n{first}" if first else base


def _in_chat() -> bool:
    """The Assistente has already posted a welcome (any text of it) in the chat of the app."""
    try:
        raw = chat_path().read_text(encoding="utf-8")
    except OSError:
        return False
    greetings = _greetings()
    for line in raw.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("role") == "assistant" and looks_like_the_welcome(str(row.get("text", "")), greetings):
            return True
    return False


def post_to_chat(text: str) -> str | None:
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
    if not _in_chat():
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
        if _in_chat():
            chat, telegram = "already", "replay"
        else:
            failure = post_to_chat(text)
            if failure:
                _log_error(failure)
                print(f"WELCOME_NOT_DELIVERED {failure}")
                return 3
            chat, telegram = "posted", send_telegram(text)
        flag = "ok" if touch_flag() else "not_written"
    print(f"WELCOME_DELIVERED chat={chat} telegram={telegram} flag={flag}")
    return 0


def _nothing_left_to_ask() -> bool:
    """The eight fields are in the profile and the questionnaire has no step left: what the Assistente checks after a restart
    before it writes onboarding-done.flag and asks nothing. Whatever cannot be read means there may be something to ask."""
    try:
        if str(HERE) not in sys.path:
            sys.path.insert(0, str(HERE))
        import onboarding_questionnaire  # type: ignore
        import profile_review  # type: ignore
        import validate_profile  # type: ignore

        profile, raw = profile_review._read_profile()
        if raw is None or not isinstance(profile, dict) or validate_profile.team_minimum_missing(profile):
            return False
        return onboarding_questionnaire.status().get("done") is True
    except Exception:  # noqa: BLE001
        return False


# Back after the switch of the tools (JHT-T346). The host writes $JHT_HOME/state/tools-switch.json = {"schema":1,"at":"<ISO UTC>"}
# just before it stops the core team (scripts/jht-tools.sh): the container goes away under the person's chat, and on the full
# image the Assistente starts again with no word of it. At its first start after the switch (the launcher runs `settled`, or the
# welcome runs `deliver`) one line in its name says it is back, what happens now and what the person can do: no call of the model,
# once per switch (state/tools-switch-told keeps the `at` it was said for). A team paused (the budget brake, the person, a standby)
# is said paused, never «working». Nothing on stdout: the one line of `settled` and `deliver` stays as it was.
SWITCH_WINDOW_S = 600
_ISO_UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z")


def _switch_at(now: float | None = None) -> str | None:
    path = jht_home() / "state" / "tools-switch.json"
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 512:
            return None
        seen = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    at = seen.get("at") if isinstance(seen, dict) and seen.get("schema") == 1 else None
    if not isinstance(at, str) or not _ISO_UTC.fullmatch(at):
        return None
    try:
        when = datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
    age = (time.time() if now is None else now) - when
    return at if -120 <= age <= SWITCH_WINDOW_S else None


def _team_paused() -> bool:
    home = jht_home()
    try:
        halt = json.loads((home / "logs" / "daily-halt.flag").read_text(encoding="utf-8"))
        if isinstance(halt, dict) and halt.get("reason") == "pi_spend_cap":
            return True
    except (OSError, ValueError):
        pass
    return (home / ".team-standby.flag").is_file()


def tell_back_after_switch() -> str:
    """`told`, `already`, `none` (no recent switch, or no welcome in the chat yet: the welcome comes first) or the reason it failed."""
    at = _switch_at()
    if at is None:
        return "none"
    marker = jht_home() / "state" / "tools-switch-told"
    try:
        if marker.read_text(encoding="utf-8").strip() == at:
            return "already"
    except OSError:
        pass
    if not _in_chat():
        return "none"
    t = _catalog()
    text = _lookup(t, "welcome.assistente_back_paused" if _team_paused() else "welcome.assistente_back")
    if not text:
        return "none"
    reason = post_to_chat(text)
    if reason:
        return reason
    try:
        marker.write_text(at + "\n", encoding="utf-8")
    except OSError:
        pass
    return "told"


def settled() -> int:
    profile = jht_home() / "profile"
    if not (profile / FLAG).is_file():
        missing = "flag"
    elif not _in_chat():
        missing = "chat"
    elif not (profile / ONBOARDING_DONE_FLAG).is_file() and not _nothing_left_to_ask():
        missing = "onboarding"
    else:
        print("WELCOME_SETTLED")
        return 0
    print(f"WELCOME_PENDING {missing}")
    return 1


def main(argv: list[str]) -> int:
    if argv in (["deliver"], ["settled"]):
        try:
            tell_back_after_switch()
        except Exception:  # noqa: BLE001 — a line that cannot be said never stops the welcome or the start of the Assistente
            pass
    if argv == ["deliver"]:
        return deliver()
    if argv == ["settled"]:
        return settled()
    print("usage: assistant_welcome.py deliver|settled", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
