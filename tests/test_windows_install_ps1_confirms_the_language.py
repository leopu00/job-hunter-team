"""`install.ps1` asks to confirm the language right before the setup starts (JHT-T359).

The first lines of the Windows installer are said in the language of Windows. Right before `jht setup`, the person reads
"Language: <the proposed one>. Is that right? Press Enter for yes, or choose 1-7" with the seven languages, as the installer
of Linux and the Mac asks. Enter keeps the proposed language, 1-7 picks another, anything else keeps the proposed one. The
answer goes where the setup, the wrapper and the agents read it: i18n-prefs.json with `asked_at` (the wizard in the container
does not ask again), the JHT_LANG line of host.env, and JHT_LANG of the process that starts the setup.

Nothing is asked when a language was already chosen (i18n-prefs.json, or JHT_LANG set when the installer started), under
`powershell -NonInteractive`, or when nobody can answer (Invoke-Onboard returns before, on the conditions of
Test-WillAutoOnboard).

The check of the source runs everywhere; the rest runs the real functions in Windows PowerShell 5.1 and in PowerShell 7, with
the answer of the person given by a stand-in of Read-JhtLanguageAnswer. The Windows config ACL gate runs this file with
`JHT_REQUIRE_WINDOWS_SHELLS=1`: a missing shell is a failure, not a skip.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.ps1"
SOURCE = INSTALL.read_text(encoding="utf-8")
SHELLS = ("powershell", "pwsh")
LANGUAGES = ("en", "it", "hu", "es", "de", "fr", "pt")


def _function(name: str) -> str:
    match = re.search(rf"^function {re.escape(name)} \{{.*?^\}}\n", SOURCE, re.S | re.M)
    assert match, f"{name} is missing"
    return match.group(0)


def _confirm_block() -> str:
    start = SOURCE.index("# -- The language, confirmed before the setup (JHT-T359)")
    return SOURCE[start:SOURCE.index("function Invoke-Onboard {")]


# -- the source, on every machine -------------------------------------------

def test_the_confirmation_comes_after_the_checks_and_right_before_the_setup():
    onboard = _function("Invoke-Onboard")
    guard = onboard.index("Test-WillAutoOnboard")
    confirm = onboard.index("Confirm-JhtLanguage")
    setup = onboard.index('& "$BinDir\\jht.cmd" setup')
    assert guard < confirm < setup
    # the header and the steps before stay in the language of Windows: the question is asked nowhere else
    assert SOURCE.count("Confirm-JhtLanguage") == 2, "defined once, called once (in Invoke-Onboard)"


def test_the_list_has_the_seven_languages_of_install_sh_in_its_order():
    block = _confirm_block()
    assert "$script:JhtLanguages = @('en', 'it', 'hu', 'es', 'de', 'fr', 'pt')" in block
    picks = dict(re.findall(r"(\d)\) JHT_LANG=([a-z]{2})", (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")))
    assert tuple(picks[str(n)] for n in range(1, 8)) == LANGUAGES
    # one place reads the person: Read-JhtLanguageAnswer
    code = [line for line in block.splitlines() if not line.lstrip().startswith("#")]
    assert sum(line.count("Read-Host") for line in code) == 1 and "function Read-JhtLanguageAnswer" in block


def test_the_installer_stays_ascii_and_its_web_copy_is_the_same_file():
    assert all(line.isascii() for line in _confirm_block().splitlines())
    assert (ROOT / "web" / "public" / "install.ps1").read_bytes() == INSTALL.read_bytes()


# -- the real functions, in both shells -------------------------------------

def _shell(name: str) -> str:
    if name == "powershell":
        if os.name != "nt":
            pytest.skip("Windows PowerShell 5.1 only exists on Windows")
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(name)
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


def _case(shell: str, tmp_path: Path, *, proposed: str = "it", answer: str | None = "", prefs: dict | None = None,
          host_env: str | None = "# Host env\nJHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Paris\n",
          jht_lang: str | None = None, non_interactive: bool = False) -> dict:
    """Confirm-JhtLanguage in a box: Get-JhtTextLanguage proposes `proposed`, the person types `answer` (None: the read
    fails). Returns what it printed, what it returned, whether it asked, and the files after."""
    home = tmp_path / "profile" / ".jht"
    home.mkdir(parents=True)
    if prefs is not None:
        (home / "i18n-prefs.json").write_text(json.dumps(prefs), encoding="utf-8")
    if host_env is not None:
        (home / "host.env").write_text(host_env, encoding="utf-8")
    reader = ("function Read-JhtLanguageAnswer { throw 'no console' }" if answer is None
              else "function Read-JhtLanguageAnswer { $script:Asked = $true; return '%s' }" % answer.replace("'", "''"))
    script = "\n".join([
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
        f"$JhtHome = '{home}'",
        _function("Get-InstallerTextTable"), _function("Ts"), _function("Tsf"), _function("Write-HostFile"),
        _confirm_block(),
        f"function Get-JhtTextLanguage {{ return '{proposed}' }}",
        "$script:Asked = $false",
        reader,
        "$chosen = Confirm-JhtLanguage",
        "[Console]::Out.WriteLine('')",
        "[Console]::Out.WriteLine('RESULT ' + $chosen + ' ' + $script:Asked + ' ' + $env:JHT_LANG)",
        # the names with a letter outside ASCII, as code points: Write-Host of Windows PowerShell 5.1 writes a redirected output
        # in the encoding of the console, so the printed letters cannot be compared here
        "[Console]::Out.WriteLine('NAMES ' + ((@('es', 'fr', 'pt') | ForEach-Object { ([int[]][char[]](Get-JhtLanguageName $_)) -join '.' }) -join ' '))",
    ]) + "\n"
    path = tmp_path / "probe.ps1"
    path.write_text(script, encoding="utf-8-sig")
    argv = [_shell(shell), "-NoLogo", "-NoProfile"] + (["-NonInteractive"] if non_interactive else []) + [
        "-ExecutionPolicy", "Bypass", "-File", str(path)]
    env = {k: v for k, v in os.environ.items() if k.upper() != "JHT_LANG"}
    if jht_lang is not None:
        env["JHT_LANG"] = jht_lang
    done = subprocess.run(argv, env=env, capture_output=True, timeout=120, check=False, stdin=subprocess.DEVNULL)
    out = done.stdout.decode("utf-8", "replace")
    assert done.returncode == 0, out + done.stderr.decode("utf-8", "replace")
    result = re.search(r"RESULT (\S+) (\S+) ?(\S*)\s*$", out, re.M)
    assert result, out
    names = re.search(r"^NAMES (.+?)\s*$", out, re.M)
    assert names, out
    assert [bytes(int(c) for c in word.split(".")).decode("latin-1") for word in names.group(1).split()] == [
        "Espa\u00f1ol", "Fran\u00e7ais", "Portugu\u00eas"]
    prefs_file = home / "i18n-prefs.json"
    env_file = home / "host.env"
    return {
        "out": out, "chosen": result.group(1), "asked": result.group(2) == "True", "env": result.group(3),
        "prefs": json.loads(prefs_file.read_text(encoding="utf-8")) if prefs_file.exists() else None,
        "host_env": env_file.read_text(encoding="utf-8") if env_file.exists() else None,
        "leftovers": sorted(p.name for p in (tmp_path / "profile").iterdir() if p.name != ".jht"),
    }


@pytest.mark.parametrize("shell", SHELLS)
def test_enter_keeps_the_language_proposed_and_saves_it_for_the_setup(shell, tmp_path):
    before = int(time.time())
    r = _case(shell, tmp_path, proposed="it", answer="")
    assert r["asked"] and r["chosen"] == "it" and r["env"] == "it"
    assert "Lingua: Italiano. Va bene? Premi Invio per s" in r["out"]
    for number, name in enumerate(("English", "Italiano", "Magyar", "Espa", "Deutsch", "Fran", "Portugu"), 1):
        assert f"    {number}) {name}" in r["out"], name
    assert r["prefs"]["locale"] == "it"
    assert before - 5 <= r["prefs"]["asked_at"] <= int(time.time()) + 5, "asked_at: the wizard does not ask again within the hour"
    assert r["host_env"] == "# Host env\nJHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Paris\n"
    assert r["leftovers"] == [], "no temporary file left next to the folder"


@pytest.mark.parametrize("shell", SHELLS)
def test_a_number_picks_another_language_everywhere_it_is_read(shell, tmp_path):
    r = _case(shell, tmp_path, proposed="it", answer=" 4 ")
    assert r["asked"] and r["chosen"] == "es" and r["env"] == "es"
    assert r["prefs"]["locale"] == "es"
    assert "JHT_LANG=es\n" in r["host_env"] and "JHT_LANG=it" not in r["host_env"]
    assert "JHT_HOST_TYPE=local\n" in r["host_env"] and "JHT_USER_TZ=Europe/Paris\n" in r["host_env"]


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("answer", ["9", "0", "spanish", "12"])
def test_an_answer_that_is_not_1_to_7_keeps_the_language_proposed(shell, tmp_path, answer):
    r = _case(shell, tmp_path, proposed="de", answer=answer, host_env=None)
    assert r["asked"] and r["chosen"] == "de" and r["prefs"]["locale"] == "de"
    assert "Sprache: Deutsch." in r["out"]
    assert r["host_env"] is None, "no host.env is made where there was none"


@pytest.mark.parametrize("shell", SHELLS)
def test_a_saved_choice_is_not_asked_again(shell, tmp_path):
    prefs = {"locale": "fr", "asked_at": 100}
    r = _case(shell, tmp_path, proposed="fr", prefs=prefs)
    assert not r["asked"] and r["chosen"] == "fr"
    assert r["prefs"] == prefs, "the saved choice is left as it is"
    assert "1-7" not in r["out"]


@pytest.mark.parametrize("shell", SHELLS)
def test_jht_lang_set_before_the_installer_is_a_choice_and_an_unknown_one_is_not(shell, tmp_path):
    r = _case(shell, tmp_path / "a", proposed="pt", jht_lang="pt_BR.UTF-8")
    assert not r["asked"] and r["prefs"] is None
    r = _case(shell, tmp_path / "b", proposed="en", jht_lang="xx")
    assert r["asked"] and r["prefs"]["locale"] == "en"


@pytest.mark.parametrize("shell", SHELLS)
def test_nothing_is_asked_under_non_interactive_and_nothing_is_written(shell, tmp_path):
    r = _case(shell, tmp_path, proposed="it", non_interactive=True)
    assert not r["asked"] and r["chosen"] == "it" and r["prefs"] is None
    assert r["host_env"].count("JHT_LANG=it") == 1


@pytest.mark.parametrize("shell", SHELLS)
def test_a_console_that_cannot_be_read_keeps_the_language_proposed(shell, tmp_path):
    r = _case(shell, tmp_path, proposed="hu", answer=None)
    assert r["chosen"] == "hu" and r["prefs"]["locale"] == "hu"
