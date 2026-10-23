"""The setup accepts its logon task when Task Scheduler gives the user back as a name, as Windows does (T100).

The setup registers "Job Hunter Team - Start runtime" with the user's SID and reads it back to check
it. Windows gives the user back as a name, never as the SID: "COMPUTER\\user" in the trigger and
"user" in the principal (Windows 10 Pro with a local account, under 5.1 and 7, in a console and in
session 0; seen by hand and with a throwaway task of the test user on the ThinkPad, 23/10). The fake
Task Scheduler of test_windows_podman_wsl_branches.py gave the SID back, so the check passed there
and failed on every real Windows: «JHT startup task verification failed», and the Podman setup never
finished.

Here the fake reads the task back as Windows does. On Windows the user is the real one and its name
resolves through the enabler's own ConvertTo-JhtSid; elsewhere there is no account API, so a stand-in
resolves the two names of a made-up user (the real resolution is tested on Windows by
test_windows_startup_task_sid.py). A task registered for someone else is still refused.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from test_windows_podman_wsl_branches import ENABLER, STARTUP_TASK_BODY, _run
from windows_native_fakes import WINDOWS

# The fakes of the Task Scheduler, without the call of the other test.
FAKES = STARTUP_TASK_BODY.split("Install-JhtStartupTask -PodmanPath", 1)[0]
assert "function Register-ScheduledTask" in FAKES

CASE = FAKES + r"""
if ($env:JHT_MADE_UP_USER) {
  $sid = 'S-1-5-21-1111-2222-3333-1001'; $computer = 'JHTPC'; $user = 'jhtuser'
  # No account API off Windows: the two names of the made-up user, and nobody else, resolve to it.
  function ConvertTo-JhtSid {
    param([string]$Identity)
    if ($Identity -in @($sid, "$computer\$user", $user)) { return $sid }
    return ''
  }
} else {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $me.User.Value; $computer = $env:COMPUTERNAME; $user = ($me.Name -split '\\')[-1]
}
$readBack = @{ trigger = "$computer\$user"; principal = $user }
if ($env:JHT_SOMEONE_ELSE) { $readBack = @{ trigger = "$computer\jht-someone-else"; principal = 'jht-someone-else' } }
# Read back as Windows gives it: names in place of the SID the task was registered with.
function Get-ScheduledTask {
  param($TaskName, $ErrorAction)
  $task = $script:Registered
  [pscustomobject]@{
    TaskName = $task.TaskName; Actions = $task.Actions; Settings = $task.Settings; Description = $task.Description
    Triggers = @([pscustomobject]@{ UserId = $readBack.trigger })
    Principal = [pscustomobject]@{ UserId = $readBack.principal; LogonType = $task.Principal.LogonType; RunLevel = $task.Principal.RunLevel }
  }
}
try {
  Install-JhtStartupTask -PodmanPath 'C:\Program Files\RedHat\Podman\podman.exe' -MachineName 'jht-podman' -UserId $sid
  [Console]::Out.WriteLine('ACCEPTED')
} catch {
  [Console]::Out.WriteLine("REFUSED $($_.Exception.Message)")
}
[Console]::Out.WriteLine("REGISTERED_FOR=$(if ($script:Registered.Principal.UserId -ceq $sid) { 'sid' } else { 'other' })")
"""


def _install(tmp_path: Path, someone_else: bool = False):
    imports = ["Install-JhtStartupTask"]
    # On Windows the real conversion, when the enabler has one; elsewhere the stand-in of CASE.
    if WINDOWS and "function ConvertTo-JhtSid" in ENABLER.read_text(encoding="utf-8"):
        imports.insert(0, "ConvertTo-JhtSid")
    env = {"JHT_SOMEONE_ELSE": "1" if someone_else else ""}
    if not WINDOWS:
        env["JHT_MADE_UP_USER"] = "1"
    result, _ = _run(tmp_path, ENABLER, imports, CASE, env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "REGISTERED_FOR=sid" in result.stdout, result.stdout       # registered with the SID, as before
    return result.stdout


def test_the_task_read_back_with_the_names_windows_gives_is_accepted(tmp_path):
    out = _install(tmp_path)
    assert "ACCEPTED" in out, (
        "Task Scheduler gives the user back as «COMPUTER\\user» and «user», never as the SID: "
        f"the setup must accept its own task\n{out}"
    )


def test_a_task_read_back_for_another_user_is_still_refused(tmp_path):
    out = _install(tmp_path, someone_else=True)
    assert "REFUSED JHT startup task verification failed" in out, out
