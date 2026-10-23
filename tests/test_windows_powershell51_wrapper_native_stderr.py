"""The Windows wrapper (jht.ps1) under Windows PowerShell 5.1 next to PowerShell 7, when Podman or Docker write on stderr.

The wrapper runs under `$ErrorActionPreference = 'Stop'`. There Windows PowerShell
5.1, the shell the app runs it with, turns a line a native program writes on stderr
into an error that stops the script, even when that stderr goes to `$null`, is merged
(`2>&1`) or goes with every stream (`*> $null`); PowerShell 7 does not (T82). Podman
and podman-compose write warnings on stderr in normal runs, and "no such object"
when a container or a volume is not there.

So every redirected native call of the wrapper runs in its own block,
`& { $ErrorActionPreference = 'Continue'; & docker ... 2>$null }`, and so does a call
to a function of the wrapper that runs one (Invoke-TelegramLegacy).

The fake `docker.exe` / `podman.exe` is a real native program (C#, compiled with
Add-Type), so each shell runs it as it runs the real ones. It writes on stderr where
the real ones do. Each case runs the wrapper's own text (functions and statements
read through its AST), in both shells:
- the reads go on and give what stdout said; with the old line put back they stop
  under 5.1 only (the counter-check the gate carries with it);
- where the wrapper must stop (a volume list that fails during the migration), it
  still stops, on the exit code, with its own error.

The Windows config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`:
a missing shell is a failure, not a skip.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"

pytestmark = pytest.mark.skipif(os.name != "nt", reason="needs Windows PowerShell 5.1, which only Windows has")

SHELLS = ("powershell", "pwsh")
BLOCK = "& { $ErrorActionPreference = 'Continue'; "
CONTAINER_ID = "0123456789abcdef"
LABELS = json.dumps({"com.docker.compose.project": "jht", "com.docker.compose.service": "jht"})


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
    static bool Has(string[] args, string word) { return Array.IndexOf(args, word) >= 0; }

    public static int Main(string[] args)
    {
        if (Has(args, "info"))
        {
            Console.Error.WriteLine("Cannot connect to Podman. Please verify your connection to the Linux system");
            return 125;
        }
        if (Has(args, "machine") && Has(args, "list"))
        {
            Console.Error.WriteLine("time=\"2026-10-23T00:00:00Z\" level=warning msg=\"The cgroupv2 manager is set to systemd\"");
            Console.WriteLine("[{\"Name\":\"jht-podman\",\"Running\":true}]");
            return 0;
        }
        if (Has(args, "compose") && Has(args, "ps"))
        {
            Console.Error.WriteLine("WARN: podman-compose: the project jht has no running container named jht-broker");
            Console.WriteLine(Environment.GetEnvironmentVariable("FAKE_ID"));
            return 0;
        }
        if (Has(args, "compose") && Has(args, "config"))
        {
            Console.WriteLine("ghcr.io/leopu00/jht@sha256:" + new string('a', 64));
            return 0;
        }
        if (Has(args, "inspect") && Has(args, "--type"))
        {
            Console.WriteLine("true|" + Environment.GetEnvironmentVariable("FAKE_LABELS"));
            return 0;
        }
        if (Has(args, "volume") && Has(args, "ls"))
        {
            Console.Error.WriteLine("Error: no such volume: jht_broker_data");
            return 125;
        }
        if (Has(args, "run"))
        {
            // the legacy Telegram helper: roles with a token left, exit 1
            Console.Error.WriteLine("legacy tokens left in ~/.jht");
            Console.WriteLine("capitano");
            return 1;
        }
        return 0;
    }
}
"""


@pytest.fixture(scope="module")
def fake_engine(tmp_path_factory):
    """podman.exe and docker.exe: one native program, compiled by Windows PowerShell 5.1's Add-Type."""
    root = tmp_path_factory.mktemp("fake-engine-wrapper-stderr")
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


