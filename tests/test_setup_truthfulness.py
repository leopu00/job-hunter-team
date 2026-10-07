"""Contratti di verità durante il setup.

Il run Windows del 2026-08-03 mostrava KPI demo e sedici etichette
``AL LAVORO`` mentre il setup era 1/4 e nessuna sessione LLM esisteva. Fino
all'08/10 questo file sorvegliava soprattutto l'ufficio Godot (game/: badge
della simulazione, stati vuoti, console di setup, upgrade del runtime). Godot è
abbandonato e quei 29 test sono stati tolti con lui; resta l'installer macOS.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _src(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_macos_installer_finds_homebrew_from_finder_path():
    installer = _src("scripts/install.sh")
    block = installer[
        installer.index("install_brew_if_missing()") :
        installer.index("install_colima_macos()")
    ]
    assert "/opt/homebrew/bin/brew /usr/local/bin/brew" in block
    assert 'eval "$("$brew_bin" shellenv)"' in block
