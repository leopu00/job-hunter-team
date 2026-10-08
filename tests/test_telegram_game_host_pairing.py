from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game" / "scripts"
GAME_LOCALES = {
    "it": GAME / "ui_strings.gd",
    "en": GAME / "i18n" / "ui_en.gd",
    "es": GAME / "i18n" / "ui_es.gd",
    "fr": GAME / "i18n" / "ui_fr.gd",
    "de": GAME / "i18n" / "ui_de.gd",
    "hu": GAME / "i18n" / "ui_hu.gd",
    "pt": GAME / "i18n" / "ui_pt.gd",
}


def test_game_shows_host_commands_without_collecting_or_saving_tokens():
    panel = (GAME / "ui" / "section_panel.gd").read_text(encoding="utf-8")
    telegram_ui = panel.split("func _build_telegram()", 1)[1].split(
        "func _on_email_settings_refresh", 1
    )[0]

    for role in ("assistente", "capitano", "mentor"):
        assert role in telegram_ui
    assert "jht telegram status" in telegram_ui
    assert '"jht telegram pair " + role' in telegram_ui
    assert '"jht telegram remove " + role' in telegram_ui
    assert "LineEdit.new()" not in telegram_ui
    assert "save_telegram_bot" not in telegram_ui

    setup = (GAME / "setup" / "setup_service.gd").read_text(encoding="utf-8")
    settings = (GAME / "backend" / "payloads" / "settings.py").read_text(
        encoding="utf-8"
    )
    assert "TELEGRAM_SAVE_PY" not in setup
    assert "save_telegram_bot" not in setup
    assert "bot_token" not in settings
    assert not (GAME / "backend" / "payloads" / "telegram_save.py").exists()
    assert not (GAME / "backend" / "payloads" / "telegram_delete.py").exists()


@pytest.mark.parametrize(("locale", "catalog"), GAME_LOCALES.items())
def test_game_catalog_documents_safe_host_pairing(locale, catalog):
    source = catalog.read_text(encoding="utf-8")
    guide = next(line for line in source.splitlines() if '"tg.guide"' in line)

    assert "jht telegram pair assistente|capitano|mentor" in guide, locale
    assert "JSON" in guide, locale
    assert "stdin" in guide, locale
    assert "~/.jht" in guide, locale
