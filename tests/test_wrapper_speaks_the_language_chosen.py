"""The jht wrapper speaks the language the person chose, in all 7.

The wrapper had its texts in English and Italian only, and some 220 sentences written by hand in one language (most in
Italian, for a person who chose English too). Every sentence is now `jht_say <key>`, and the texts of the 7 languages are
a block made from shared/locales (keys wrapper.*; tests/wrapper_texts.py), written in the wrapper because it runs on the
host, where the catalogs are not, and reads no file the container can write.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wrapper_texts import LANGUAGES, TEXTS, WRAPPER, catalog, say_functions  # noqa: E402

PLACEHOLDER = re.compile(r"%[sd]")


def test_the_block_in_the_wrapper_is_the_one_made_from_the_catalogs():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/wrapper_texts.py --write"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_text_of_the_wrapper_is_in_the_catalog_of_each_language(lang):
    assert TEXTS.problems(lang) == []


def _without_said(line: str) -> str:
    """The line without its $(jht_say ...), $(jht_say_sentence ...) and $(jht_code_prefix ...) (balanced, quotes and all)."""
    out, i = "", 0
    calls = re.compile(r"\$\((jht_say|jht_say_sentence|jht_code_prefix)\b")
    while True:
        found = calls.search(line, i)
        if not found:
            return out + line[i:]
        out += line[i : found.start()]
        depth, j = 0, found.start() + 1
        while j < len(line):
            depth += {"(": 1, ")": -1}.get(line[j], 0)
            j += 1
            if depth == 0:
                break
        i = j


def test_no_sentence_for_the_person_is_written_by_hand():
    source = TEXTS._without_block(WRAPPER.read_text(encoding="utf-8"))
    left = []
    for number, line in enumerate(source.splitlines(), 1):
        if line.lstrip().startswith("#"):
            continue
        for call in re.finditer(r'\b(err|warn|info|ok|fail)\s+"((?:[^"\\]|\\.)*)"', _without_said(line)):
            # a code in front and values are not words written here
            words = re.sub(r"\$\{[^}]*\}|\$\w+|^[a-z][a-z0-9]*_[a-z0-9_]+: ", "", call.group(2))
            if re.search(r"[A-Za-zàèéìòù]{3,}\W+[A-Za-zàèéìòù]{3,}", words):
                left.append(f"{number}: {line.strip()}")
    assert left == []


def _function(name: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    start = source.index(f"\n{name}() {{") + 1
    return source[start : source.index("\n}\n", start) + 3]


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_texts_with_values_put_them_in_every_language(lang):
    english = catalog("en")
    keys = [key for key in TEXTS.calls() if PLACEHOLDER.search(english.get("wrapper." + key, ""))]
    lines = [say_functions(lang)]
    for key in keys:
        args = " ".join("ZZVALUE" if p == "%s" else "4242" for p in PLACEHOLDER.findall(english["wrapper." + key]))
        lines.append(f"printf '%s\\n' \"$(jht_say {key} {args})\"")
    result = subprocess.run(["bash", "-c", "\n".join(lines)], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0 and not result.stderr, result.stderr
    said = result.stdout.splitlines()
    assert len(said) == len(keys)
    for line, key in zip(said, keys):
        reference = english["wrapper." + key]
        assert line.count("ZZVALUE") == reference.count("%s") and line.count("4242") == reference.count("%d"), (key, line)


@pytest.mark.parametrize("lang", LANGUAGES)
def test_a_text_is_said_in_the_language_chosen(lang):
    expected = catalog(lang)["wrapper.monitor.window_invalid"]
    script = say_functions(lang) + "jht_say monitor.window_invalid"
    result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    assert result.stdout == expected, result.stderr


def test_a_language_with_no_text_and_one_we_do_not_have_read_english():
    english = catalog("en")["wrapper.monitor.window_invalid"]
    for lang in ("xx", ""):
        script = "\n".join([_function("jht_text_en"), _function("jht_say"), f"JHT_SAY_LANG={lang}", "JHT_LANG=", "jht_say monitor.window_invalid"])
        result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
        assert result.stdout == english, (lang, result.stderr)
    # only the English and Italian functions are there (as some tests take them): another language reads English
    script = "\n".join([_function("jht_text_en"), _function("jht_text_it"), _function("jht_say"), "JHT_SAY_LANG=hu", "jht_say monitor.window_invalid"])
    result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    assert result.stdout == english and not result.stderr, result.stderr
