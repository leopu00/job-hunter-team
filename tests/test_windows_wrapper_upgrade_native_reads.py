"""The Windows wrapper's upgrade reads the image and the CLI version of jht by the native command's own exit code.

Get-UpgradeImage and Get-UpgradeVersion read `& docker ... | Select-Object -First 1` and then
$LASTEXITCODE. Select-Object -First 1 stops the native command, and the exit code is then not its
own: -1 under Windows PowerShell 5.1, the one of the native command before it under 7. Under 5.1
both always returned '', so Test-UpgradeRunning never saw the new jht running (T79).

The functions are the wrapper's own, read through the AST; docker is a native fake (on Windows, the
shell JHT_TEST_SHELL names: Windows PowerShell 5.1 by default). Before each read a native command
exits 1, as `profile validate` does on a team whose profile is not ready.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Get-UpgradeImage', 'Get-UpgradeVersion')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
$Container = 'jht'; $NodeEntry = '/app/cli/bin/jht.js'
& { $ErrorActionPreference = 'Continue'; & docker fail 2>$null }
[Console]::Out.WriteLine('image=' + (Get-UpgradeImage))
& { $ErrorActionPreference = 'Continue'; & docker fail 2>$null }
[Console]::Out.WriteLine('version=' + (Get-UpgradeVersion))
"""

FAKE_DOCKER = r"""#!/bin/sh
[ "$1" = fail ] && exit 1
[ -f "$FAKE_STATE/exit" ] && code=$(cat "$FAKE_STATE/exit") || code=0
case "$1" in
  inspect) echo "sha256:1111"; echo "a second line"; exit "$code" ;;
  exec) echo "0.4.2"; exit "$code" ;;
esac
exit 0
"""


def _read(tmp_path: Path, docker_exit: int) -> dict[str, str]:
    state = tmp_path / "state"
    state.mkdir()
    (state / "exit").write_text(str(docker_exit), encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE_DOCKER)
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(WRAPPER), "FAKE_STATE": str(state),
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    return dict(line.split("=", 1) for line in done.stdout.splitlines() if "=" in line)


def test_a_running_jht_gives_its_image_and_version(tmp_path):
    assert _read(tmp_path, 0) == {"image": "sha256:1111", "version": "0.4.2"}


@pytest.mark.parametrize("code", [1, 125])
def test_a_failed_docker_gives_nothing_even_with_output(tmp_path, code):
    assert _read(tmp_path, code) == {"image": "", "version": ""}
