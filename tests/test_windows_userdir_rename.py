"""Una rinomina del prodotto non deve creare un nuovo ``user://`` Windows.

Godot usa per default ``config/name`` come ultima componente del percorso.
Quel nome e' anche copy di prodotto: cambiarlo e' legittimo, ma fino a questo
fix significava perdere apparentemente lingua, onboarding, tour e setup perche'
il gioco apriva una cartella vuota. Non migriamo nulla: l'override Windows
riproduce il percorso gia' pubblicato e lo rende indipendente dal display name.
"""

import re
from pathlib import Path, PureWindowsPath


ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / "game" / "project.godot"
HISTORICAL_RELATIVE_DIR = PureWindowsPath(
    "Godot/app_userdata/Job Hunter Team"
)


def application_settings(source: str) -> dict[str, str | bool]:
    """Legge i tipi usati dal contratto nella sola sezione application."""
    section = re.search(
        r"^\[application\]\s*$\n(?P<body>.*?)(?=^\[|\Z)",
        source,
        re.MULTILINE | re.DOTALL,
    )
    assert section, "sezione [application] assente"
    parsed: dict[str, str | bool] = {}
    for raw_line in section.group("body").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(";"):
            continue
        key, separator, raw_value = line.partition("=")
        assert separator, f"setting application non parsabile: {raw_line!r}"
        value = raw_value.strip()
        if value in ("true", "false"):
            parsed[key] = value == "true"
        elif value.startswith('"') and value.endswith('"'):
            parsed[key] = value[1:-1]
        else:
            parsed[key] = value
    return parsed


def setting_for_windows(
    settings: dict[str, str | bool], key: str, default: str | bool
) -> str | bool:
    return settings.get(f"{key}.windows", settings.get(key, default))


def windows_userdir_relative(source: str) -> PureWindowsPath:
    settings = application_settings(source)
    project_name = setting_for_windows(settings, "config/name", "")
    assert isinstance(project_name, str) and project_name
    custom = setting_for_windows(settings, "config/use_custom_user_dir", False)
    if not custom:
        return PureWindowsPath("Godot/app_userdata") / project_name
    custom_name = setting_for_windows(
        settings, "config/custom_user_dir_name", ""
    )
    assert isinstance(custom_name, str)
    return PureWindowsPath(custom_name or project_name)


def test_windows_override_reuses_the_published_directory_without_migration():
    source = PROJECT.read_text(encoding="utf-8")
    settings = application_settings(source)

    assert settings["config/use_custom_user_dir.windows"] is True
    assert (
        settings["config/custom_user_dir_name.windows"]
        == HISTORICAL_RELATIVE_DIR.as_posix()
    )
    assert windows_userdir_relative(source) == HISTORICAL_RELATIVE_DIR

    # Il fix e' solo Windows. Un custom dir globale sposterebbe subito i dati
    # Linux/macOS, che hanno casing e parent specifici della piattaforma.
    assert "config/use_custom_user_dir" not in settings
    assert "config/use_custom_user_dir.macos" not in settings
    assert "config/use_custom_user_dir.linuxbsd" not in settings


def test_a_project_rename_reads_the_same_existing_sentinel(tmp_path: Path):
    source = PROJECT.read_text(encoding="utf-8")
    renamed, replacements = re.subn(
        r'^config/name="[^"]+"$',
        'config/name="Renamed Product"',
        source,
        count=1,
        flags=re.MULTILINE,
    )
    assert replacements == 1

    before = windows_userdir_relative(source)
    after = windows_userdir_relative(renamed)
    assert before == after == HISTORICAL_RELATIVE_DIR

    # Modella APPDATA su un filesystem temporaneo: non basta che il test veda
    # due stringhe simili, il processo post-rename deve raggiungere il byte che
    # esisteva gia' prima del rename.
    existing_dir = tmp_path.joinpath(*before.parts)
    existing_dir.mkdir(parents=True)
    sentinel = existing_dir / "existing-user-state.txt"
    sentinel.write_text("keep me", encoding="utf-8")
    reopened = tmp_path.joinpath(*after.parts) / sentinel.name
    assert reopened.read_text(encoding="utf-8") == "keep me"


def test_all_windows_consumers_name_the_same_historical_directory():
    expected_slash = HISTORICAL_RELATIVE_DIR.as_posix()
    expected_backslash = str(HISTORICAL_RELATIVE_DIR)

    installer = (ROOT / "game/installer/windows.nsi").read_text(encoding="utf-8")
    smoke = (ROOT / "scripts/build-windows-installer.ps1").read_text(
        encoding="utf-8"
    )
    wrapper = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")

    assert f'$APPDATA\\{expected_backslash}' in installer
    assert f"'{expected_slash}'" in smoke
    assert f"'{expected_backslash}\\client'" in wrapper
