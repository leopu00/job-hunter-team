"""The Windows installer says the long steps of the Podman machine in the person's language, in all 7.

Giro Windows 16/11 (it): «Creating the Linux machine…», «Starting the Linux machine…», «WSL settings added…» and «Downloading the
Job Hunter Team runtime image…» were English in an Italian install. Their texts are the podman_machine.* keys of the catalogs, in a
block inside scripts/podman-machine-bridge.ps1 (tests/bridge_ps1_texts.py), ASCII for Windows PowerShell 5.1. The language is the
wrapper's when the bridge is dot-sourced there, else JHT_LANG, which install.ps1 now gives the enabler (with the timezone: its
`jht up` makes the container before host.env is written).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from bridge_ps1_texts import ENABLER, TEXTS
from script_texts import LANGUAGES, catalog
from test_windows_long_phases_show_progress import INIT_CALL, PULL_CALL, _case, _words

INSTALLER = Path(__file__).resolve().parent.parent / "scripts" / "install.ps1"


def test_the_block_is_the_catalogs_and_the_scripts_are_ascii_outside_comments():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/bridge_ps1_texts.py --write"
    for source in (TEXTS.source(), ENABLER.read_text(encoding="utf-8")):
        assert all(line.isascii() for line in source.split("\n") if not line.lstrip().startswith("#"))


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_catalog_has_every_sentence(lang):
    assert TEXTS.problems(lang) == []
    assert len(TEXTS.calls()) == 11


def test_no_sentence_of_the_machine_is_left_written_by_hand():
    for source in (TEXTS._without_block(TEXTS.source()), ENABLER.read_text(encoding="utf-8")):
        body = "\n".join(line for line in source.split("\n") if not line.lstrip().startswith("#"))
        for left in ("Write-Host '  > Downloading", "Said = 'Creating", "Said = 'Starting", 'Write-Host "  WSL settings', "Write-Host '  To undo"):
            assert left not in body, left


def test_the_installer_gives_the_enabler_the_language_and_the_timezone_of_host_env():
    source = INSTALLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    enabler = source[source.index("function Invoke-PodmanRuntimeEnabler"):]
    enabler = enabler[: enabler.index("\n}\n")]
    assert "$env:JHT_LANG = Get-JhtPersonLanguage" in enabler and "$env:JHT_USER_TZ = Get-JhtInstallTimezone" in enabler
    # given for the run of the enabler only, then put back as they were
    assert "$env:JHT_LANG = $oldLang" in enabler and "$env:JHT_USER_TZ = $oldTz" in enabler
    host_env = source[source.index("function Write-HostEnv"):]
    host_env = host_env[: host_env.index("\n}\n")]
    assert "$lang = Get-JhtPersonLanguage" in host_env and "$tz = Get-JhtInstallTimezone" in host_env


@pytest.mark.parametrize("lang", ["it", "de", "pt"])
def test_creating_the_machine_is_said_in_the_language_of_jht_lang(tmp_path, lang):
    texts = catalog(lang)
    result, _ = _case(tmp_path, f"$env:JHT_LANG = '{lang}'; {INIT_CALL}", machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert f"  > {texts['podman_machine.init']}" in out, out
    waits = re.findall(rf"^  \.\.\. {re.escape(texts['podman_machine.init_wait'])} \(\d+:\d\d\)\s*$", out, flags=re.MULTILINE)
    assert len(waits) >= 2, out
    assert "Creating the Linux machine" not in out and "still creating" not in out, out


def test_the_download_of_the_image_is_said_in_italian(tmp_path):
    texts = catalog("it")
    result, _ = _case(tmp_path, f"$env:JHT_LANG = 'it'; {PULL_CALL}", machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert f"  > {texts['podman_machine.pull']}" in out, out
    assert any("2 strati iniziati" in line for line in out.splitlines() if texts["podman_machine.pull_wait"] in line), out
    assert "Downloading the Job Hunter Team" not in out and "layers started" not in out, out


def test_without_a_language_it_stays_english(tmp_path):
    result, _ = _case(tmp_path, f"Remove-Item Env:JHT_LANG -ErrorAction SilentlyContinue; {INIT_CALL}", machine_output="0")
    out = _words(result)
    assert "  > Creating the Linux machine for Podman:" in out and "  ... still creating the Linux machine (" in out, out
