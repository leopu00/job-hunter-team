"""install.ps1 on Windows 10: a warning and a notice for the desktop, never a block.

Podman 6 removed Windows 10 support. Windows 11 is the supported system;
Windows 10 still installs, with the sentence «Podman no longer supports
Windows 10: it may work, but we do not guarantee it. The supported system is
Windows 11» and the line
`JHT_NOTICE windows10_unsupported`, which the desktop keeps on the setup
screen (windows_runtime.rs, INSTALL_NOTICES).

The product type is read before the build: Windows Server 2019 (17763) and
2022 (20348) have builds under 22000 too, and they are not Windows 10.

The functions are taken from the REAL script through the PowerShell AST and run
by pwsh with a fake edition, as in test_windows_podman_wsl_branches.py.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / "scripts" / "install.ps1"
PUBLIC_INSTALLER = ROOT / "web" / "public" / "install.ps1"
DIGEST = ROOT / "desktop" / "src-tauri" / "installer-windows.sha256"
NOTICE = "JHT_NOTICE windows10_unsupported"
WARNING = "Podman no longer supports Windows 10: it may work, but we do not guarantee it. The supported system is Windows 11."


def _pwsh() -> str:
    found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if found:
        return found
    if os.environ.get("CI"):
        pytest.fail("pwsh is missing on the CI runner: the Windows 10 notice would go untested")
    pytest.skip("pwsh not installed")


PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in ($env:JHT_IMPORT -split ',')) {
  if (-not $name) { continue }
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "function $name missing" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
. ([scriptblock]::Create($env:JHT_CASE_BODY))
exit 0
"""

NOTICE_FUNCTIONS = ["Show-WindowsSupportNotice", "Test-JhtWindows10Client", "Get-Windows10SupportWarning", "Write-JhtNotice", "Write-Warn"]


def _run(tmp_path: Path, imports: list[str], body: str):
    prelude = tmp_path / "prelude.ps1"
    prelude.write_text(PRELUDE, encoding="utf-8")
    env = {
        "PATH": f"/usr/bin{os.pathsep}/bin",
        "HOME": str(tmp_path),
        "JHT_UNDER_TEST": str(INSTALLER),
        "JHT_IMPORT": ",".join(imports),
        "JHT_CASE_BODY": body,
    }
    return subprocess.run(
        [_pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(prelude)],
        env=env, capture_output=True, text=True, timeout=120,
    )


def _with_edition(tmp_path: Path, edition: str):
    # The fake edition replaces the CIM read; the fixed language makes these
    # OS-detection tests independent of the ThinkPad's console locale.
    body = (
        f"function Get-JhtWindowsEdition {{ return {edition} }}\n"
        f"function Get-Windows10SupportWarning {{ return '{WARNING}' }}\n"
        "Show-WindowsSupportNotice\n[Console]::Out.WriteLine('SETUP_GOES_ON')\n"
    )
    return _run(tmp_path, NOTICE_FUNCTIONS, body)


@pytest.mark.parametrize(
    "build", [10240, 17763, 19041, 19045], ids=["1507", "1809", "2004", "22H2"],
)
def test_windows_10_warns_and_the_setup_goes_on(tmp_path, build):
    result = _with_edition(tmp_path, f"@{{ ProductType = 1; Build = {build} }}")
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert lines.count(NOTICE) == 1, result.stdout
    assert any(WARNING in line for line in lines), result.stdout
    # the notice comes before the rest of the setup, which runs
    assert lines.index(NOTICE) < lines.index("SETUP_GOES_ON")


@pytest.mark.parametrize(
    ("product_type", "build"),
    [
        (1, 22000),  # Windows 11 21H2
        (1, 26100),  # Windows 11 24H2
        (3, 17763),  # Windows Server 2019
        (3, 20348),  # Windows Server 2022
        (2, 20348),  # a domain controller on Server 2022
        (1, 9600),   # Windows 8.1: not Windows 10
    ],
    ids=["win11-21h2", "win11-24h2", "server-2019", "server-2022", "domain-controller", "win81"],
)
def test_no_windows_10_notice_off_windows_10(tmp_path, product_type, build):
    result = _with_edition(tmp_path, f"@{{ ProductType = {product_type}; Build = {build} }}")
    assert result.returncode == 0, result.stderr
    assert "JHT_NOTICE" not in result.stdout
    assert "Windows 10" not in result.stdout
    assert "SETUP_GOES_ON" in result.stdout


def test_an_unreadable_edition_says_nothing_and_goes_on(tmp_path):
    result = _with_edition(tmp_path, "$null")
    assert result.returncode == 0, result.stderr
    assert "JHT_NOTICE" not in result.stdout
    assert "SETUP_GOES_ON" in result.stdout


@pytest.mark.parametrize(
    ("cim", "expected"),
    [
        ("[pscustomobject]@{ ProductType = [uint32]1; BuildNumber = '19045' }", "1 19045"),
        ("[pscustomobject]@{ ProductType = [uint32]3; BuildNumber = '20348' }", "3 20348"),
        ("throw 'Invalid class'", "none"),
    ],
    ids=["client", "server", "cim-fails"],
)
def test_the_edition_is_read_from_win32_operatingsystem(tmp_path, cim, expected):
    body = (
        "function Get-CimInstance { param([string]$ClassName, $OperationTimeoutSec, $ErrorAction)\n"
        "  if ($ClassName -ne 'Win32_OperatingSystem') { throw \"class $ClassName\" }\n"
        f"  {cim}\n}}\n"
        "$e = Get-JhtWindowsEdition\n"
        "if ($e) { [Console]::Out.WriteLine(\"$($e.ProductType) $($e.Build)\") } else { [Console]::Out.WriteLine('none') }\n"
    )
    result = _run(tmp_path, ["Get-JhtWindowsEdition"], body)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


