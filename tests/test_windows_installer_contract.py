"""The staged Windows installer must stay safe before publication is enabled."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NSI = ROOT / "game" / "installer" / "windows.nsi"
BUILDER = ROOT / "scripts" / "build-windows-installer.ps1"
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
PUBLISH_WORKFLOW = ROOT / ".github" / "workflows" / "publish-signed-release.yml"
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
    assert "MUI_PAGE_DIRECTORY" not in source
    assert "Function AssertSafeInstallDir" in source
    assert "GetFileAttributesW" in source
    assert source.index("Call AssertSafeInstallDir") < source.index(
        'File "..\\builds\\windows\\job-hunter-team.exe"'
    )
    assert source.index("icacls.exe") < source.index(
        'File "${AUTHORITY_DIR}\\jht-windows-update.ps1"'
    )
    assert '"$INSTDIR" /reset /T /C' in source
    assert source.count("Call AssertSafeInstallDir") >= 3


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
        "AuthorityDirectory",
        "Detached release signature must be exactly 384 raw bytes",
        "installer-authority-",
        "Assert-NoReparseAncestors",
        "Initialize-ProtectedDirectory",
        "Assert-ProtectedDirectory",
        "FileSystemAclExtensions",
        "verify_artifact_files",
        "Signed release artifacts changed before packaging",
    ):
        assert seam in source


def test_release_publishes_setup_primary_and_portable_secondary() -> None:
    prepare = RELEASE_WORKFLOW.read_text()
    publish = PUBLISH_WORKFLOW.read_text()
    assert "job-hunter-team-windows-x64-portable.exe" in prepare
    assert "job-hunter-team-windows-x64-setup.exe" not in prepare
    assert publish.index("Decode and verify detached signature") < publish.index(
        "build-windows-installer.ps1 -Version $version"
    )
    assert "-AuthorityDirectory release-assets -Smoke" in publish
    assert "--expected-asset job-hunter-team-windows-x64-setup.exe" in publish
    assert "--expected-asset job-hunter-team-windows-x64-portable.exe" in publish
    assert "contents: read" in publish
    assert publish.count("contents: write") == 1
    assert publish.count("ref: ${{ needs.authorize.outputs.tag_sha }}") == 2
    assert "uses: actions/checkout@v" not in publish
    assert "git rev-list -n 1 '${{ inputs.tag }}'" in publish


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
    assert "tests/test_windows_installer_contract.py" in workflow
    assert "tests/test_windows_update_helper.py" in workflow
    assert "./scripts/build-windows-installer.ps1" not in workflow
    assert "actions/upload-artifact" not in workflow
    assert "uses: actions/checkout@v" not in workflow
    publish = PUBLISH_WORKFLOW.read_text()
    assert "build-windows-installer.ps1 -Version $version" in publish
    assert "-AuthorityDirectory release-assets -Smoke" in publish
