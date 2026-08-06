"""Il wrapper deve tradurre --output dal container al filesystem host."""

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BASH_WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"


def make_fake_docker(tmp_path: Path) -> tuple[Path, Path]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    container_root = tmp_path / "container"
    container_root.mkdir()
    docker = fake_bin / "docker"
    docker.write_text(
        """#!/usr/bin/env bash
set -eu
cmd="$1"; shift
case "$cmd" in
  info) exit 0 ;;
  ps) printf 'jht\\n' ;;
  exec)
    while [ "$#" -gt 0 ]; do
      case "$1" in -i|-it) shift ;; -e) shift 2 ;; jht) shift; break ;; *) shift ;; esac
    done
    if [ "${1:-}" = "rm" ]; then
      rm -f "$FAKE_CONTAINER_ROOT${3:-}"
      exit 0
    fi
    if [ "${FAKE_DOWNLOAD_FAIL:-0}" = "1" ]; then exit 9; fi
    out=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--output" ]; then out="$2"; shift 2; else shift; fi
    done
    mkdir -p "$(dirname "$FAKE_CONTAINER_ROOT$out")"
    printf 'verified release bytes' > "$FAKE_CONTAINER_ROOT$out"
    ;;
  cp)
    source_path="${1#*:}"
    cp "$FAKE_CONTAINER_ROOT$source_path" "$2"
    ;;
  *) exit 0 ;;
esac
"""
    )
    docker.chmod(0o755)
    return fake_bin, container_root


def run_wrapper(tmp_path: Path, *args: str, extra_env=None):
    fake_bin, container_root = make_fake_docker(tmp_path)
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text("services: {}\n")
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path / "home"),
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_COMPOSE_FILE": str(runtime / "docker-compose.yml"),
        "FAKE_CONTAINER_ROOT": str(container_root),
        **(extra_env or {}),
    }
    return subprocess.run(
        ["bash", str(BASH_WRAPPER), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    ), container_root


def test_bash_wrapper_publishes_explicit_output_atomically(tmp_path):
    output = tmp_path / "outside-bind" / "client.exe"
    result, container_root = run_wrapper(
        tmp_path,
        "download", "--os", "windows", "--version", "0.3.5", "--output", str(output),
    )

    assert result.returncode == 0, result.stderr
    assert output.read_bytes() == b"verified release bytes"
    assert not list(output.parent.glob("*.part*"))
    assert not list((container_root / "tmp").glob("jht-download-*"))


def test_bash_wrapper_preserves_existing_host_file(tmp_path):
    output = tmp_path / "client.exe"
    output.write_bytes(b"keep")
    result, _ = run_wrapper(
        tmp_path,
        "download", "--os", "windows", "--version", "0.3.5", "--output", str(output),
    )

    assert result.returncode != 0
    assert output.read_bytes() == b"keep"
    assert not list(tmp_path.glob("*.part*"))


def test_bash_wrapper_propagates_inner_failure_without_artifact(tmp_path):
    output = tmp_path / "client.exe"
    result, _ = run_wrapper(
        tmp_path,
        "download", "--os", "windows", "--version", "0.0.0-missing", "--output", str(output),
        extra_env={"FAKE_DOWNLOAD_FAIL": "1"},
    )

    assert result.returncode != 0
    assert not output.exists()
    assert not list(tmp_path.glob("*.part*"))


def test_powershell_wrapper_has_same_no_clobber_bridge_contract():
    source = POWERSHELL_WRAPPER.read_text()
    for seam in (
        "function Invoke-HostDownload",
        'docker cp "${Container}:$containerTemp" $hostTemp',
        "[IO.File]::Move($hostTemp, $hostOutput)",
        "Remove-Item -LiteralPath $hostTemp",
        "'download' {",
    ):
        assert seam in source
