from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game" / "scripts"


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