# The wrapper's functions, with JHT_OLD_FORM put back in place of its block when asked:
# the replacement must happen, or the counter-check would prove nothing.
IMPORT = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
function Get-JhtOldForm([string]$Text) {
  if (-not $env:JHT_OLD_FORM) { return $Text }
  $new = "& { `$ErrorActionPreference = 'Continue'; " + $env:JHT_NEW_CALL + " }"
  if (-not $Text.Contains($new)) { return $Text }
  $script:OldFormPut = $true
  return $Text.Replace($new, $env:JHT_OLD_FORM)
}
$script:OldFormPut = $false
$wanted = @($env:JHT_IMPORT -split ',' | Where-Object { $_ })
$found = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $n.Name }, $true))
if ($found.Count -ne $wanted.Count) { throw "functions not found: $($env:JHT_IMPORT)" }
foreach ($fn in $found) { Invoke-Expression (Get-JhtOldForm $fn.Extent.Text) }
$env:PATH = $env:FAKE_BIN + [IO.Path]::PathSeparator + $env:PATH
$Podman = Join-Path $env:FAKE_BIN 'podman.exe'
$ContainerRuntime = 'podman'; $Container = 'jht'; $BrokerContainer = 'jht-broker'; $TelegramContainer = 'jht-telegram'
$ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
$JhtHome = $env:TEMP; $DefaultRuntimeImage = 'ghcr.io/leopu00/jht:latest'
"""

CHECK_OLD = r"""
if ($env:JHT_OLD_FORM -and -not $script:OldFormPut) { throw 'the old form was not put back' }
"""

REACHABLE = CHECK_OLD + r"""
[Console]::Out.WriteLine("REACHABLE=$(Test-DockerReachable)")
"""

MACHINE = CHECK_OLD + r"""
[Console]::Out.WriteLine("MACHINE=$(Get-JhtPodmanMachineState -PodmanPath $Podman -WslPath '' -MachineName 'jht-podman')")
"""

SERVICE = CHECK_OLD + r"""
[Console]::Out.WriteLine("ID=$(Get-RunningComposeServiceId -Service 'jht')")
"""

# The wrapper's own statement that asks the legacy Telegram helper which roles are left.
TELEGRAM = r"""
$statement = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Extent.Text -match '^\$remainingOut = ' }, $true)
if (-not $statement) { throw 'remaining statement missing' }
. ([scriptblock]::Create((Get-JhtOldForm $statement.Extent.Text)))
""" + CHECK_OLD + r"""
[Console]::Out.WriteLine("REMAINING=[$($remainingOut -join ' ')] CODE=$LASTEXITCODE")
"""

VOLUME = CHECK_OLD + r"""
try {
  $id = Get-RuntimeMigrationVolumeId -Engine docker -DockerPath (Join-Path $env:FAKE_BIN 'docker.exe') -PodmanPath $Podman -Machine 'jht-podman' -Project 'host-runtime' -Logical 'broker_data'
  [Console]::Out.WriteLine("VOLUME=[$id]")
} catch {
  [Console]::Out.WriteLine("STOPPED=$($_.Exception.Message)")
}
"""

CASES = {
    # name: (imports, body, the new call inside the block, the old form, what stdout says)
    "reachable": (["Test-DockerReachable"], REACHABLE, "& docker info 2>&1", "docker info 2>&1", "REACHABLE=False"),
    "machine": (["Get-JhtPodmanMachineState"], MACHINE, "& $PodmanPath machine list --format json 2>$null",
                "& $PodmanPath machine list --format json 2>$null", "MACHINE=present"),
    "service": (["Get-RunningComposeServiceId", "Get-ComposeProjectName"], SERVICE, "& docker @composeArgs 2>$null",
                "& docker @composeArgs 2>$null", f"ID={CONTAINER_ID}"),
    "telegram": (["Invoke-TelegramLegacy", "Get-ComposeImage"], TELEGRAM, "Invoke-TelegramLegacy remaining 2>$null",
                 "Invoke-TelegramLegacy remaining 2>$null", "REMAINING=[capitano] CODE=1"),
}


def _run(tmp_path: Path, shell: str, imports: list[str], body: str, bin_dir: Path, env: dict[str, str]):
    harness = tmp_path / "case.ps1"
    harness.write_text(IMPORT + body, encoding="utf-8-sig")
    run_env = {
        **os.environ, "FAKE_BIN": str(bin_dir), "FAKE_ID": CONTAINER_ID, "FAKE_LABELS": LABELS,
        "JHT_UNDER_TEST": str(WRAPPER), "JHT_IMPORT": ",".join(imports), "JHT_OLD_FORM": "", "JHT_NEW_CALL": "", **env,
    }
    return subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(harness)],
        env=run_env, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("case", sorted(CASES))
def test_the_wrapper_goes_on_when_podman_writes_on_stderr_in_both_shells(tmp_path, shell, case, fake_engine):
    imports, body, new_call, _old, expected = CASES[case]
    assert BLOCK + new_call + " }" in WRAPPER.read_text(encoding="utf-8"), f"{case}: the wrapper's line changed"
    result = _run(tmp_path, shell, imports, body, fake_engine, {})
    assert result.returncode == 0, result.stdout + result.stderr
    assert expected in result.stdout, result.stdout + result.stderr


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("case", sorted(CASES))
def test_the_old_line_stops_on_the_stderr_under_51_only(tmp_path, shell, case, fake_engine):
    """The counter-check the gate carries with it: the defect is visible here, and only in 5.1."""
    imports, body, new_call, old, expected = CASES[case]
    result = _run(tmp_path, shell, imports, body, fake_engine, {"JHT_OLD_FORM": old, "JHT_NEW_CALL": new_call})
    assert "the old form was not put back" not in result.stdout + result.stderr
    if shell == "powershell":
        assert expected not in result.stdout, result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert expected in result.stdout, result.stdout


@pytest.mark.parametrize("shell", SHELLS)
def test_a_failure_that_must_stop_still_stops_with_its_own_error(tmp_path, shell, fake_engine):
    """Not silent where it stopped before: a volume list that fails during the migration
    stops it with volume_list_failed, in both shells, not with Podman's stderr."""
    result = _run(tmp_path, shell, ["Get-RuntimeMigrationVolumeId", "Get-RuntimeMigrationPodmanArgs"], VOLUME, fake_engine, {})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "STOPPED=volume_list_failed:docker:broker_data" in result.stdout, result.stdout + result.stderr
