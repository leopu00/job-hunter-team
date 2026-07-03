#!/usr/bin/env python3
"""Anonymize the candidate_profile.yml extracted from a VPS.

Replaces PII fields (name, email, linkedin, github, phone) with placeholder
values. Operates idempotently on the local copy — doesn't touch the VPS.

Usage:
    python3 anonymize_profile.py --in PATH/TO/profile/candidate_profile.yml
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PLACEHOLDER_BY_KEY = {
    "name": "Beta tester",
    "email": "<redacted>@example.com",
    "phone": "<redacted>",
    "linkedin": "<redacted>",
    "linkedin_url": "<redacted>",
    "github": "<redacted>",
    "github_url": "<redacted>",
    "personal_website": "<redacted>",
    "website": "<redacted>",
    "address": "<redacted>",
    "city": "<redacted>",
    "birthdate": "<redacted>",
    "date_of_birth": "<redacted>",
    "nationality": "<redacted>",
    "tax_id": "<redacted>",
    "fiscal_code": "<redacted>",
}


def redact(text: str) -> tuple[str, list[str]]:
    """Return (anonymized_text, list_of_changes)."""
    changes: list[str] = []
    out_lines: list[str] = []
    # Naive YAML line-level approach (no full parse — preserves comments and formatting).
    # Matches:  KEY: VALUE     or     KEY: "VALUE"
    for raw in text.splitlines(keepends=True):
        line = raw.rstrip("\n")
        m = re.match(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", line)
        if not m:
            out_lines.append(raw)
            continue
        indent, key, _value = m.group(1), m.group(2), m.group(3)
        if key.lower() in PLACEHOLDER_BY_KEY:
            new_value = PLACEHOLDER_BY_KEY[key.lower()]
            new_line = f'{indent}{key}: "{new_value}"\n'
            out_lines.append(new_line)
            changes.append(key)
        else:
            out_lines.append(raw)
    return "".join(out_lines), changes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="in_path", required=True, type=Path, help="Path to candidate_profile.yml")
    ap.add_argument("--dry-run", action="store_true", help="Print changes, don't write")
    args = ap.parse_args()

    if not args.in_path.exists():
        print(f"  ! {args.in_path} not found, skipping anonymization")
        return 0

    original = args.in_path.read_text()
    anonymized, changes = redact(original)

    if not changes:
        print(f"  no PII keys found in {args.in_path.name}")
        return 0

    if args.dry_run:
        print(f"  would redact: {', '.join(changes)}")
        return 0

    args.in_path.write_text(anonymized)
    print(f"  redacted keys in {args.in_path.name}: {', '.join(changes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
