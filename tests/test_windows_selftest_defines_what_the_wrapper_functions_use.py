"""The ACL selftest extracts functions of the Windows wrapper and runs them in a fixture; a variable such a function reads that the
fixture does not define makes the gate fail with «Value cannot be null» (the wrapper defines them at script level, the extraction
does not). A function that grows a new variable is a red test here, not a red run on GitHub.

Read as text: the selftest itself runs only elevated, on the GitHub runner."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
SELFTEST = (ROOT / "scripts" / "windows-config-acl-selftest.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
# the wrapper functions the selftest extracts and RUNS (the trust predicates it only names are covered by their own cases)
EXTRACTED_AND_RUN = ("Write-RuntimeManifest",)
AUTOMATIC = {"true", "false", "null", "env", "args", "_", "PID", "LASTEXITCODE", "script", "global", "error", "PSScriptRoot", "Matches", "ErrorActionPreference"}


def function_text(source: str, name: str) -> str:
    start = source.index(f"function {name} {{")
    end = source.find("\nfunction ", start + 1)
    return source[start: end if end != -1 else len(source)]


def test_every_variable_an_extracted_function_reads_is_defined_in_the_fixture():
    for name in EXTRACTED_AND_RUN:
        body = function_text(WRAPPER, name)
        used = {m.group(1) for m in re.finditer(r"\$(?:script:|global:)?([A-Za-z_][A-Za-z0-9_]*)", body)} - AUTOMATIC
        assigned_inside = {m.group(1) for m in re.finditer(r"\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+?=)(?!=)", body)}
        params = {m.group(1) for m in re.finditer(r"\[[^\]]+\]\s*\$([A-Za-z_][A-Za-z0-9_]*)", body)}
        outside = {v for v in used - assigned_inside - params if not re.search(rf"\b(?:foreach|ForEach-Object)\b.*\${v}\b", body)}
        missing = sorted(v for v in outside if not re.search(rf"^\s*\${v}\s*=", SELFTEST, re.M))
        assert not missing, f"{name} reads {missing}, which the selftest fixture does not define"
