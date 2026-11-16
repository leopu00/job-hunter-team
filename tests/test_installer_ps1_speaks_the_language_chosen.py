"""The Windows installer says its lines in the person's language, in all 7.

scripts/install.ps1 said its lines in English or Italian (`T 'english' 'italiano'`), about thirty only in English. Its texts are
now keys of shared/locales (installer.windows.*), in a block of the 7 languages inside the installer made from the catalogs
(tests/installer_ps1_texts.py), in ASCII ([char]0x.... for every other letter) because Windows PowerShell 5.1 reads the file in
the legacy console encoding. The language is the one it had already (Get-JhtTextLanguage: the saved choice, JHT_LANG, the
language of Windows); the Windows 10 notice keeps its own seven.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from installer_ps1_texts import TEXTS
from script_texts import LANGUAGES, catalog

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")
PWSH = shutil.which("pwsh") or shutil.which("powershell")


def _code() -> list[str]:
    return [line for line in TEXTS._without_block(SOURCE).splitlines() if not line.lstrip().startswith("#")]


def test_the_block_is_the_catalogs_and_the_installer_is_ascii():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/installer_ps1_texts.py --write, then sync web/public"
    assert all(line.isascii() for line in SOURCE.splitlines() if not line.lstrip().startswith("#"))


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_catalog_has_every_line(lang):
    assert TEXTS.problems(lang) == []


def test_no_line_of_two_languages_is_left():
    code = "\n".join(_code())
    assert not re.search(r"(?<![\w-])T ['\"]", code)
    assert "function T {" not in SOURCE
    for key in TEXTS.calls():
        italian = catalog("it")[key]
        if italian != catalog("en")[key] and len(italian) > 14:
            assert italian not in code and italian.replace("'", "''") not in code, key


def test_the_problems_of_the_podman_setup_and_the_checks_are_said_in_the_language_too():
    for key in ("installer.windows.podman.install_failed", "installer.windows.podman.sshproxy", "installer.windows.podman.stopped",
                "installer.windows.branch_unresolved", "installer.windows.wrapper_lacks_protocol", "installer.check.compose_boundary",
                "installer.windows.download_failed"):
        assert key in TEXTS.calls(), key
    body = SOURCE[SOURCE.index("function Show-PodmanSetupProblem {"):SOURCE.index("function Test-JhtDownloadedRuntimeScripts {")]
    assert not re.search(r"-What '|-What \"", body)


def _functions(*names: str) -> str:
    return "\n".join(re.search(rf"^function {n} \{{\n.*?^\}}\n", SOURCE, re.S | re.M).group(0) for n in names)


@pytest.mark.skipif(PWSH is None, reason="needs PowerShell (it is on the Linux and Windows gates)")
@pytest.mark.parametrize("lang", LANGUAGES)
def test_powershell_says_the_catalogs_text_with_its_values_in_each_language(tmp_path, lang):
    texts = catalog(lang)
    cases = [(key, english) for key, english in sorted(TEXTS.calls().items())]
    script = _functions("Get-InstallerTextTable", "Ts", "Tsf") + "\nfunction Get-JhtTextLanguage { return $env:T_LANG }\n$out = [ordered]@{}\n"
    for key, english in cases:
        values = " ".join(f"'V{i}'" for i in range(len(re.findall(r"%[sd]", english))))
        call = f"Tsf '{key}' 'x' {values}" if values else f"Ts '{key}' 'x'"
        script += f"$out['{key}'] = ({call})\n"
    script += "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n[Console]::Out.Write((ConvertTo-Json -InputObject $out -Compress))\n"
    path = tmp_path / "case.ps1"
    path.write_bytes(script.encode("ascii"))
    done = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-File", str(path)], capture_output=True, timeout=120,
                          env={**__import__("os").environ, "T_LANG": lang})
    assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
    said = json.loads(done.stdout.decode("utf-8"))
    for key, english in cases:
        expected = texts[key]
        for i in range(len(re.findall(r"%[sd]", english))):
            expected = re.sub(r"%[sd]", f"V{i}", expected, count=1)
        assert said[key] == expected, key


def _language_case(script: Path, *, culture: str, jht_lang: str | None, prefs: str | None, tmp_path: Path) -> str:
    """Get-JhtTextLanguage of a script, on a Windows whose language is `culture` (giro Windows: an Italian ThinkPad)."""
    from windows_native_fakes import powershell_argv
    text = script.read_text(encoding="utf-8")
    body = re.search(r"^function Get-JhtTextLanguage \{\n.*?^\}\n", text, re.S | re.M).group(0)
    home = tmp_path / "home" / ".jht"
    home.mkdir(parents=True, exist_ok=True)
    if prefs is not None:
        (home / "i18n-prefs.json").write_text(json.dumps({"locale": prefs}), encoding="utf-8")
    case = tmp_path / "case.ps1"
    case.write_text(
        f"[Globalization.CultureInfo]::CurrentUICulture = [Globalization.CultureInfo]::new('{culture}')\n"
        f"$JhtHome = '{home}'\n$env:JHT_HOST_ENV_FILE = '{home / 'host.env'}'\n$script:JhtHostEnvLang = ''\n"
        + body + "\n[Console]::Out.WriteLine((Get-JhtTextLanguage))\n", encoding="utf-8")
    import os as _os
    env = {key: value for key, value in _os.environ.items() if key.upper() != "JHT_LANG"}
    if jht_lang is not None:
        env["JHT_LANG"] = jht_lang
    done = subprocess.run([*powershell_argv(), "-File", str(case)], capture_output=True, text=True, timeout=60, env=env)
    return done.stdout.strip() + done.stderr.strip()


@pytest.mark.parametrize("script", ["install.ps1", "jht-wrapper.ps1"])
def test_a_language_the_product_does_not_have_reads_english_not_the_language_of_windows(tmp_path, script):
    """A person who asked for a language the product does not have reads English, even on an Italian Windows (giro ThinkPad: the
    uninstall and `jht status` answered in Italian). The language of Windows counts only when nothing was chosen."""
    path = ROOT / "scripts" / script
    assert _language_case(path, culture="it-IT", jht_lang="xx", prefs=None, tmp_path=tmp_path / "a") == "en"
    assert _language_case(path, culture="it-IT", jht_lang=None, prefs="xx", tmp_path=tmp_path / "b") == "en"
    assert _language_case(path, culture="it-IT", jht_lang=None, prefs=None, tmp_path=tmp_path / "c") == "it"
    assert _language_case(path, culture="it-IT", jht_lang="pt", prefs=None, tmp_path=tmp_path / "d") == "pt"
    assert _language_case(path, culture="it-IT", jht_lang="it", prefs="de", tmp_path=tmp_path / "e") == "de"


@pytest.mark.parametrize("culture", ["it-IT"])
def test_an_update_keeps_the_language_the_host_type_and_the_zone_of_host_env(tmp_path, culture):
    """An update on Windows (host.env of the install before, no i18n-prefs.json, JHT_LANG not set): host.env is written again
    with the language, the host type and the time zone it had, not with the language of Windows, `local` and the zone detected."""
    from windows_native_fakes import powershell_argv
    home = tmp_path / "home" / ".jht"
    home.mkdir(parents=True)
    (home / "host.env").write_text("JHT_LANG=pt\nJHT_HOST_TYPE=vps\nJHT_USER_TZ=America/Sao_Paulo\n", encoding="utf-8")
    script = (f"[Globalization.CultureInfo]::CurrentUICulture = [Globalization.CultureInfo]::new('{culture}')\n"
              f"$JhtHome = '{home}'\n$PairingToken = ''\n$DryRun = $true\n$TotalSteps = 5\n"
              "function Write-Step { }\nfunction Ts { param($Key, $English) return $English }\n"
              "function Write-Dry { param($Text) [Console]::Out.WriteLine($Text) }\n"
              + _functions("Get-JhtSavedHostEnvValue", "Get-JhtTextLanguage", "Get-JhtPersonLanguage", "Write-HostEnv")
              + "\nWrite-HostEnv\n")
    case = tmp_path / "case.ps1"
    case.write_text(script, encoding="utf-8")
    import os as _os
    env = {key: value for key, value in _os.environ.items() if key.upper() != "JHT_LANG"}
    done = subprocess.run([*powershell_argv(), "-File", str(case)], capture_output=True, text=True, timeout=60, env=env)
    assert done.returncode == 0 and not done.stderr.strip(), done.stdout + done.stderr
    assert "(JHT_HOST_TYPE=vps, JHT_LANG=pt, JHT_USER_TZ=America/Sao_Paulo)" in done.stdout, done.stdout
