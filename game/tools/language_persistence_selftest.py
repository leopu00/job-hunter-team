#!/usr/bin/env python3
"""Two-process first-launch persistence gate for the Godot language picker."""

from __future__ import annotations

import os
import subprocess
import sys


def run_phase(phase: str, marker: str) -> None:
    env = os.environ.copy()
    env.pop("JHT_LANG", None)
    env.update({"JHT_NOVPS": "1", "JHT_LANGUAGE_PERSIST_TEST": phase})
    result = subprocess.run(
        ["godot", "--headless", "."],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)),),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    output = result.stdout + result.stderr
    if result.returncode != 0 or marker not in output:
        sys.stderr.write(output)
        raise SystemExit("language persistence %s failed" % phase)


def main() -> None:
    run_phase("write", "LANGUAGE-PERSISTENCE-WRITE PASS")
    run_phase("verify", "LANGUAGE-PERSISTENCE-VERIFY PASS")
    print("LANGUAGE-PERSISTENCE-TEST PASS")


if __name__ == "__main__":
    main()
