"""The staged Windows installer must stay safe before publication is enabled."""

import json
import hashlib
import os
import re
import shutil
import stat
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
UPDATE_HELPER = ROOT / "scripts" / "jht-windows-update.ps1"
MUTATING_ACL_RIGHTS = {
    "WriteData",
    "AppendData",
    "WriteExtendedAttributes",
    "WriteAttributes",
    "DeleteSubdirectoriesAndFiles",
    "Delete",
    "ChangePermissions",
    "TakeOwnership",
}


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


def test_acl_mutation_masks_remain_complete_and_in_sync() -> None:
    observed: list[set[str]] = []
    for path in (PREFLIGHT, UPDATE_HELPER, BUILDER):
        source = path.read_text()
        match = re.search(
            r"\$writeMask\s*=(.*?)(?=\n\s*(?:if|foreach)\b)", source, re.DOTALL
        )
        assert match is not None, path
        rights = re.findall(r"FileSystemRights\]::([A-Za-z]+)", match.group(1))
        assert len(rights) == len(MUTATING_ACL_RIGHTS), path
        assert set(rights) == MUTATING_ACL_RIGHTS, path
        observed.append(set(rights))
    assert observed[0] == observed[1] == observed[2]


def test_acl_authority_uses_typed_clr_accessors_in_all_copies() -> None:
    for path in (PREFLIGHT, UPDATE_HELPER, BUILDER):
        source = path.read_text()
        assert re.search(
            r"\.GetOwner\(\s*\[Security\.Principal\.SecurityIdentifier\]\s*\)",
            source,
        ), path
        assert re.search(
            r"\.GetAccessRules\(\s*\$true,\s*\$true,\s*"
            r"\[Security\.Principal\.SecurityIdentifier\]\s*\)",
            source,
        ), path
        ets_acl = r"\$acl\." + r"(?:Owner|Access)\b"
        assert re.search(ets_acl, source) is None, path

    security_sources = (
        PREFLIGHT,
        UPDATE_HELPER,
        BUILDER,
        Path(__file__),
        ROOT / "tests" / "test_windows_update_helper.py",
    )
    ets_type = "PSIs" + "Container"
    for path in security_sources:
        assert ets_type not in path.read_text(), path


def _windows_powershell() -> str:
    executable = shutil.which("powershell.exe")
    if not executable:
        pytest.skip("Windows PowerShell 5.1 is unavailable")
    return executable


def _windows_pwsh() -> str:
    executable = shutil.which("pwsh")
    if not executable:
        pytest.skip("PowerShell 7 is unavailable")
    return executable


def _write_powershell_fixture(path: Path, body: str) -> None:
    path.write_text("$ErrorActionPreference='Stop';" + body, encoding="utf-8")


def test_powershell_fixture_writer_is_fail_closed_from_first_instruction(
    tmp_path: Path,
) -> None:
    fixture = tmp_path / "fixture.ps1"
    _write_powershell_fixture(fixture, "[Console]::Out.Write('ok')\n")
    assert fixture.read_text(encoding="utf-8").startswith(
        "$ErrorActionPreference='Stop';"
    )


