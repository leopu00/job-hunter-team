"""Windows PowerShell 5.1 hygiene of the .ps1 files the Windows setup runs (T-ps51).

The setup broke one step after the other on the same few shapes, each one invisible on a Mac and
on PowerShell 7. The first (a native command with redirected stderr under 'Stop', and `node -e`
with double quotes inside single quotes) has its own guard, test_powershell_native_stderr_guard.py.
These are the others:

 1. `$LASTEXITCODE` read after `| Select-Object -First 1`: the native command is stopped early, so
    it is -1 in 5.1 and stale in 7. Read all the lines, then take the first.
 2. `[string]$X = $null` is "": `$null -ne $X` is always true. Ask `$PSBoundParameters`.
 3. `"$name: text"` is a drive-qualified variable, not `$name` and a colon: `${name}`.
 4. `Invoke-BrokerAdmin` and `Invoke-TelegramAdmin` have `$InputText` as their first positional
    parameter: `Invoke-BrokerAdmin secrets status` would bind 'secrets' to it and hand the broker
    only 'status'. Every caller names `-AdminArgs`.

This reads the source, so it needs no PowerShell; it normalises CRLF first (the files are published
with either ending). A real run on Windows is the V1.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SETUP_FILES = [
    "install.ps1",
    "jht-wrapper.ps1",
    "enable-podman-windows-runtime.ps1",
    "configure-podman-windows-network.ps1",
    "podman-windows-probe.ps1",
    "windows-private-acl.ps1",
    "jht-uninstall-windows.ps1",
    "setup.ps1",
]

QUOTED = re.compile(r"'[^'\n]*'|\"(?:`.|[^\"`\n])*\"")


def source(name: str) -> list[str]:
    return (ROOT / "scripts" / name).read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")


def code_lines(name: str):
    """(number, text, text with quoted text blanked) of each line of code: comments and here-strings out."""
    in_here = None
    for number, line in enumerate(source(name), 1):
        stripped = line.strip()
        if in_here:
            if stripped.startswith(in_here):
                in_here = None
            continue
        here = re.search(r"@(['\"])\s*$", line)
        if here:
            in_here = here.group(1) + "@"
            continue
        if stripped.startswith("#"):
            continue
        yield number, line, QUOTED.sub('""', line)


FIRST_THEN_EXIT = re.compile(r"Select-Object\s+-(First|Index|Skip)\b")


@pytest.mark.parametrize("name", SETUP_FILES)
def test_the_exit_code_is_not_read_after_a_first_one_select(name):
    lines = list(code_lines(name))
    for position, (number, raw, text) in enumerate(lines):
        if not FIRST_THEN_EXIT.search(text):
            continue
        following = [line for _, line, _ in lines[position : position + 3]]
        # a native command that runs after the select, or the same statement's own scope, resets it
        assert not any("$LASTEXITCODE" in line and "& " not in line for line in following), (
            f"{name}:{number}: {raw.strip()}"
        )


@pytest.mark.parametrize("name", SETUP_FILES)
def test_a_typed_string_default_null_is_not_tested_against_null(name):
    text = "\n".join(source(name))
    for match in re.finditer(r"\[string\]\s*\$(\w+)\s*=\s*\$null", text):
        variable = match.group(1)
        assert not re.search(r"\$null\s+-ne\s+\$" + variable + r"\b|\$" + variable + r"\s+-ne\s+\$null", text), (
            f"{name}: [string]${variable} = $null is \"\"; ask $PSBoundParameters.ContainsKey('{variable}')"
        )


@pytest.mark.parametrize("name", SETUP_FILES)
def test_no_variable_is_followed_by_a_colon_inside_a_string(name):
    safe = re.compile(r"\$(env|script|global|local|private|using|args|true|false|null|PSScriptRoot)\b", re.I)
    for number, raw, _ in code_lines(name):
        for string in re.findall(r"\"(?:`.|[^\"`\n])*\"", raw):
            for match in re.finditer(r"\$([A-Za-z_]\w*):(?=[\s\"'.,)\]])", string):
                assert safe.match("$" + match.group(1)), f"{name}:{number}: {string[:120]} (use ${{{match.group(1)}}})"


def test_the_fixed_shapes_stay_fixed():
    wrapper = "\n".join(source("jht-wrapper.ps1"))
    probe = "\n".join(source("podman-windows-probe.ps1"))
    # Invoke-BrokerAdmin opens stdin only for an -InputText that was really passed (`apply record` passes '')
    broker = wrapper[wrapper.index("function Invoke-BrokerAdmin"):wrapper.index("function Invoke-TelegramAdmin")]
    assert "$PSBoundParameters.ContainsKey('InputText')" in broker and "$null -ne $InputText" not in broker
    # the apply skill's stderr is redirected inside the 'Continue' scope
    assert re.search(r"@\(& \{ \$ErrorActionPreference = 'Continue'; & docker exec \$ContainerId python3 /app/shared/skills/apply_request\.py", wrapper)
    # the probe reads the exit code of docker, then takes the first line
    assert "$inspectCode = $LASTEXITCODE" in probe and "$inspectCode -ne 0 -or $running" in probe


PENDING_ELSEWHERE: set[str] = set()


def test_every_caller_of_the_admin_helpers_names_its_admin_args():
    """The first positional parameter of both is `$InputText`: a caller that does not name -AdminArgs
    loses the first word of its command to it (and the broker gets one verb fewer). A caller that
    names -InputText is safe too: the words that follow all go to the remaining arguments."""
    offenders = []
    for number, raw, text in code_lines("jht-wrapper.ps1"):
        for match in re.finditer(r"\b(Invoke-BrokerAdmin|Invoke-TelegramAdmin)\b(?!\s*\{)", text):
            if raw.lstrip().startswith("function "):
                continue
            rest = raw[raw.index(match.group(1)) :]
            if "-AdminArgs" not in rest and "-InputText" not in rest and not any(pending in raw for pending in PENDING_ELSEWHERE):
                offenders.append(f"{number}: {raw.strip()}")
    assert offenders == []
