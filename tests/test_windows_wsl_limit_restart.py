"""The memory limit written while the WSL virtual machine runs is applied by the setup, not left for a restart of Windows.

Measured on a Windows 10 computer (WSL 3.0.5): with the VM already running, the limit the setup writes does nothing (the VM stayed at
5866 MB); WSL ends its VM about a minute after its last distribution stopped (podman machine stop: vmmem 0 at +76 s), and the next start
has the limit (vmmem 1.0-1.2 GB, Windows 56%). So when the setup has just written the limit with the VM up, and nothing of the team runs
in the machine, it stops the machine, waits for the VM to be gone (at most 120 s, never wsl --shutdown) and starts it again. Otherwise,
or when the VM is still there after the wait, it says the limit applies from the next restart.
"""
from __future__ import annotations

import pytest

from test_windows_podman_wsl_branches import ENABLER, INFO, MACHINE_BLOCK_BODY, PODMAN_CASES, START, _fake, _machines, _run

STOP = "machine stop jht-podman"
WAITS = "WSL is already running: the memory limit applies from the next restart of Windows, or of WSL"
APPLYING = "Applying the memory limit to WSL: the machine waits for WSL to restart (about a minute)."

# The WSL VM is up for the first FAKE_VM_CHECKS checks (or always with 'never'), then gone.
VM_STAND_IN = r"""
function Test-JhtWslVmRunning {
  $file = $env:FAKE_LOG + '.vm'
  $n = 0; if (Test-Path -LiteralPath $file) { $n = [int](Get-Content -LiteralPath $file) }
  Set-Content -LiteralPath $file -Value ($n + 1)
  Add-Content -LiteralPath $env:FAKE_LOG -Value 'vm?'
  if ($env:FAKE_VM_CHECKS -eq 'never') { return $true }
  return ($n -lt [int]$env:FAKE_VM_CHECKS)
}
"""


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _setup(tmp_path, *, machines, limit="vm-running", vm_checks="1", ps=""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", PODMAN_CASES)
    result, calls = _run(
        tmp_path, ENABLER, ["Invoke-Checked", "Write-JhtPhase"], VM_STAND_IN + MACHINE_BLOCK_BODY,
        {"FAKE_PODMAN": str(bin_dir / "podman.exe"), "FAKE_MACHINES": machines, "INITIALIZE": "1", "FAKE_FAIL": "",
         "WELCOME": "Skip-WslWelcome", "FAKE_WSL_LIMIT": limit, "FAKE_VM_CHECKS": vm_checks, "FAKE_PS": ps,
         "JHT_WSL_STOP_WAIT_SECONDS": "3"},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.replace("\r\n", "\n"), [c for c in calls if c != "vm?"], calls.count("vm?")


def test_a_running_machine_with_no_team_is_stopped_and_started_once_the_vm_is_gone(tmp_path):
    out, calls, _ = _setup(tmp_path, machines=_machines(("jht-podman", True)), vm_checks="1")
    assert APPLYING in out and WAITS not in out
    assert calls == ["machine list --format json", "--connection jht-podman ps --quiet", STOP, START, INFO]


def test_a_stopped_machine_waits_for_the_vm_and_then_starts_as_always(tmp_path):
    out, calls, _ = _setup(tmp_path, machines=_machines(("jht-podman", False)), vm_checks="2")
    assert APPLYING in out and WAITS not in out
    assert STOP not in calls and calls[-2:] == [START, INFO]


def test_a_machine_with_the_team_running_is_never_stopped_for_it(tmp_path):
    out, calls, vm_checks = _setup(tmp_path, machines=_machines(("jht-podman", True)), ps="0123456789ab\n")
    assert WAITS in out and APPLYING not in out
    assert STOP not in calls and START not in calls and vm_checks == 0


def test_a_vm_still_there_after_the_wait_is_said_and_the_machine_starts_anyway(tmp_path):
    out, calls, _ = _setup(tmp_path, machines=_machines(("jht-podman", True)), vm_checks="never")
    assert APPLYING in out and WAITS in out
    assert calls[-3:] == [STOP, START, INFO]


def test_with_wsl_off_or_no_limit_written_nothing_changes(tmp_path):
    out, calls, vm_checks = _setup(tmp_path, machines=_machines(("jht-podman", True)), limit="")
    assert APPLYING not in out and WAITS not in out
    assert calls == ["machine list --format json", INFO] and vm_checks == 0


def test_the_setup_never_shuts_wsl_down():
    for script in (ENABLER, ENABLER.parent / "podman-machine-bridge.ps1"):
        code = "\n".join(line for line in script.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))
        assert "'--shutdown'" not in code and "wsl.exe --shutdown" not in code and "& wsl --shutdown" not in code
