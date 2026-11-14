"""install.ps1 with `-SourceSha`: the banner says the commit that was asked for, not «branch: production».

A test-channel install is one commit, fetched by its SHA (compose, wrapper and installer of that commit). The banner used to print
`branch:  production`, the default of a parameter that plays no part in that install, so a person or a tester reading the screen
could not tell which commit was being installed (the Linux installer already prints the commit). Without `-SourceSha` the banner
keeps its `branch:` line.

The function is taken from the REAL script and run in the shells the installer runs in: Windows PowerShell 5.1 (the one Windows
ships) and PowerShell 7. The config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`, so a missing shell is a failure there.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from test_windows_host_env_is_not_written_through_a_link import SHELLS, _function, _run, windows_only

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / "scripts" / "install.ps1"
SHA = "0123456789abcdef0123456789abcdef01234567"


def _banner(shell: str, tmp_path: Path, source_sha: str) -> str:
    source = INSTALLER.read_text(encoding="utf-8")
    script = (
        "$RuntimeImage = 'ghcr.io/leopu00/jht@sha256:" + "a" * 64 + "'\n"
        "$Branch = 'production'\n"
        f"$SourceSha = '{source_sha}'\n"
        "$RuntimeDir = 'C:\\runtime'; $BinDir = 'C:\\bin'; $DryRun = $false; $PairingToken = ''\n"
        + _function(source, "Get-JhtTextLanguage")
        + _function(source, "T")
        + _function(source, "Show-Header")
        + "\nShow-Header\n"
    )
    done = _run(shell, script, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout


def test_the_banner_code_is_plain_syntax_that_windows_powershell_5_1_reads():
    # no PowerShell 7 only operator in the function (ternary, null-coalescing, pipeline chain): checked on the source everywhere
    body = _function(INSTALLER.read_text(encoding="utf-8"), "Show-Header")
    for operator in (" ? ", "??", "&&", "||"):
        assert operator not in body, operator
    assert "$SourceSha" in body


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_test_channel_install_names_its_commit_in_the_banner(shell: str, tmp_path: Path):
    shown = _banner(shell, tmp_path, SHA)
    assert f"commit:  {SHA}" in shown
    assert "branch:" not in shown and "production" not in shown


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_without_a_source_sha_the_banner_keeps_its_branch_line(shell: str, tmp_path: Path):
    shown = _banner(shell, tmp_path, "")
    assert "branch:  production" in shown and "commit:" not in shown
