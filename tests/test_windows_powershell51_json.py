"""Windows PowerShell 5.1 next to PowerShell 7 on the JSON the scripts read from Podman.

The app runs the Windows scripts with Windows PowerShell 5.1 (`powershell.exe`,
see `windows_runtime.rs`). In 5.1 `ConvertFrom-Json` does not enumerate a JSON
array through the pipeline: `@($json | ConvertFrom-Json)` is ONE element, the
whole array. PowerShell 7 enumerates it. Every other test of these scripts
runs on Linux under 7, so a pull that 5.1 always refused (Podman 6 lists two
repository digests, the index and the platform manifest) had a green CI.

Here the real blocks run under both shells, with a fake `podman` that is a
native process like the real one (a `.cmd` that hands its arguments to Python):

- a sentinel proves each shell is the one named: 5.1 does not enumerate, 7 does;
- the enabler's post-pull digest check accepts Podman 6's two digests;
- the same check with the old pipeline parse is refused under 5.1 only: the
  gate proves it still sees the defect, and is not green because it runs 7;
- the wrapper and the probe find the JHT machine among two.

The Windows config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`:
a missing shell is a failure, not a skip.
"""

import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
PROBE = ROOT / "scripts" / "podman-windows-probe.ps1"

pytestmark = pytest.mark.skipif(os.name != "nt", reason="needs Windows PowerShell 5.1, which only Windows has")

SHELLS = ("powershell", "pwsh")

IMAGE = "ghcr.io/leopu00/jht"
INDEX_DIGEST = "sha256:" + "1" * 64
PLATFORM_DIGEST = "sha256:" + "2" * 64
# `podman image inspect --format '{{json .RepoDigests}}'` on Podman 6 after a pull by digest.
PODMAN6_REPO_DIGESTS = json.dumps([f"{IMAGE}@{INDEX_DIGEST}", f"{IMAGE}@{PLATFORM_DIGEST}"])
OLD_PARSE = "$repoDigests = @($repoDigestsJson | ConvertFrom-Json)"
TWO_MACHINES = json.dumps([
    {"Name": "podman-machine-default", "Running": False, "Default": True},
    {"Name": "jht-podman", "Running": True, "Default": False},
])


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


FAKE_PODMAN = r"""
import json, os, sys
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as fh:
    fh.write(json.dumps(args) + "\n")
if args[:1] == ["--connection"]:
    args = args[2:]
if args[:3] == ["machine", "list", "--format"]:
    print(os.environ["FAKE_MACHINES"])
elif args[:1] == ["pull"]:
    pass
elif args[:2] == ["image", "inspect"]:
    print(os.environ["FAKE_REPO_DIGESTS"])
else:
    sys.exit(125)
"""


def _fake_podman(tmp_path: Path) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "fake_podman.py").write_text(FAKE_PODMAN, encoding="utf-8")
    cmd = bin_dir / "podman.cmd"
    cmd.write_text(
        f'@echo off\r\n"{sys.executable}" "{bin_dir / "fake_podman.py"}" %*\r\nexit /b %ERRORLEVEL%\r\n',
        encoding="ascii",
    )
    return cmd


