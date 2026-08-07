"""The staged Windows installer must stay safe before publication is enabled."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
NSI = ROOT / "game" / "installer" / "windows.nsi"
BUILDER = ROOT / "scripts" / "build-windows-installer.ps1"
PREFLIGHT = ROOT / "scripts" / "jht-windows-install-preflight.ps1"
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
    assert source.index('StrCpy $9 "Prepare"') < source.index(
        'File "${AUTHORITY_DIR}\\jht-windows-update.ps1"'
    )
    assert "icacls.exe" not in source
    assert "-ExecutionPolicy" not in source
    assert 'StrCpy $9 "VerifyInstalled"' in source
    assert source.index('WriteUninstaller "$INSTDIR\\Uninstall.exe"') < source.index(
        'StrCpy $9 "VerifyInstalled"'
    )
    assert source.index('StrCpy $9 "VerifyInstalled"') < source.index(
        'WriteRegStr HKCU "Software\\Job Hunter Team" "InstallDir"'
    )
    assert source.count("Call AssertSafeInstallDir") >= 3


def test_installer_preflight_is_handle_and_acl_fail_closed() -> None:
    source = PREFLIGHT.read_text()
    for seam in (
        "FILE_FLAG_OPEN_REPARSE_POINT",
        "GetFileInformationByHandle",
        "GetFinalPathNameByHandle",
        "NumberOfLinks != 1",
        "installer node has a foreign owner",
        "installer node grants write to another principal",
        "SetAccessRuleProtection($true, $false)",
        "VerifyInstalled",
        "Uninstall.exe",
    ):
        assert seam in source
    assert "Invoke-Expression" not in source
    assert "ExecutionPolicy" not in source
    assert "FileSystemRights]::Modify -bor" not in source
    assert "FileSystemRights]::FullControl -bor" not in source


def _windows_powershell() -> str:
    executable = shutil.which("powershell.exe")
    if not executable:
        pytest.skip("Windows PowerShell 5.1 is unavailable")
    return executable


def _run_preflight(
    install_dir: Path, mode: str, environment: dict[str, str]
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(PREFLIGHT),
            "-Mode",
            mode,
            "-InstallDir",
            str(install_dir),
        ],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.skipif(sys.platform != "win32", reason="Windows ACL/link gate")
def test_installer_preflight_reinstalls_and_rejects_hostile_nodes(
    tmp_path: Path,
) -> None:
    local = tmp_path / "local app data ';&$() with spaces"
    local.mkdir()
    install = local / "Programs" / "Job Hunter Team"
    environment = os.environ.copy()
    environment["LOCALAPPDATA"] = str(local)

    local_acl = tmp_path / "protect-localappdata.ps1"
    local_acl.write_text(
        "$item=[IO.DirectoryInfo]::new($env:JHT_LOCALAPPDATA);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User;"
        "$acl.SetOwner($current);$acl.SetAccessRuleProtection($true,$false);"
        "foreach($sid in @($current,"
        "[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),"
        "[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');"
        "$acl.SetAccessRule($rule)};$item.SetAccessControl($acl)\n",
        encoding="utf-8",
    )
    local_acl_env = environment.copy()
    local_acl_env["JHT_LOCALAPPDATA"] = str(local)
    subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(local_acl),
        ],
        env=local_acl_env,
        check=True,
    )
    install.mkdir(parents=True)
    (install / "job-hunter-team.exe").write_bytes(b"legacy-v0.3.5\n")
    fixture_owner = tmp_path / "set-fixture-owner.ps1"
    fixture_owner.write_text(
        "foreach($path in @($env:JHT_OWNER_PATHS | ConvertFrom-Json)){"
        "$item=Get-Item -LiteralPath $path -Force;"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);"
        "$item.SetAccessControl($acl)}\n",
        encoding="utf-8",
    )
    fixture_owner_env = environment.copy()
    fixture_owner_env["JHT_OWNER_PATHS"] = json.dumps(
        [
            str(local),
            str(local / "Programs"),
            str(install),
            str(install / "job-hunter-team.exe"),
        ]
    )
    subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(fixture_owner),
        ],
        env=fixture_owner_env,
        check=True,
    )
    read_acl = tmp_path / "add-read-only-ace.ps1"
    read_acl.write_text(
        "$item=[IO.DirectoryInfo]::new($env:JHT_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow');"
        "$acl.AddAccessRule($rule);$item.SetAccessControl($acl)\n",
        encoding="utf-8",
    )
    read_acl_env = environment.copy()
    read_acl_env["JHT_ACL_PATH"] = str(install)
    subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(read_acl),
        ],
        env=read_acl_env,
        check=True,
    )
    first = _run_preflight(install, "Prepare", environment)
    assert first.returncode == 0, first.stderr
    second = _run_preflight(install, "Prepare", environment)
    assert second.returncode == 0, second.stderr

    for name in (
        "job-hunter-team.exe",
        "icon.ico",
        "jht-windows-update.ps1",
        "RELEASE-MANIFEST.json",
        "RELEASE-MANIFEST.json.sig",
        "Uninstall.exe",
    ):
        (install / name).write_bytes((name + "\n").encode())
    verified = _run_preflight(install, "VerifyInstalled", environment)
    assert verified.returncode == 0, verified.stderr

    helper = install / "jht-windows-update.ps1"
    helper.unlink()
    sentinel = local / "hardlink-sentinel"
    sentinel.write_bytes(b"must-not-change")
    os.link(sentinel, helper)
    rejected = _run_preflight(install, "Prepare", environment)
    assert rejected.returncode != 0
    assert sentinel.read_bytes() == b"must-not-change"
    helper.unlink()
    helper.write_bytes(b"restored\n")

    victim = local / "junction-victim"
    victim.mkdir()
    marker = victim / "marker"
    marker.write_bytes(b"must-not-change")
    junction = install / "hostile-junction"
    fixture = tmp_path / "make-junction.ps1"
    fixture.write_text(
        "New-Item -ItemType $env:JHT_LINK_TYPE -Path $env:JHT_LINK "
        "-Target $env:JHT_TARGET | Out-Null\n",
        encoding="utf-8",
    )
    fixture_env = environment.copy()
    fixture_env.update(
        JHT_LINK=str(junction), JHT_LINK_TYPE="Junction", JHT_TARGET=str(victim)
    )
    subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(fixture),
        ],
        env=fixture_env,
        check=True,
    )
    rejected = _run_preflight(install, "Prepare", environment)
    assert rejected.returncode != 0
    assert marker.read_bytes() == b"must-not-change"
    assert "installer node is a reparse point" in rejected.stderr
    os.rmdir(junction)

    symlink = install / "hostile-symlink"
    symlink_env = environment.copy()
    symlink_env.update(
        JHT_LINK=str(symlink),
        JHT_LINK_TYPE="SymbolicLink",
        JHT_TARGET=str(marker),
    )
    symlink_created = subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(fixture),
        ],
        env=symlink_env,
        capture_output=True,
        text=True,
        check=False,
    )
    if symlink_created.returncode == 0:
        rejected = _run_preflight(install, "Prepare", environment)
        assert rejected.returncode != 0
        assert "installer node is a reparse point" in rejected.stderr
        assert marker.read_bytes() == b"must-not-change"
        symlink.unlink()
    else:
        # GitHub-hosted Windows can deny symlink creation without Developer
        # Mode. Junction above must still have exercised the single shared
        # FILE_ATTRIBUTE_REPARSE_POINT rejection branch.
        source = PREFLIGHT.read_text()
        assert source.count("FILE_ATTRIBUTE_REPARSE_POINT) != 0") == 1
        assert marker.read_bytes() == b"must-not-change"

    owner_sentinel = install / "foreign-owner-sentinel"
    owner_sentinel.write_bytes(b"must-not-change")
    set_owner = tmp_path / "set-owner.ps1"
    set_owner.write_text(
        "$item=[IO.FileInfo]::new($env:JHT_OWNER_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$sid=if($env:JHT_OWNER_MODE -ceq 'current'){"
        "[Security.Principal.WindowsIdentity]::GetCurrent().User"
        "}else{[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')};"
        "$acl.SetOwner($sid);"
        "$item.SetAccessControl($acl)\n",
        encoding="utf-8",
    )
    owner_env = environment.copy()
    owner_env.update(JHT_OWNER_MODE="foreign", JHT_OWNER_PATH=str(owner_sentinel))
    subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(set_owner),
        ],
        env=owner_env,
        check=True,
    )
    rejected = _run_preflight(install, "Prepare", environment)
    assert rejected.returncode != 0
    assert "installer node has a foreign owner" in rejected.stderr
    assert owner_sentinel.read_bytes() == b"must-not-change"
    owner_env["JHT_OWNER_MODE"] = "current"
    subprocess.run(
        [
            _windows_powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(set_owner),
        ],
        env=owner_env,
        check=True,
    )

    foreign_acl = tmp_path / "set-foreign-ace.ps1"
    foreign_acl.write_text(
        "$item=[IO.DirectoryInfo]::new($env:JHT_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$sid,$env:JHT_ACL_RIGHTS,'ContainerInherit,ObjectInherit','None','Allow');"
        "if($env:JHT_ACL_MODE -ceq 'add'){$acl.AddAccessRule($rule)}"
        "else{$acl.RemoveAccessRuleSpecific($rule)};"
        "$item.SetAccessControl($acl)\n",
        encoding="utf-8",
    )
    acl_env = environment.copy()
    acl_env["JHT_ACL_PATH"] = str(install)
    acl_argv = [
        _windows_powershell(),
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        str(foreign_acl),
    ]
    for rights in ("WriteData", "Delete", "ChangePermissions", "TakeOwnership"):
        acl_env.update(JHT_ACL_MODE="add", JHT_ACL_RIGHTS=rights)
        subprocess.run(acl_argv, env=acl_env, check=True)
        rejected = _run_preflight(install, "Prepare", environment)
        assert rejected.returncode != 0
        assert "installer node grants write to another principal" in rejected.stderr
        assert (install / "job-hunter-team.exe").read_bytes() == (
            b"job-hunter-team.exe\n"
        )
        acl_env["JHT_ACL_MODE"] = "remove"
        subprocess.run(acl_argv, env=acl_env, check=True)


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
        "Synthetic v0.3.5 baseline unexpectedly has a protected DACL",
        "Silent reinstall exited",
        "Installer accepted a hostile hardlink child",
        "Installer mutated the hardlink sentinel before failing",
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
    checkout_blocks = publish.split("uses: actions/checkout@")[1:]
    assert len(checkout_blocks) == 3
    for checkout in checkout_blocks:
        with_block = checkout.split("\n      - ", 1)[0]
        assert "persist-credentials: false" in with_block
    assert publish.count("RELEASE_TAG: ${{ inputs.tag }}") >= 6
    assert 'git rev-list -n 1 "$RELEASE_TAG"' in publish
    assert '--tag "$RELEASE_TAG"' in publish
    for run_block in publish.split("run: |")[1:]:
        run_body = run_block.split("\n      - ", 1)[0]
        assert "${{" not in run_body


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
    assert "scripts/jht-windows-install-preflight.ps1" in workflow
    assert "tests/test_windows_installer_contract.py" in workflow
    assert "tests/test_windows_update_helper.py" in workflow
    assert "./scripts/build-windows-installer.ps1" not in workflow
    assert "actions/upload-artifact" not in workflow
    assert "uses: actions/checkout@v" not in workflow
    publish = PUBLISH_WORKFLOW.read_text()
    assert "build-windows-installer.ps1 -Version $version" in publish
    assert "-AuthorityDirectory release-assets -Smoke" in publish
