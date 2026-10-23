"""Windows PowerShell 5.1 next to PowerShell 7 on a native program that writes on stderr, under 'Stop'.

Under `$ErrorActionPreference = 'Stop'`, Windows PowerShell 5.1, the shell the app
runs the scripts with, turns a line a native program writes on stderr into an error
that stops the script, even when that stderr goes to `$null`; PowerShell 7 does not.
On a new machine there is no container jht yet, `podman inspect jht` says
"Error: no such object", and the enabler stopped at every first installation (T82).

The fake `podman.exe` / `docker.exe` is a real native program (C#, compiled with
Add-Type) that answers `inspect jht` as Podman does when the container is not there:
the message on stderr, exit 125.

- the enabler's read of an existing container goes on in both shells on a new machine;
- the same read in its old form stops under 5.1 only: the gate sees the defect;
- the probe's check for a container already there goes on in both shells;
- where the failure must stop (the owner of a legacy file), it still stops, on the
  exit code, in both shells, and goes on when the command succeeds.

The Windows config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`:
a missing shell is a failure, not a skip.
"""

import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
PROBE = ROOT / "scripts" / "podman-windows-probe.ps1"

pytestmark = pytest.mark.skipif(os.name != "nt", reason="needs Windows PowerShell 5.1, which only Windows has")

SHELLS = ("powershell", "pwsh")
OLD_ENABLER_READ = (
    "[string]$existingLabelsJson = (& $Podman --connection $MachineName inspect jht --format "
    "'{{json .Config.Labels}}' 2>$null | Select-Object -First 1)\n"
)


def _shell(name: str) -> str:
    if name == "powershell":
        # The very executable the app starts, not whatever `powershell` is first on PATH.
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(name)
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


FAKE_SOURCE = r"""
using System;

public static class FakeContainerEngine
{
    public static int Main(string[] args)
    {
        if (Array.IndexOf(args, "inspect") >= 0 && Array.IndexOf(args, "jht") >= 0)
        {
            Console.Error.WriteLine("Error: no such object: \"jht\"");
            return 125;
        }
        if (Array.IndexOf(args, "ssh") >= 0)
        {
            if (Environment.GetEnvironmentVariable("FAKE_SSH_FAILS") == "1")
            {
                Console.Error.WriteLine("stat: cannot statx: No such file or directory");
                return 1;
            }
            Console.WriteLine("1000");
            return 0;
        }
        return 0;
    }
}
"""


