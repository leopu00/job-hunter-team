"""`jht setup` on Windows helps the person choose their timezone (the twin of the host preflight of the .sh, T322).

Resolve-JhtUserTimezone and the functions under it are taken out of the wrapper and run in PowerShell (7 here, 5.1 and 7 on the Windows
gate) with what the person types on the standard input and a host.env of a folder of the test. The computer's zone is `JHT_TZ_LOCAL_ID`
(the Windows id the picker takes for the computer's). What it says is read from the catalogs (host_setup.tz.* and host_setup.timezone_*):
in the 7 languages. The data (shared/data/timezones.txt) is what the wrapper carries inside it.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import timezone_data  # noqa: E402
import wrapper_ps_texts as texts  # noqa: E402
from script_texts import LANGUAGES, catalog  # noqa: E402
from wrapper_ps_texts import UTF8_OUTPUT, say_functions  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
SHELLS = ("powershell", "pwsh")
FUNCTIONS = ("Test-HostEnvValue", "Get-JhtTimezoneLines", "ConvertFrom-JhtTzEscape", "ConvertTo-JhtTzKey", "Add-JhtTzName", "Get-JhtTzIndex",
             "Find-JhtTimezone", "Get-JhtTzNow", "Get-JhtDetectedTimezone", "Get-JhtHostEnvTimezone", "Set-JhtHostEnvTimezone",
             "Read-JhtTzLine", "Format-JhtTzZone", "Resolve-JhtUserTimezone")
ROME, PARIS = "Romance Standard Time", "W. Europe Standard Time"  # the Windows ids of Paris (Europe/Paris) and Berlin (Europe/Berlin)
HOST_ENV = "# Host env for the JHT wrapper\nJHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=UTC\n"


def _shell(name: str) -> str:
    if name == "powershell":
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(os.environ.get("JHT_TEST_PWSH") or "pwsh")
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


def _function(name: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8").replace("\r\n", "\n")
    start = source.index(f"\nfunction {name} {{") + 1
    return source[start : source.index("\n}\n", start) + 3]


def _script(lang: str, setup_args: str) -> str:
    return "\n".join([
        UTF8_OUTPUT, "$ErrorActionPreference = 'Stop'", say_functions(lang), *[_function(name) for name in FUNCTIONS],
        "function Write-Warn { param([string]$Msg) Write-Host \"warn:  $Msg\" }",
        "$HostEnvFile = $env:T_HOST_ENV", "$env:JHT_USER_TZ = 'UTC'",
        f"Resolve-JhtUserTimezone {setup_args}", "'AFTER env=' + $env:JHT_USER_TZ", ""])


class Result:
    def __init__(self, done: subprocess.CompletedProcess, host_env: Path):
        self.out = done.stdout.replace("\r\n", "\n")
        self.err = done.stderr
        self.code = done.returncode
        self.env = re.search(r"^AFTER env=(.*)$", self.out, re.M).group(1) if "AFTER env=" in self.out else None
        self.file = host_env.read_text(encoding="utf-8").replace("\r\n", "\n") if host_env.exists() else None


def _run(shell: str, tmp_path: Path, typed: str, *, local: str | None = None, lang="en", host_env: str | None = HOST_ENV,
         setup_args: str = "@()", redirected_ok: bool = True) -> Result:
    home = tmp_path / "profile" / ".jht"
    home.mkdir(parents=True, exist_ok=True)
    path = home / "host.env"
    if host_env is not None:
        path.write_text(host_env, encoding="utf-8")
    script = tmp_path / "case.ps1"
    script.write_text(_script(lang, setup_args), encoding="ascii")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "FLEET"))}
    env.update(T_HOST_ENV=str(path), JHT_TZ_LOCAL_ID=local if local is not None else "No Such Standard Time")
    if redirected_ok:
        env["JHT_TZ_PROMPT_STDIN"] = "1"
    done = subprocess.run([_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                          input=typed, capture_output=True, text=True, encoding="utf-8", timeout=180, env=env)
    return Result(done, path)


def _say(lang: str, key: str, *values: object) -> str:
    text = catalog(lang)[key]
    for value in values:
        text = re.sub(r"%[sd]", lambda _m, v=value: str(v), text, count=1)
    return text


def _lines(result: Result) -> list[str]:
    return [re.sub(r"\(\d\d:\d\d\)", "(HH:MM)", re.sub(r"now \d\d:\d\d", "now HH:MM", line)) for line in result.out.splitlines()]


@pytest.mark.parametrize("shell", SHELLS)
def test_enter_takes_the_zone_of_the_computer_and_writes_it_keeping_the_rest_of_host_env(shell, tmp_path):
    result = _run(shell, tmp_path, "\n", local=ROME)
    assert result.env == "Europe/Paris"
    assert result.file == "# Host env for the JHT wrapper\nJHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Paris\n"
    assert any(line.startswith("Proposed: Europe/Paris (now ") for line in result.out.splitlines())
    assert "Timezone [Europe/Paris]: " in result.out and "Timezone: Europe/Paris" in result.out


@pytest.mark.parametrize("shell", SHELLS)
def test_a_saved_zone_that_is_the_computers_is_not_asked(shell, tmp_path):
    result = _run(shell, tmp_path, "", local=ROME, host_env=HOST_ENV.replace("UTC", "Europe/Paris"))
    assert result.out.strip() == "AFTER env=UTC", "nothing is said and nothing is changed (the environment is the run's own)"
    assert result.file.endswith("JHT_USER_TZ=Europe/Paris\n")


@pytest.mark.parametrize("shell", SHELLS)
def test_a_saved_zone_that_differs_from_the_detected_is_shown_with_it_and_enter_keeps_the_saved(shell, tmp_path):
    result = _run(shell, tmp_path, "\n", local=ROME, host_env=HOST_ENV.replace("UTC", "Europe/Rome"))
    first = [line for line in _lines(result) if line.startswith("Saved: ")]
    assert first == ["Saved: Europe/Rome (now HH:MM) \u00b7 Detected now: Europe/Paris (now HH:MM)"]
    assert result.env == "Europe/Rome" and result.file.endswith("JHT_USER_TZ=Europe/Rome\n")


@pytest.mark.parametrize("shell", SHELLS)
def test_the_utc_the_installer_wrote_does_not_hold_against_the_computers_zone(shell, tmp_path):
    result = _run(shell, tmp_path, "\n", local=ROME)
    assert result.env == "Europe/Paris", "host.env has UTC, which the installer writes when it cannot tell: the zone of the computer is proposed"


@pytest.mark.parametrize("shell", SHELLS)
def test_nothing_detected_asks_and_a_city_is_found_proposed_and_confirmed_with_enter(shell, tmp_path):
    result = _run(shell, tmp_path, "xyz\nRoma\n\n")
    lines = _lines(result)
    assert "Your timezone was not detected." in lines
    assert _say("en", "host_setup.tz.none", "xyz") in "\n".join(lines)
    assert "Proposed: Europe/Rome (now HH:MM)." in "\n".join(lines)
    assert result.env == "Europe/Rome" and result.file.endswith("JHT_USER_TZ=Europe/Rome\n")
    assert "UTC" not in result.out.split("AFTER")[0].replace("timezone", ""), "UTC is never said as a fallback"


@pytest.mark.parametrize("shell", SHELLS)
def test_a_country_with_more_zones_gives_a_numbered_list_and_a_wrong_number_asks_again(shell, tmp_path):
    result = _run(shell, tmp_path, "Germany\n5\n2\n")
    text = "\n".join(_lines(result))
    assert "  1) Europe/Berlin  (HH:MM)\n  2) Europe/Busingen  (HH:MM)\n" in text
    assert "Number (1-2), or a new search: " in text and "Choose a number between 1 and 2." in text
    assert result.env == "Europe/Busingen" and result.file.endswith("JHT_USER_TZ=Europe/Busingen\n")


@pytest.mark.parametrize("shell", SHELLS)
def test_more_than_9_zones_asks_for_something_more_precise_and_a_new_search_after_a_list_restarts(shell, tmp_path):
    result = _run(shell, tmp_path, "United States\nGermany\nParis\n\n")
    text = "\n".join(_lines(result))
    assert re.search(r"\d\d timezones match \u00abUnited States\u00bb: type something more precise", text)
    assert "Proposed: Europe/Paris" in text and result.env == "Europe/Paris"
    assert "Number (1-2), or a new search: " in text


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("typed, zone", [("Italia", "Europe/Rome"), ("Roma", "Europe/Rome"), ("Deutschland", "Europe/Berlin"), ("Muenchen", "Europe/Berlin"),
                                          ("M\u00fcnchen", "Europe/Berlin"), ("Espa\u00f1a", "Europe/Madrid"), ("Magyarorsz\u00e1g", "Europe/Budapest"),
                                          ("Budapest", "Europe/Budapest"), ("new york", "America/New_York"), ("Europe/Rome", "Europe/Rome"),
                                          ("europe/rome", "Europe/Rome"), ("UTC", "UTC"), ("IT", "Europe/Rome"), ("Tokyo", "Asia/Tokyo"),
                                          ("Mumbai", "Asia/Kolkata"), ("Wien", "Europe/Vienna"), ("Lisboa", "Europe/Lisbon"),
                                          ("Z\u00fcrich", "Europe/Zurich"), ("Mexico City", "America/Mexico_City")])
def test_names_in_the_7_languages_and_in_iana_find_their_zone(shell, tmp_path, typed, zone):
    result = _run(shell, tmp_path, f"{typed}\n\n1\n")
    assert result.env == zone, (typed, result.out)


@pytest.mark.parametrize("shell", SHELLS)
def test_a_single_zone_from_a_name_that_only_starts_like_the_search_is_listed_not_proposed(shell, tmp_path):
    # Pago -> Pago Pago, one zone that is not named exactly: the person picks it by its number, it is not the proposal Enter takes
    result = _run(shell, tmp_path, "Pago\n\n1\n")
    text = "\n".join(_lines(result))
    assert "  1) Pacific/Pago_Pago  (HH:MM)\n" in text and "Number (1-1), or a new search: " in text
    assert "Proposed: Pacific/Pago_Pago" not in text
    assert result.env == "Pacific/Pago_Pago"
    # nothing picked: the input ends, nothing is taken
    ended = _run(shell, tmp_path / "ended", "Pago\n")
    assert ended.env == "UTC" and ended.file == HOST_ENV


@pytest.mark.parametrize("shell", SHELLS)
def test_america_is_the_name_of_a_country_with_many_zones_and_portugal_gives_its_three_zones(shell, tmp_path):
    result = _run(shell, tmp_path, "America\n")
    assert re.search(r"\d\d timezones match \u00abAmerica\u00bb", "\n".join(_lines(result))) and result.env == "UTC"
    result = _run(shell, tmp_path / "pt", "Portugal\n3\n")
    text = "\n".join(_lines(result))
    assert "  1) Europe/Lisbon  (HH:MM)\n  2) Atlantic/Madeira  (HH:MM)\n  3) Atlantic/Azores  (HH:MM)\n" in text
    assert result.env == "Atlantic/Azores"


@pytest.mark.parametrize("shell", SHELLS)
def test_utc_is_chosen_only_by_writing_it_and_an_ended_input_without_a_choice_changes_nothing(shell, tmp_path):
    result = _run(shell, tmp_path, "")
    assert result.env == "UTC" and result.file == HOST_ENV, "the input ended: host.env stays as it was"
    assert catalog("en")["host_setup.timezone_vps_utc"] in result.out, "and the person is told what the team will use and how to set it"
    result = _run(shell, tmp_path / "two", "utc\n")
    assert result.env == "UTC" and "Timezone: UTC" in result.out


@pytest.mark.parametrize("shell", SHELLS)
def test_a_new_search_typed_at_the_number_prompt_is_a_search(shell, tmp_path):
    result = _run(shell, tmp_path, "Germany\nParis\n\n")
    assert result.env == "Europe/Paris"


@pytest.mark.parametrize("shell", SHELLS)
def test_non_interactive_and_a_redirected_input_ask_nothing(shell, tmp_path):
    result = _run(shell, tmp_path / "a", "\n", local=ROME, setup_args="@('--non-interactive', '--provider', 'glm')")
    assert result.out.strip() == "AFTER env=UTC" and result.file == HOST_ENV
    result = _run(shell, tmp_path / "b", "\n", local=ROME, redirected_ok=False)
    assert result.out.strip() == "AFTER env=UTC" and result.file == HOST_ENV


@pytest.mark.parametrize("shell", SHELLS)
def test_without_a_host_env_the_choice_is_for_this_run_and_nothing_is_created(shell, tmp_path):
    result = _run(shell, tmp_path, "\n", local=ROME, host_env=None)
    assert result.env == "Europe/Paris" and result.file is None


@pytest.mark.skipif(os.name == "nt", reason="creating a link needs a privilege on Windows")
@pytest.mark.parametrize("shell", SHELLS)
def test_a_host_env_that_is_a_link_is_not_followed(shell, tmp_path):
    target = tmp_path / "elsewhere.env"
    target.write_text(HOST_ENV, encoding="utf-8")
    home = tmp_path / "profile" / ".jht"
    home.mkdir(parents=True)
    (home / "host.env").symlink_to(target)
    result = _run(shell, tmp_path, "\n", local=ROME, host_env=None)
    assert target.read_text(encoding="utf-8") == HOST_ENV
    assert result.env == "Europe/Paris"


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_person_is_spoken_to_in_the_language_chosen(shell, tmp_path, lang):
    result = _run(shell, tmp_path, "Germany\n2\n", lang=lang)
    out = result.out
    for key, values in (("host_setup.timezone_header", ()), ("host_setup.timezone_explain", ()), ("host_setup.tz.not_detected", ()),
                        ("host_setup.tz.how", ()), ("host_setup.tz.pick", (2,))):
        assert _say(lang, key, *values) in out, (lang, key)
    result = _run(shell, tmp_path / "b", "xyz\nxyz2\n", lang=lang)
    assert _say(lang, "host_setup.tz.none", "xyz") in result.out and _say(lang, "host_setup.tz.none", "xyz2") in result.out


# ── the data and the code that reads it ─────────────────────────────────────────────────────────────────────────────

def test_the_data_in_the_wrapper_is_the_file_of_the_data():
    assert texts.written_timezone_block() == texts.timezone_block(), "run: python3 tests/wrapper_ps_texts.py --write"
    assert all(ord(char) < 128 for char in texts.written_timezone_block()), "ASCII only: Windows PowerShell 5.1 reads a file without a mark as ANSI"


def test_the_file_of_the_data_is_whole():
    table = timezone_data.table()
    zones = {zone for _code, zone in table["Z"]}
    countries = {fields[0] for fields in table["C"]}
    assert len(zones) > 400 and len(countries) > 240
    assert all(len(fields) == 8 for fields in table["C"]), "a country: code and its name in the 7 languages"
    assert {code for code, _zone in table["Z"]} <= countries
    assert all("/" in zone for zone in zones), "every zone has an area and a place: no historic link such as Portugal or Japan"
    assert all(zone in zones for zone, _names in ((f[0], f[1:]) for f in table["X"])), "an alias names a zone that exists"
    assert all(zone in zones or zone == "UTC" for _ident, zone in table["P"]), "a Windows id takes a zone that exists"
    assert dict(table["P"])["W. Europe Standard Time"] == "Europe/Berlin" and dict(table["P"])["India Standard Time"] == "Asia/Kolkata"
    assert dict(table["W"])["Europe/Rome"] == "W. Europe Standard Time"


@pytest.mark.parametrize("shell", SHELLS)
def test_the_keys_of_the_picker_in_powershell_are_the_keys_of_the_data_in_python(shell, tmp_path):
    samples = ["Italia", "M\u00fcnchen", "Magyarorsz\u00e1g", "Espa\u00f1a", "Stra\u00dfe", "S\u00e3o Paulo", "St. Lucia", "Cote d'Ivoire", "Z\u00fcrich", "  New   York ",
               "\u0141\u00f3d\u017a", "Kyiv", "\u00c5land", "Sao_Paulo", "America/Argentina/Buenos_Aires", "Cura\u00e7ao", "N\u00fcrnberg", "\u00d8resund"]
    lines = [_function("ConvertTo-JhtTzKey")]
    lines += ["[Console]::Out.WriteLine('KEY=' + (ConvertTo-JhtTzKey '%s'))" % sample.replace("'", "''") for sample in samples]
    script = tmp_path / "keys.ps1"
    script.write_text("\n".join(lines), encoding="utf-8-sig")  # with a mark: Windows PowerShell 5.1 reads the accents as they are
    done = subprocess.run([_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                          capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert done.returncode == 0, done.stderr
    assert [line[4:] for line in done.stdout.splitlines() if line.startswith("KEY=")] == [timezone_data.key(sample) for sample in samples]
