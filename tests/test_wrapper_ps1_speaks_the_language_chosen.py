"""The jht wrapper for Windows (scripts/jht-wrapper.ps1) speaks the language the person chose, in all 7.

The wrapper said its sentences in Italian (some 230, written where they are said, and for a person who chose English too) or in
English and Italian only (Get-JhtTextLanguage answered `it` or `en`, so a German read the Italian branch of every `-ceq 'en'`).
Every sentence is now `(Get-JhtText '<key>')` or `(Format-JhtText '<key>' values...)`, and the texts of the 7 languages are a block
made from shared/locales (keys wrapper.*; tests/wrapper_ps_texts.py), written in the wrapper because it runs on the host, where the
catalogs are not, and reads no file the container can write. The file is ASCII: an accent is a [char]0x... in the generated block.

The first half of this file reads the files; the second half RUNS the wrapper's own functions and the wrapper itself in every
language with the PowerShell of the machine (PowerShell 7 or Windows PowerShell 5.1: it runs in both on the Windows gate), and
checks them text by text against the catalogs.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wrapper_ps_texts as texts  # noqa: E402
from wrapper_ps_texts import UTF8_OUTPUT  # noqa: E402
from ps_strings import tokens  # noqa: E402
from script_texts import LANGUAGES, catalog  # noqa: E402

WRAPPER = texts.WRAPPER
PLACEHOLDER = re.compile(r"%[sd]")


SHELLS = ("powershell", "pwsh")


def _shell(name: str) -> str:
    """Windows PowerShell 5.1 (`powershell`, only on Windows) or PowerShell 7 (`pwsh`, or JHT_TEST_PWSH). The Windows gate runs this file
    with JHT_REQUIRE_WINDOWS_SHELLS=1: a missing shell is a failure there, not a skip."""
    if name == "powershell":
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


# ── what the file says ─────────────────────────────────────────────────────────────────────────────────────────────
def test_the_block_in_the_wrapper_is_the_one_made_from_the_catalogs():
    assert texts.written_block() == texts.block(), "run: python3 tests/wrapper_ps_texts.py --write"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_text_of_the_wrapper_is_in_the_catalog_of_each_language(lang):
    assert texts.problems(lang) == []


def test_the_wrapper_names_a_key_the_catalog_has():
    english = catalog("en")
    assert [key for key in texts.keys() if texts.catalog_name(key) not in english] == []


def test_the_code_of_the_wrapper_is_ascii_the_accents_are_in_the_block_as_characters():
    """Windows PowerShell 5.1 reads a .ps1 with no byte order mark as ANSI: a string with an accent in it is read wrong
    (the confirmation that accepted «sì» never matched, «perché» and «è» were spoiled). Only comments may have more."""
    left = []
    for number, line in enumerate(WRAPPER.read_text(encoding="utf-8").splitlines(), 1):
        if not line.isascii() and not line.lstrip().startswith("#"):
            left.append(f"{number}: {line.strip()[:100]}")
    assert left == []
    assert not WRAPPER.read_bytes().startswith(b"\xef\xbb\xbf")


def test_the_language_is_one_of_the_seven_codes_and_not_only_italian_or_english():
    source = WRAPPER.read_text(encoding="utf-8")
    start = source.index("function Get-JhtTextLanguage {")
    body = source[start : source.index("\n}\n", start)]
    assert "-cmatch $known) { return $code }" in body
    assert "-ceq 'it') { return 'it' }" not in body
    assert not re.findall(r"\(Get-JhtTextLanguage\) -ceq '(?:en|it)'", texts.without_block(source))


ITALIAN = re.compile(
    r"\b(il|la|le|lo|gli|non|per|con|del|della|sono|puoi|esegui|nessun|che|una|di|dei|nel|poi|ancora|resta|rilancia|prova|errore|uso|cosa|fare"
    r"|riprova|annullato|serve|rifiutato|avvia|ferma|scarico|tolgo|vengono|abbinare|casella)\b|\b(?:e|puo|gia|piu|cosi|perche|citta|attivita|verra|prendera|dov'e|c)'(?:\s|\$|\.|,|:|;|$)|\b(?:perch|attivit|riuscit)",
    re.I,
)


def test_no_sentence_for_the_person_is_written_in_italian_by_hand():
    source = texts.without_block(WRAPPER.read_text(encoding="utf-8"))
    left = []
    for kind, start, _end, body, line in tokens(source):
        if kind not in ("s", "d", "hs", "hd") or not ITALIAN.search(body):
            continue
        # a key of the catalog, a state or a reason that a machine reads (the app reads `non-installata` and the JSON of an absent helper)
        if re.fullmatch(r"[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)+|--[a-z][a-z0-9-]*", body) or '"state":"not_installed"' in body:
            continue
        # code is not a sentence: a pattern, a command run in the container, a path
        if re.search(r"^\s*(?:const |import |if \[|IFS=|[\w/.-]+\.sh)|\\\\|\(\?m\)|\^\[", body) or body.count("\n") > 3 and not body.startswith(("jht", "Uso")):
            continue
        left.append(f"{line}: {source[start:start + 90]!r}")
    assert left == [], "\n".join(left[:20])


# ── what the wrapper does: its own functions and the wrapper itself, run ───────────────────────────────────────────────
def _function(name: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    start = source.index(f"\nfunction {name} {{") + 1
    return source[start : source.index("\n}\n", start) + 3]


def _argv(shell: str, *tail: str) -> list[str]:
    return [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", *tail]


def _run(shell: str, script: str, env: dict | None = None) -> subprocess.CompletedProcess:
    """Runs the script from a file (a script read from the standard input makes PowerShell 7 write terminal codes into the output)."""
    import tempfile

    assert script.isascii()
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "probe.ps1"
        path.write_bytes((UTF8_OUTPUT + script).encode("ascii"))
        # what is read is UTF-8 (the texts have accents): the console of the run is set to it, the output is decoded as it
        return subprocess.run(_argv(shell, "-File", str(path)), capture_output=True, text=True, encoding="utf-8", timeout=180, env=env, stdin=subprocess.DEVNULL)


def _functions() -> str:
    return "\n".join([texts.block(), _function("Get-JhtText"), _function("Format-JhtText"), "$script:JhtCallerLang = $env:JHT_LANG"])


@pytest.mark.parametrize("shell", SHELLS)
def test_every_text_of_the_wrapper_comes_out_of_powershell_exactly_as_the_catalog_has_it(shell):
    """Script = catalog, key by key and language by language: the accents, the apostrophes and the lines, read back by PowerShell."""
    script = _functions() + r"""
