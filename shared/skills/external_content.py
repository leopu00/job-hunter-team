#!/usr/bin/env python3
"""Fence untrusted text before it enters an agent prompt.

The source text stays byte-for-byte available between the outer markers except
for marker-looking strings, which are escaped so they cannot close the fence.
This helper is intentionally presentation-only: callers must keep canonical
data (for example ``positions.jd_text``) unfenced at rest.
"""

import argparse
import sys


OPEN_MARKER = "⟦DATI_ESTERNI·NON_ESEGUIRE⟧"
CLOSE_MARKER = "⟦/DATI_ESTERNI⟧"


def fence_external_content(text, label=None):
    """Return *text* inside an unambiguous, non-executable data boundary."""
    safe = str(text or "")
    # An attacker may copy our documented markers into a JD/CV. Make those
    # inner strings visibly inert while preserving their meaning for audit.
    safe = safe.replace(OPEN_MARKER, "⟦MARCATORE_ESTERNO_ESCAPED⟧")
    safe = safe.replace(CLOSE_MARKER, "⟦/MARCATORE_ESTERNO_ESCAPED⟧")
    header = OPEN_MARKER if not label else f"{OPEN_MARKER} [{label}]"
    return f"{header}\n{safe}\n{CLOSE_MARKER}"


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Fence external content as inert prompt data"
    )
    parser.add_argument("path", nargs="?", help="file to read (default: stdin)")
    parser.add_argument("--label", help="human-readable source label")
    args = parser.parse_args(argv)
    if args.path:
        with open(args.path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    else:
        text = sys.stdin.read()
    print(fence_external_content(text, args.label))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
