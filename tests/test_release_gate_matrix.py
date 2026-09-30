"""The release and distribution gate build Tauri 2 on all supported OSes."""

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / ".github" / "workflows" / "release.yml"
DISTRIBUTION = ROOT / ".github" / "workflows" / "game.yml"
EXPECTED_OS = {"windows-2022", "macos-14", "ubuntu-22.04"}


def _load(path: Path) -> dict:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_release_builds_tauri_bundles_on_three_operating_systems() -> None:
    workflow = _load(RELEASE)
    job = workflow["jobs"]["build-desktop"]
    matrix = job["strategy"]["matrix"]["include"]
    assert {row["os"] for row in matrix} == EXPECTED_OS
    args = " ".join(row["args"] for row in matrix)
    for bundle in ("nsis", "dmg", "appimage", "deb"):
        assert bundle in args
    source = RELEASE.read_text(encoding="utf-8")
    assert "npm --prefix desktop test" in source
    assert "cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked" in source
    assert "game/tools/run" not in source
    assert "setup-godot" not in source


def test_distribution_gate_builds_tauri_not_godot() -> None:
    workflow = _load(DISTRIBUTION)
    job = workflow["jobs"]["build-tauri"]
    assert {row["os"] for row in job["strategy"]["matrix"]["include"]} == EXPECTED_OS
    source = DISTRIBUTION.read_text(encoding="utf-8")
    assert "npm run tauri:build" in source
    assert "setup-godot" not in source
    assert '"game/**"' not in source


def test_release_bundle_requires_public_login_configuration() -> None:
    source = RELEASE.read_text(encoding="utf-8")
    assert "vars.VITE_SUPABASE_URL" in source
    assert "vars.VITE_SUPABASE_ANON_KEY" in source
    assert "verify-tauri-login-bundle.py --path desktop/dist" in source
