#!/usr/bin/env python3
"""Compile every embedded *_PY payload in the Godot sources.

Godot only parses the surrounding GDScript, so indentation mistakes inside a
triple-quoted Python command otherwise surface only against a real container.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1] / "scripts"
PATTERN = re.compile(r'const\s+([A-Z0-9_]+_PY)\s*:=\s*"""\n(.*?)\n"""', re.S)
errors: list[str] = []
count = 0

for path in ROOT.rglob("*.gd"):
    source = path.read_text(encoding="utf-8")
    for name, payload in PATTERN.findall(source):
        count += 1
        try:
            # GDScript applies `%` placeholders before execution. Replace the
            # scalar ones with syntax-safe samples while preserving `%%` used
            # inside Python strftime strings.
            rendered = re.sub(r"(?<!%)%d", "1", payload)
            rendered = re.sub(r"(?<!%)%s", "SAFE", rendered)
            compile(rendered, f"{path.name}:{name}", "exec")
        except SyntaxError as exc:
            errors.append(f"{path.relative_to(ROOT.parent)}:{name}: {exc}")

if errors:
    print("PYTHON-PAYLOAD-TEST FAIL")
    print("\n".join(errors))
    sys.exit(1)
print(f"PYTHON-PAYLOAD-TEST PASS payloads={count}")
