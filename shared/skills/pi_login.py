#!/usr/bin/env python3
"""pi_login.py — does the sign-in of Pi in auth.json belong to the provider the team runs on?

Pi keeps ONE entry per service in <team home>/.pi/agent/auth.json (the ChatGPT subscription is `openai-codex`, Anthropic `anthropic`, ...).
A file that is there says nothing about which account it is for: a login to Anthropic with the Claude subscription (billed per token as
extra usage when used from Pi) is a file that is there, and it used to be taken for the sign-in of the OpenAI account. This reads the NAMES of
the entries, never their values, and says whether the provider of the setup has its own.

The names Pi uses for each provider are in shared/runtime/pi-login-keys.list, the same list agent-harness.js (the wizard and
`jht providers harness`) reads: tests/test_pi_login.py keeps the two answers together.

  python3 pi_login.py <auth.json> <provider>     one JSON line: {"state": ..., "found": [...], "needs": [...]}
  state: ok | other_provider | empty | unreadable | no_rule (a provider this release has no entry name for) | missing (no file)
"""

from __future__ import annotations

import json
import re
import stat
import sys
from pathlib import Path

LIST = Path(__file__).resolve().parents[1] / "runtime" / "pi-login-keys.list"
MAX_BYTES = 256 * 1024
NAME = re.compile(r"[a-z0-9._-]{1,40}")


def login_keys() -> dict[str, tuple[str, ...]]:
    keys: dict[str, tuple[str, ...]] = {}
    for line in LIST.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            provider, names = line.split("|")
            keys[provider] = tuple(names.split(","))
    return keys


def inspect_text(text: str, provider: str) -> dict:
    needs = login_keys().get((provider or "").strip().lower(), ())
    try:
        data = json.loads(text)
    except ValueError:
        return {"state": "unreadable", "found": [], "needs": list(needs)}
    if not isinstance(data, dict):
        return {"state": "unreadable", "found": [], "needs": list(needs)}
    found = [name for name in data if NAME.fullmatch(name)]
    filled = lambda name: isinstance(data.get(name), dict) and len(data[name]) > 0  # noqa: E731
    if not needs:
        state = "no_rule"
    elif any(filled(name) for name in needs):
        state = "ok"
    else:
        state = "other_provider" if found else "empty"
    return {"state": state, "found": found, "needs": list(needs)}


def inspect_file(path: str | Path, provider: str) -> dict:
    """Same as inspect_text for a file: a regular file (no link), bounded in size. Nothing but the names leaves this function."""
    needs = list(login_keys().get((provider or "").strip().lower(), ()))
    try:
        info = Path(path).lstat()
    except OSError:
        return {"state": "missing", "found": [], "needs": needs}
    if not stat.S_ISREG(info.st_mode) or info.st_size == 0 or info.st_size > MAX_BYTES:
        return {"state": "unreadable", "found": [], "needs": needs}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, ValueError):
        return {"state": "unreadable", "found": [], "needs": needs}
    return inspect_text(text, provider)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({"state": "unreadable", "found": [], "needs": []}))
        return 2
    print(json.dumps(inspect_file(argv[0], argv[1]), separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
