"""Public download targets must be verified Tauri release assets."""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
DOWNLOADS = (ROOT / "web/lib/download-funnel.ts").read_text(encoding="utf-8")


def test_public_downloads_are_verified_release_assets() -> None:
    expected = set(re.findall(r"--expected-asset ([^ \\\n]+)", WORKFLOW))
    primary_targets = DOWNLOADS.split("export const DOWNLOAD_TARGETS", 1)[1].split(
        "} as const", 1
    )[0]
    targets = set(re.findall(r"RELEASE_BASE}/([^`]+)`", primary_targets))
    assert targets == {
        "job-hunter-team-windows-x64-setup.exe",
        "job-hunter-team-macos-universal.dmg",
        "job-hunter-team-linux-x64.AppImage",
    }
    assert targets <= expected
    assert 'DOWNLOAD_RELEASE_TAG = "v0.4.0"' in DOWNLOADS
    assert "releases/latest/download" not in DOWNLOADS


def test_release_has_linux_debian_alternative() -> None:
    assert "--expected-asset job-hunter-team-linux-x64.deb" in WORKFLOW


def test_godot_is_not_built_or_published() -> None:
    assert "build-game" not in WORKFLOW
    assert "setup-godot" not in WORKFLOW
    assert "game/builds/" not in WORKFLOW