# Defines the named functions exactly as the script has them.
IMPORT = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$wanted = @($env:JHT_IMPORT -split ',')
$found = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $n.Name }, $true))
if ($found.Count -ne $wanted.Count) { throw "functions not found: $($env:JHT_IMPORT)" }
foreach ($fn in $found) { Invoke-Expression $fn.Extent.Text }
"""

# The enabler's top-level statements from the pull to the digest decision.
DIGEST_BLOCK = r"""
$statements = @($ast.EndBlock.Statements)
$first = -1; $last = -1
for ($i = 0; $i -lt $statements.Count; $i++) {
  $text = $statements[$i].Extent.Text
  if ($first -lt 0 -and $text -match '^Write-JhtPhase image_pull') { $first = $i }
  if ($first -ge 0 -and $text -match 'has no canonical repository digest') { $last = $i; break }
}
if ($first -lt 0 -or $last -lt 0) { throw 'digest block missing' }
$block = (@($statements[$first..$last]) | ForEach-Object { $_.Extent.Text }) -join "`n"
if ($env:JHT_OLD_PARSE) {
  $parse = [regex]'(?m)^\$repoDigests = .*$'
  if ($parse.Matches($block).Count -ne 1) { throw 'the repoDigests statement is not one line' }
  $block = $parse.Replace($block, { param($m) $env:JHT_OLD_PARSE })
}
$Podman = $env:FAKE_PODMAN
$MachineName = 'jht-podman'
$RuntimeImage = $env:JHT_RUNTIME_IMAGE
$ExpectedImageDigest = $env:JHT_EXPECTED_DIGEST
. ([scriptblock]::Create($block))
[Console]::Out.WriteLine("CANONICAL=$canonicalImage")
"""


def _run(tmp_path: Path, shell: str, script: Path, imports: list[str], body: str, env: dict[str, str]):
    harness = tmp_path / "case.ps1"
    harness.write_text(IMPORT + body, encoding="utf-8-sig")
    log = tmp_path / "calls.log"
    log.touch()
    podman = _fake_podman(tmp_path)
    run_env = {
        **os.environ,
        "PATH": f"{podman.parent}{os.pathsep}{os.environ.get('PATH', '')}",
        "FAKE_PODMAN": str(podman),
        "FAKE_LOG": str(log),
        "JHT_UNDER_TEST": str(script),
        "JHT_IMPORT": ",".join(imports),
        **env,
    }
    result = subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(harness)],
        env=run_env, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]
    return result, calls


@pytest.mark.parametrize("shell", SHELLS)
def test_each_shell_is_the_one_named(shell):
    """Without this a gate that silently ran PowerShell 7 twice would prove nothing about 5.1."""
    # Single quotes only: 5.1 mangles double quotes on its command line.
    probe = "$v = $PSVersionTable.PSVersion.Major; $n = @('[1,2]' | ConvertFrom-Json).Count; [Console]::Out.WriteLine([string]$v + ' ' + [string]$n)"
    result = subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", probe],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert result.returncode == 0, result.stderr
    major, items = (int(part) for part in result.stdout.split())
    if shell == "powershell":
        assert (major, items) == (5, 1), result.stdout
    else:
        assert major >= 7 and items == 2, result.stdout


def _canonical(stdout: str):
    """The whole value: under 5.1 a non-enumerated array prints as every digest joined by
    a space, and a substring check would still find the first one in it."""
    found = re.findall(r"^CANONICAL=(.*)$", stdout, flags=re.MULTILINE)
    return found[-1].strip() if found else None


def _digest_case(tmp_path, shell, *, expected: str, old_parse: bool = False):
    image = f"{IMAGE}@{expected}" if expected else f"{IMAGE}:test"
    return _run(
        tmp_path, shell, ENABLER, ["Invoke-Checked", "Write-JhtPhase"], DIGEST_BLOCK,
        {
            "FAKE_REPO_DIGESTS": PODMAN6_REPO_DIGESTS,
            "JHT_RUNTIME_IMAGE": image,
            "JHT_EXPECTED_DIGEST": expected,
            "JHT_OLD_PARSE": OLD_PARSE if old_parse else "",
        },
    )


@pytest.mark.parametrize("expected", [INDEX_DIGEST, PLATFORM_DIGEST], ids=["index", "platform"])
@pytest.mark.parametrize("shell", SHELLS)
def test_the_pull_is_accepted_whichever_of_podman_6s_two_digests_is_expected(tmp_path, shell, expected):
    result, calls = _digest_case(tmp_path, shell, expected=expected)
    assert result.returncode == 0, result.stdout + result.stderr
    assert _canonical(result.stdout) == f"{IMAGE}@{expected}", result.stdout
    assert calls[0] == ["--connection", "jht-podman", "pull", f"{IMAGE}@{expected}"]
    assert calls[1][:4] == ["--connection", "jht-podman", "image", "inspect"]


@pytest.mark.parametrize("shell", SHELLS)
def test_a_tag_pull_takes_the_first_canonical_digest(tmp_path, shell):
    result, _ = _digest_case(tmp_path, shell, expected="")
    assert result.returncode == 0, result.stdout + result.stderr
    assert _canonical(result.stdout) == f"{IMAGE}@{INDEX_DIGEST}", result.stdout


@pytest.mark.parametrize("shell", SHELLS)
def test_the_old_pipeline_parse_is_refused_under_51_only(tmp_path, shell):
    """The counter-check the gate carries with it: the defect is visible here, and only in 5.1."""
    result, _ = _digest_case(tmp_path, shell, expected=PLATFORM_DIGEST, old_parse=True)
    if shell == "powershell":
        assert result.returncode != 0, result.stdout
        assert "does not expose the expected repository digest" in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("shell", SHELLS)
def test_the_wrapper_finds_the_jht_machine_among_two(tmp_path, shell):
    body = (
        "$state = Get-JhtPodmanMachineState -PodmanPath $env:FAKE_PODMAN -WslPath '' -MachineName 'jht-podman'\n"
        "[Console]::Out.WriteLine(\"STATE=$state\")\n"
    )
    result, _ = _run(tmp_path, shell, WRAPPER, ["Get-JhtPodmanMachineState"], body, {"FAKE_MACHINES": TWO_MACHINES})
    assert result.returncode == 0, result.stderr
    assert "STATE=present" in result.stdout, result.stdout + result.stderr


@pytest.mark.parametrize("shell", SHELLS)
def test_the_probe_finds_the_jht_machine_among_two(tmp_path, shell):
    body = (
        "$machine = Get-MachineState -Name 'jht-podman'\n"
        "[Console]::Out.WriteLine(\"NAME=$($machine.Name) RUNNING=$($machine.Running)\")\n"
    )
    result, _ = _run(tmp_path, shell, PROBE, ["Get-MachineState"], body, {"FAKE_MACHINES": TWO_MACHINES})
    assert result.returncode == 0, result.stderr
    assert "NAME=jht-podman RUNNING=True" in result.stdout, result.stdout + result.stderr
