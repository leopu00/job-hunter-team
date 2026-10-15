"""The explicit Docker -> Podman volume migration is verified and resumable."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

from test_desktop_chat_wrapper import _runtime


ROOT = Path(__file__).resolve().parents[1]
PS_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
IMAGE = "ghcr.io/leopu00/jht@sha256:" + "a" * 64
VOLUMES = (
    "jht-broker-state",
    "jht-secrets",
    "jht-telegram-secrets",
    "jht-telegram-state",
)
POWERSHELL = shutil.which("pwsh") or shutil.which("powershell.exe")


FAKE_ENGINE = r'''#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

engine = "docker" if "docker" in Path(sys.argv[0]).name else "podman"
args = sys.argv[1:]
if engine == "podman" and args[:2] == ["--connection", "jht-podman"]:
    args = args[2:]
root = Path(os.environ["JHT_TEST_MIGRATION_STATE"])
log = Path(os.environ["JHT_TEST_MIGRATION_LOG"])
with log.open("a", encoding="utf-8") as stream:
    stream.write(engine + " " + " ".join(args) + "\n")

def logical_from_args():
    for arg in args:
        if arg.startswith("label=com.docker.compose.volume="):
            return arg.split("=", 2)[-1]
    return ""

def mounted_volume():
    index = args.index("--volume")
    return args[index + 1].split(":", 1)[0]

def directory(volume):
    return root / engine / volume

if args[:2] == ["image", "inspect"]:
    raise SystemExit(0)
if args[:1] == ["ps"]:
    if os.environ.get("JHT_TEST_MIGRATION_RUNNING") == engine: print("running-container")
    raise SystemExit(0)
if args[:3] == ["volume", "ls", "-q"]:
    logical = logical_from_args()
    name = ("host-runtime_" if engine == "docker" else "jht_") + logical
    if directory(name).is_dir(): print(name)
    raise SystemExit(0)
if args[:2] == ["volume", "rm"]:
    shutil.rmtree(directory(args[-1]), ignore_errors=True)
    raise SystemExit(0)
if args[:2] == ["volume", "create"]:
    directory(args[-1]).mkdir(parents=True, exist_ok=True)
    print(args[-1])
    raise SystemExit(0)
if args[:1] != ["run"]:
    raise SystemExit(90)
volume = mounted_volume()
logical = volume.removeprefix("host-runtime_").removeprefix("jht_")
path = directory(volume)
entrypoint = args[args.index("--entrypoint") + 1]
if entrypoint == "/usr/bin/python3":
    count = 0
    aggregate = hashlib.sha256()
    root_stat = path.stat()
    root_owner = f"{root_stat.st_uid}:{root_stat.st_gid}:{root_stat.st_mode & 0o777:o}"
    aggregate.update(b"D\0.\0" + root_owner.encode() + b"\0\0")
    for item in sorted(path.rglob("*"), key=lambda p: p.relative_to(path).as_posix()):
        rel = item.relative_to(path).as_posix()
        metadata = item.stat()
        owner = f"{metadata.st_uid}:{metadata.st_gid}:{metadata.st_mode & 0o777:o}".encode()
        if item.is_dir():
            aggregate.update(b"D\0" + rel.encode() + b"\0" + owner + b"\0\0")
        elif item.is_file():
            digest = hashlib.sha256(item.read_bytes()).hexdigest()
            aggregate.update(b"F\0" + rel.encode() + b"\0" + owner + b"\0" + digest.encode() + b"\0")
            count += 1
        else:
            raise SystemExit(42)
    value = aggregate.hexdigest()
    if engine == "podman" and os.environ.get("JHT_TEST_MIGRATION_MISMATCH") == logical:
        value = "f" * 64
    print(f"{count} {value}")
    raise SystemExit(0)
if entrypoint != "/bin/tar":
    raise SystemExit(91)
if "-cf" in args:
    payload = {p.relative_to(path).as_posix(): p.read_bytes().hex()
               for p in path.rglob("*") if p.is_file()}
    if os.environ.get("JHT_TEST_MIGRATION_INTERRUPT") == logical:
        sys.stdout.buffer.write(b"partial")
        raise SystemExit(130)
    sys.stdout.write(json.dumps(payload))
    raise SystemExit(0)
try:
    payload = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(92)
for relative, content in payload.items():
    target = path / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes.fromhex(content))
raise SystemExit(0)
'''


def _migration_runtime(tmp_path: Path) -> tuple[Path, dict[str, str], Path]:
    wrapper, env, _ = _runtime(tmp_path)
    state = tmp_path / "migration-state"
    log = tmp_path / "migration.log"
    for logical in VOLUMES:
        volume = state / "docker" / f"host-runtime_{logical}"
        volume.mkdir(parents=True)
        (volume / "value.json").write_text(
            json.dumps({"volume": logical, "secret": f"not-in-log-{logical}"}),
            encoding="utf-8",
        )
    bin_dir = tmp_path / "migration-bin"
    bin_dir.mkdir()
    docker = bin_dir / "real-docker"
    podman = bin_dir / "real-podman"
    for path in (docker, podman):
        path.write_text(FAKE_ENGINE, encoding="utf-8")
        path.chmod(0o700)
    env.update(
        {
            "JHT_MIGRATION_DOCKER": str(docker),
            "JHT_MIGRATION_PODMAN": str(podman),
            "JHT_MIGRATION_IMAGE": IMAGE,
            "JHT_TEST_MIGRATION_STATE": str(state),
            "JHT_TEST_MIGRATION_LOG": str(log),
        }
    )
    return wrapper, env, log


def _run(wrapper: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(wrapper), "migrate-runtime", "podman"],
        env=env,
        text=True,
        capture_output=True,
        timeout=20,
        check=False,
    )


SECRETS_LEFT_NOTICE = (
    "contengono ancora le password della posta, gli accessi ai portali e i token di Telegram"
)


def test_posix_migration_streams_verifies_marks_and_is_idempotent(tmp_path: Path):
    wrapper, env, log = _migration_runtime(tmp_path)
    marker = Path(env["JHT_RUNTIME_DIR"]) / ".runtime-migrated-podman"

    first = _run(wrapper, env)
    assert first.returncode == 0, first.stderr
    assert marker.is_file()
    assert marker.stat().st_mode & 0o777 == 0o600
    marker_text = marker.read_text(encoding="utf-8")
    assert "source=docker:host-runtime" in marker_text
    assert "target=podman:jht" in marker_text
    assert all(f"{logical}=1 " in marker_text for logical in VOLUMES)
    # The kept Docker volumes still hold the broker and Telegram secrets.
    assert SECRETS_LEFT_NOTICE in first.stdout + first.stderr
    calls_before = log.read_text(encoding="utf-8")
    assert "--entrypoint /bin/tar" in calls_before
    assert "not-in-log" not in calls_before

    second = _run(wrapper, env)
    assert second.returncode == 0, second.stderr
    assert SECRETS_LEFT_NOTICE in second.stdout + second.stderr
    calls_after = log.read_text(encoding="utf-8")
    assert calls_after.count("--entrypoint /bin/tar") == calls_before.count(
        "--entrypoint /bin/tar"
    )
    assert all(
        (Path(env["JHT_TEST_MIGRATION_STATE"]) / "docker" / f"host-runtime_{logical}").is_dir()
        for logical in VOLUMES
    )


def test_posix_interruption_leaves_no_marker_and_retry_replaces_partial_target(
    tmp_path: Path,
):
    wrapper, env, _ = _migration_runtime(tmp_path)
    marker = Path(env["JHT_RUNTIME_DIR"]) / ".runtime-migrated-podman"
    env["JHT_TEST_MIGRATION_INTERRUPT"] = "jht-secrets"

    interrupted = _run(wrapper, env)
    assert interrupted.returncode == 24
    assert not marker.exists()
    assert "JHT_LEFT jht-secrets" in interrupted.stdout
    assert "JHT_LEFT jht-telegram-state" in interrupted.stdout

    env.pop("JHT_TEST_MIGRATION_INTERRUPT")
    retried = _run(wrapper, env)
    assert retried.returncode == 0, retried.stderr
    assert marker.is_file()


def test_posix_checksum_mismatch_never_publishes_the_marker(tmp_path: Path):
    wrapper, env, _ = _migration_runtime(tmp_path)
    marker = Path(env["JHT_RUNTIME_DIR"]) / ".runtime-migrated-podman"
    env["JHT_TEST_MIGRATION_MISMATCH"] = "jht-broker-state"

    result = _run(wrapper, env)
    assert result.returncode == 24
    assert "runtime_migration_checksum_mismatch" in result.stderr
    assert "JHT_LEFT jht-broker-state" in result.stdout
    assert not marker.exists()


def test_posix_migration_refuses_a_running_source_team(tmp_path: Path):
    wrapper, env, log = _migration_runtime(tmp_path)
    marker = Path(env["JHT_RUNTIME_DIR"]) / ".runtime-migrated-podman"
    env["JHT_TEST_MIGRATION_RUNNING"] = "docker"

    result = _run(wrapper, env)
    assert result.returncode == 24
    assert "runtime_migration_team_running" in result.stderr
    assert "JHT_LEFT jht-broker-state" in result.stdout
    assert "--entrypoint /bin/tar" not in log.read_text(encoding="utf-8")
    assert not marker.exists()


def test_powershell_uses_a_binary_stream_and_the_same_volume_contract():
    source = PS_WRAPPER.read_text(encoding="utf-8")
    for logical in VOLUMES:
        assert f"'{logical}'" in source
    assert "StandardOutput.BaseStream.CopyTo" in source
    assert ".runtime-migrated-podman" in source
    assert "JHT_LEFT $logical" in source
    assert "source=docker:host-runtime" in source
    assert "target=podman:jht" in source
    assert SECRETS_LEFT_NOTICE in source


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell unavailable")
@pytest.mark.parametrize(
    ("scenario", "expected", "marked"),
    (("success", 0, True), ("interrupt", 24, False), ("mismatch", 24, False)),
)
def test_powershell_fake_engines_publish_only_a_fully_verified_marker(
    tmp_path: Path, scenario: str, expected: int, marked: bool
):
    assert POWERSHELL
    engine = tmp_path / ("engine.cmd" if os.name == "nt" else "engine")
    if os.name == "nt":
        engine.write_text(
            "@echo off\r\n"
            "echo %*| %SystemRoot%\\System32\\findstr.exe /c:\"-cf -\" >nul\r\n"
            "if not errorlevel 1 (\r\n"
            "  <nul set /p =partial\r\n"
            "  if \"%JHT_PS_MIGRATION_SCENARIO%\"==\"interrupt\" exit /b 130\r\n"
            "  exit /b 0\r\n"
            ")\r\n"
            "echo %*| %SystemRoot%\\System32\\findstr.exe /c:\"-xf -\" >nul\r\n"
            "if not errorlevel 1 (more >nul & exit /b 0)\r\n"
            "exit /b 0\r\n",
            encoding="ascii",
        )
    else:
        engine.write_text(
            "#!/bin/sh\n"
            "case \" $* \" in\n"
            "  *\" -cf - \"*) printf partial; "
            "[ \"${JHT_PS_MIGRATION_SCENARIO:-}\" != interrupt ] || exit 130 ;;\n"
            "  *\" -xf - \"*) cat >/dev/null ;;\n"
            "esac\n"
            "exit 0\n",
            encoding="ascii",
        )
        engine.chmod(0o700)
    marker = tmp_path / f"{scenario}.marker"
    harness = tmp_path / "harness.ps1"
    harness.write_text(
        r'''
param([string]$Wrapper, [string]$Engine, [string]$Marker, [string]$Scenario)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Wrapper, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw ($errors | Out-String) }
foreach ($name in @('Write-Err', 'Write-Info', 'Write-RuntimeMigrationLeft',
                    'Get-RuntimeMigrationPodmanArgs', 'Start-RuntimeMigrationProcess',
                    'Copy-RuntimeMigrationVolume', 'Invoke-RuntimeMigrationPodman')) {
  $fn = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $fn) { throw "missing function $name" }
  Invoke-Expression $fn.Extent.Text
}
$RuntimeMigrationVolumes = @('jht-broker-state', 'jht-secrets', 'jht-telegram-secrets', 'jht-telegram-state')
function Get-RuntimeMigrationVolumeId {
  param($EngineName, $DockerPath, $PodmanPath, $Machine, $Project, $Logical)
  if ($EngineName -eq 'docker') { return "host-runtime_$Logical" }
  return $null
}
function Get-RuntimeMigrationVolumeManifest {
  param($EngineName, $DockerPath, $PodmanPath, $Machine, $Image, $Volume)
  if ($Scenario -eq 'mismatch' -and $EngineName -eq 'podman') { return ('1 ' + ('f' * 64)) }
  return ('1 ' + ('a' * 64))
}
$env:JHT_PS_MIGRATION_SCENARIO = $Scenario
$image = 'ghcr.io/leopu00/jht@sha256:' + ('a' * 64)
$code = Invoke-RuntimeMigrationPodman -DockerPath $Engine -PodmanPath $Engine `
  -Machine jht-podman -Image $image -MarkerPath $Marker
[Console]::Out.WriteLine("RESULT $code $([bool](Test-Path -LiteralPath $Marker))")
''',
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            POWERSHELL,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(harness),
            "-Wrapper",
            str(PS_WRAPPER),
            "-Engine",
            str(engine),
            "-Marker",
            str(marker),
            "-Scenario",
            scenario,
        ],
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"RESULT {expected} {str(marked)}" in result.stdout
    assert marker.exists() is marked
    if expected:
        assert "JHT_LEFT" in result.stdout
    diagnostic = result.stdout + result.stderr
    if scenario == "interrupt":
        assert "runtime_migration_interrupted" in diagnostic
    if scenario == "mismatch":
        assert "runtime_migration_checksum_mismatch" in diagnostic
