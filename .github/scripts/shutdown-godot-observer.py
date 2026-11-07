#!/usr/bin/env python3
"""CI-only observer for the existing isolated shutdown test; not run locally."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


def manifest(directory):
    return [
        {"path": str(path.relative_to(directory)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
         "bytes": path.stat().st_size}
        for path in sorted(directory.rglob("*")) if path.is_file()
    ]


arguments = sys.argv[1:]
if "--path" not in arguments:
    raise SystemExit("The shutdown observer requires an explicit isolated project")
project = Path(arguments[arguments.index("--path") + 1]).resolve(strict=True)
allowed = Path(os.environ["JHT_SHUTDOWN_FIXTURE_ROOT"]).resolve(strict=True)
if not project.is_relative_to(allowed):
    raise SystemExit("Godot project is outside the declared shutdown fixture root")
real_binary = Path(os.environ["JHT_REAL_GODOT"]).resolve(strict=True)
expected = "f85bbc6b15e22416c7d797cd60b63286dd67b9cb13498847056c18520ae55a75"
if hashlib.sha256(real_binary.read_bytes()).hexdigest() != expected:
    raise SystemExit("Godot binary checksum differs from the declared official binary")
evidence = Path(os.environ["JHT_SHUTDOWN_NATIVE_LOGS"])
evidence.mkdir(parents=True, exist_ok=True)
invocation = uuid.uuid4().hex
before = manifest(project)
result = subprocess.run([str(real_binary), *arguments], capture_output=True)
(evidence / (invocation + ".stdout.log")).write_bytes(result.stdout)
(evidence / (invocation + ".stderr.log")).write_bytes(result.stderr)
sys.stdout.buffer.write(result.stdout)
sys.stderr.buffer.write(result.stderr)
sys.stdout.buffer.flush()
sys.stderr.buffer.flush()
clean = re.sub(r"\x1b\[[0-9;]*m", "", (result.stdout + b"\n" + result.stderr).decode("utf8", "replace"))
diagnostics = re.findall(r"(?mi)^\s*(?:(?:SCRIPT\s+)?ERROR|Parse\s+Error|Failed\s+to\s+load|Failed\s+loading)[^\n]*", clean)
cache = project / ".godot/global_script_class_cache.cfg"
cache_bytes = cache.read_bytes() if cache.is_file() else b""
importing = "--editor" in arguments and "--import" in arguments
cache_ok = bool(cache_bytes) and b"BracketPanel" in cache_bytes
record = {
    "arguments": arguments, "project": str(project), "real_binary": str(real_binary),
    "real_binary_sha256": expected, "native_exit": result.returncode,
    "importing": importing, "diagnostics": diagnostics, "class_cache_ok": cache_ok,
    "class_cache_sha256": hashlib.sha256(cache_bytes).hexdigest() if cache_bytes else None,
    "before": before, "after": manifest(project),
    "shutdown_pass_marker": "SHUTDOWN-DELIVERY-TEST PASS" in clean,
}
(evidence / (invocation + ".json")).write_text(json.dumps(record, indent=2) + "\n")
if result.returncode:
    raise SystemExit(result.returncode)
if diagnostics or (importing and not cache_ok):
    sys.stderr.write("Shutdown observer rejected unexpected diagnostics or missing imported class cache\n")
    raise SystemExit(97)
raise SystemExit(0)
