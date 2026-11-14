"""JHT-T318: after the install, `jht` and `podman` are not found in the window that ran the installer.

Podman (from winget or from its release) and the jht folder are put on the registry PATH of the user, and the
PowerShell window the installer was started from keeps the PATH it had: «podman: not recognized as the name
of a cmdlet». The installer adds to its own PATH what the registry has and it lacks, and says in plain words
to open a new PowerShell window (no restart of the computer), with the line that brings the registry PATH
into the current window.

The functions are read from the real install.ps1 (the harness of test_windows_podman_wsl_branches): off
Windows under pwsh, on Windows under the shell JHT_TEST_SHELL names.
"""
from __future__ import annotations

import pytest

from test_windows_podman_wsl_branches import INSTALLER, _run

PASTE_LINE = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"

FINAL_BODY = r"""
$JhtHome = 'C:\Users\someone\.jht'; $RuntimeDir = 'C:\runtime'; $BinDir = 'C:\bin'; $RuntimeImage = 'ghcr.io/leopu00/jht@sha256:abc'
$DryRun = ($env:DRY_RUN -eq '1'); $SkipOnboard = $true; $PairingToken = ''
$script:PathReady = $true
Show-Final
"""

MERGE_BODY = r"""
$env:Path = 'C:\a;C:\b\;C:\Windows'
Add-NewRegistryPathToSession -MachinePath 'C:\A;C:\m\bin;' -UserPath 'C:\B;C:\u;C:\m\bin\'
[Console]::Out.WriteLine('PATH=' + $env:Path)
"""


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _final(tmp_path, **env):
    (tmp_path / "bin").mkdir()
    env = {"JHT_LANG": "en", **env}  # the sentences read below are the English ones
    result, _ = _run(tmp_path, INSTALLER, ["Show-Final", "Test-WillAutoOnboard", "Write-JhtNewWindowNotice"], FINAL_BODY, env)
    return result, result.stdout.replace("\r\n", "\n")


def test_the_end_of_the_install_says_to_open_a_new_window_and_that_no_restart_is_needed(tmp_path):
    result, out = _final(tmp_path)
    assert result.returncode == 0, out + result.stderr
    assert "Open a NEW PowerShell window to use jht and podman." in out
    assert "No restart of the computer is needed." in out
    assert "THIS PowerShell window was open before the" in out
    # and the line that makes it work in the window already open
    assert PASTE_LINE in out
    assert out.index("Installation complete!") < out.index("Open a NEW PowerShell window") < out.index("Next steps:")


def test_a_dry_run_and_the_desktop_app_do_not_get_the_notice(tmp_path):
    (tmp_path / "dry").mkdir()
    _, dry = _final(tmp_path / "dry", DRY_RUN="1")
    assert "Installation complete!" in dry and "Open a NEW PowerShell window" not in dry
    (tmp_path / "app").mkdir()
    _, app = _final(tmp_path / "app", JHT_MACHINE_OUTPUT="1")
    assert "Installation complete!" in app and "Open a NEW PowerShell window" not in app


def test_what_the_registry_added_and_the_session_lacks_goes_at_the_end_once(tmp_path):
    (tmp_path / "bin").mkdir()
    result, _ = _run(tmp_path, INSTALLER, ["Add-NewRegistryPathToSession"], MERGE_BODY, {})
    assert result.returncode == 0, result.stdout + result.stderr
    line = [row for row in result.stdout.replace("\r\n", "\n").split("\n") if row.startswith("PATH=")]
    # C:\A and C:\B are already there (case and trailing backslash do not matter); C:\m\bin and C:\u are new, once
    assert line == [r"PATH=C:\a;C:\b\;C:\Windows;C:\m\bin;C:\u"], line
