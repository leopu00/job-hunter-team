"""The folder the Assistant names to the user is the real one on disk (`Documents`), never the name Finder or Explorer shows.

On disk the folder is `Documents` on Mac and Windows whatever the language of the system; a translated name in a chat message or in
the welcome sends the user to a path that does not exist.

Run:
    pytest tests/test_assistant_real_folder_path.py -v
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LANGS = ("en", "it", "de", "es", "fr", "pt", "hu")
TRANSLATED = re.compile(r"(Dokumente|Documenti|Documentos|Dokumentumok)[/\\]+Job Hunter Team")


@pytest.mark.parametrize("lang", LANGS)
def test_the_welcome_gives_the_real_path_for_mac_linux_and_windows_and_says_the_name_may_be_shown_translated(lang):
    text = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))["welcome.assistente"]
    assert "`~/Documents/Job Hunter Team/allegati`" in text
    assert "`%USERPROFILE%\\Documents\\Job Hunter Team\\allegati`" in text
    assert not TRANSLATED.search(text)


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistant_prompt_says_the_real_path_and_never_a_translated_name_in_a_path(lang):
    name = "assistente.md" if lang == "en" else f"assistente.{lang}.md"
    text = (ROOT / "agents" / "assistente" / name).read_text(encoding="utf-8")
    assert "`~/Documents/Job Hunter Team/allegati`" in text
    assert "`%USERPROFILE%\\Documents\\Job Hunter Team\\allegati`" in text
    assert "Dokumente" in text and "Documentos" in text         # named only as what must NOT be written
    assert not TRANSLATED.search(text)
