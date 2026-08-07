"""Windows PowerShell 5.1 gate for the protected desktop update helper."""

from __future__ import annotations

import os
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from scripts.release_manifest import build_manifest, canonical_bytes
from scripts.release_signing import public_key_id, render_helper


ROOT = Path(__file__).resolve().parents[1]
HELPER_SOURCE = ROOT / "scripts" / "jht-windows-update.ps1"
DESKTOP = "job-hunter-team-windows-x64-portable.exe"
HELPER = "jht-windows-update.ps1"
SPECS = [
    (
        "windows-desktop",
        "windows",
        "x86_64",
        DESKTOP,
        "jht-windows-desktop-v1",
    ),
    (
        "windows-update-helper",
        "windows",
        "x86_64",
        HELPER,
        "jht-windows-update-v1",
    ),
]
EXTRA_ARTIFACTS = {
    "extra-windows-installer": {
        "role": "windows-installer",
        "platform": "windows",
        "arch": "x86_64",
        "filename": "job-hunter-team-windows-x64-setup.exe",
        "protocol": "jht-windows-installer-v1",
    },
    "extra-linux-desktop": {
        "role": "linux-desktop",
        "platform": "linux",
        "arch": "x86_64",
        "filename": "job-hunter-team-linux-x64.tar.gz",
        "protocol": "jht-linux-desktop-v1",
    },
    "extra-macos-desktop": {
        "role": "macos-desktop",
        "platform": "macos",
        "arch": "universal2",
        "filename": "job-hunter-team.zip",
        "protocol": "jht-macos-desktop-v1",
    },
}


def test_helper_source_has_no_remote_or_shell_bootstrap() -> None:
    source = HELPER_SOURCE.read_text()
    producer = (ROOT / "scripts" / "release_manifest.py").read_text()
    assert "__JHT_RELEASE_PUBLIC_KEYS_SPKI_PEM__" in source
    for forbidden in (
        "Invoke-Expression",
        "DownloadString",
        "Invoke-WebRequest",
        "Start-BitsTransfer",
        "cmd.exe",
        "taskkill",
        "Stop-Process",
    ):
        assert forbidden not in source
    for required in (
        "Read-VerifiedManifest",
        "Get-CanonicalManifestText",
        "Assert-ManifestSchema",
        "Acquire-Lock",
        "Get-RecoveryBundle",
        "Restore-OldAuthority",
        "Install-CandidateMetadata",
        "Install-CandidateHelper",
        "ReleaseOwnership",
        "PROC_THREAD_ATTRIBUTE_JOB_LIST",
        "EXTENDED_STARTUPINFO_PRESENT",
        "Get-ObservedProcess",
        "interrupted_commit_completed",
        "committed floor forbids rollback",
    ):
        assert required in source
    assert "Get-Process -ErrorAction SilentlyContinue" not in source
    assert source.index("Write-AtomicJson $FloorPath") < source.index(
        "Install-CandidateHelper $bundle"
    )
    main_dispatch = "if ($Mode -eq 'Recover') { Invoke-Recover } else { Invoke-Apply }"
    assert source.index("Remove-Item -LiteralPath $ResultPath") < source.rindex(
        main_dispatch
    )
    assert "Get-Acl" not in source
    assert "Set-Acl" not in source
    assert "FileSystemRights]::Modify -bor" not in source
    assert "FileSystemRights]::FullControl -bor" not in source
    for mutating_right in (
        "WriteData",
        "AppendData",
        "WriteExtendedAttributes",
        "WriteAttributes",
        "DeleteSubdirectoriesAndFiles",
        "ChangePermissions",
        "TakeOwnership",
    ):
        assert mutating_right in source
    assert (
        "Assert-FileMatchesArtifact $PSCommandPath "
        "(Get-ArtifactByRole $installed.Value $HelperRole)"
    ) in source
    assert "Assert-FileMatchesArtifact $oldHelperPath" not in source
    for forbidden_role in (
        "windows-installer",
        "linux-desktop",
        "macos-desktop",
    ):
        assert forbidden_role not in source
        assert forbidden_role not in producer