@pytest.fixture(scope="module")
def fake_engine(tmp_path_factory):
    """podman.exe and docker.exe: one native program, compiled by Windows PowerShell 5.1's Add-Type."""
    root = tmp_path_factory.mktemp("fake-engine-stderr")
    source = root / "FakeContainerEngine.cs"
    source.write_text(FAKE_SOURCE, encoding="utf-8")
    exe = root / "fake-engine.exe"
    compile_ps = "Add-Type -Path $env:FAKE_SOURCE -OutputAssembly $env:FAKE_EXE -OutputType ConsoleApplication"
    result = subprocess.run(
        [_shell("powershell"), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", compile_ps],
        env={**os.environ, "FAKE_SOURCE": str(source), "FAKE_EXE": str(exe)},
        capture_output=True, text=True, timeout=180,
    )
    assert result.returncode == 0 and exe.is_file(), result.stdout + result.stderr
    bin_dir = root / "bin"
    bin_dir.mkdir()
    for name in ("podman.exe", "docker.exe"):
        shutil.copyfile(exe, bin_dir / name)
    return bin_dir


IMPORT = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$wanted = @($env:JHT_IMPORT -split ',' | Where-Object { $_ })
$found = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $n.Name }, $true))
if ($found.Count -ne $wanted.Count) { throw "functions not found: $($env:JHT_IMPORT)" }
foreach ($fn in $found) { Invoke-Expression $fn.Extent.Text }
$Podman = Join-Path $env:FAKE_BIN 'podman.exe'
$MachineName = 'jht-podman'
"""

# The enabler's top-level statements that read an existing container, up to the migration decision.
ENABLER_BLOCK = r"""
$statements = @($ast.EndBlock.Statements)
$first = -1; $last = -1
for ($i = 0; $i -lt $statements.Count; $i++) {
  $text = $statements[$i].Extent.Text
  if ($first -lt 0 -and $text -match '^\[string\]\$existingLabelsJson = ') { $first = $i }
  if ($first -ge 0 -and $text -match '^\$containerNeedsMigration = ') { $last = $i; break }
}
if ($first -lt 0 -or $last -lt $first) { throw 'existing container block missing' }
$block = (@($statements[$first..$last]) | ForEach-Object { $_.Extent.Text }) -join "`n"
if ($env:JHT_OLD_READ) {
  $rest = (@($statements[($first + 1)..$last]) | ForEach-Object { $_.Extent.Text }) -join "`n"
  $block = $env:JHT_OLD_READ + "`n" + $rest
}
. ([scriptblock]::Create($block))
[Console]::Out.WriteLine("PROJECT=[$existingProject] MIGRATE=$([bool]$containerNeedsMigration)")
"""

# The probe's check for a container already there, as the probe writes it.
PROBE_EXISTING = r"""
$check = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Extent.Text -match '^\$existing = ' }, $true)
if (-not $check) { throw 'probe check missing' }
$env:PATH = $env:FAKE_BIN + [IO.Path]::PathSeparator + $env:PATH
. ([scriptblock]::Create($check.Extent.Text))
[Console]::Out.WriteLine("EXISTING=[$existing] CODE=$LASTEXITCODE")
"""

LEGACY_OWNER = r"""
[Console]::Out.WriteLine("LEGACY=$(Test-LegacyWslOwner -WindowsPath $env:FAKE_FILE -PodmanPath $Podman)")
"""


def _run(tmp_path: Path, shell: str, script: Path, imports: list[str], body: str, bin_dir: Path, env: dict[str, str]):
    harness = tmp_path / "case.ps1"
    harness.write_text(IMPORT + body, encoding="utf-8-sig")
    run_env = {**os.environ, "FAKE_BIN": str(bin_dir), "JHT_UNDER_TEST": str(script), "JHT_IMPORT": ",".join(imports), **env}
    return subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(harness)],
        env=run_env, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )


@pytest.mark.parametrize("shell", SHELLS)
def test_the_enabler_goes_on_when_there_is_no_container_yet_in_both_shells(tmp_path, shell, fake_engine):
    result = _run(tmp_path, shell, ENABLER, [], ENABLER_BLOCK, fake_engine, {"JHT_OLD_READ": ""})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PROJECT=[] MIGRATE=False" in result.stdout, result.stdout + result.stderr


@pytest.mark.parametrize("shell", SHELLS)
def test_the_old_read_stops_on_podmans_stderr_under_51_only(tmp_path, shell, fake_engine):
    """The counter-check the gate carries with it: the defect is visible here, and only in 5.1."""
    result = _run(tmp_path, shell, ENABLER, [], ENABLER_BLOCK, fake_engine, {"JHT_OLD_READ": OLD_ENABLER_READ})
    if shell == "powershell":
        assert result.returncode != 0, result.stdout
        assert "PROJECT=" not in result.stdout, result.stdout
        assert "no such object" in result.stdout + result.stderr, result.stdout + result.stderr
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert "PROJECT=[] MIGRATE=False" in result.stdout, result.stdout


@pytest.mark.parametrize("shell", SHELLS)
def test_the_probe_goes_on_when_there_is_no_container_yet_in_both_shells(tmp_path, shell, fake_engine):
    result = _run(tmp_path, shell, PROBE, [], PROBE_EXISTING, fake_engine, {})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "EXISTING=[] CODE=125" in result.stdout, result.stdout + result.stderr


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize(("ssh_fails", "expected"), [("0", "LEGACY=False"), ("1", "Cannot read the owner of")])
def test_a_failure_that_must_stop_still_stops_on_its_exit_code(tmp_path, shell, fake_engine, ssh_fails, expected):
    """Not silent where it stopped before: the owner of a legacy file that cannot be read stops the
    setup, in both shells, on the exit code; a readable owner goes on."""
    legacy = tmp_path / "jobs.db"
    legacy.write_text("", encoding="utf-8")
    result = _run(
        tmp_path, shell, ENABLER, ["Test-LegacyWslOwner", "ConvertTo-WslPath", "Quote-Sh"], LEGACY_OWNER, fake_engine,
        {"FAKE_SSH_FAILS": ssh_fails, "FAKE_FILE": str(legacy)},
    )
    if ssh_fails == "1":
        assert result.returncode != 0, result.stdout
        assert "LEGACY=" not in result.stdout, result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr
    assert expected in result.stdout + result.stderr, result.stdout + result.stderr
