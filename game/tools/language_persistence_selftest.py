#!/usr/bin/env python3
"""Two-process first-launch persistence gate for the Godot language picker."""

from __future__ import annotations

import os
import subprocess
import sys


def run_phase(phase: str, marker: str) -> None:
    env = os.environ.copy()
    for override in ("JHT_LANG", "JHT_LANGUAGE_PICKER_TEST", "JHT_LANGUAGE_SETTINGS_TEST"):
        env.pop(override, None)
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
    run_phase("cleanup", "LANGUAGE-PERSISTENCE-CLEANUP PASS")
    try:
        run_phase("write", "LANGUAGE-PERSISTENCE-WRITE PASS")
        run_phase("verify", "LANGUAGE-PERSISTENCE-VERIFY PASS")
        run_phase("save_failure", "LANGUAGE-PERSISTENCE-SAVE-FAILURE PASS")
    finally:
        # A red gate must not contaminate the next one: cleanup is a third,
        # separate Godot process so it cannot inherit in-memory state either.
        run_phase("cleanup", "LANGUAGE-PERSISTENCE-CLEANUP PASS")
    print("LANGUAGE-PERSISTENCE-TEST PASS")


if __name__ == "__main__":
    main()
