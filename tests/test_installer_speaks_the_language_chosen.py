"""The installer for Mac and Linux says its lines in the person's language, in all 7.

scripts/install.sh said its lines in Italian or English (`tx "english" "italiano"`), and many only in English. Its texts are now
a block inside the script made from shared/locales (tests/installer_texts.py): the installer runs before anything of JHT is on
the computer, often as `curl … | bash`. The language is the rule of the CLI (installer_person_lang): the choice saved by the
setup, JHT_LANG, ~/.jht/host.env, then the system's; on a first install that is the system's. Checked: the block is the catalogs,
key by key; every catalog has every key with the same placeholders; no sentence of two languages is left in the script; the
values are put in in every language; the installer itself, sourced in each language, says the catalog's texts.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

import pytest

from installer_texts import TEXTS
from script_texts import LANGUAGES, catalog

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
SOURCE = INSTALL.read_text(encoding="utf-8")
LOCALE = {"en": "en_US.UTF-8", "it": "it_IT.UTF-8", "hu": "hu_HU.UTF-8", "es": "es_ES.UTF-8", "de": "de_DE.UTF-8",
          "fr": "fr_FR.UTF-8", "pt": "pt_PT.UTF-8"}


def _body() -> str:
    body = TEXTS._without_block(SOURCE)
    return "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))


def test_the_block_in_the_installer_is_the_catalogs():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/installer_texts.py --write, then sync web/public"


def test_the_published_copy_and_the_desktop_digest_follow_it():
    assert (ROOT / "web" / "public" / "install.sh").read_bytes() == INSTALL.read_bytes()
    digest = (ROOT / "desktop" / "src-tauri" / "installer.sha256").read_text(encoding="utf-8").strip()
    assert digest == hashlib.sha256(INSTALL.read_bytes()).hexdigest()


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_catalog_has_every_line_with_the_same_placeholders(lang):
    assert TEXTS.problems(lang) == []


def test_no_line_of_two_languages_is_left_in_the_installer():
    body = _body()
    assert "tx " not in body and "tx()" not in body
    assert not re.search(r'= it \]|"\$lang" = it|_it=|_en=', body)
    for key in TEXTS.calls():
        italian = catalog("it")[key]
        if italian != catalog("en")[key] and len(italian) > 12:
            assert italian not in body, key


def test_the_language_is_one_of_the_7_or_english():
    fn = re.search(r"^installer_person_lang\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert "en|it|hu|es|de|fr|pt) printf '%s\\n' \"$value\"" in fn and "*) printf 'en\\n'" in fn


def _sourced(tmp_path: Path, lang: str, script: str) -> subprocess.CompletedProcess:
    home = tmp_path / lang
    home.mkdir(exist_ok=True)
    return subprocess.run(["bash", "-c", f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n{script}'], capture_output=True, text=True,
                          timeout=30, env={"PATH": "/usr/bin:/bin", "HOME": str(home), "LANG": LOCALE[lang]})


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_values_are_put_in_in_every_language(tmp_path, lang):
    lines = []
    for key, english in TEXTS.calls().items():
        specs = re.findall(r"%[sd]", english)
        if specs:
            values = " ".join(str(410 + i) if spec == "%d" else f"VALUE{i}" for i, spec in enumerate(specs))
            lines.append(f"printf '%s\\n' \"{key}=$(tsf {key} 'x' {values})\"")
    done = _sourced(tmp_path, lang, "\n".join(lines))
    assert done.returncode == 0, done.stderr
    said = dict(line.split("=", 1) for line in done.stdout.splitlines())
    for key, english in TEXTS.calls().items():
        specs = re.findall(r"%[sd]", english)
        if not specs:
            continue
        text = said[key]
        assert text == re.sub(r"%[sd]", "{}", catalog(lang)[key]).format(*(str(410 + i) if s == "%d" else f"VALUE{i}" for i, s in enumerate(specs))), key


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_installer_says_the_catalogs_lines_in_each_language(tmp_path, lang):
    texts = catalog(lang)
    done = _sourced(tmp_path, lang, 'USE_DOCKER=1; OS=macos; header; PATH_READY=1; JHT_SKIP_ONBOARD=1; final_message')
    assert done.returncode == 0, done.stderr
    for key in ("installer.installation_complete", "installer.container_mode_active_podman", "installer.next_steps",
                "installer.mode", "installer.image"):
        assert texts[key] in done.stdout, key
    if lang != "en":
        assert catalog("en")["installer.installation_complete"] not in done.stdout


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_refusal_for_a_docker_install_is_said_in_each_language_with_its_code_for_the_app(tmp_path, lang):
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    (runtime / "container-runtime").write_text("docker\n", encoding="utf-8")
    done = subprocess.run(["bash", "-c", f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nOS=macos\nkeep_chosen_runtime'],
                          capture_output=True, text=True, timeout=30,
                          env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "JHT_RUNTIME_DIR": str(runtime),
                               "LANG": LOCALE[lang]})
    assert done.returncode == 85
    assert done.stderr.startswith("JHT_ERROR runtime_change_requires_migration\n")  # the same code in every language
    texts = catalog(lang)
    expected = texts["installer.migration.refused"].replace("%s", texts["installer.migration.uninstall"], 1).replace("%s", "", 1)
    assert expected in done.stderr


@pytest.mark.parametrize("lang", ["it", "hu", "fr"])
def test_a_choice_saved_by_the_setup_wins_over_the_system(tmp_path, lang):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    (home / ".jht" / "i18n-prefs.json").write_text('{"locale": "%s"}' % lang, encoding="utf-8")
    done = subprocess.run(["bash", "-c", f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nts installer.next_steps "Next steps:"'],
                          capture_output=True, text=True, timeout=30,
                          env={"PATH": "/usr/bin:/bin", "HOME": str(home), "LANG": "en_US.UTF-8"})
    assert done.stdout == catalog(lang)["installer.next_steps"]
