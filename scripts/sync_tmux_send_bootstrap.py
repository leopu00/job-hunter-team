#!/usr/bin/env python3
"""Keep the bootstrap of `tmux_send_run` identical in the callers that cannot import it from one place.

The bridges and skills that call `jht-tmux-send` are stand-alone scripts (the launcher runs them from `.launcher/`,
the container from `/app/shared/skills/`), so each one has to find `tmux_send_run.py` by itself. That finding, and
the fallback to the old call, is ONE text, `shared/skills/tmux_send_run_bootstrap.txt`; every caller carries it between
the two marker lines. This script writes it into the callers, or with `--check` says which ones differ (the test
`tests/test_tmux_send_bootstrap_parity.py` runs the same check).

    python3 scripts/sync_tmux_send_bootstrap.py [--check]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "shared" / "skills" / "tmux_send_run_bootstrap.txt"
CALLERS = [
    ".launcher/pacing-bridge.py",
    ".launcher/heartbeat-bridge.py",
    ".launcher/stepcap-watchdog.py",
    "shared/skills/throttle_engine.py",
    "shared/skills/standby.py",
    "shared/skills/soft_pause_team.py",
    "shared/skills/application_answers.py",
]
BLOCK = re.compile(r"^# >>> tmux_send_run bootstrap.*?^# <<< tmux_send_run bootstrap\n", re.S | re.M)


def block_of(text: str) -> str | None:
    found = BLOCK.findall(text)
    return found[0] if len(found) == 1 else None


def differing(root: Path = ROOT) -> list[str]:
    """The callers whose bootstrap is not the source's (or that do not have exactly one)."""
    source = (root / "shared" / "skills" / "tmux_send_run_bootstrap.txt").read_text(encoding="utf-8")
    return [name for name in CALLERS if block_of((root / name).read_text(encoding="utf-8")) != source]


def sync(root: Path = ROOT) -> list[str]:
    """Write the source into the callers that differ; the names of those it changed. A caller without exactly one
    block is an error (ValueError): there is no place to write it."""
    source = (root / "shared" / "skills" / "tmux_send_run_bootstrap.txt").read_text(encoding="utf-8")
    changed = []
    for name in differing(root):
        path = root / name
        text = path.read_text(encoding="utf-8")
        if block_of(text) is None:
            raise ValueError(f"no single bootstrap block in {name}")
        path.write_text(BLOCK.sub(lambda _m: source, text, count=1), encoding="utf-8")
        changed.append(name)
    return changed


def main(argv: list[str]) -> int:
    if "--check" in argv:
        bad = differing()
        for name in bad:
            print(f"differs: {name}")
        return 1 if bad else 0
    try:
        for name in sync():
            print(f"updated: {name}")
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
