#!/usr/bin/env python3
"""Compile every Python payload the game ships to a container.

The payloads are real files under `scripts/backend/payloads/`, so this is a
plain `py_compile` over the whole directory: it covers everything that lives
there, not only the constants that happened to be named `*_PY`. Godot never
parses them, so an indentation mistake would otherwise surface only against a
real container.

Four extra guards, all cheap and all for failures nothing else catches:

* every export preset must carry these files. They are not Godot resources,
  so `export_filter="all_resources"` walks straight past them: measured on
  2026-07-30, an exported .pck contained **0 of 21**. A build that ships
  without them starts, looks healthy and never talks to a VPS again — and no
  local test notices, because from the project directory the files are there;
* a payload that no `.gd` loads (dead file), or a `payload("x.py")` call with
  no file behind it (a typo that at runtime is just an empty string, and on an
  exported build looks exactly like the resource missing from the package);
* a `const <NAME>_PY := \"\"\"` block sneaking back into GDScript;
* an empty directory, so a rename cannot turn this test into a green no-op.
"""

from pathlib import Path
import re
import sys

GAME = Path(__file__).resolve().parents[1]
PAYLOADS = GAME / "scripts" / "backend" / "payloads"
SCRIPTS = GAME / "scripts"

# `payload("name.ext")` — how GDScript asks for one of these files.
CALL = re.compile(r'payload\("([^"]+)"\)')
# The shape this directory exists to make impossible.
EMBEDDED = re.compile(r'const\s+[A-Z0-9_]+_PY\s*:=\s*"""')

errors: list[str] = []

# ── 1. every payload compiles ────────────────────────────────────────────
files = sorted(PAYLOADS.glob("*.py"))
if not files:
    print("PYTHON-PAYLOAD-TEST FAIL")
    print(f"no payload found in {PAYLOADS.relative_to(GAME)}")
    sys.exit(1)

for path in files:
    source = path.read_text(encoding="utf-8")
    # GDScript applies `%` placeholders before execution. Replace the scalar
    # ones with syntax-safe samples while preserving `%%`, which Python
    # strftime strings use and GDScript collapses to a single `%`.
    rendered = re.sub(r"(?<!%)%d", "1", source)
    rendered = re.sub(r"(?<!%)%s", "SAFE", rendered)
    try:
        compile(rendered, str(path.relative_to(GAME)), "exec")
    except SyntaxError as exc:
        errors.append(f"{path.relative_to(GAME)}: {exc}")

# ── 2. files and call sites match ────────────────────────────────────────
on_disk = {p.name for p in PAYLOADS.iterdir() if p.is_file()}
asked = set()
for gd in SCRIPTS.rglob("*.gd"):
    source = gd.read_text(encoding="utf-8")
    asked.update(CALL.findall(source))
    if EMBEDDED.search(source):
        errors.append(f"{gd.relative_to(GAME)}: Python payload embedded in "
                      "GDScript — move it to scripts/backend/payloads/")

for missing in sorted(asked - on_disk):
    errors.append(f"payload requested but not on disk: {missing}")
for orphan in sorted(on_disk - asked):
    errors.append(f"payload on disk but never loaded: {orphan}")

# ── 3. every export preset ships them ────────────────────────────────────
presets = (GAME / "export_presets.cfg").read_text(encoding="utf-8")
name = ""
covered = 0
for line in presets.splitlines():
    if line.startswith("name="):
        name = line.split("=", 1)[1].strip('"')
    elif line.startswith("include_filter="):
        if "scripts/backend/payloads" in line:
            covered += 1
        else:
            errors.append(f'export preset "{name}": include_filter does not '
                          "carry scripts/backend/payloads — the exported build "
                          "would load empty payloads")

if errors:
    print("PYTHON-PAYLOAD-TEST FAIL")
    print("\n".join(errors))
    sys.exit(1)
print(f"PYTHON-PAYLOAD-TEST PASS payloads={len(files)} files={len(on_disk)} "
      f"presets={covered}")
