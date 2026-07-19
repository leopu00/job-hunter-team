#!/usr/bin/env python3
"""Emit one final JHT chat reply with optional clickable answer choices."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time


def chat_file(agent: str | None) -> Path:
    if agent:
        home = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
        return home / "agents" / agent / "chat.jsonl"
    if os.environ.get("JHT_AGENT_DIR"):
        return Path(os.environ["JHT_AGENT_DIR"]) / "chat.jsonl"
    return Path.cwd() / "chat.jsonl"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reply in JHT chat and offer 2-5 generated clickable answers."
    )
    parser.add_argument("--prompt", required=True, help="Agent reply shown above choices")
    parser.add_argument("--agent", help="Target agent id; normally inferred")
    parser.add_argument("choice", nargs="+", help="2-5 useful reply labels")
    args = parser.parse_args()
    prompt = args.prompt.strip()
    choices = [value.strip() for value in args.choice if value.strip()]
    if not prompt or not 2 <= len(choices) <= 5:
        parser.error("--prompt and between 2 and 5 non-empty choices are required")
    if len(prompt) > 4000 or any(len(value) > 240 for value in choices):
        parser.error("prompt or choice is too long")
    entry = {
        "role": "assistant",
        "text": prompt,
        "ts": time.time(),
        "done": True,
        "choices": [
            {"id": f"reply-{index + 1}", "label": value, "value": value}
            for index, value in enumerate(choices)
        ],
    }
    destination = chat_file(args.agent)
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(entry, ensure_ascii=False) + "\n"
    # O_APPEND keeps each compact JSONL record in a single append operation.
    fd = os.open(destination, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        os.write(fd, encoded.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        json.loads(destination.read_text(encoding="utf-8").rstrip().splitlines()[-1])
    except Exception as error:
        print(f"jht-reply-options: invalid final JSONL record: {error}", file=sys.stderr)
        return 1
    print(f"jht-reply-options: sent {len(choices)} choices to {destination}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
