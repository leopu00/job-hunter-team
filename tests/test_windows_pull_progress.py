"""The image pull of the Windows setup tells the app how far it is (JHT_PULL), without private data.

enable-podman-windows-runtime.ps1 pulled the runtime image with `| Out-Null`: the minutes of the pull
were a silent wait. Invoke-PodmanPull now passes the layers podman says it copies to stdout as
`JHT_PULL <line>` (the app reads them: windows_runtime.rs PullTracker), cleaned of paths and of the
user's name, and nothing else of podman's output; it does so with the redirected stderr inside a
'Continue' scope (a 5.1 NativeCommandError under 'Stop' otherwise) and still fails with podman's exit code.

The functions are read out of the script through the AST and run against a fake podman (a function that
writes to the error stream, as a native command's stderr arrives): off Windows under pwsh, on Windows
under the shell JHT_TEST_SHELL names (PowerShell 5.1 and 7 in CI).
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
needs_powershell = pytest.mark.skipif(not WINDOWS and shutil.which("pwsh") is None, reason="needs PowerShell")

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in 'ConvertTo-JhtPullLine', 'Invoke-PodmanPull') {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "$name missing" }
  Invoke-Expression $fn.Extent.Text
}
function fake-podman {
  $global:FAKE_ARGS = $args -join '|'
  Write-Error 'Trying to pull ghcr.io/leopu00/jht@sha256:abc...' -ErrorAction Continue
  Write-Error 'Getting image source signatures' -ErrorAction Continue
  Write-Error 'Copying blob sha256:aaaaaaaaaaaa1111 [=>-----] 3.0MiB / 28.0MiB' -ErrorAction Continue
  Write-Error ("Copying blob sha256:bbbbbbbbbbbb2222 [>------] 1.0MiB / 5.0MiB`rCopying blob sha256:bbbbbbbbbbbb2222 [==>----] 2.0MiB / 5.0MiB") -ErrorAction Continue
  Write-Error 'Copying blob sha256:aaaaaaaaaaaa1111 done   |' -ErrorAction Continue
  Write-Error ('Copying config sha256:cccccccccccc3333 from ' + $env:USERPROFILE + '\x\y done') -ErrorAction Continue
  'sha256:deadbeefdeadbeef'
  $global:LASTEXITCODE = [int]$env:FAKE_PODMAN_CODE
}
Invoke-PodmanPull -PodmanPath 'fake-podman' -Machine 'jht-podman' -Image 'ghcr.io/leopu00/jht@sha256:abc'
[Console]::Out.WriteLine("ARGS=$global:FAKE_ARGS")
"""


def _run(tmp_path: Path, code: str = "0"):
    harness = tmp_path / "harness.ps1"
    engine = tmp_path / "engine.txt"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(ENABLER), "FAKE_PODMAN_CODE": code,
        "USERPROFILE": r"C:\Users\someone-private", "USERNAME": "someone-private",
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    return done


@needs_powershell
def test_the_layers_go_to_stdout_cleaned_and_the_rest_of_podmans_output_stays_out(tmp_path):
    done = _run(tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = done.stdout.replace("\r\n", "\n").split("\n")
    assert [line for line in lines if line.startswith("JHT_PULL ")] == [
        "JHT_PULL Copying blob sha256:aaaaaaaaaaaa1111 [=>-----] 3.0MiB / 28.0MiB",
        # a bar redrawn with carriage returns: its last drawing
        "JHT_PULL Copying blob sha256:bbbbbbbbbbbb2222 [==>----] 2.0MiB / 5.0MiB",
        "JHT_PULL Copying blob sha256:aaaaaaaaaaaa1111 done   |",
        # the user's name and path are taken out
        "JHT_PULL Copying config sha256:cccccccccccc3333 from <private>\\x\\y done",
    ]
    text = done.stdout
    for private in ("someone-private", "Trying to pull", "Getting image source", "deadbeefdeadbeef"):
        assert private not in text, private
    assert "ARGS=--connection|jht-podman|pull|ghcr.io/leopu00/jht@sha256:abc" in text


@needs_powershell
def test_a_failed_pull_still_fails_with_podmans_exit_code(tmp_path):
    done = _run(tmp_path, "125")
    assert done.returncode != 0
    assert "Command failed (125)" in done.stdout + done.stderr


def test_the_enabler_pulls_through_the_function_and_not_through_out_null():
    source = ENABLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert "Invoke-PodmanPull -PodmanPath $Podman -Machine $MachineName -Image $RuntimeImage" in source
    assert "'pull' $RuntimeImage | Out-Null" not in source
    # the redirection of podman's stderr is inside the 'Continue' scope, and the exit code follows the pipeline
    body = source[source.index("function Invoke-PodmanPull"):source.index("function Update-ProcessPath")]
    assert body.index("$ErrorActionPreference = 'Continue'") < body.index("2>&1") < body.index("$code = $LASTEXITCODE")
    assert "Select-Object" not in body
