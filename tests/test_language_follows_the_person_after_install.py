"""One language for the person, from the installer to the wrapper.

After an installation with no language chosen yet, an Italian system got English from the wrapper (install.ps1 wrote
JHT_LANG=en in host.env, and the wrapper let it win over the person's JHT_LANG) and an English installer with a few
Italian error lines. The rule is now the CLI's in every piece: the choice saved by the setup (i18n-prefs.json), then
JHT_LANG as the person set it, then host.env, then the system's language, then English.
"""

import os
import subprocess
from pathlib import Path

import pytest

from test_cli_help_never_starts_docker import make_docker_spy, write_trusted_runtime

ROOT = Path(__file__).resolve().parents[1]
INSTALL_SH = ROOT / "scripts" / "install.sh"
INSTALL_PS1 = ROOT / "scripts" / "install.ps1"
WRAPPER_SH = ROOT / "scripts" / "jht-wrapper.sh"
WRAPPER_PS1 = ROOT / "scripts" / "jht-wrapper.ps1"

GAME_IT = "'jht game' e' stato tolto nella 0.4.0 insieme all'ufficio Godot"
GAME_EN = "'jht game' was removed in 0.4.0 with the Godot office"


def _clean_env(home: Path, **extra) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in {"LANG", "LC_ALL", "LC_MESSAGES", "JHT_LANG"}}
    env.update({"HOME": str(home), **extra})
    return env


def _wrapper(tmp_path: Path, *, host_env: str | None = None, prefs: str | None = None, **extra) -> subprocess.CompletedProcess:
    jht_home = tmp_path / ".jht"
    jht_home.mkdir(exist_ok=True)
    if host_env is not None:
        (jht_home / "host.env").write_text(host_env, encoding="utf-8")
    if prefs is not None:
        (jht_home / "i18n-prefs.json").write_text('{"locale": "%s"}' % prefs, encoding="utf-8")
    fake_bin, _log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    env = _clean_env(tmp_path, PATH=f"{fake_bin}:/usr/bin:/bin:/usr/sbin:/sbin", JHT_TEST_DOCKER_LOG=str(tmp_path / "docker-calls.log"))
    env.update(write_trusted_runtime(tmp_path))
    env.update(extra)
    return subprocess.run(["bash", str(WRAPPER_SH), "game"], capture_output=True, text=True, env=env, timeout=60)


@pytest.mark.parametrize(
    "case,host_env,prefs,extra,expected",
    [
        ("an Italian system, nothing chosen, no host.env", None, None, {"LANG": "it_IT.UTF-8"}, GAME_IT),
        ("an English system, nothing chosen", None, None, {"LANG": "en_US.UTF-8"}, GAME_EN),
        ("the person's JHT_LANG wins over the host.env of the installer", "JHT_LANG=en\n", None, {"JHT_LANG": "it"}, GAME_IT),
        ("host.env says the installer's language", "JHT_LANG=it\n", None, {"LANG": "en_US.UTF-8"}, GAME_IT),
        ("the saved choice wins over everything", "JHT_LANG=it\n", "en", {"JHT_LANG": "it", "LANG": "it_IT.UTF-8"}, GAME_EN),
        ("C reads English", None, None, {"LANG": "C.UTF-8"}, GAME_EN),
    ],
)
def test_the_wrapper_speaks_the_language_of_the_person(tmp_path, case, host_env, prefs, extra, expected):
    result = _wrapper(tmp_path, host_env=host_env, prefs=prefs, **extra)
    assert result.returncode == 2, (case, result.stderr)
    assert expected in result.stderr, (case, result.stderr)


def _installer(tmp_path: Path, script: str, **extra) -> str:
    env = _clean_env(tmp_path, PATH="/usr/bin:/bin", JHT_INSTALLER_SOURCE_ONLY="1", **extra)
    result = subprocess.run(["bash", "-c", f'. "{INSTALL_SH}"; {script}'], capture_output=True, text=True, env=env, timeout=30)
    assert result.returncode == 0, result.stderr
    return result.stdout


@pytest.mark.parametrize(
    "prefs,host_env,extra,expected",
    [
        (None, None, {"LANG": "it_IT.UTF-8"}, "it"),
        (None, None, {"LANG": "en_US.UTF-8"}, "en"),
        (None, None, {"LC_ALL": "it_IT.UTF-8", "LANG": "en_US.UTF-8"}, "it"),
        (None, "JHT_LANG=it\n", {"LANG": "en_US.UTF-8"}, "it"),
        (None, "JHT_LANG=en\n", {"JHT_LANG": "it"}, "it"),
        ("en", "JHT_LANG=it\n", {"JHT_LANG": "it", "LANG": "it_IT.UTF-8"}, "en"),
        (None, None, {"LANG": "de_DE.UTF-8"}, "en"),
    ],
)
def test_the_installer_takes_the_language_by_the_rule_of_the_cli(tmp_path, prefs, host_env, extra, expected):
    (tmp_path / ".jht").mkdir()
    if prefs:
        (tmp_path / ".jht" / "i18n-prefs.json").write_text('{"locale": "%s"}' % prefs, encoding="utf-8")
    if host_env:
        (tmp_path / ".jht" / "host.env").write_text(host_env, encoding="utf-8")
    assert _installer(tmp_path, "installer_person_lang", **extra).strip() == expected


def test_an_installation_on_an_italian_system_says_its_lines_in_italian(tmp_path):
    script = 'USE_DOCKER=1; OS=macos; header; step 2 4 "$(tx "Container runtime" "Motore dei container")"; PATH_READY=1; JHT_SKIP_ONBOARD=1; final_message'
    italian = _installer(tmp_path, script, LANG="it_IT.UTF-8")
    for line in ("Motore dei container", "Installazione completata!", "Modalita' container attiva (Podman).", "Prossimi passi:", "Per disinstallare"):
        assert line in italian, line
    for line in ("Installation complete!", "Next steps:", "Container mode active"):
        assert line not in italian, line
    english = _installer(tmp_path, script, LANG="en_US.UTF-8")
    assert "Installation complete!" in english and "Installazione completata!" not in english


def test_the_key_file_warning_follows_the_language_too():
    source = WRAPPER_SH.read_text(encoding="utf-8")
    assert 'warn "$(jht_say keyfile.readable "$host_file")"' in source
    assert "keyfile.readable) printf '%s' \"il file %s lo possono leggere anche altri utenti: chmod 600 sul file.\" ;;" in source


def test_windows_writes_the_language_of_the_person_in_host_env_and_reads_it_by_the_same_rule():
    installer = INSTALL_PS1.read_text(encoding="utf-8")
    assert "JHT_LANG=en\n" not in installer.replace("\r\n", "\n")
    assert "JHT_LANG=$lang" in installer
    person = installer[installer.index("function Get-JhtPersonLanguage"):installer.index("function Write-HostEnv")]
    order = [person.index(p) for p in ("i18n-prefs.json", "$env:JHT_LANG", "Get-UICulture", "return 'en'")]
    assert order == sorted(order)
    wrapper = WRAPPER_PS1.read_text(encoding="utf-8")
    assert wrapper.index("$script:JhtCallerLang = [string]$env:JHT_LANG") < wrapper.index("Get-Content $HostEnvFile")
    text = wrapper[wrapper.index("function Get-JhtTextLanguage"):wrapper.index("function Get-JhtUninstallText")]
    order = [text.index(p) for p in ("i18n-prefs.json", "$caller -cmatch", "$script:JhtHostEnvLang -cmatch", "Get-UICulture", "return 'en'")]
    assert order == sorted(order)
