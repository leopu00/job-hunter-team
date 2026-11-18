"""The installer asks the language before its own lines, not after them.

Giro Linux build11: on a new Linux user the installer said all its lines, «Installation complete!» and «Setup host (preflight)»
in English (the language of the system), and the language was asked only then, by the setup it starts. Now, when that setup
runs right after it in this terminal and nothing was chosen yet, the installer asks first; the answer goes on in JHT_LANG (its
own lines, host.env, the setup) with JHT_LANG_ASKED_BY_INSTALLER, so that host-setup.sh does not ask a second time
(tests/test_host_setup_timezone_choice.py). The reading of the answer is stood in for: no test ever reads /dev/tty.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

from script_texts import catalog

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
SOURCE = INSTALL.read_text(encoding="utf-8")


def _ask(tmp_path: Path, answer: str | None, *, lang_env: str = "en_US.UTF-8", prefs: str | None = None, before: str = "",
         extra: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True, exist_ok=True)
    if prefs:
        (home / ".jht" / "i18n-prefs.json").write_text('{"locale": "%s"}' % prefs, encoding="utf-8")
    # the answer of the person, or a reading that must never happen
    reader = (f"installer_read_answer() {{ printf '%s\\n' '{answer}'; }}" if answer is not None
              else "installer_read_answer() { echo NEVER-ASKED >&2; exit 97; }")
    script = (f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
              "will_auto_onboard() { return 0; }\n" + reader + "\n" + before
              + "installer_ask_language\n"
              "printf '\\nLANG=%s ASKED=%s\\n' \"${JHT_LANG:-}\" \"${JHT_LANG_ASKED_BY_INSTALLER:-}\"\n"
              "ts installer.installation_complete 'Installation complete!'\n")
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home), "LANG": lang_env, **(extra or {})}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30, env=env)


def test_main_asks_the_language_before_any_line_of_the_installer():
    main = re.search(r"^main\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert main.index("installer_ask_language") < main.index("keep_chosen_runtime") < main.index("header")
    assert main.index("installer_ask_language") < main.index("final_message") < main.index("maybe_onboard")


@pytest.mark.parametrize("answer,lang", [("2", "it"), ("5", "de"), ("7", "pt")])
def test_the_answer_is_the_language_of_the_installer_and_of_the_setup_after_it(tmp_path, answer, lang):
    done = _ask(tmp_path, answer)
    assert done.returncode == 0, done.stderr
    assert "Choose your language / Scegli la lingua" in done.stdout
    assert f"LANG={lang} ASKED=1" in done.stdout
    assert done.stdout.rstrip().endswith(catalog(lang)["installer.installation_complete"]), done.stdout


def test_an_empty_answer_is_the_language_of_the_system_and_is_proposed_as_such(tmp_path):
    done = _ask(tmp_path, "", lang_env="fr_FR.UTF-8")
    assert done.returncode == 0, done.stderr
    assert "Choix / Escolha [6]: " in done.stdout
    assert "LANG=fr ASKED=1" in done.stdout and catalog("fr")["installer.installation_complete"] in done.stdout


def test_an_answer_that_is_not_a_number_of_the_list_is_the_language_of_the_system(tmp_path):
    done = _ask(tmp_path, "9", lang_env="es_ES.UTF-8")
    assert "LANG=es ASKED=1" in done.stdout, done.stdout


@pytest.mark.parametrize("case", ["saved", "env", "host_env", "skip_onboard", "pairing", "no_terminal"])
def test_nothing_is_asked_when_the_language_is_chosen_or_no_setup_follows(tmp_path, case):
    before, extra, prefs = "", {}, None
    if case == "saved":
        prefs = "hu"
    elif case == "env":
        extra = {"JHT_LANG": "de"}
    elif case == "host_env":
        before = f'printf "JHT_LANG=es\\n" > "{tmp_path}/home/.jht/host.env"\n'
    elif case == "skip_onboard":
        before = "unset -f will_auto_onboard; JHT_SKIP_ONBOARD=1\n"
    elif case == "pairing":
        before = "PAIRING_TOKEN=pt-0123\n"
    else:
        before = "will_auto_onboard() { return 1; }\n"
    done = _ask(tmp_path, None, prefs=prefs, before=before, extra=extra)
    assert done.returncode == 0, done.stderr
    assert "NEVER-ASKED" not in done.stderr and "Choose your language" not in done.stdout
    assert re.search(r"ASKED=$", done.stdout, re.M), done.stdout
