#!/usr/bin/env python3
"""The pi session an agent takes up again when it is started again, or nothing (a new session).

pi keeps every conversation of an agent as a JSONL file under <pi agent dir>/sessions/--<cwd>--/, and start-agent.sh used
to start pi with none of them: after a restart of the container (the switch to the full image in the middle of the
onboarding, a reboot) the Assistente had forgotten the conversation it was having with the person. start-agent.sh now
asks this file which session to open (`pi --session <path>`), and opens a new one when the answer is empty.

Only the NEWEST session of the agent is looked at, and it is taken up again only when all of this holds:
  * every line is a JSON object (a line cut by a crash is a corrupted session: pi would stop on it, the agent with it);
  * the header is a pi session of this working directory;
  * the person and the agent have talked in it (at least one user and one assistant message);
  * the last model it used (the latest model_change, else the last assistant message) is the provider and model the
    agent starts with now: a conversation of another provider or model is not continued on this one;
  * it was written in the last `--max-age-hours` hours (an old conversation is a new one).
Anything else answers nothing, with the reason on stderr. The newer session never falls back to an older one: that would
bring back a conversation that came before the one the person remembers.

    pi_session_resume.py --sessions-dir DIR --cwd CWD --provider zai --model glm-5.3 [--max-age-hours 24]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

# what start-agent.sh may put on the command line of pi: the path is written between single quotes there
SAFE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")
MAX_BYTES = 64 * 1024 * 1024


def session_folder(sessions_dir: Path, cwd: str) -> Path:
    """pi's folder for a working directory: the leading separator removed, `/`, `\\` and `:` made `-`, between `--`."""
    name = cwd.lstrip("/\\")
    for ch in "/\\:":
        name = name.replace(ch, "-")
    return sessions_dir / ("--%s--" % name)


def newest_session(folder: Path):
    try:
        files = [p for p in folder.glob("*.jsonl") if p.is_file()]
    except OSError:
        return None
    return max(files, key=lambda p: (p.stat().st_mtime, p.name)) if files else None


def why_not(path: Path, cwd: str, provider: str, model: str, max_age_s: float, now: float):
    """None when `path` may be taken up again, else the reason in a few words."""
    try:
        stat = path.stat()
    except OSError as error:
        return "unreadable (%s)" % error.__class__.__name__
    if now - stat.st_mtime > max_age_s:
        return "older than the limit"
    if stat.st_size > MAX_BYTES:
        return "too big"
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return "unreadable (%s)" % error.__class__.__name__
    if not text.endswith("\n"):
        return "the last line is cut"
    entries = []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            return "line %d is not JSON" % number
        if not isinstance(entry, dict):
            return "line %d is not an object" % number
        entries.append(entry)
    if not entries or entries[0].get("type") != "session":
        return "no session header"
    if entries[0].get("cwd") != cwd:
        return "another working directory"
    roles = [e.get("message", {}).get("role") for e in entries if e.get("type") == "message" and isinstance(e.get("message"), dict)]
    if "user" not in roles or "assistant" not in roles:
        return "no conversation in it"
    used = None
    for entry in entries[1:]:
        if entry.get("type") == "model_change":
            used = (entry.get("provider"), entry.get("modelId"))
        elif entry.get("type") == "message" and isinstance(entry.get("message"), dict) and entry["message"].get("role") == "assistant":
            used = (entry["message"].get("provider"), entry["message"].get("model"))
    if used != (provider, model):
        return "another provider or model (%s/%s)" % used
    return None


def pick(sessions_dir: Path, cwd: str, provider: str, model: str, max_age_hours: float = 24.0, now: float | None = None):
    """(path or None, reason or None)."""
    newest = newest_session(session_folder(sessions_dir, cwd))
    if newest is None:
        return None, "no session yet"
    reason = why_not(newest, cwd, provider, model, max_age_hours * 3600, time.time() if now is None else now)
    if reason is None and not SAFE_PATH.match(str(newest)):
        reason = "a path that cannot go on the command line"
    return (None, reason) if reason else (newest, None)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sessions-dir", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--max-age-hours", type=float, default=24.0)
    args = parser.parse_args(argv)
    path, reason = pick(Path(args.sessions_dir), args.cwd, args.provider, args.model, args.max_age_hours)
    if path is None:
        print("pi session: a new one (%s)" % reason, file=sys.stderr)
        return 0
    print(str(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
