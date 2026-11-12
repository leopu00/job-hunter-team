"""The team's start-up unit is installed before the team starts, and a failure there never stops the setup half way.

Every `podman machine ssh` is, on WSL, a new `wsl.exe -u root -d <distro> sh`, whose vmbus ring the machine's kernel allocates in one
contiguous piece. On a Windows 10 computer with the 3 GB memory limit, after a long pull and the team's first start, that allocation
failed (order 7), the session ended with 0xffffffff, the install of jht-container.service failed and the setup stopped without
jht.cmd (3 installs out of 3; the same on a GitHub runner). Now: drop the cache the pull filled, install and enable the unit at once,
then start the team; the unit is made active after it, best effort. Read from the real enabler (the harness of
test_windows_podman_wsl_branches), with a stand-in podman.
"""
from __future__ import annotations

import pytest

from test_windows_podman_wsl_branches import ENABLER, _fake, _run

CASES = '''  "machine ssh jht-podman "*) [ -n "$FAKE_SSH_EXIT" ] && { echo 'Error: command C:\\Windows\\system32\\wsl.exe [-u root -d podman-jht-podman sh] failed: exit status 0xffffffff' >&2; exit "$FAKE_SSH_EXIT"; }; exit 0 ;;'''

BODY = r"""
$MachineName = 'jht-podman'
function ConvertTo-WslPath { param([string]$Path) return '/mnt/c/Users/person/jht-container.service' }
$unit = Join-Path $env:HOME 'jht-container.service'
Set-Content -LiteralPath $unit -Value '[Unit]'
$done = Install-JhtContainerService -PodmanPath $env:FAKE_PODMAN -UnitPath $unit
[Console]::Out.WriteLine('INSTALLED=' + [string]$done)
Start-JhtContainerServiceIfInactive -PodmanPath $env:FAKE_PODMAN
[Console]::Out.WriteLine('WENT ON')
"""


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _install(tmp_path, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", CASES)
    result, calls = _run(tmp_path, ENABLER, ["Install-JhtContainerService", "Start-JhtContainerServiceIfInactive", "Invoke-Checked",
                                             "Quote-Sh"], BODY, {"FAKE_PODMAN": str(bin_dir / "podman.exe"), **env})
    return result.stdout.replace("\r\n", "\n"), result, calls


def test_the_unit_is_installed_and_enabled_then_made_active_in_another_step(tmp_path):
    out, result, calls = _install(tmp_path, FAKE_SSH_EXIT="")
    assert result.returncode == 0, out + result.stderr
    assert "INSTALLED=True" in out and "WENT ON" in out
    install, start = calls
    assert "systemctl enable --no-reload jht-container.service" in install and "systemctl start" not in install
    assert "systemctl is-active --quiet jht-container.service || sudo timeout 120 systemctl start jht-container.service" in start


def test_a_session_that_cannot_be_opened_never_stops_the_setup(tmp_path):
    out, result, calls = _install(tmp_path, FAKE_SSH_EXIT="125")
    assert result.returncode == 0, out + result.stderr
    assert "INSTALLED=False" in out and "WENT ON" in out
    assert "The team will not start by itself with the Podman machine: its start-up unit was not installed" in out
    assert "Run the setup again later to add it" in out


def test_the_unit_goes_in_right_after_the_cache_is_dropped_and_before_the_team_starts():
    source = ENABLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    pull = source.index("Invoke-PodmanPull -PodmanPath $Podman")
    drop = source.index("[void](Invoke-JhtMachineDropCaches -PodmanPath $Podman -MachineName $MachineName)", pull)
    install = source.index("$containerUnitInstalled = Install-JhtContainerService -PodmanPath $Podman -UnitPath $containerUnitFile")
    up = source.index("& (Join-Path $BinDir 'jht.ps1') up")
    active = source.index("if ($containerUnitInstalled) { Start-JhtContainerServiceIfInactive -PodmanPath $Podman }")
    assert pull < drop < install < up < active
    # nothing between the drop and the install opens another session
    between = source[drop + 10:install]
    assert "'ssh'" not in between and "Invoke-JhtPodmanMachine" not in between and "Invoke-Checked $Podman 'machine'" not in between
