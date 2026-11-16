"""The Windows installer writes in host.env the zone of the computer's country, not the 001 zone of its Windows id.

Windows round of build 6: a Windows in Italian, «W. Europe Standard Time», a person in Brescia. host.env had JHT_USER_TZ=Europe/Berlin and
the chat said «finished at 20:31 (Europe/Berlin)»: the clock right, the name wrong. The CLDR maps the id with the country (W. Europe Standard
Time in IT: Europe/Rome) and takes the 001 zone (Europe/Berlin) only where the country has none of its own. install.ps1 carries the zones of
the ids in a block made from shared/data/timezones.txt (tests/installer_ps1_zones.py); the setup's picker of the wrapper follows the same rule.

The functions are read from the real install.ps1 and jht-wrapper.ps1 (the harness of test_windows_podman_wsl_branches): off Windows under
pwsh, on Windows under the shell JHT_TEST_SHELL names.
"""
from __future__ import annotations

import re

import pytest

import installer_ps1_zones as zones
from test_windows_podman_wsl_branches import INSTALLER, _run
from test_wrapper_ps1_timezone_choice import SHELLS, _run as _run_picker

INSTALL_FUNCTIONS = ["Get-JhtWindowsZoneLines", "Get-JhtZoneOfWindowsId", "Get-JhtInstallTimezone", "Get-JhtSavedHostEnvValue"]

# (Windows id, country, saved in host.env, zone written)
CASES = [
    ("W. Europe Standard Time", "IT", "", "Europe/Rome"),  # the round: Brescia
    ("W. Europe Standard Time", "DE", "", "Europe/Berlin"),
    ("W. Europe Standard Time", "CH", "", "Europe/Zurich"),
    ("W. Europe Standard Time", "", "", "Europe/Berlin"),  # no country: the 001 zone
    ("W. Europe Standard Time", "JP", "", "Europe/Berlin"),  # a country without a zone of the id: the 001 zone
    ("Romance Standard Time", "ES", "", "Europe/Madrid"),
    ("Eastern Standard Time", "US", "", "America/New_York"),  # the 001 zone is the country's own
    ("Eastern Standard Time", "CA", "", "America/Toronto"),
    ("No Such Standard Time", "IT", "", "UTC"),  # an id that is not known: UTC, and jht setup asks
    # an update: the 001 zone an earlier install wrote gives way to the country's, a zone the person chose stays
    ("W. Europe Standard Time", "IT", "Europe/Berlin", "Europe/Rome"),
    ("W. Europe Standard Time", "IT", "Europe/Vienna", "Europe/Vienna"),
    ("W. Europe Standard Time", "DE", "Europe/Berlin", "Europe/Berlin"),
    ("No Such Standard Time", "IT", "Asia/Tokyo", "Asia/Tokyo"),
]


@pytest.fixture
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def test_the_block_of_the_installers_is_the_data():
    for installer in zones.INSTALLERS:
        text = installer.read_bytes().decode("utf-8").replace("\r\n", "\n")
        assert zones.written_block(text) == zones.block(), "run: python3 tests/installer_ps1_zones.py --write"
    primary, territory = zones.zones()
    assert primary["W. Europe Standard Time"] == "Europe/Berlin"
    assert territory[("W. Europe Standard Time", "IT")] == "Europe/Rome"
    assert ("W. Europe Standard Time", "DE") not in territory  # Berlin is the 001 zone: no line of its own


@pytest.mark.usefixtures("require_the_requested_engine")
def test_the_installer_writes_the_zone_of_the_country(tmp_path):
    (tmp_path / "bin").mkdir()
    lines = ["$JhtHome = Join-Path $env:HOME 'jht'"]
    for number, (win, country, saved, _) in enumerate(CASES):
        lines.append(f"$JhtHome = Join-Path $env:HOME 'case{number}'; New-Item -ItemType Directory -Force -Path $JhtHome | Out-Null")
        if saved:
            lines.append(f"Set-Content -LiteralPath (Join-Path $JhtHome 'host.env') -Value 'JHT_HOST_TYPE=local','JHT_USER_TZ={saved}'")
        lines.append(f"[Console]::Out.WriteLine('ZONE {number} ' + (Get-JhtInstallTimezone -WindowsId '{win}' -Country '{country}'))")
    result, _ = _run(tmp_path, INSTALLER, INSTALL_FUNCTIONS, "\n".join(lines) + "\n", {})
    assert result.returncode == 0, result.stdout + result.stderr
    found = dict(re.findall(r"^ZONE (\d+) (\S+)\s*$", result.stdout.replace("\r\n", "\n"), flags=re.MULTILINE))
    assert {int(k): v for k, v in found.items()} == {n: case[3] for n, case in enumerate(CASES)}, result.stdout


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("country, zone", [("IT", "Europe/Rome"), ("AT", "Europe/Vienna"), ("", "Europe/Berlin")])
def test_the_setup_proposes_the_zone_of_the_country(shell, tmp_path, country, zone):
    # the picker of `jht setup` proposes the same zone the installer writes, in place of the UTC of an install that could not tell
    result = _run_picker(shell, tmp_path, "\n", local="W. Europe Standard Time", country=country)
    assert result.env == zone, result.out + result.err
    assert result.file.endswith(f"JHT_USER_TZ={zone}\n")
