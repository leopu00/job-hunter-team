"""`jht integration` and `jht linkedin login` say their sentences in the language the person chose, in all 7.

scripts/jht-integration.sh said every sentence in Italian, whatever the language chosen at the setup. Its texts are now a block
inside the script made from shared/locales (tests/integration_texts.py): the script is sourced into the wrapper on the host, where
the catalogs are not. The words of the JSON (`state`, the LinkedIn `reason` codes) stay the same in every language; only the
sentence for the person changes. Checked: the block is the catalogs, key by key; every catalog has every key with the same
placeholders; no sentence is left written by hand; the values are put in in every language; the library itself, run in each
language, says the catalog's text; the error marker keeps the letters of the language.
"""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from integration_texts import TEXTS
from script_texts import LANGUAGES, catalog
from test_integration_command import LIBRARY, host, run, states  # noqa: F401

SOURCE = LIBRARY.read_text(encoding="utf-8")


def _body() -> str:
    """The script without its block of texts and without comments."""
    body = TEXTS._without_block(SOURCE)
    return "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))


def test_the_block_in_the_script_is_the_catalogs():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/integration_texts.py --write"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_catalog_has_every_sentence_with_the_same_placeholders(lang):
    assert TEXTS.problems(lang) == []


def test_no_sentence_for_the_person_is_left_written_by_hand():
    body = _body()
    for key in TEXTS.calls():
        assert catalog("it")[key] not in body, key
    # what is said, is said through itx/itxf (or a value: a JSON line, a code, a name)
    said = re.findall(r'(?:INTEGRATION_WHY|err|info|warn)[ =]"([^\n]*)', body)
    assert len(said) > 50
    for text in said:
        # starts with a text of the catalogs, a value, or what the wrapper said before; never with a word written here
        assert re.match(r'("|\$\(itxf? integration\.|\$INTEGRATION_WHY; \$\(itxf? integration\.|\$2: |id: \$INTEGRATION_IDS"|\$\(integration_foreign )', text), text


def test_the_state_words_and_the_linkedin_codes_are_never_said_through_the_texts():
    body = _body()
    assert not re.search(r"printf '\{\"id\"[^\n]*itx", body)
    # the state is a fixed word in front of the sentence: printf '<word>|%s\n' "$(itx ...)"
    for word in re.findall(r"printf '([a-z_]+)\|%s\\n' \"\$\(itx", body):
        assert word in ("not_installed", "downloading", "ready", "running", "error"), word
    assert "linkedin_fail token_required" in body and "itx integration.linkedin" in body


def _say(lang: str, key: str, english: str, *values: str) -> str:
    script = TEXTS.written_block() + "\n" + "\n".join(
        re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", SOURCE, re.S | re.M).group(0) for name in ("itx", "itxf"))
    script += '\nJHT_SAY_LANG="$1"; shift; itxf "$@"\n'
    return subprocess.run(["bash", "-c", script, "say", lang, key, english, *values], capture_output=True, text=True,
                          timeout=30, check=True).stdout


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_values_are_put_in_in_every_language(lang):
    for key, english in TEXTS.calls().items():
        count = len(re.findall(r"%[sd]", english))
        if not count:
            continue
        values = [str(410 + i) if spec == "%d" else f"VALUE{i}" for i, spec in enumerate(re.findall(r"%[sd]", english))]
        text = _say(lang, key, english, *values)
        for value in values:
            assert value in text, (lang, key, text)
        assert "%" not in text, (lang, key, text)


def test_a_language_without_the_sentence_says_the_english_of_the_call():
    assert _say("xx", "integration.state.not_yet", "not available yet") == "not available yet"
    assert _say("it", "integration.no_such_key", "the english of the call") == "the english of the call"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_library_says_the_catalogs_text_in_each_language(host, lang):
    texts = catalog(lang)
    listing = run(host, "list --json", {"JHT_SAY_LANG": lang})
    assert listing.returncode == 0, listing.stderr
    rows = states(listing)
    assert rows["linkedin-login"] == {"id": "linkedin-login", "state": "not_installed",
                                      "reason": texts["integration.state.linkedin_how"]}
    assert rows["google"]["reason"] == texts["integration.state.not_added"]
    plain = run(host, "status mail", {"JHT_SAY_LANG": lang})
    assert plain.stdout.split()[0] == "mail"
    assert texts["integration.label.not_installed"] in plain.stdout and texts["integration.state.not_added"] in plain.stdout
    unknown = run(host, "status nope", {"JHT_SAY_LANG": lang})
    assert unknown.returncode == 2
    assert unknown.stderr.strip() == "error: " + texts["integration.unknown"].replace("%s", "google telegram mail linkedin-login screen media")
    usage = run(host, "", {"JHT_SAY_LANG": lang})
    assert usage.returncode == 2 and texts["integration.usage"] in usage.stderr


@pytest.mark.parametrize("lang", ["hu", "de", "fr"])
def test_the_error_marker_keeps_the_letters_of_the_language(host, lang):
    marker_dir = host.runtime / "integrations"
    marker_dir.mkdir(mode=0o700)
    texts = catalog(lang)
    sentence = next(texts[key] for key in sorted(TEXTS.calls()) if "%" not in texts[key] and not texts[key].isascii())
    (marker_dir / "mail.error").write_text(sentence + "\n", encoding="utf-8")
    (marker_dir / "mail.error").chmod(0o600)
    rows = states(run(host, "list --json", {"JHT_SAY_LANG": lang}))
    assert rows["mail"] == {"id": "mail", "state": "error", "reason": sentence}


def test_a_marker_line_with_control_characters_loses_them():
    marker = re.search(r"^integration_marker_text\(\) \{[^\n]*\}$", SOURCE, re.M).group(0)
    out = subprocess.run(["bash", "-c", marker + '\nintegration_marker_text "$1"', "m", "a\x1b[31mb\x07c"],
                         capture_output=True, text=True, timeout=30).stdout
    assert out == "a[31mbc"
