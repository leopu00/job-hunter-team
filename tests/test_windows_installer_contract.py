"""The staged Windows installer must stay safe before publication is enabled."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NSI = ROOT / "game" / "installer" / "windows.nsi"
BUILDER = ROOT / "scripts" / "build-windows-installer.ps1"
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
SMOKE_WORKFLOW = ROOT / ".github" / "workflows" / "windows-installer-smoke.yml"


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


def test_release_does_not_publish_staged_installer_yet() -> None:
    workflow = RELEASE_WORKFLOW.read_text()
    assert "build-windows-installer.ps1" not in workflow
    assert "job-hunter-team-windows-x64-setup.exe" not in workflow
    assert "game/builds/windows/job-hunter-team.exe" in workflow


def test_native_windows_smoke_is_non_publishing() -> None:
    workflow = SMOKE_WORKFLOW.read_text()
    assert "windows-2022" in workflow
    assert "build-windows-installer.ps1 -Version $version -Smoke" in workflow
    assert "actions/upload-artifact" not in workflow
    assert "release.yml" in workflow