foreach ($lang in @('en','it','hu','es','de','fr','pt')) {
  foreach ($key in @(%s)) {
    $text = Get-JhtTextTable $lang $key
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$text)
    [Console]::Out.WriteLine($lang + ' ' + $key + ' ' + [Convert]::ToBase64String($bytes))
  }
}
""" % ", ".join(f"'{key}'" for key in texts.keys())
    done = _run(shell, script)
    assert done.returncode == 0, done.stderr
    said = {}
    for line in done.stdout.splitlines():
        lang, key, encoded = line.split(" ", 2)
        said[(lang, key)] = base64.b64decode(encoded).decode("utf-8")
    wanted = {(lang, key): catalog(lang)[texts.catalog_name(key)] for lang in LANGUAGES for key in texts.keys()}
    assert said.keys() == wanted.keys()
    wrong = [pair for pair in wanted if said[pair] != wanted[pair]]
    assert wrong == [], wrong[:5]


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_texts_with_values_put_them_in_every_language(shell, lang):
    english = catalog("en")
    keys = [key for key in texts.keys() if PLACEHOLDER.search(english[texts.catalog_name(key)])]
    lines = [_functions()]
    for key in keys:
        values = " ".join("'ZZVALUE'" if p == "%s" else "4242" for p in PLACEHOLDER.findall(english[texts.catalog_name(key)]))
        lines.append(f"[Console]::Out.WriteLine((Format-JhtText '{key}' {values}))")
    env = {**os.environ, "JHT_LANG": lang, "JHT_HOST_ENV_FILE": str(Path("/nonexistent") / "host.env")}
    done = _run(shell, "\n".join(lines).replace("Get-JhtTextTable (Get-JhtTextLanguage) $Key", f"Get-JhtTextTable '{lang}' $Key"), env)
    assert done.returncode == 0, done.stderr
    said = done.stdout.splitlines()
    assert len(said) == len(keys)
    for line, key in zip(said, keys):
        reference = english[texts.catalog_name(key)]
        assert line.count("ZZVALUE") == reference.count("%s") and line.count("4242") == reference.count("%d"), (key, line)


def _wrapper_env(tmp_path: Path, **extra: str) -> dict:
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True, exist_ok=True)
    base = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "FLEET"))}
    base.update(USERPROFILE=str(home), HOME=str(home), LOCALAPPDATA=str(home / "lad"), JHT_HOST_ENV_FILE=str(home / ".jht" / "host.env"),
                JHT_LANG="")
    base.update(extra)
    return base


def _quoted(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _wrapper(shell: str, tmp_path: Path, *args: str, **extra: str) -> subprocess.CompletedProcess:
    # Windows PowerShell 5.1 writes to a pipe in the OEM code page: the console of the run is set to UTF-8, which is what is read here
    command = UTF8_OUTPUT.strip() + "; & " + _quoted(str(WRAPPER)) + "".join(" " + _quoted(arg) for arg in args) + "; exit $LASTEXITCODE"
    return subprocess.run(_argv(shell, "-Command", command), capture_output=True, text=True, encoding="utf-8", timeout=180,
                          env=_wrapper_env(tmp_path, **extra), stdin=subprocess.DEVNULL)


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_help_of_the_wrapper_is_said_in_the_language_chosen(tmp_path, shell, lang):
    done = _wrapper(shell, tmp_path, "setup", "--help", JHT_LANG=lang)
    assert done.stdout.strip() == catalog(lang)["wrapper.help.setup"].strip(), done.stderr
    done = _wrapper(shell, tmp_path, "integration", "--help", JHT_LANG=lang)
    assert done.stdout.strip() == catalog(lang)["wrapper.help.integration"].strip(), done.stderr


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("lang", LANGUAGES)
def test_an_error_of_the_wrapper_is_said_in_the_language_chosen(tmp_path, shell, lang):
    done = _wrapper(shell, tmp_path, "status", "--nope", JHT_LANG=lang)
    expected = catalog(lang)["wrapper.status.no_options"].replace("%s", "--nope")
    assert done.returncode == 2 and expected in done.stdout + done.stderr, done.stdout + done.stderr
    done = _wrapper(shell, tmp_path, "game", JHT_LANG=lang)
    assert catalog(lang)["wrapper.removed.office"].replace("%s", "game") in done.stdout + done.stderr


@pytest.mark.parametrize("shell", SHELLS)
def test_the_language_the_person_chose_is_kept_from_one_command_to_the_next(tmp_path, shell):
    """The choice is saved in i18n-prefs.json next to host.env; it wins over JHT_LANG of the terminal, the host.env and Windows."""
    prefs = tmp_path / "home" / ".jht" / "i18n-prefs.json"
    prefs.parent.mkdir(parents=True)
    prefs.write_text('{"locale": "de"}', encoding="utf-8")
    done = _wrapper(shell, tmp_path, "status", "--nope", JHT_LANG="it")
    assert catalog("de")["wrapper.status.no_options"].replace("%s", "--nope") in done.stdout + done.stderr
    # no choice saved, another language in the terminal: the terminal's; one the product does not have: English
    prefs.unlink()
    done = _wrapper(shell, tmp_path, "status", "--nope", JHT_LANG="pt")
    assert catalog("pt")["wrapper.status.no_options"].replace("%s", "--nope") in done.stdout + done.stderr
    done = _wrapper(shell, tmp_path, "status", "--nope", JHT_LANG="xx")
    assert catalog("en")["wrapper.status.no_options"].replace("%s", "--nope") in done.stdout + done.stderr


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_uninstall_says_its_usage_and_what_it_loses_in_the_language_chosen(tmp_path, shell, lang):
    done = _wrapper(shell, tmp_path, "uninstall", JHT_LANG=lang)
    said = done.stderr + done.stdout
    assert done.returncode == 2
    assert catalog(lang)["wrapper.uninstall.usage"] in said, said
    assert catalog(lang)["wrapper.ps.uninstall.removal_notice"] in said and catalog(lang)["wrapper.ps.uninstall.purge_notice"] in said, said
