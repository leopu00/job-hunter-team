"""JHT-T318: after the install, `jht` and `podman` are not found in the window that ran the installer.

Podman (from winget or from its release) and the jht folder are put on the registry PATH of the user, and the
PowerShell window the installer was started from keeps the PATH it had: «podman: not recognized as the name
of a cmdlet». The installer adds to its own PATH what the registry has and it lacks, and says in plain words
to open a new PowerShell window (no restart of the computer).

Build8, German, a new user: the notice still ended with «Um sie sofort in diesem Fenster zu nutzen, füge ein:» and
a `$env:Path = …` line to paste. A person who is not technical gets no command about the PATH, in no language:
only the new window.

The functions are read from the real install.ps1 (the harness of test_windows_podman_wsl_branches): off
Windows under pwsh, on Windows under the shell JHT_TEST_SHELL names.
"""
from __future__ import annotations

import json
from pathlib import Path

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


def _final(tmp_path, before="", **env):
    (tmp_path / "bin").mkdir()
    env = {"JHT_LANG": "en", **env}  # the sentences read below are the English ones
    body = FINAL_BODY.replace("Show-Final", before + "\nShow-Final")
    result, _ = _run(tmp_path, INSTALLER, ["Show-Final", "Test-WillAutoOnboard", "Write-JhtNewWindowNotice", "Test-JhtStartWindowHasTools"],
                     body, env)
    return result, result.stdout.replace("\r\n", "\n")


def test_the_end_of_the_install_says_to_open_a_new_window_and_that_no_restart_is_needed(tmp_path):
    result, out = _final(tmp_path)
    assert result.returncode == 0, out + result.stderr
    assert "Open a NEW PowerShell window to use jht." in out
    assert "No restart of the computer is needed." in out
    # JHT-T352 F-11: podman typed on its own reaches Podman's default connection, not the JHT machine (jht names it): the end
    # of the install no longer promises it, and says it works through jht.
    assert "jht and podman" not in out and "use jht and podman" not in out
    assert "on its own, `podman` does not reach the JHT machine." in out
    assert "THIS PowerShell window was open before the" in out
    # and no command to paste
    assert PASTE_LINE not in out and "$env:Path" not in out and "GetEnvironmentVariable" not in out
    assert "paste" not in out.lower()
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


def _start_window(tmp_path, with_podman):
    # The PATH of the window that launched the installer: the jht folders of an earlier install, and a podman.exe or not.
    podman = tmp_path / "podman bin"
    podman.mkdir()
    if with_podman:
        (podman / "podman.exe").write_bytes(b"")
    return (f"$ShimBin = 'C:\\bin\\shim'; $script:JhtStartPath = 'C:\\Windows;C:\\bin\\shim\\;C:\\BIN;{podman}'")


def test_a_window_that_already_has_jht_and_podman_gets_no_notice(tmp_path):
    # Known defect #13 (Linux round of build6), the same case on Windows: an install over an earlier one, in a window
    # that already finds jht and podman, was told to open a new window.
    result, out = _final(tmp_path, before=_start_window(tmp_path, with_podman=True))
    assert result.returncode == 0, out + result.stderr
    assert "Installation complete!" in out and "Open a NEW PowerShell window" not in out and PASTE_LINE not in out


def test_a_window_without_podman_still_gets_the_notice(tmp_path):
    result, out = _final(tmp_path, before=_start_window(tmp_path, with_podman=False))
    assert result.returncode == 0, out + result.stderr
    assert "Open a NEW PowerShell window to use jht." in out and PASTE_LINE not in out


# A word of each language for the PATH and for pasting: none of them comes to a person.
PASTE_WORDS = {"en": "paste", "it": "incolla", "de": "ge ein", "fr": "colle", "es": "pega", "pt": "cola", "hu": "illeszd be"}
NEW_WINDOW = {"en": "Open a NEW PowerShell window", "it": "PowerShell", "de": "NEUES PowerShell-Fenster", "fr": "PowerShell",
              "es": "PowerShell", "pt": "PowerShell", "hu": "PowerShell"}


@pytest.mark.parametrize("lang", sorted(PASTE_WORDS))
def test_no_language_gets_a_command_about_the_path(tmp_path, lang):
    result, out = _final(tmp_path, JHT_LANG=lang)
    assert result.returncode == 0, out + result.stderr
    notice = out[out.index("PowerShell"):]
    notice = notice[: notice.index("\n\n")] if "\n\n" in notice else notice
    assert NEW_WINDOW[lang] in out, out
    assert "$env:Path" not in out and "GetEnvironmentVariable" not in out, out
    assert PASTE_WORDS[lang] not in notice, notice


def test_the_catalogs_and_the_installer_have_no_sentence_to_paste_the_path():
    assert "use_them_window_right" not in INSTALLER.read_text(encoding="utf-8")
    for catalog in sorted((Path(__file__).resolve().parents[1] / "shared" / "locales").glob("*.json")):
        assert "installer.windows.use_them_window_right" not in json.loads(catalog.read_text(encoding="utf-8")), catalog
