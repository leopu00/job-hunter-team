"""The Windows terminal capabilities reach the Linux CLI as bounded presentation metadata."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
HELPER = re.search(r"^function Get-JhtTerminalEnv \{\n.*?^\}\n", WRAPPER, re.M | re.S).group(0)
CAPABILITIES = ("WT_SESSION", "TERM_PROGRAM", "TERMINAL_EMULATOR", "JHT_UNICODE")


def run_shell(tmp_path, body, env=None):
    shell = os.environ.get("JHT_TEST_SHELL", "pwsh")
    if not shutil.which(shell):
        pytest.skip(f"{shell} not installed")
    script = tmp_path / "terminal.ps1"
    script.write_text("$ErrorActionPreference = 'Stop'\n" + body, encoding="utf-8")
    environment = {k: v for k, v in os.environ.items() if k not in CAPABILITIES}
    environment.update(env or {})
    result = subprocess.run([shell, "-NoProfile", "-File", str(script)], capture_output=True,
                            text=True, encoding="utf-8", env=environment, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


@pytest.mark.parametrize("env, expected", [
    ({}, "0"),
    ({"WT_SESSION": "synthetic"}, "1"),
    ({"TERM_PROGRAM": "vscode"}, "1"),
    ({"TERM_PROGRAM": "WezTerm"}, "1"),
    ({"TERM": "xterm-256color", "CI": "1"}, "0"),
    ({"JHT_UNICODE": "1"}, "1"),
    ({"WT_SESSION": "synthetic", "JHT_UNICODE": "0"}, "0"),
    ({"JHT_UNICODE": "invalid; ignored"}, "0"),
])
def test_console_capabilities_and_overrides_become_only_bounded_exec_values(tmp_path, env, expected):
    output = run_shell(tmp_path, HELPER + "@(Get-JhtTerminalEnv) | ConvertTo-Json -Compress\n", env)
    assert json.loads(output) == ["-e", "JHT_TERMINAL_PLATFORM=win32", "-e", f"JHT_UNICODE={expected}"]


def test_every_node_cli_exec_and_the_console_chat_preserve_the_terminal_metadata():
    lines = [line for line in WRAPPER.splitlines() if "& docker exec" in line and "$NodeEntry" in line]
    assert len(lines) >= 12
    assert all("@JhtTerminalEnv" in line for line in lines)
    setup = re.search(r"^  'setup' \{\n.*?^  \}\n", WRAPPER, re.M | re.S).group(0)
    assert "docker exec -i @JhtTerminalEnv @setupEnv" in setup
    assert "docker exec @ExecFlags @JhtTerminalEnv @setupEnv" in setup
    assert "$ExecFlags + $JhtTerminalEnv + $HostFlags" in WRAPPER
    assert "$JhtTerminalEnv = @(Get-JhtTerminalEnv)" in WRAPPER


def test_the_final_chat_command_reloads_the_persisted_path_in_the_same_powershell(tmp_path):
    source = (ROOT / "cli/wizard/setup-outro.js").read_text(encoding="utf-8")
    command = re.search(r'WINDOWS_CHAT_COMMAND = "(.*?)";', source).group(1)
    body = """
$expected = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$env:Path = 'synthetic-stale-path'
function jht { $script:seen = $env:Path; $script:words = $args -join ' ' }
""" + command + """
if ($script:seen -cne $expected) { throw 'PATH was not refreshed before chat' }
if ($script:words -cne 'team chat assistente') { throw 'chat arguments changed' }
'PASS'
"""
    assert run_shell(tmp_path, body) == "PASS"
