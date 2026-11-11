"""The pin of the image of the tools on request (test channel) in the Windows side: the installer parameter, the enabler that writes the
pin and its integrity file, and the wrapper function that believes it (the PowerShell port of tests/test_install_extras_image_pin.py).

The wrapper function is read through the AST and run in the PowerShell under test with the owner/ACL check stubbed (it is the one
thing a Linux run cannot do); the installer and the enabler are read as text.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTALLER = ROOT / "scripts" / "install.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
INTEGRATION = ROOT / "scripts" / "jht-integration.ps1"

EXTRAS = "sha256:" + "e" * 64
REF = f"ghcr.io/leopu00/jht@{EXTRAS}"

CASE = r"""
$ErrorActionPreference = 'Stop'
$RuntimeDir = $env:T_RUNTIME
$RuntimeExtrasFile = Join-Path $RuntimeDir 'runtime-extras-image'
$RuntimeExtrasIntegrity = Join-Path $RuntimeDir '.runtime-extras-integrity'
$ExtrasImageDigest = $env:T_CONSTANT
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:T_WRAPPER_SRC, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-RuntimeExtrasPin' }, $true)
Invoke-Expression $fn.Extent.Text
function Test-ProtectedRuntimeNode { param($p, [switch]$Directory) $true }
$ok = Test-RuntimeExtrasPin -PinPresent ($env:T_MAIN_PIN -eq '1')
"result=$ok digest=$ExtrasImageDigest"
"""


@pytest.fixture()
def box(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()

    def pin(text: str = REF + "\n", *, integrity: str | None = None) -> None:
        file = runtime / "runtime-extras-image"
        file.write_bytes(text.encode())
        digest = integrity if integrity is not None else hashlib.sha256(file.read_bytes()).hexdigest()
        (runtime / ".runtime-extras-integrity").write_bytes(f"runtime-extras-image={digest}\n".encode())

    def run(*, main_pin: bool = True, constant: str = "") -> str:
        harness = tmp_path / "case.ps1"
        harness.write_text(ENGINE_CHECK + CASE, encoding="utf-8")
        engine = tmp_path / "engine.txt"
        env = {**(windows_env(tmp_path) if WINDOWS else os.environ), "JHT_ENGINE_FILE": str(engine), "T_RUNTIME": str(runtime),
               "T_WRAPPER_SRC": str(WRAPPER), "T_CONSTANT": constant, "T_MAIN_PIN": "1" if main_pin else "0"}
        done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
        assert done.returncode == 0, done.stdout + done.stderr
        assert_engine(engine, done.stderr)
        return [line for line in done.stdout.splitlines() if line.startswith("result=")][-1]

    return type("Box", (), {"pin": pin, "run": run, "runtime": runtime})


def test_without_any_extras_file_the_runtime_is_fine_and_the_constant_stays(box):
    assert box.run(constant="sha256:" + "c" * 64) == "result=True digest=sha256:" + "c" * 64


def test_an_attested_canonical_pin_next_to_the_main_pin_wins_over_the_constant(box):
    box.pin()
    assert box.run(constant="sha256:" + "c" * 64) == f"result=True digest={EXTRAS}"


@pytest.mark.parametrize(
    "case",
    ["content", "pin_removed", "integrity_removed", "noncanonical", "two_lines", "extra_blank_line", "uppercase_digest", "no_main_pin"],
)
def test_a_pin_that_is_not_the_one_the_installer_wrote_is_not_believed_and_the_constant_is_not_used(box, case):
    main_pin = case != "no_main_pin"
    box.pin()
    pin, integrity = box.runtime / "runtime-extras-image", box.runtime / ".runtime-extras-integrity"
    if case == "content":
        pin.write_bytes((f"ghcr.io/leopu00/jht@sha256:{'d' * 64}\n").encode())
    elif case == "pin_removed":
        pin.unlink()
    elif case == "integrity_removed":
        integrity.unlink()
    elif case == "noncanonical":
        box.pin("ghcr.io/someone/jht:latest\n")
    elif case == "two_lines":
        box.pin(REF + "\n" + REF + "\n")
    elif case == "extra_blank_line":
        box.pin(REF + "\n\n")
    elif case == "uppercase_digest":
        box.pin("ghcr.io/leopu00/jht@sha256:" + "E" * 64 + "\n")
    result = box.run(main_pin=main_pin, constant="sha256:" + "c" * 64)
    assert result == "result=False digest=sha256:" + "c" * 64, result


def test_the_installer_takes_the_parameter_only_inside_the_test_channel_with_the_exact_shape():
    text = INSTALLER.read_text(encoding="utf-8")
    assert "[string]$ExtrasImageDigest = ''" in text
    assert "-not $TestChannel -or $ExtrasImageDigest -cnotmatch '^sha256:[0-9a-f]{64}\\z'" in text
    assert "if ($TestChannel -and $ExtrasImageDigest) { $enablerArgs += @('-ExtrasImageDigest', $ExtrasImageDigest) }" in text
    assert "'.runtime-extras-integrity'" in text  # the owner of both files is set with the rest of the published nodes


def test_the_enabler_writes_the_file_first_the_integrity_second_and_drops_them_without_the_parameter():
    text = ENABLER.read_text(encoding="utf-8")
    write = text.index("WriteAllText($runtimeExtrasFile")
    assert write < text.index("WriteAllText($runtimeExtrasIntegrity")
    assert "-not $PersistImagePin) { throw 'Extras image digest is invalid.' }" in text
    assert "Remove-Item -LiteralPath $runtimeExtrasFile, $runtimeExtrasIntegrity" in text
    assert "$bundleFiles += $runtimeExtrasFile, $runtimeExtrasIntegrity" in text
    manifest = text[text.index('$manifest = "version=1'):].splitlines()[0]
    assert "extras" not in manifest, "the main manifest keeps its keys: the app compares them exactly"


def test_the_wrapper_checks_the_pin_with_the_rest_of_the_runtime_and_the_integration_helper_reads_the_digest():
    text = WRAPPER.read_text(encoding="utf-8")
    assert "if (-not (Test-RuntimeExtrasPin -PinPresent $pinPresent)) { return $false }" in text
    assert "$ExtrasImageDigest = ''" in text  # the constant of the release stays what the release script rewrites
    assert "Get-IntegrationExtrasRef" in INTEGRATION.read_text(encoding="utf-8")
