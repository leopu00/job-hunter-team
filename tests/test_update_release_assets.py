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
        "job-hunter-team-macos-universal.dmg",
        "job-hunter-team-linux-x64.AppImage",
    }
    assert targets <= expected
    assert 'DOWNLOAD_RELEASE_TAG = "v0.4.0"' in DOWNLOADS
    assert "releases/latest/download" not in DOWNLOADS


def test_release_has_linux_debian_alternative() -> None:
    assert "--expected-asset job-hunter-team-linux-x64.deb" in WORKFLOW


def test_the_site_links_the_release_of_the_manifest() -> None:
    # the button leads to the release the repository is about to publish, not to an older one
    import json

    manifest = json.loads((ROOT / "release/runtime-image.v1.json").read_text(encoding="utf-8"))
    assert f'DOWNLOAD_RELEASE_TAG = "v{manifest["release_version"]}"' in DOWNLOADS


def test_windows_is_not_in_the_release() -> None:
    # D13: 0.4.0 has no Windows installer: not built, not attached, not expected, not linked
    for built_or_attached in ("windows-2022", "windows-x64-setup", "release-assets/*.exe", "runner.os == 'Windows'"):
        assert built_or_attached not in WORKFLOW, built_or_attached
    assert "nsis" not in WORKFLOW.lower()
    assert "windows-x64" not in DOWNLOADS and ".exe" not in DOWNLOADS
    assert "win-setup" not in DOWNLOADS
    # an installer that shows up among the collected assets stops the release
    assert 'Windows is not part of this release, remove' in WORKFLOW
