"""scripts/jht-tools.ps1 says its three lines in the language the wrapper decided, from the block of the 7 languages."""

from __future__ import annotations

import pytest

from script_texts import LANGUAGES
from tools_ps1_texts import TEXTS


def test_the_block_is_the_catalogs_and_ascii():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/tools_ps1_texts.py --write"
    assert TEXTS.written_block().isascii()
    assert set(TEXTS.calls()) == {"integration.state.engine_silent", "integration.tools.tier_not_removed", "integration.tools.usage"}


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_catalog_has_the_three_lines(lang):
    assert TEXTS.problems(lang) == []


def test_no_italian_line_is_left():
    source = TEXTS._without_block(TEXTS.source())
    for text in ("il motore dei container non risponde", "livello del runtime non tolto", "uso: jht tools"):
        assert text not in source