def _tree_snapshot(root: Path) -> tuple[tuple[object, ...], ...]:
    observed: list[tuple[object, ...]] = []

    def visit(directory: Path) -> None:
        for entry in sorted(os.scandir(directory), key=lambda item: item.name):
            path = Path(entry.path)
            relative = path.relative_to(root).as_posix()
            metadata = entry.stat(follow_symlinks=False)
            is_junction = bool(
                hasattr(os.path, "isjunction") and os.path.isjunction(path)
            )
            if entry.is_symlink() or is_junction:
                observed.append((relative, "reparse", metadata.st_size, metadata.st_nlink))
            elif stat.S_ISDIR(metadata.st_mode):
                observed.append((relative, "directory", metadata.st_nlink))
                visit(path)
            elif stat.S_ISREG(metadata.st_mode):
                observed.append(
                    (
                        relative,
                        "file",
                        metadata.st_size,
                        metadata.st_nlink,
                        hashlib.sha256(path.read_bytes()).hexdigest(),
                    )
                )
            else:
                observed.append((relative, "other", metadata.st_size))

    visit(root)
    return tuple(observed)


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
    _write_powershell_fixture(
        local_acl,
        "$item=[IO.DirectoryInfo]::new($env:JHT_LOCALAPPDATA);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User;"
        "$acl.SetOwner($current);$acl.SetAccessRuleProtection($true,$false);"
        "foreach($identity in @($acl.GetAccessRules($true,$true,"
        "[Security.Principal.SecurityIdentifier]) | "
        "ForEach-Object {$_.IdentityReference} | "
        "Select-Object -Unique)){$acl.PurgeAccessRules($identity)};"
        "foreach($sid in @($current,"
        "[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),"
        "[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');"
        "$acl.SetAccessRule($rule)};$item.SetAccessControl($acl)\n",
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
    _write_powershell_fixture(
        fixture_owner,
        "$full=[IO.Path]::GetFullPath($env:JHT_OWNER_PATH);"
        "$item=if([IO.Directory]::Exists($full)){[IO.DirectoryInfo]::new($full)}"
        "elseif([IO.File]::Exists($full)){[IO.FileInfo]::new($full)}"
        "else{throw 'owner fixture path is missing'};"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);"
        "$item.SetAccessControl($acl)\n",
    )
    fixture_owner_argv = [
        _windows_powershell(),
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        str(fixture_owner),
    ]
    for owner_path in (
        local,
        local / "Programs",
        install,
        install / "job-hunter-team.exe",
    ):
        fixture_owner_env = environment.copy()
        fixture_owner_env["JHT_OWNER_PATH"] = str(owner_path)
        subprocess.run(fixture_owner_argv, env=fixture_owner_env, check=True)
    acl_snapshot = tmp_path / "snapshot-acl.ps1"
    _write_powershell_fixture(
        acl_snapshot,
        "$full=[IO.Path]::GetFullPath($env:JHT_ACL_PATH);"
        "$item=if([IO.Directory]::Exists($full)){[IO.DirectoryInfo]::new($full)}"
        "elseif([IO.File]::Exists($full)){[IO.FileInfo]::new($full)}"
        "else{throw 'snapshot path is missing'};"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "[Console]::Out.Write($acl.GetSecurityDescriptorSddlForm("
        "[Security.AccessControl.AccessControlSections]::All))\n",
    )
    acl_snapshot_argv = [
        _windows_powershell(),
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        str(acl_snapshot),
    ]

    def security_snapshot(*acl_paths: Path) -> tuple[object, ...]:
        del acl_paths  # Every non-reparse node under LOCALAPPDATA is covered.
        nodes = [local]
        pending = [local]
        while pending:
            directory = pending.pop()
            for entry in sorted(os.scandir(directory), key=lambda item: item.name):
                path = Path(entry.path)
                is_reparse = entry.is_symlink() or bool(
                    hasattr(os.path, "isjunction") and os.path.isjunction(path)
                )
                if is_reparse:
                    continue
                nodes.append(path)
                if entry.is_dir(follow_symlinks=False):
                    pending.append(path)
        digests: list[tuple[str, str, str]] = []
        for acl_path in sorted(nodes, key=lambda item: item.as_posix()):
            snapshot_env = environment.copy()
            snapshot_env["JHT_ACL_PATH"] = str(acl_path)
            raw = subprocess.run(
                acl_snapshot_argv,
                env=snapshot_env,
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            digests.append(
                (
                    "."
                    if acl_path == local
                    else acl_path.relative_to(local).as_posix(),
                    "directory" if acl_path.is_dir() else "file",
                    hashlib.sha256(raw.encode()).hexdigest(),
                )
            )
        return (_tree_snapshot(local), tuple(digests))
    read_acl = tmp_path / "add-read-only-ace.ps1"
    _write_powershell_fixture(
        read_acl,
        "$item=[IO.DirectoryInfo]::new($env:JHT_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow');"
        "$acl.AddAccessRule($rule);$item.SetAccessControl($acl)\n",
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
    before_security = security_snapshot(install)
    rejected = _run_preflight(install, "Prepare", environment)
    assert rejected.returncode != 0
    assert security_snapshot(install) == before_security
    assert sentinel.read_bytes() == b"must-not-change"
    helper.unlink()
    helper.write_bytes(b"restored\n")

    victim = local / "junction-victim"
    victim.mkdir()
    marker = victim / "marker"
    marker.write_bytes(b"must-not-change")
    junction = install / "hostile-junction"
    fixture = tmp_path / "make-junction.ps1"
    _write_powershell_fixture(
        fixture,
        "New-Item -ItemType $env:JHT_LINK_TYPE -Path $env:JHT_LINK "
        "-Target $env:JHT_TARGET | Out-Null\n",
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
    before_security = security_snapshot(install)
    rejected = _run_preflight(install, "Prepare", environment)
    assert rejected.returncode != 0
    assert security_snapshot(install) == before_security
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
        before_security = security_snapshot(install)
        rejected = _run_preflight(install, "Prepare", environment)
        assert rejected.returncode != 0
        assert security_snapshot(install) == before_security
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
    _write_powershell_fixture(
        set_owner,
        "$item=[IO.FileInfo]::new($env:JHT_OWNER_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$sid=if($env:JHT_OWNER_MODE -ceq 'current'){"
        "[Security.Principal.WindowsIdentity]::GetCurrent().User"
        "}else{[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')};"
        "$acl.SetOwner($sid);"
        "$item.SetAccessControl($acl)\n",
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
    before_security = security_snapshot(install, owner_sentinel)
    rejected = _run_preflight(install, "Prepare", environment)
    assert rejected.returncode != 0
    assert security_snapshot(install, owner_sentinel) == before_security
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
    _write_powershell_fixture(
        foreign_acl,
        "$item=[IO.DirectoryInfo]::new($env:JHT_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$sid,$env:JHT_ACL_RIGHTS,'ContainerInherit,ObjectInherit','None','Allow');"
        "if($env:JHT_ACL_MODE -ceq 'add'){$acl.AddAccessRule($rule)}"
        "else{$acl.RemoveAccessRuleSpecific($rule)};"
        "$item.SetAccessControl($acl)\n",
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
        before_security = security_snapshot(install)
        rejected = _run_preflight(install, "Prepare", environment)
        assert rejected.returncode != 0
        assert security_snapshot(install) == before_security
        assert "installer node grants write to another principal" in rejected.stderr
        assert (install / "job-hunter-team.exe").read_bytes() == (
            b"job-hunter-team.exe\n"
        )
        acl_env["JHT_ACL_MODE"] = "remove"
        subprocess.run(acl_argv, env=acl_env, check=True)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows ACL gate")
def test_builder_acl_seam_accepts_read_only_and_rejects_every_mutating_right(
    tmp_path: Path,
) -> None:
    authority = tmp_path / "publish authority ';&$()"
    acl_fixture = tmp_path / "builder-acl-fixture.ps1"
    _write_powershell_fixture(
        acl_fixture,
        "$item=[IO.DirectoryInfo]::new($env:JHT_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User;"
        "$foreign=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
        "if($env:JHT_ACL_MODE -ceq 'sddl'){"
        "[Console]::Out.Write($acl.GetSecurityDescriptorSddlForm("
        "[Security.AccessControl.AccessControlSections]::All));exit 0};"
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
        "$foreign,$env:JHT_ACL_RIGHTS,'ContainerInherit,ObjectInherit','None','Allow');"
        "if($env:JHT_ACL_MODE -ceq 'add'){$acl.AddAccessRule($rule)}"
        "elseif($env:JHT_ACL_MODE -ceq 'remove'){"
        "$acl.RemoveAccessRuleSpecific($rule)}else{throw 'unknown fixture mode'};"
        "$item.SetAccessControl($acl)\n",
    )
    environment = os.environ.copy()
    environment["JHT_ACL_PATH"] = str(authority)
    fixture_argv = [
        _windows_powershell(),
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        str(acl_fixture),
    ]

    def fixture(mode: str, rights: str = "") -> subprocess.CompletedProcess[str]:
        fixture_env = environment.copy()
        fixture_env.update(JHT_ACL_MODE=mode, JHT_ACL_RIGHTS=rights)
        return subprocess.run(
            fixture_argv,
            env=fixture_env,
            capture_output=True,
            text=True,
            check=True,
        )

    def builder_acl(mode: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                _windows_pwsh(),
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(BUILDER),
                "-Version",
                "0.0.0",
                "-AuthorityDirectory",
                str(tmp_path),
                "-AclSelfTestMode",
                mode,
                "-AclSelfTestPath",
                str(authority),
            ],
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    initialized = builder_acl("Initialize")
    assert initialized.returncode == 0, initialized.stderr
    assert json.loads(initialized.stdout) == {
        "acl": "protected",
        "mode": "Initialize",
    }
    sentinel = authority / "sentinel"
    sentinel.write_bytes(b"must-not-change")
    fixture("add", "ReadAndExecute")
    before = hashlib.sha256(fixture("sddl").stdout.encode()).hexdigest()
    before_tree = _tree_snapshot(authority)
    accepted = builder_acl("Assert")
    assert accepted.returncode == 0, accepted.stderr
    assert json.loads(accepted.stdout) == {"acl": "protected", "mode": "Assert"}
    assert hashlib.sha256(fixture("sddl").stdout.encode()).hexdigest() == before
    assert _tree_snapshot(authority) == before_tree
    assert sentinel.read_bytes() == b"must-not-change"

    for right in sorted(MUTATING_ACL_RIGHTS):
        fixture("add", right)
        before = hashlib.sha256(fixture("sddl").stdout.encode()).hexdigest()
        before_tree = _tree_snapshot(authority)
        rejected = builder_acl("Assert")
        assert rejected.returncode != 0
        assert "grants write to another principal" in rejected.stderr
        assert hashlib.sha256(fixture("sddl").stdout.encode()).hexdigest() == before
        assert _tree_snapshot(authority) == before_tree
        assert sentinel.read_bytes() == b"must-not-change"
        fixture("remove", right)


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
        "AclSelfTestMode",
        "AclSelfTestPath",
        "FileSystemAclExtensions",
        "verify_artifact_files",
        "Signed release artifacts changed before packaging",
        "Synthetic v0.3.5 baseline unexpectedly has a protected DACL",
        "Silent reinstall exited",
        "Installer accepted a hostile hardlink child",
        "Installer mutated the hardlink sentinel before failing",
    ):
        assert seam in source
    assert source.index("if ($AclSelfTestMode)") < source.index(
        "$root = Split-Path"
    )
    assert "Initialize-ProtectedDirectory $AclSelfTestPath" in source
    assert "$acl.SetOwner($currentSid)" in source
    assert "$verified.GetOwner([Security.Principal.SecurityIdentifier])" in source
    assert "$verified.GetAccessRules(" in source


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
