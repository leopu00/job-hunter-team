"""A stalled download of the Podman machine has its own code, from the bridge to the app (JHT-T356, JHT-T352).

`podman machine init` downloads the machine's system image. The bridge stops it only when nothing moves for minutes
(scripts/podman-machine-bridge-selftest.ps1 proves that on Windows) and says so with `podman_machine_download_stalled`.
Before, that stop was `podman_machine_timeout` and every layer said «Podman did not respond, check WSL» while WSL was
fine and the line was slow. Here the chain the code travels is checked link by link: the enabler gives it exit 27,
install.ps1 explains 27, the desktop maps 27 to the code, and the catalog of the app has its words.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODE = "podman_machine_download_stalled"


def _read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def test_the_bridge_stops_a_stalled_init_with_its_own_code_and_exit_124():
    bridge = _read("scripts/podman-machine-bridge.ps1")
    assert "elseif ($stalled) { 'podman_machine_download_stalled' }" in bridge
    # rethrown as it is (never wrapped into podman_machine_command_failed) and still the exit of a stopped command
    assert bridge.count("'podman_machine_timeout', 'podman_machine_download_stalled'") == 2


def test_the_enabler_gives_the_stall_exit_27_and_only_it():
    enabler = _read("scripts/enable-podman-windows-runtime.ps1")
    assert enabler.count("exit 27") == 1
    assert f"if ($why -clike '{CODE}: *') {{ [Console]::Error.WriteLine($why); exit 27 }}" in enabler


def test_install_ps1_explains_27_with_the_connection_first_and_the_catalogs_have_it_in_7_languages():
    installer = _read("scripts/install.ps1")
    case = installer[installer.index("    27 {"):]
    case = case[: case.index("    }\n")]
    assert "installer.windows.podman.download_stalled'" in case and "installer.windows.podman.download_stalled_todo'" in case
    assert "$again" in case
    assert _read("web/public/install.ps1") == installer
    for catalog in sorted((ROOT / "shared" / "locales").glob("*.json")):
        texts = json.loads(catalog.read_text(encoding="utf-8"))
        assert texts.get("installer.windows.podman.download_stalled"), catalog.name
        assert "wsl --status" in texts.get("installer.windows.podman.download_stalled_todo", ""), catalog.name


def test_the_desktop_maps_27_to_the_code_and_the_app_has_its_words():
    rust = _read("desktop/src-tauri/src/windows_runtime.rs")
    assert f'27 => Some("{CODE}")' in rust
    catalog = _read("desktop/src/lib/error-catalog.ts")
    start = catalog.index(f"  {CODE}: copy(")
    entry = catalog[start: catalog.index("  ),", start)]
    english = re.findall(r'"([^"]+)"', entry)[2]
    assert "WSL" not in english, english
    locales = _read("desktop/src/lib/error-catalog.locales.ts")
    assert f'{CODE}: translated("{english}")' in locales
    assert f'"{english}": tr(' in locales