pytestmark = pytest.mark.skipif(
    sys.platform != "win32",
    reason="PowerShell 5.1 process/ACL contract is Windows-only",
)


def _powershell() -> str:
    executable = shutil.which("powershell.exe")
    if not executable:
        pytest.skip("Windows PowerShell 5.1 is unavailable")
    return executable


def _run_powershell_command(
    command: str,
    *,
    env_values: dict[str, str],
    check: bool = True,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update(env_values)
    return subprocess.run(
        [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ],
        env=environment,
        check=check,
        capture_output=capture_output,
        text=True,
    )


def test_consumer_uses_file_without_execution_policy_bypass() -> None:
    source = (ROOT / "game/scripts/support/windows_update_client.gd").read_text()
    argv = source[source.index("static func helper_argv"):]
    assert '"-File"' in argv
    assert "ExecutionPolicy" not in argv
    assert "Bypass" not in argv


def test_restricted_execution_policy_fails_closed(tmp_path: Path) -> None:
    probe = tmp_path / "must-not-run.ps1"
    marker = tmp_path / "policy-was-bypassed"
    probe.write_text(
        f"[IO.File]::WriteAllText('{str(marker).replace("'", "''")}', 'bad')\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Restricted",
            "-File",
            str(probe),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert not marker.exists()


def _generate_rsa_pair(directory: Path, prefix: str) -> tuple[Path, Path]:
    openssl = shutil.which("openssl.exe") or shutil.which("openssl")
    if not openssl:
        pytest.skip("OpenSSL is unavailable on the Windows runner")
    private = directory / f"{prefix}-private.pem"
    public = directory / f"{prefix}-public.pem"
    subprocess.run(
        [
            openssl,
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:3072",
            "-out",
            private,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        [openssl, "pkey", "-in", private, "-pubout", "-out", public],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return private, public


@pytest.fixture(scope="module")
def rsa_keys(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    return _generate_rsa_pair(tmp_path_factory.mktemp("windows-helper-rsa"), "release")


def _protect_directory(path: Path) -> None:
    _run_powershell_command(
        "$p=$env:JHT_TEST_ACL_PATH;$item=[IO.DirectoryInfo]::new($p);"
        "$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::All);"
        "$acl.SetAccessRuleProtection($true,$false);"
        "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule("
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User,"
        "'FullControl','ContainerInherit,ObjectInherit','None','Allow');"
        "$acl.SetAccessRule($rule);$item.SetAccessControl($acl)",
        env_values={"JHT_TEST_ACL_PATH": str(path)},
    )


def test_acl_fixture_treats_path_with_spaces_as_data(tmp_path: Path) -> None:
    protected = tmp_path / "protected ';&$() path with spaces"
    protected.mkdir()
    _protect_directory(protected)
    observed = _run_powershell_command(
        "[Console]::Out.Write($env:JHT_TEST_ACL_PATH)",
        env_values={"JHT_TEST_ACL_PATH": str(protected)},
        capture_output=True,
    )
    assert observed.stdout == str(protected)


def _write_signed_manifest(
    *,
    directory: Path,
    version: str,
    private: Path,
    public: Path,
) -> None:
    manifest = build_manifest(
        directory=directory,
        artifact_specs=SPECS,
        key_id=public_key_id(public),
        version=version,
        commit="2" * 40,
        published_at="2026-08-07T12:34:56Z",
    )
    manifest_path = directory / "RELEASE-MANIFEST.json"
    manifest_path.write_bytes(canonical_bytes(manifest))
    openssl = shutil.which("openssl.exe") or shutil.which("openssl")
    assert openssl is not None
    subprocess.run(
        [
            openssl,
            "dgst",
            "-sha256",
            "-sign",
            str(private),
            "-out",
            str(directory / "RELEASE-MANIFEST.json.sig"),
            str(manifest_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _run_verify(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    *,
    candidate_version: str = "0.3.7",
    mutation: str = "none",
    rotation_keys: tuple[Path, Path] | None = None,
    candidate_helper_suffix: bytes = b"",
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    private, public = rsa_keys
    candidate_private, candidate_public = rotation_keys or rsa_keys
    target_dir = tmp_path / "installed"
    target_dir.mkdir()
    _protect_directory(target_dir)
    nonce = "a" * 32
    helper_env = os.environ.copy()
    if mutation in {"bind-root", "bind-descendant"}:
        fake_profile = tmp_path / "profile"
        fake_profile.mkdir()
        helper_env["USERPROFILE"] = str(fake_profile)
        state = fake_profile / ".jht"
        if mutation == "bind-descendant":
            state /= "container-visible"
    elif mutation == "state-junction":
        state = tmp_path / "state"
        junction_target = tmp_path / "state-real"
        junction_target.mkdir()
        _run_powershell_command(
            "New-Item -ItemType Junction -Path $env:JHT_TEST_JUNCTION_PATH "
            "-Target $env:JHT_TEST_JUNCTION_TARGET | Out-Null",
            env_values={
                "JHT_TEST_JUNCTION_PATH": str(state),
                "JHT_TEST_JUNCTION_TARGET": str(junction_target),
            },
        )
    else:
        state = tmp_path / "state"
    transaction = state / nonce
    transaction.mkdir(parents=True)
    if mutation != "state-junction":
        # `%TEMP%` on the hosted runner can grant write to BUILTIN\Users.
        # Production state lives under the owner-protected LOCALAPPDATA root;
        # mirror that authority before the helper's pre-mutation attestation.
        _protect_directory(state)
        _protect_directory(transaction)
    installed_build = tmp_path / "installed-build"
    candidate_build = tmp_path / "candidate-build"
    installed_build.mkdir()
    candidate_build.mkdir()

    ping = Path(os.environ["SystemRoot"]) / "System32" / "ping.exe"
    helper = target_dir / HELPER
    additional = (candidate_public,) if rotation_keys else ()
    render_helper(
        template=HELPER_SOURCE,
        output=helper,
        public_key=public,
        additional_public_keys=additional,
    )
    shutil.copy2(ping, installed_build / DESKTOP)
    shutil.copy2(helper, installed_build / HELPER)
    _write_signed_manifest(
        directory=installed_build,
        version="0.3.6",
        private=private,
        public=public,
    )
    target = target_dir / DESKTOP
    shutil.copy2(installed_build / DESKTOP, target)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json", target_dir)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json.sig", target_dir)

    candidate_bytes = (installed_build / DESKTOP).read_bytes() + b"candidate"
    (candidate_build / DESKTOP).write_bytes(candidate_bytes)
    if rotation_keys:
        render_helper(
            template=HELPER_SOURCE,
            output=candidate_build / HELPER,
            public_key=candidate_public,
        )
    else:
        shutil.copy2(helper, candidate_build / HELPER)
    if candidate_helper_suffix:
        with (candidate_build / HELPER).open("ab") as stream:
            stream.write(candidate_helper_suffix)
    _write_signed_manifest(
        directory=candidate_build,
        version=candidate_version,
        private=candidate_private,
        public=candidate_public,
    )
    candidate = target_dir / f".jht-update-{nonce}.candidate.exe"
    candidate.write_bytes(candidate_bytes)
    shutil.copy2(candidate_build / HELPER, transaction / HELPER)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json", transaction)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json.sig", transaction)
    if mutation == "asset":
        candidate.write_bytes(candidate.read_bytes() + b"tamper")
    elif mutation == "signature":
        signature = transaction / "RELEASE-MANIFEST.json.sig"
        raw = bytearray(signature.read_bytes())
        raw[0] ^= 1
        signature.write_bytes(raw)
    elif mutation == "unsigned":
        (transaction / "RELEASE-MANIFEST.json.sig").unlink()
    elif mutation == "stale-result-before-lock":
        signature = transaction / "RELEASE-MANIFEST.json.sig"
        raw = bytearray(signature.read_bytes())
        raw[0] ^= 1
        signature.write_bytes(raw)
        (transaction / "result.json").write_text(
            json.dumps(
                {
                    "schema": 1,
                    "ok": True,
                    "phase": "committed",
                    "code": "stale",
                    "nonce": nonce,
                    "rolled_back": False,
                }
            )
        )
    elif mutation in EXTRA_ARTIFACTS:
        manifest_path = transaction / "RELEASE-MANIFEST.json"
        manifest = json.loads(manifest_path.read_text())
        entry = dict(EXTRA_ARTIFACTS[mutation])
        entry.update(size=1, sha256="4" * 64)
        manifest["artifacts"].append(entry)
        manifest["artifacts"].sort(
            key=lambda item: (
                item["role"],
                item["platform"],
                item["arch"],
                item["filename"],
            )
        )
        manifest_path.write_bytes(canonical_bytes(manifest))
        openssl = shutil.which("openssl.exe") or shutil.which("openssl")
        assert openssl is not None
        subprocess.run(
            [
                openssl,
                "dgst",
                "-sha256",
                "-sign",
                str(private),
                "-out",
                str(transaction / "RELEASE-MANIFEST.json.sig"),
                str(manifest_path),
            ],
            check=True,
        )
    elif mutation in {"foreign-read-ace", "foreign-write-ace"}:
        rights = "ReadAndExecute" if mutation == "foreign-read-ace" else "Modify"
        _run_powershell_command(
            "$item=[IO.DirectoryInfo]::new($env:JHT_TEST_ACL_PATH);"
            "$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::All);"
            "$sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
            "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
            f"$sid,'{rights}','ContainerInherit,ObjectInherit','None','Allow');"
            "$acl.AddAccessRule($rule);$item.SetAccessControl($acl)",
            env_values={"JHT_TEST_ACL_PATH": str(transaction)},
        )

    process = subprocess.Popen(
        [str(target), "-t", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        command = [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(helper),
            "-Mode",
            "Verify",
            "-TargetPath",
            str(target),
            "-CandidatePath",
            str(candidate),
            "-CandidateHelperPath",
            str(transaction / HELPER),
            "-InstalledManifestPath",
            str(target_dir / "RELEASE-MANIFEST.json"),
            "-InstalledSignaturePath",
            str(target_dir / "RELEASE-MANIFEST.json.sig"),
            "-CandidateManifestPath",
            str(transaction / "RELEASE-MANIFEST.json"),
            "-CandidateSignaturePath",
            str(transaction / "RELEASE-MANIFEST.json.sig"),
            "-StateRoot",
            str(state),
            "-Nonce",
            nonce,
            "-OldPid",
            str(process.pid),
        ]
        result = subprocess.run(
            command,
            text=True,
            capture_output=True,
            timeout=30,
            env=helper_env,
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    return result, target, transaction


def _helper_command(
    *, target: Path, transaction: Path, mode: str, old_pid: int = 1
) -> list[str]:
    state = transaction.parent
    nonce = transaction.name
    return [
        _powershell(),
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        str(target.parent / HELPER),
        "-Mode",
        mode,
        "-TargetPath",
        str(target),
        "-CandidatePath",
        str(target.parent / f".jht-update-{nonce}.candidate.exe"),
        "-CandidateHelperPath",
        str(transaction / HELPER),
        "-InstalledManifestPath",
        str(target.parent / "RELEASE-MANIFEST.json"),
        "-InstalledSignaturePath",
        str(target.parent / "RELEASE-MANIFEST.json.sig"),
        "-CandidateManifestPath",
        str(transaction / "RELEASE-MANIFEST.json"),
        "-CandidateSignaturePath",
        str(transaction / "RELEASE-MANIFEST.json.sig"),
        "-StateRoot",
        str(state),
        "-Nonce",
        nonce,
        "-OldPid",
        str(old_pid),
    ]


def _write_compact_json(path: Path, value: dict[str, object]) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def _helper_result_diagnostic(transaction: Path) -> str:
    result_path = transaction / "result.json"
    if not result_path.is_file():
        return "helper result=missing"
    try:
        frame = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "helper result=malformed"
    if not isinstance(frame, dict):
        return "helper result=wrong-type"
    safe = {
        key: frame.get(key)
        for key in ("schema", "ok", "phase", "code", "rolled_back")
    }
    return "helper result=" + json.dumps(safe, sort_keys=True, separators=(",", ":"))


@pytest.mark.parametrize(
    ("boundary", "install_candidate", "install_metadata", "commit_floor", "promote_helper"),
    [
        ("swap_intent", False, False, False, False),
        ("candidate_installed", True, False, False, False),
        ("metadata_installed", True, True, False, False),
        ("floor_intent", True, True, True, False),
        ("helper_intent", True, True, True, False),
        ("helper_promoted", True, True, True, True),
    ],
)
def test_reboot_recovery_is_idempotent_at_every_promotion_boundary(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    boundary: str,
    install_candidate: bool,
    install_metadata: bool,
    commit_floor: bool,
    promote_helper: bool,
) -> None:
    verified, target, transaction = _run_verify(
        tmp_path,
        rsa_keys,
        candidate_helper_suffix=b"\n# independently signed next helper\n",
    )
    assert verified.returncode == 0, _helper_result_diagnostic(transaction)
    nonce = transaction.name
    state = transaction.parent
    candidate = target.parent / f".jht-update-{nonce}.candidate.exe"
    backup = target.parent / f".jht-update-{nonce}.backup.exe"
    authority_backup = target.parent / f".jht-update-{nonce}.authority-backup"
    installed_helper = target.parent / HELPER
    installed_manifest = target.parent / "RELEASE-MANIFEST.json"
    installed_signature = target.parent / "RELEASE-MANIFEST.json.sig"
    old_bytes = target.read_bytes()
    old_helper_bytes = installed_helper.read_bytes()
    candidate_bytes = candidate.read_bytes()
    candidate_helper_bytes = (transaction / HELPER).read_bytes()
    journal_path = transaction / "journal.json"
    journal = json.loads(journal_path.read_text(encoding="utf-8"))

    if install_candidate:
        shutil.copy2(target, backup)
        shutil.copy2(candidate, target)
        candidate.unlink()
    if install_metadata:
        authority_backup.mkdir()
        _protect_directory(authority_backup)
        shutil.copy2(installed_helper, authority_backup / HELPER)
        shutil.copy2(installed_manifest, authority_backup / "RELEASE-MANIFEST.json")
        shutil.copy2(
            installed_signature,
            authority_backup / "RELEASE-MANIFEST.json.sig",
        )
        shutil.copy2(transaction / "RELEASE-MANIFEST.json", installed_manifest)
        shutil.copy2(
            transaction / "RELEASE-MANIFEST.json.sig", installed_signature
        )
    if commit_floor:
        _write_compact_json(
            state / "committed-floor.json",
            {
                "schema": 1,
                "sequence": int(journal["target_sequence"]),
                "version": str(journal["target_version"]),
            },
        )
    if promote_helper:
        shutil.copy2(transaction / HELPER, installed_helper)

    journal["state"] = "helper_intent" if boundary == "helper_promoted" else boundary
    candidate_process: subprocess.Popen[bytes] | None = None
    try:
        if commit_floor:
            candidate_process = subprocess.Popen(
                [str(target), "-t", "127.0.0.1"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            started = _run_powershell_command(
                "(Get-Process -Id ([int]$env:JHT_TEST_PID) -ErrorAction Stop)."
                "StartTime.ToUniversalTime().Ticks.ToString()",
                env_values={"JHT_TEST_PID": str(candidate_process.pid)},
                capture_output=True,
            ).stdout.strip()
            journal["candidate_pid"] = candidate_process.pid
            journal["candidate_started"] = started
            _write_compact_json(
                transaction / "health.json",
                {
                    "schema": 1,
                    "type": "healthy",
                    "nonce": nonce,
                    "version": str(journal["target_version"]),
                    "exe_path": str(target.resolve()),
                    "exe_sha256": str(journal["candidate_sha256"]),
                    "pid": candidate_process.pid,
                    "process_started_utc_ticks": started,
                },
            )
        _write_compact_json(journal_path, journal)

        recovered = subprocess.run(
            _helper_command(
                target=target,
                transaction=transaction,
                mode="Recover",
            ),
            text=True,
            capture_output=True,
            timeout=45,
        )
        result = json.loads((transaction / "result.json").read_text())
        if commit_floor:
            assert recovered.returncode == 0, _helper_result_diagnostic(transaction)
            assert result["phase"] == "committed"
            assert target.read_bytes() == candidate_bytes
            assert installed_helper.read_bytes() == candidate_helper_bytes
            assert json.loads(journal_path.read_text())["state"] == "committed"
        else:
            assert recovered.returncode != 0, recovered.stderr
            assert result["phase"] in {"rollback", "recovered"}
            assert target.read_bytes() == old_bytes
            assert installed_helper.read_bytes() == old_helper_bytes
            assert json.loads(journal_path.read_text())["state"] == "rolled_back"
    finally:
        if candidate_process and candidate_process.poll() is None:
            candidate_process.kill()


def test_windows_powershell51_verifies_signed_bundle(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    result, target, transaction = _run_verify(tmp_path, rsa_keys)
    assert result.returncode == 0, _helper_result_diagnostic(transaction)
    assert (transaction / "ready.json").is_file()
    ready = json.loads((transaction / "ready.json").read_text())
    assert ready["old_pid"] > 0
    assert str(ready["old_started"]).isdigit()
    assert b"candidate" not in target.read_bytes()


def test_windows_powershell51_rotation_overlap_accepts_new_signed_new_only_helper(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    keys = tmp_path / "rotation-keys"
    keys.mkdir()
    next_keys = _generate_rsa_pair(keys, "next")
    result, target, transaction = _run_verify(
        tmp_path, rsa_keys, rotation_keys=next_keys
    )
    assert result.returncode == 0, _helper_result_diagnostic(transaction)
    assert (transaction / "ready.json").is_file()
    installed_helper = target.parent / HELPER
    candidate_helper = transaction / HELPER
    assert installed_helper.read_text().count("-----BEGIN PUBLIC KEY-----") == (
        candidate_helper.read_text().count("-----BEGIN PUBLIC KEY-----") + 1
    )


def test_windows_powershell51_accepts_foreign_read_only_acl(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    result, _target, transaction = _run_verify(
        tmp_path, rsa_keys, mutation="foreign-read-ace"
    )
    assert result.returncode == 0, _helper_result_diagnostic(transaction)


@pytest.mark.parametrize(
    ("candidate_version", "mutation"),
    [
        ("0.3.7", "asset"),
        ("0.3.7", "signature"),
        ("0.3.7", "unsigned"),
        ("0.3.7", "stale-result-before-lock"),
        ("0.3.7", "extra-windows-installer"),
        ("0.3.7", "extra-linux-desktop"),
        ("0.3.7", "extra-macos-desktop"),
        ("0.3.7", "foreign-write-ace"),
        ("0.3.7", "state-junction"),
        ("0.3.7", "bind-root"),
        ("0.3.7", "bind-descendant"),
        ("0.3.6", "none"),
    ],
)
def test_windows_powershell51_rejects_untrusted_or_replayed_candidate(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    candidate_version: str,
    mutation: str,
) -> None:
    result, target, transaction = _run_verify(
        tmp_path,
        rsa_keys,
        candidate_version=candidate_version,
        mutation=mutation,
    )
    assert result.returncode != 0
    assert not (transaction / "ready.json").exists()
    assert not (transaction.parent / "committed-floor.json").exists()
    assert not (transaction.parent / ".update.lock").exists()
    assert b"candidate" not in target.read_bytes()


def test_windows_recovery_reclaims_stale_lock_and_rolls_back_post_switch_crash(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    private, public = rsa_keys
    nonce = "b" * 32
    target_dir = tmp_path / "installed"
    target_dir.mkdir()
    _protect_directory(target_dir)
    state = tmp_path / "state"
    transaction = state / nonce
    transaction.mkdir(parents=True)
    _protect_directory(state)
    _protect_directory(transaction)
    installed_build = tmp_path / "installed-build"
    candidate_build = tmp_path / "candidate-build"
    installed_build.mkdir()
    candidate_build.mkdir()
    system32 = Path(os.environ["SystemRoot"]) / "System32"
    ping = system32 / "ping.exe"
    notepad = system32 / "notepad.exe"
    helper = target_dir / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)

    shutil.copy2(ping, installed_build / DESKTOP)
    shutil.copy2(helper, installed_build / HELPER)
    _write_signed_manifest(
        directory=installed_build,
        version="0.3.6",
        private=private,
        public=public,
    )
    target = target_dir / DESKTOP
    old_bytes = (installed_build / DESKTOP).read_bytes()
    target.write_bytes(old_bytes)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json", target_dir)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json.sig", target_dir)

    shutil.copy2(notepad, candidate_build / DESKTOP)
    shutil.copy2(helper, candidate_build / HELPER)
    _write_signed_manifest(
        directory=candidate_build,
        version="0.3.7",
        private=private,
        public=public,
    )
    candidate = target_dir / f".jht-update-{nonce}.candidate.exe"
    shutil.copy2(candidate_build / DESKTOP, candidate)
    shutil.copy2(candidate_build / HELPER, transaction / HELPER)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json", transaction)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json.sig", transaction)

    old = subprocess.Popen(
        [str(target), "-t", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    candidate_pid = 0
    updater: subprocess.Popen[str] | None = None
    try:
        base = [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(helper),
            "-TargetPath",
            str(target),
            "-CandidatePath",
            str(candidate),
            "-CandidateHelperPath",
            str(transaction / HELPER),
            "-InstalledManifestPath",
            str(target_dir / "RELEASE-MANIFEST.json"),
            "-InstalledSignaturePath",
            str(target_dir / "RELEASE-MANIFEST.json.sig"),
            "-CandidateManifestPath",
            str(transaction / "RELEASE-MANIFEST.json"),
            "-CandidateSignaturePath",
            str(transaction / "RELEASE-MANIFEST.json.sig"),
            "-StateRoot",
            str(state),
            "-Nonce",
            nonce,
            "-OldPid",
            str(old.pid),
        ]
        updater = subprocess.Popen(
            base + ["-Mode", "Apply"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        ready = transaction / "ready.json"
        deadline = time.monotonic() + 15
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert ready.exists(), _helper_result_diagnostic(transaction)
        old.terminate()
        old.wait(timeout=5)

        journal_path = transaction / "journal.json"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if journal_path.exists():
                journal = json.loads(journal_path.read_text())
                if (
                    journal.get("state") == "candidate_installed"
                    and int(journal.get("candidate_pid", 0)) > 0
                ):
                    candidate_pid = int(journal["candidate_pid"])
                    break
            time.sleep(0.05)
        assert candidate_pid > 0
        updater.terminate()
        updater.wait(timeout=5)
        assert not candidate.exists()
        assert (state / ".update.lock").is_dir()

        recovered = subprocess.run(
            base + ["-Mode", "Recover"],
            text=True,
            capture_output=True,
            timeout=30,
        )
        assert recovered.returncode != 0, recovered.stderr
        assert target.read_bytes() == old_bytes
        assert json.loads(journal_path.read_text())["state"] == "rolled_back"
        assert not (state / ".update.lock").exists()
        process_check = _run_powershell_command(
            "if (Get-Process -Id ([int]$env:JHT_TEST_PID) "
            "-ErrorAction SilentlyContinue) { exit 1 }",
            env_values={"JHT_TEST_PID": str(candidate_pid)},
            check=False,
        )
        assert process_check.returncode == 0
    finally:
        if updater and updater.poll() is None:
            updater.kill()
        if old.poll() is None:
            old.kill()
