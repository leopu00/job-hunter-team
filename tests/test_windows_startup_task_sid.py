"""The setup compares the logon task's user as an identity, not as a string, on a real Windows.

The setup registers the task "Job Hunter Team - Start runtime" with the user's SID, then reads it
back to check it. Get-ScheduledTask gives the user back as a name: "COMPUTER\\user" in the trigger,
"user" in the principal (Windows 10 Pro with a local account, under 5.1 and 7, in a console and in
session 0), never the SID. The string comparison failed every time and the setup never finished on
Windows with Podman (T100). The enabler's ConvertTo-JhtSid turns either form into the SID.

Only on Windows: the name of an account resolves through the Windows API. The Windows config ACL
gate runs this file under Windows PowerShell 5.1 and pwsh (JHT_TEST_SHELL); a skip there fails the
count. The rest of the check (one trigger, the executable, Interactive, Limited) is tested with a
fake Task Scheduler in test_windows_podman_wsl_branches.py.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv

ROOT = Path(__file__).resolve().parent.parent
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"

pytestmark = pytest.mark.skipif(not WINDOWS, reason="an account name resolves only through the Windows API")

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'ConvertTo-JhtSid' }, $true)
if (-not $fn) { throw 'ConvertTo-JhtSid missing' }
Invoke-Expression $fn.Extent.Text
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$forms = @{
  sid = $me.User.Value
  qualified = $me.Name
  computer = "$env:COMPUTERNAME\$(($me.Name -split '\\')[-1])"
  bare = ($me.Name -split '\\')[-1]
  unknown = $env:JHT_UNKNOWN_USER
}
[Console]::Out.WriteLine("EXPECTED=$($me.User.Value)")
foreach ($key in $forms.Keys) { [Console]::Out.WriteLine("$key=$(ConvertTo-JhtSid $forms[$key])") }
"""


@pytest.fixture(scope="module")
def answers(tmp_path_factory) -> dict[str, str]:
    root = tmp_path_factory.mktemp("startup-task-sid")
    harness = root / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = root / "engine.txt"
    done = subprocess.run(
        [*powershell_argv(), "-File", str(harness)],
        env={**os.environ, "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(ENABLER),
             "JHT_UNKNOWN_USER": f"jht-no-such-user-{uuid.uuid4().hex[:12]}"},
        capture_output=True, text=True, timeout=120,
    )
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    return dict(line.split("=", 1) for line in done.stdout.splitlines() if "=" in line)


@pytest.mark.parametrize("form", ["sid", "qualified", "computer", "bare"])
def test_every_form_windows_gives_the_user_back_in_is_the_same_sid(answers, form):
    assert answers["EXPECTED"].startswith("S-1-"), answers
    assert answers[form] == answers["EXPECTED"], answers


def test_a_user_that_does_not_resolve_is_not_the_same_user(answers):
    assert answers["unknown"] == "", answers
