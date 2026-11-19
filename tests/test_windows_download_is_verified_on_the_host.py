"""`jht download` in the Windows wrapper downloads nothing: 0.4.0 has no desktop app, and the release attaches no installer.

The command used to fetch the dmg or the setup.exe of the release and check its SHA-256 on the host; with no app in the release
that would be a 404. Now it says, in the language of the person, that JHT is used from the terminal (jht setup, jht up), and ends
with 1. The check of the source runs everywhere; the rest runs the real function in Windows PowerShell 5.1 and in PowerShell 7,
and the Windows config gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from test_windows_host_env_is_not_written_through_a_link import SHELLS, _run, windows_only
from wrapper_ps_texts import say_functions

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
LANGS = ["en", "it", "es", "fr", "de", "pt", "hu"]
SAID = {lang: json.loads((ROOT / f"shared/locales/{lang}.json").read_text(encoding="utf-8"))["wrapper.download.no_desktop_app"]
        for lang in LANGS}


def _function() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    match = re.search(r"^function Invoke-HostDownload \{.*?^\}\n", text, re.S | re.M)
    assert match
    return match.group(0)


# ── the source, on every machine ───────────────────────────────────────────

def test_the_windows_download_asks_the_release_for_nothing_and_ends_with_1():
    source = WRAPPER.read_text(encoding="utf-8")
    function = _function()
    for gone in ("Invoke-WebRequest", "releases/download", "SHA256SUMS", ".dmg", "setup.exe", "JHT_RELEASE_BASE_URL", "docker"):
        assert gone not in function, gone
    assert "Get-JhtText 'download.no_desktop_app'" in function and "$script:HostDownloadExitCode = 1" in function
    # the helpers of the old download are gone with it
    for helper in ("function Test-DownloadInsideShared", "function Get-DownloadSha256"):
        assert helper not in source, helper
    arm = source[source.index("  'download' {"):]
    arm = arm[:arm.index("\n  }\n")]
    assert "Ensure-Up" not in arm and "Require-Docker" not in arm and "Invoke-HostDownload $Rest" in arm
    assert "exit $script:HostDownloadExitCode" in arm
    # `jht download --help` is the local help of the host commands, before the arm
    assert "'download'" in source[source.index("function Test-HostCommandUsesLocalHelp"):][:2000]


# ── the real code, in both shells ──────────────────────────────────────────

def _download(shell: str, tmp_path: Path, lang: str, *args: str):
    home = tmp_path / "profile"
    home.mkdir(exist_ok=True)
    temp = tmp_path / "temp"
    temp.mkdir(exist_ok=True)
    quoted = ", ".join("'" + a.replace("'", "''") + "'" for a in args)
    script = ("function Write-Err { param([string]$Msg) Write-Host \"error: $Msg\" }\n" + say_functions(lang) + _function()
              + f"\nInvoke-HostDownload -DownloadArgs @({quoted})\nWrite-Host \"RC=$script:HostDownloadExitCode\"\n")
    done = _run(shell, script, tmp_path, USERPROFILE=str(home), JHT_RELEASE_BASE_URL="http://127.0.0.1:9",
                TEMP=str(temp), TMP=str(temp))
    return done, home, temp


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("args", (
    ("--os", "macos", "--version", "0.4.0"),
    ("--os", "windows", "--version", "0.4.0", "--output", "client.exe"),
    ("--os", "linux", "--version", "0.4.0", "--deb"),
    (),
))
def test_jht_download_downloads_nothing_and_says_jht_is_used_from_the_terminal(shell: str, args: tuple, tmp_path: Path):
    done, home, temp = _download(shell, tmp_path, "en", *args)
    assert "RC=1" in done.stdout and SAID["en"] in done.stdout, done.stdout + done.stderr
    assert not (home / "Downloads").exists() and list(temp.iterdir()) == []
    assert not (tmp_path / "client.exe").exists()


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("lang", LANGS)
def test_it_is_said_in_the_language_of_the_person(shell: str, lang: str, tmp_path: Path):
    # what Write-Host says is taken from its stream and written as UTF-8: the console of Windows PowerShell 5.1 is not UTF-8
    said = tmp_path / "said.txt"
    script = ("function Write-Err { param([string]$Msg) Write-Host \"error: $Msg\" }\n" + say_functions(lang) + _function()
              + "\n$out = (Invoke-HostDownload -DownloadArgs @('--os', 'macos', '--version', '0.4.0') 6>&1 | Out-String)\n"
              + f"[IO.File]::WriteAllText('{said}', $out, (New-Object Text.UTF8Encoding $false))\n"
              + "Write-Host \"RC=$script:HostDownloadExitCode\"\n")
    done = _run(shell, script, tmp_path, TEMP=str(tmp_path), TMP=str(tmp_path))
    assert "RC=1" in done.stdout, done.stdout + done.stderr
    assert SAID[lang] in said.read_text(encoding="utf-8"), said.read_text(encoding="utf-8")
