"""Windows PowerShell 5.1 next to PowerShell 7 on the arguments the scripts hand to Podman and Docker.

The app runs the Windows scripts with Windows PowerShell 5.1, which drops the
double quotes inside a native argument; PowerShell 7 keeps them. After the pull
the setup stopped on the enabler's `--format '{{index .Config.Labels "com.docker.compose.project"}}'`:
Podman received `index .Config.Labels com.docker...` and answered «function "com"
not defined» (T71, N2 of the push 8 collaudo).

The fake `podman.exe` / `docker.exe` here is a real native program (C#, compiled
with Add-Type), so each shell hands it its arguments the way it hands them to
the real ones; it records them exactly as it received them, and answers the Go
template as Podman would, the mangled one with Podman's error.

- the enabler reads the existing container's compose project in both shells;
- the same read with the old template is refused under 5.1 only: the gate still
  sees the defect, and is not green because it runs 7;
- the wrapper finds the running compose service in both shells;
- the chat's send hands `sh -c` its line whole in both shells.

The Windows config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`:
a missing shell is a failure, not a skip.
"""

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"

pytestmark = pytest.mark.skipif(os.name != "nt", reason="needs Windows PowerShell 5.1, which only Windows has")

SHELLS = ("powershell", "pwsh")
LABELS = json.dumps({"com.docker.compose.project": "jht", "com.docker.compose.service": "jht"})
CONTAINER_ID = "0123456789abcdef"
OLD_TEMPLATE = '{{index .Config.Labels "com.docker.compose.project"}}'
OLD_ENABLER_READ = (
    "[string]$existingProject = (& $Podman --connection $MachineName inspect jht --format "
    "'" + OLD_TEMPLATE + "' 2>$null | Select-Object -First 1)\n"
    "$existingProject = $existingProject.Trim()\n"
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
using System.IO;
using System.Text;

public static class FakeContainerEngine
{
    public static int Main(string[] args)
    {
        var line = new StringBuilder();
        foreach (var arg in args)
        {
            if (line.Length > 0) line.Append(',');
            line.Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
        }
        File.AppendAllText(Environment.GetEnvironmentVariable("FAKE_LOG"), line.ToString() + "\n");
        if (Array.IndexOf(args, "ps") >= 0 && Array.IndexOf(args, "-q") >= 0)
        {
            Console.WriteLine(Environment.GetEnvironmentVariable("FAKE_ID"));
            return 0;
        }
        int at = Array.IndexOf(args, "--format");
        if (at < 0 || at + 1 >= args.Length) return 0;
        string format = args[at + 1];
        string labels = Environment.GetEnvironmentVariable("FAKE_LABELS");
        if (format == "{{json .Config.Labels}}") { Console.WriteLine(labels); return 0; }
        if (format == "{{.State.Running}}|{{json .Config.Labels}}") { Console.WriteLine("true|" + labels); return 0; }
        if (format == "{{index .Config.Labels \"com.docker.compose.project\"}}") { Console.WriteLine("jht"); return 0; }
        if (format.StartsWith("{{index .Config.Labels com."))
        {
            Console.Error.WriteLine("Error: template: inspect:1: function \"com\" not defined");
            return 125;
        }
        return 0;
    }
}
"""


@pytest.fixture(scope="module")
def fake_engine(tmp_path_factory):
    """podman.exe and docker.exe: one native program, compiled by Windows PowerShell 5.1's Add-Type."""
    root = tmp_path_factory.mktemp("fake-engine")
    source = root / "FakeContainerEngine.cs"
    source.write_text(FAKE_SOURCE, encoding="utf-8")
    exe = root / "fake-engine.exe"
    compile_ps = (
        "Add-Type -Path $env:FAKE_SOURCE -OutputAssembly $env:FAKE_EXE -OutputType ConsoleApplication"
    )
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
"""

# The enabler's top-level statements that read the existing container's compose project.
ENABLER_BLOCK = r"""
$statements = @($ast.EndBlock.Statements)
$first = -1; $last = -1
for ($i = 0; $i -lt $statements.Count; $i++) {
  $text = $statements[$i].Extent.Text
  if ($first -lt 0 -and $text -match '^\[string\]\$existingLabelsJson = ') { $first = $i }
  if ($first -ge 0 -and $text -match '^\[string\]\$existingCgroupManager = ') { $last = $i - 1; break }
}
if ($first -lt 0 -or $last -lt $first) { throw 'project block missing' }
$block = (@($statements[$first..$last]) | ForEach-Object { $_.Extent.Text }) -join "`n"
if ($env:JHT_OLD_READ) { $block = $env:JHT_OLD_READ }
$Podman = Join-Path $env:FAKE_BIN 'podman.exe'
$MachineName = 'jht-podman'
. ([scriptblock]::Create($block))
[Console]::Out.WriteLine("PROJECT=$existingProject")
"""

WRAPPER_SERVICE = r"""
function Get-ComposeProjectName { 'jht' }
$ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
$ContainerRuntime = 'docker'; $Container = 'jht'; $BrokerContainer = 'jht-broker'; $TelegramContainer = 'jht-telegram'
[Console]::Out.WriteLine("ID=$(Get-RunningComposeServiceId -Service 'jht')")
"""

# The chat's send, exactly as the wrapper writes it, with the values it gets.
WRAPPER_SEND = r"""
$send = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.Extent.Text -match 'jht-tmux-send' }, $true)
if (-not $send) { throw 'send line missing' }
$containerId = 'cid'
$ChatArgs = @('send', 'CAPITANO')
. ([scriptblock]::Create($send.Extent.Text))
"""


def _run(tmp_path: Path, shell: str, script: Path, imports: list[str], body: str, bin_dir: Path, env: dict[str, str]):
    harness = tmp_path / "case.ps1"
    harness.write_text(IMPORT + body, encoding="utf-8-sig")
    log = tmp_path / "calls.log"
    log.write_text("", encoding="utf-8")
    run_env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
        "FAKE_BIN": str(bin_dir),
        "FAKE_LOG": str(log),
        "FAKE_LABELS": LABELS,
        "FAKE_ID": CONTAINER_ID,
        "JHT_UNDER_TEST": str(script),
        "JHT_IMPORT": ",".join(imports),
        **env,
    }
    result = subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(harness)],
        env=run_env, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    calls = [
        [base64.b64decode(part).decode("utf-8") for part in line.split(",") if part] if line else []
        for line in log.read_text(encoding="utf-8").splitlines()
    ]
    return result, calls


def _formats(calls: list[list[str]]) -> list[str]:
    return [call[call.index("--format") + 1] for call in calls if "--format" in call]


@pytest.mark.parametrize("shell", SHELLS)
def test_the_enabler_reads_the_compose_project_in_both_shells(tmp_path, shell, fake_engine):
    result, calls = _run(tmp_path, shell, ENABLER, [], ENABLER_BLOCK, fake_engine, {"JHT_OLD_READ": ""})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PROJECT=jht" in result.stdout, result.stdout + result.stderr
    assert _formats(calls) == ["{{json .Config.Labels}}"]


@pytest.mark.parametrize("shell", SHELLS)
def test_the_old_template_is_refused_under_51_only(tmp_path, shell, fake_engine):
    """The counter-check the gate carries with it: the defect is visible here, and only in 5.1."""
    result, calls = _run(tmp_path, shell, ENABLER, [], ENABLER_BLOCK, fake_engine, {"JHT_OLD_READ": OLD_ENABLER_READ})
    if shell == "powershell":
        # Podman got the template without its quotes and refused it: no project (with the
        # script's `Stop` preference 5.1 may also end on Podman's stderr, as the setup did)
        assert _formats(calls) == ["{{index .Config.Labels com.docker.compose.project}}"]
        assert "PROJECT=jht" not in result.stdout, result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert _formats(calls) == [OLD_TEMPLATE]
        assert "PROJECT=jht" in result.stdout, result.stdout


@pytest.mark.parametrize("shell", SHELLS)
def test_the_wrapper_finds_the_running_compose_service_in_both_shells(tmp_path, shell, fake_engine):
    result, calls = _run(
        tmp_path, shell, WRAPPER, ["Get-RunningComposeServiceId"], WRAPPER_SERVICE, fake_engine, {},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"ID={CONTAINER_ID}" in result.stdout, result.stdout + result.stderr
    assert _formats(calls) == ["{{.State.Running}}|{{json .Config.Labels}}"]


@pytest.mark.parametrize("shell", SHELLS)
def test_the_chat_send_reaches_sh_whole_in_both_shells(tmp_path, shell, fake_engine):
    result, calls = _run(tmp_path, shell, WRAPPER, [], WRAPPER_SEND, fake_engine, {})
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == [[
        "exec", "-i", "cid", "sh", "-c", "IFS=; set -f; msg=$(cat); exec jht-tmux-send $1 $msg", "sh", "CAPITANO",
    ]]
