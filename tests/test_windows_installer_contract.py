"""The staged Windows installer must stay safe before publication is enabled."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NSI = ROOT / "game" / "installer" / "windows.nsi"
BUILDER = ROOT / "scripts" / "build-windows-installer.ps1"
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
SMOKE_WORKFLOW = ROOT / ".github" / "workflows" / "windows-installer-smoke.yml"
DOWNLOAD_CLIENT = ROOT / "web" / "app" / "download" / "DownloadClient.tsx"
DOWNLOAD_FUNNEL = ROOT / "web" / "lib" / "download-funnel.ts"


def test_nsis_uses_stable_per_user_release_name() -> None:
    source = NSI.read_text()
    assert 'OutFile "..\\builds\\windows\\job-hunter-team-windows-x64-setup.exe"' in source
    assert 'InstallDir "$LOCALAPPDATA\\Programs\\Job Hunter Team"' in source
    assert "RequestExecutionLevel user" in source
    assert 'WriteRegStr HKCU "${UNINST_KEY}" "DisplayName"' in source
    assert 'WriteUninstaller "$INSTDIR\\Uninstall.exe"' in source


def test_builder_checks_metadata_hash_install_and_uninstall() -> None:
    source = BUILDER.read_text()
    for seam in (
        "VERSION_NUMERIC",
        "Get-FileHash",
        "ProductVersion",
        "FileVersion",
        "Apps & Features DisplayVersion",
        "Installed executable does not match",
        "Silent uninstaller",
    ):
        assert seam in source


def test_release_publishes_setup_primary_and_portable_secondary() -> None:
    workflow = RELEASE_WORKFLOW.read_text()
    assert "build-windows-installer.ps1 -Version $version -Smoke" in workflow
    assert "job-hunter-team-windows-x64-setup.exe" in workflow
    assert "job-hunter-team-windows-x64-portable.exe" in workflow
    assert "--expected-asset job-hunter-team-windows-x64-setup.exe" in workflow
    assert "--expected-asset job-hunter-team-windows-x64-portable.exe" in workflow


def test_download_page_prefers_installer_and_labels_portable_alternative() -> None:
    client = DOWNLOAD_CLIENT.read_text()
    funnel = DOWNLOAD_FUNNEL.read_text()

    # The client owns stable local slugs; only the server-side allowlist owns
    # release destinations, so a query parameter can never choose an asset.
    assert 'windows: "win-setup"' in client
    assert 'downloadHref("win-portable", attribution)' in client
    assert (
        '"win-setup": `${RELEASE_BASE}/job-hunter-team-windows-x64-setup.exe`'
        in funnel
    )
    assert (
        '"win-portable": `${RELEASE_BASE}/job-hunter-team-windows-x64-portable.exe`'
        in funnel
    )
    assert 't("dl_windows_portable_label")' in client
    assert 't("dl_windows_portable_link")' in client


def test_native_windows_smoke_is_non_publishing() -> None:
    workflow = SMOKE_WORKFLOW.read_text()
    assert "windows-2022" in workflow
    assert "build-windows-installer.ps1 -Version $version -Smoke" in workflow
    assert "actions/upload-artifact" not in workflow
    assert "release.yml" in workflow
