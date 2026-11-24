"""`install.ps1 -PairingToken` pairs the device with the cloud sync paused, as `install.sh --pairing-token` does.

The sync with the site is a choice. With a pairing token the installer leaves a marker, `.pairing-paused`, next to the
token; `jht cloud pair` reads it and writes cloud.json with `enabled:false`, `paused_by:"installer"`, `sync_choice:"user"`
(the token is registered all the same, so `jht cloud resume` is one step). `-CloudSync on` is the explicit way to start it on,
and takes away a marker left by an earlier install.

The checks of the source run everywhere; the block that writes (or removes) the marker runs for real in Windows PowerShell 5.1
and in PowerShell 7 on Windows. The Windows gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.ps1"
SOURCE = INSTALL.read_text(encoding="utf-8")
SHELLS = ("powershell", "pwsh")
windows_only = pytest.mark.skipif(os.name != "nt", reason="needs Windows PowerShell 5.1, which only Windows has")


def _function(name: str) -> str:
    match = re.search(rf"^function {re.escape(name)} \{{.*?^\}}\n", SOURCE, re.S | re.M)
    assert match, f"{name} is missing"
    return match.group(0)


def _marker_block() -> str:
    start = SOURCE.index("$pausedMarker = Join-Path $JhtHome '.pairing-paused'")
    end = SOURCE.index("\n      }\n", SOURCE.index("} else {", start)) + len("\n      }\n")
    return SOURCE[start:end]


def test_the_parameter_is_on_or_off_and_off_by_default():
    assert re.search(r"\[ValidateSet\('on', 'off'\)\]\s*\[string\]\$CloudSync = 'off',", SOURCE)
    assert "-CloudSync" in SOURCE.split("[CmdletBinding()]")[0], "the header box does not document the parameter"


def test_the_marker_goes_through_the_writer_that_never_follows_a_link():
    block = _marker_block()
    assert "Write-HostFile -Path $pausedMarker -Content '' -Encoding ASCII -NoNewline -Prepare $restrictAcl" in block
    assert "Set-Content -Path $pausedMarker" not in SOURCE
    assert "if ($CloudSync -eq 'on')" in block and "[IO.File]::Delete($pausedMarker)" in block


def test_the_marker_belongs_to_the_pairing_token_branch_and_to_nothing_else():
    token_branch = SOURCE[SOURCE.index("if ($PairingToken) {\n    $tokenFile"):]
    assert token_branch.index("$pausedMarker") < token_branch.index("# ── Final message")
    assert SOURCE.count("$pausedMarker = ") == 1


def test_the_dry_run_says_what_it_would_leave():
    assert "Write-Dry \"Set-Content (Join-Path $JhtHome '.pairing-paused')" in SOURCE


def test_the_marker_name_is_the_one_cloud_pair_reads():
    assert "'.pairing-paused'" in SOURCE
    assert "join(JHT_HOME, '.pairing-paused')" in (ROOT / "cli" / "src" / "commands" / "cloud.js").read_text(encoding="utf-8")
    assert '.pairing-paused' in (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")


def _shell(name: str) -> str:
    if name == "powershell":
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(name)
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


def _run_block(shell: str, tmp_path: Path, cloud_sync: str) -> subprocess.CompletedProcess:
    jht_home = tmp_path / "home" / ".jht"
    jht_home.mkdir(parents=True, exist_ok=True)
    script = (
        "$ErrorActionPreference = 'Stop'\n"
        + _function("Write-HostFile")
        + f"\n$JhtHome = '{jht_home}'\n$CloudSync = '{cloud_sync}'\n$restrictAcl = {{ param($file) }}\n"
        + "if ($true) {\n      " + _marker_block().strip() + "\n}\n"
    )
    path = tmp_path / "probe.ps1"
    path.write_text(script, encoding="utf-8-sig")
    return subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(path)],
        capture_output=True, text=True, timeout=120, check=False,
    )


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_by_default_the_marker_is_left_empty_and_nothing_else_stays(shell: str, tmp_path: Path):
    done = _run_block(shell, tmp_path, "off")
    assert done.returncode == 0, done.stdout + done.stderr
    jht_home = tmp_path / "home" / ".jht"
    assert (jht_home / ".pairing-paused").is_file() and (jht_home / ".pairing-paused").stat().st_size == 0
    assert sorted(p.name for p in jht_home.iterdir()) == [".pairing-paused"]
    assert sorted(p.name for p in jht_home.parent.iterdir()) == [".jht"], "a temporary stayed in the profile"


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_cloud_sync_on_leaves_no_marker_and_takes_away_an_old_one(shell: str, tmp_path: Path):
    jht_home = tmp_path / "home" / ".jht"
    jht_home.mkdir(parents=True)
    (jht_home / ".pairing-paused").write_text("", encoding="utf-8")
    done = _run_block(shell, tmp_path, "on")
    assert done.returncode == 0, done.stdout + done.stderr
    assert not (jht_home / ".pairing-paused").exists()
    # and with none there, it is no error
    again = _run_block(shell, tmp_path, "on")
    assert again.returncode == 0, again.stdout + again.stderr


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_value_other_than_on_or_off_is_refused_before_anything_runs(shell: str, tmp_path: Path):
    done = subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(INSTALL),
         "-CloudSync", "maybe", "-DryRun"],
        capture_output=True, text=True, timeout=120, check=False, cwd=tmp_path,
        env={**os.environ, "USERPROFILE": str(tmp_path), "HOME": str(tmp_path)},
    )
    assert done.returncode != 0
    assert "CloudSync" in done.stderr + done.stdout
    # PowerShell itself makes AppData in the profile it is given; the installer must have made nothing of its own
    made = sorted(p.name for p in tmp_path.iterdir() if p.name != "AppData")
    assert made == [], f"the installer wrote something before refusing the value: {made}"
    assert not (tmp_path / ".jht").exists()
