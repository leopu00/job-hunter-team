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
def test_the_welcome_gives_the_real_path_of_the_system_it_runs_on_and_says_the_name_may_be_shown_translated(lang):
    # JHT-T354: the welcome gives the way of the place where the team runs, not the paths of every system together (on a
    # Linux server the person got the Windows path and Finder); each place has its real path, never a translated name
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    # JHT-T360: the folder by its real name, filled when the welcome is written, never «allegati» written in the text
    for kind in ("vps", "linux", "macos"):
        assert "`~/Documents/Job Hunter Team/{attachments}`" in catalog[f"welcome.assistente_file_{kind}"], kind
    assert "`%USERPROFILE%\\Documents\\Job Hunter Team\\{attachments}`" in catalog["welcome.assistente_file_windows"]
    for kind in ("unknown", "vps", "linux", "macos", "windows"):
        assert "allegati" not in catalog[f"welcome.assistente_file_{kind}"], kind
    for kind in ("unknown", "vps", "linux", "macos", "windows"):
        assert not TRANSLATED.search(catalog[f"welcome.assistente_file_{kind}"]), kind
    assert not TRANSLATED.search(catalog["welcome.assistente"])


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistant_prompt_says_the_real_path_and_never_a_translated_name_in_a_path(lang):
    name = "assistente.md" if lang == "en" else f"assistente.{lang}.md"
    text = (ROOT / "agents" / "assistente" / name).read_text(encoding="utf-8")
    # JHT-T360: the name and the path of the person's folders come from team status, never written by hand
    assert "`where.folders.allegati.path`" in text and "`where.folders.allegati.open`" in text
    assert "Job Hunter Team/allegati" not in text and "Job Hunter Team\\allegati" not in text
    local = next(line for line in text.splitlines() if "`where.folders.allegati.open`" in line)
    assert local.index("`where.folders.allegati.open`") < local.index("jht artifact upload"), "the file manager first"
    assert "Dokumente" in text and "Documentos" in text         # named only as what must NOT be written
    assert not TRANSLATED.search(text)


@pytest.mark.parametrize("lang", LANGS)
def test_every_option_label_of_the_onboarding_cards_fits_the_60_characters_a_card_allows(lang):
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    too_long = {k: len(v) for k, v in catalog.items() if re.fullmatch(r"onb\.[a-z_]+\.opt\.[a-z_]+", k) and len(v) > 60}
    assert not too_long


@pytest.mark.parametrize("lang", LANGS)
def test_on_a_computer_of_its_own_the_welcome_gives_the_file_manager_first_and_the_terminal_only_after(lang):
    # JHT-T360: for a person new to terminals, Finder or Explorer first, with a command that makes the folder if it is missing
    # and opens it; the terminal command after, with a placeholder that cannot be taken for a real file name
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    mac, win = catalog["welcome.assistente_file_macos"], catalog["welcome.assistente_file_windows"]
    assert 'mkdir -p "$HOME/Documents/Job Hunter Team/{attachments}" && open "$HOME/Documents/Job Hunter Team/{attachments}"' in mac
    assert 'explorer "$env:USERPROFILE\\Documents\\Job Hunter Team\\{attachments}"' in win and "mkdir -Force" in win
    for text, opener in ((mac, "open "), (win, "explorer ")):
        assert text.index(opener) < text.index("jht artifact upload"), "the file manager first"
        assert re.search(r'jht artifact upload "<[^>]+>\.pdf"', text), "an explicit placeholder"


def _load_welcome(monkeypatch, tmp_path, state, folders_on_disk):
    import importlib.util
    home, user = tmp_path / "home", tmp_path / "user"
    home.mkdir(); user.mkdir()
    for name in folders_on_disk:
        (user / name).mkdir()
    if state is not None:
        (home / "user-folders.json").write_text(json.dumps(state), encoding="utf-8")
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_USER_DIR", str(user))
    spec = importlib.util.spec_from_file_location("assistant_welcome_t360", ROOT / "shared" / "skills" / "assistant_welcome.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "jht_home", lambda: home)
    return mod


@pytest.mark.parametrize("state,on_disk,expected", [
    (None, ["allegati"], "allegati"),
    ({"folders": {"allegati": "mellekletek"}}, ["allegati"], "allegati"),               # not renamed yet: the folder that is there
    ({"folders": {"allegati": "mellekletek"}}, ["mellekletek"], "mellekletek"),
    ({"folders": {"allegati": "mellekletek"}, "mounted": {"allegati": "mellekletek"}}, [], "mellekletek"),
    ({"folders": {"allegati": "../out"}}, ["allegati"], "allegati"),
    ({"mounted": {"allegati": "attachments\n"}}, ["allegati"], "allegati"),
    ({"mounted": {"allegati": "CON"}}, ["allegati"], "allegati"),
    ({"mounted": "broken", "folders": []}, ["allegati"], "allegati"),
    ([], ["allegati"], "allegati"),
])
def test_the_welcome_names_the_folder_that_is_really_there(monkeypatch, tmp_path, state, on_disk, expected):
    mod = _load_welcome(monkeypatch, tmp_path, state, on_disk)
    monkeypatch.setattr(mod, "host_kind", lambda: "macos")
    catalog = json.loads((ROOT / "shared" / "locales" / "hu.json").read_text(encoding="utf-8"))
    text = mod.render_welcome(catalog["welcome.assistente"], lambda key: catalog.get(key))
    assert f"Job Hunter Team/{expected}`" in text and "{attachments}" not in text