# A fake CIM that says, outside the function's output, how it was called.
SPY_CIM = (
    "function Get-CimInstance { param([string]$ClassName, $OperationTimeoutSec, $ErrorAction)\n"
    "  [Console]::Out.WriteLine(\"CIM class=$ClassName timeout=$OperationTimeoutSec erroraction=$ErrorAction\")\n"
    "  if ($env:CIM_TIMES_OUT -eq '1') { throw 'The WS-Management service cannot complete the operation within the time specified in OperationTimeout.' }\n"
    "  [pscustomobject]@{ ProductType = [uint32]1; BuildNumber = '19045' }\n}\n"
)


def test_the_cim_read_gives_up_after_10_seconds(tmp_path):
    body = SPY_CIM + (
        "$e = Get-JhtWindowsEdition\n"
        "[Console]::Out.WriteLine(\"EDITION $($e.ProductType) $($e.Build)\")\n"
    )
    result = _run(tmp_path, ["Get-JhtWindowsEdition"], body)
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert "CIM class=Win32_OperatingSystem timeout=10 erroraction=Stop" in lines, result.stdout
    assert "EDITION 1 19045" in lines, result.stdout


def test_a_cim_read_that_times_out_says_nothing_and_the_setup_goes_on(tmp_path):
    # The real Get-JhtWindowsEdition this time, behind the notice: a timeout is a failed read.
    body = (
        "$env:CIM_TIMES_OUT = '1'\n" + SPY_CIM +
        "Show-WindowsSupportNotice\n[Console]::Out.WriteLine('SETUP_GOES_ON')\n"
    )
    result = _run(tmp_path, ["Get-JhtWindowsEdition", *NOTICE_FUNCTIONS], body)
    assert result.returncode == 0, result.stderr
    assert "CIM class=Win32_OperatingSystem timeout=10 erroraction=Stop" in result.stdout
    assert "JHT_NOTICE" not in result.stdout
    assert "Windows 10" not in result.stdout
    assert result.stdout.splitlines()[-1] == "SETUP_GOES_ON"


def _function_text(name: str) -> str:
    source = INSTALLER.read_text(encoding="utf-8")
    start = source.index(f"function {name} {{")
    end = source.index("\n}\n", start)
    return source[start:end]


def test_the_system_check_shows_the_notice_and_never_stops_for_it():
    assert "Show-WindowsSupportNotice" in _function_text("Test-System")
    notice = _function_text("Show-WindowsSupportNotice")
    assert not re.search(r"\bexit\b|Write-Fail|\bthrow\b", notice), notice


def test_the_installer_text_says_podman_and_may_work_never_microsoft():
    warning = _function_text("Get-Windows10SupportWarning")
    assert WARNING in warning
    assert "Microsoft" not in warning
    # Windows PowerShell 5.1 reads a BOM-less script as ANSI: the sentence stays ASCII.
    assert warning.isascii()


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        ("it", "Podman non supporta piu' Windows 10: puo' funzionare, ma non lo garantiamo. Il sistema supportato e' Windows 11."),
        ("en", WARNING),
        ("de", "Podman unterstuetzt Windows 10 nicht mehr: Es kann funktionieren, aber wir garantieren es nicht. Unterstuetzt wird Windows 11."),
        ("es", "Podman ya no es compatible con Windows 10: puede funcionar, pero no lo garantizamos. El sistema compatible es Windows 11."),
        ("fr", "Podman ne prend plus en charge Windows 10 : cela peut fonctionner, mais nous ne le garantissons pas. Le systeme pris en charge est Windows 11."),
        ("hu", "A Podman mar nem tamogatja a Windows 10-et: mukodhet, de nem garantaljuk. A tamogatott rendszer a Windows 11."),
        ("pt", "O Podman ja nao suporta o Windows 10: pode funcionar, mas nao o garantimos. O sistema suportado e o Windows 11."),
        ("unknown", WARNING),
    ],
)
def test_the_terminal_warning_uses_the_console_language(tmp_path, language, expected):
    result = _run(
        tmp_path,
        ["Get-Windows10SupportWarning"],
        f"[Console]::Out.WriteLine((Get-Windows10SupportWarning -Language '{language}'))\n",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


def test_the_notice_only_switch_reads_no_runtime_or_network():
    source = INSTALLER.read_text(encoding="utf-8")
    switch = source.index("if ($WindowsSupportNoticeOnly) {")
    main = source.index("Show-Header", switch)
    assert switch < main
    block = source[switch:main]
    assert "Show-WindowsSupportNotice" in block
    assert "Get-RuntimeFiles" not in block


def test_the_two_installers_and_the_compiled_digest_are_the_same_file():
    source = INSTALLER.read_bytes()
    assert PUBLIC_INSTALLER.read_bytes() == source, "web/public/install.ps1 is what jobhunterteam.ai serves"
    assert DIGEST.read_text(encoding="utf-8").strip() == hashlib.sha256(source).hexdigest(), (
        "the desktop runs install.ps1 only with the digest compiled from installer-windows.sha256"
    )
