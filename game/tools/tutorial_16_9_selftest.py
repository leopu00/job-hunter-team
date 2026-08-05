#!/usr/bin/env python3
"""Two-process persistence oracle for the deterministic P09 tutorial harness."""

from __future__ import annotations

import os
import subprocess
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_phase(extra: dict[str, str], marker: str) -> None:
    env = os.environ.copy()
    for key in (
        "JHT_LANG",
        "JHT_LANGUAGE_PICKER_TEST",
        "JHT_LANGUAGE_SETTINGS_TEST",
        "JHT_TUTORIAL_RESET",
        "JHT_TUTORIAL_HARNESS_TEST",
        "JHT_TUTORIAL_HARNESS_PERSISTENCE_TEST",
        "JHT_TUTORIAL_HARNESS_CLEANUP_TEST",
    ):
        env.pop(key, None)
    env.update({"JHT_NOVPS": "1", "JHT_TUTORIAL_HARNESS": "1"})
    env.update(extra)
    godot_bin = env.get("JHT_GODOT_BIN") or env.get("GODOT") or "godot"
    result = subprocess.run(
        [godot_bin, "--headless", "."],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    output = result.stdout + result.stderr
    if result.returncode != 0 or marker not in output:
        sys.stderr.write(output)
        raise SystemExit("tutorial harness phase failed: %s" % marker)


def main() -> None:
    run_phase({"JHT_TUTORIAL_RESET": "1", "JHT_TUTORIAL_HARNESS_TEST": "1"},
              "TUTORIAL-16-9-HARNESS-TEST PASS")
    try:
        run_phase({"JHT_TUTORIAL_HARNESS_PERSISTENCE_TEST": "1"},
                  "TUTORIAL-EN-PERSISTENCE-TEST PASS")
    finally:
        run_phase({"JHT_TUTORIAL_HARNESS_CLEANUP_TEST": "1"},
                  "TUTORIAL-HARNESS-CLEANUP PASS")
    print("TUTORIAL-16-9-PERSISTENCE-TEST PASS")


if __name__ == "__main__":
    main()
