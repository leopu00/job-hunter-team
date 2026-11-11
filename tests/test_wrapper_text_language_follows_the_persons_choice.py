"""The texts of the wrapper (`jht uninstall` and the others) speak the language the person chose, also when host.env says another.

`jht setup --language it` and the language picker save the choice in i18n-prefs.json, next to host.env; the wrapper read the language
for its texts only from host.env (host-values), which a first install leaves at `en`: the uninstall of someone who had chosen Italian
came out in English, and in Italian after a reinstall that had read the saved choice. The tests run the wrapper itself in a made-up
HOME (`jht uninstall` without --confirm prints its usage and touches nothing) and read what the person reads. JHT_LANG, which goes to the
container and into its attestation, stays what host-values says.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SOURCE = WRAPPER.read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")

ITALIAN = "uso: jht uninstall --confirm"
ENGLISH = "usage: jht uninstall --confirm"


def _home(tmp_path: Path, *, host_env: str | None, prefs: str | None) -> Path:
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    if host_env is not None:
        (home / ".jht" / "host.env").write_text(host_env, encoding="utf-8")
    if prefs is not None:
        (home / ".jht" / "i18n-prefs.json").write_text(prefs, encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    docker = bin_dir / "docker"
    docker.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    docker.chmod(0o755)
    return home


def _uninstall_says(tmp_path: Path, home: Path) -> str:
    env = {"HOME": str(home), "PATH": f"{tmp_path / 'bin'}:/usr/bin:/bin"}
    done = subprocess.run(["bash", str(WRAPPER), "uninstall"], capture_output=True, text=True, env=env, timeout=60)
    return done.stdout + done.stderr


HOST_EN = "JHT_HOST_TYPE=local\nJHT_LANG=en\nJHT_USER_TZ=UTC\n"
HOST_IT = HOST_EN.replace("JHT_LANG=en", "JHT_LANG=it")
PREFS_IT = '{\n  "locale": "it"\n}\n'
PREFS_EN = '{\n  "locale": "en"\n}\n'


def test_the_choice_of_the_setup_wins_over_a_host_env_that_says_english(tmp_path):
    out = _uninstall_says(tmp_path, _home(tmp_path, host_env=HOST_EN, prefs=PREFS_IT))
    assert ITALIAN in out and ENGLISH not in out


def test_it_works_before_host_env_exists(tmp_path):
    out = _uninstall_says(tmp_path, _home(tmp_path, host_env=None, prefs=PREFS_IT))
    assert ITALIAN in out


def test_a_choice_of_english_wins_over_an_old_host_env_in_italian(tmp_path):
    out = _uninstall_says(tmp_path, _home(tmp_path, host_env=HOST_IT, prefs=PREFS_EN))
    assert ENGLISH in out and ITALIAN not in out


@pytest.mark.parametrize("host_env, said", [(HOST_IT, ITALIAN), (HOST_EN, ENGLISH), (None, ENGLISH)])
def test_without_a_saved_choice_host_env_decides_as_before(tmp_path, host_env, said):
    assert said in _uninstall_says(tmp_path, _home(tmp_path, host_env=host_env, prefs=None))


@pytest.mark.parametrize("prefs", [
    '{"locale": "xx"}',
    '{"locale": "it; rm -rf /"}',
    '{"locale": 7}',
    "not json at all",
    "",
    '{"other": "it"}',
    '{"locale": "it"}' + " " * 5000,  # too big to be a preference
])
def test_a_choice_that_is_not_one_of_the_seven_or_too_big_is_ignored(tmp_path, prefs):
    out = _uninstall_says(tmp_path, _home(tmp_path, host_env=HOST_EN, prefs=prefs))
    assert ENGLISH in out and ITALIAN not in out


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root reads any file")
def test_a_file_that_cannot_be_read_falls_back_to_host_env_without_a_word_on_stderr(tmp_path):
    home = _home(tmp_path, host_env=HOST_EN, prefs=PREFS_IT)
    (home / ".jht" / "i18n-prefs.json").chmod(0)
    env = {"HOME": str(home), "PATH": f"{tmp_path / 'bin'}:/usr/bin:/bin"}
    done = subprocess.run(["bash", str(WRAPPER), "uninstall"], capture_output=True, text=True, env=env, timeout=60)
    assert ENGLISH in done.stdout + done.stderr and "Permission denied" not in done.stderr


def test_a_link_in_place_of_the_file_is_not_read(tmp_path):
    home = _home(tmp_path, host_env=HOST_EN, prefs=None)
    target = tmp_path / "elsewhere.json"
    target.write_text(PREFS_IT, encoding="utf-8")
    (home / ".jht" / "i18n-prefs.json").symlink_to(target)
    assert ENGLISH in _uninstall_says(tmp_path, home)


def test_the_language_of_the_container_is_still_the_one_of_host_values_not_the_choice_of_the_texts():
    """JHT_LANG is exported to the compose file and goes into the attestation: only jht_say reads the person's choice."""
    assert re.search(r'^JHT_SAY_LANG="\$\(jht_ui_language\)"$', SOURCE, re.M)
    assert not re.search(r"^export JHT_SAY_LANG", SOURCE, re.M)
    assert re.search(r"^export JHT_LANG$", SOURCE, re.M)
    say = re.search(r"^jht_say\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert "JHT_SAY_LANG" in say
    hashed = SOURCE[SOURCE.index("\nlang=${JHT_LANG:-}"):][:200]
    assert "JHT_SAY_LANG" not in hashed
