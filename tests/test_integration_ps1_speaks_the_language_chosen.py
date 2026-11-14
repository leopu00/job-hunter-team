"""On Windows too, `jht integration` and `jht linkedin login` say their sentences in the language chosen, in all 7.

scripts/jht-integration.ps1 said every sentence in Italian. Its texts are now the same keys as scripts/jht-integration.sh
(integration.*), in a block of the 7 languages inside the script made from shared/locales (tests/integration_ps1_texts.py), in
ASCII for Windows PowerShell 5.1. The language is the wrapper's (Get-JhtTextLanguage). The words of the JSON stay the same; the
error marker is read back as UTF-8, with its letters.
"""

from __future__ import annotations

import json
import re
import shutil

import pytest

from integration_ps1_texts import TEXTS
from script_texts import LANGUAGES, catalog

pytestmark_pwsh = pytest.mark.skipif(shutil.which("pwsh") is None and shutil.which("powershell") is None,
                                     reason="needs PowerShell")


def _body() -> str:
    return "\n".join(line for line in TEXTS._without_block(TEXTS.source()).split("\n") if not line.lstrip().startswith("#"))


def test_the_block_is_the_catalogs_and_the_script_is_ascii():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/integration_ps1_texts.py --write"
    assert all(line.isascii() for line in TEXTS.source().split("\n") if not line.lstrip().startswith("#"))


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_catalog_has_every_sentence(lang):
    assert TEXTS.problems(lang) == []


def test_the_same_keys_as_the_bash_script_where_the_words_are_the_same():
    from integration_texts import TEXTS as BASH
    shared = set(TEXTS.calls()) & set(BASH.calls())
    assert len(shared) >= 55 and set(TEXTS.calls()) - shared <= {"integration.engine_log_written"}


def test_no_italian_sentence_is_left_written_by_hand():
    body = _body()
    italian = catalog("it")
    for key in TEXTS.calls():
        if len(italian[key]) > 12:
            assert italian[key] not in body and italian[key].replace("'", "''") not in body, key
    for left in ("creato, container spento", "integrazione sconosciuta", "fino a ", "un volume non si cancella", "non si ferma"):
        assert left not in body, left


@pytestmark_pwsh
@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_library_says_the_catalogs_text_in_each_language(host, lang):
    from test_integration_command_windows import rows, run
    texts = catalog(lang)
    listing = run(host, ["list", "--json"], T_LANG=lang)
    assert listing.returncode == 0, listing.stderr
    found = rows(listing)
    assert found["linkedin-login"] == {"id": "linkedin-login", "state": "not_installed", "reason": texts["integration.state.linkedin_how"]}
    assert found["google"]["reason"] == texts["integration.state.not_added"]
    unknown = run(host, ["status", "nope"], T_LANG=lang)
    assert unknown.returncode == 2
    assert texts["integration.unknown"].replace("%s", "google telegram mail linkedin-login screen media") in unknown.stdout + unknown.stderr


@pytestmark_pwsh
@pytest.mark.parametrize("lang", ["hu", "de", "fr"])
def test_the_error_marker_keeps_the_letters_of_the_language(host, lang):
    from test_integration_command_windows import rows, run
    texts = catalog(lang)
    sentence = next(texts[k] for k in sorted(TEXTS.calls()) if "%" not in texts[k] and not texts[k].isascii())
    first = run(host, ["list", "--json"], T_LANG=lang)  # makes the folder of the markers the way the library wants it
    assert first.returncode == 0, first.stderr
    folder = host.runtime / "integrations"
    if not folder.exists():
        pytest.skip("the library makes the folder of the markers only on an add")
    (folder / "mail.error").write_bytes((sentence + "\n").encode("utf-8"))
    found = rows(run(host, ["list", "--json"], T_LANG=lang))
    assert found["mail"]["reason"] == sentence


# re-exported for the fixture
from test_integration_command_windows import host  # noqa: E402,F401
