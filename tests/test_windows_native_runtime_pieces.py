"""The Podman-in-WSL pieces that only a real Windows can run.

`test_windows_podman_wsl_branches.py` tests the branches on Linux with fake
programs. Two pieces cannot be faked there:

- the `docker.exe` shim the enabler compiles with Add-Type: it must forward
  every argument byte for byte (spaces, quotes, trailing backslashes, empty
  strings) and give back the exit code of the backend;
- `ConvertTo-WslPath`, which leans on `[IO.Path]::GetFullPath`: on Linux a
  `C:\\...` path is just a relative file name, so only Windows answers.

Both run under Windows PowerShell 5.1 (`powershell`, what the installer uses)
and PowerShell 7 (`pwsh`), because .NET Framework and .NET resolve paths
differently. The Windows config ACL gate runs this file; with
`JHT_REQUIRE_WINDOWS_SHELLS=1` a missing shell is a failure, not a skip.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
ENABLE = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"

pytestmark = pytest.mark.skipif(os.name != "nt", reason="needs Windows: Add-Type executables and Windows paths")

SHELLS = ("powershell", "pwsh")


def _shell(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is not on PATH, and this gate requires it")
    pytest.skip(f"{name} not installed")


def _import(script: Path, *names: str) -> str:
    """PowerShell that defines the named functions exactly as the script has them."""
    wanted = ", ".join(f"'{name}'" for name in names)
    return (
        "$tokens=$null; $errors=$null; "
        f"$ast=[System.Management.Automation.Language.Parser]::ParseFile('{script}',[ref]$tokens,[ref]$errors); "
        f"$wanted=@({wanted}); "
        "$found=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] "
        "-and $wanted -contains $node.Name}, $true); "
        "if (@($found).Count -ne $wanted.Count) { throw \"functions not found: $wanted\" }; "
        "foreach ($fn in $found) { Invoke-Expression $fn.Extent.Text }; "
    )


def _run(shell: str, command: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [shell, "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
        cwd=cwd,
    )


# A backend that writes back what it received, one argument per line, as
# [length]value: an empty argument and a trailing space stay visible.
ARGV_DUMPER = r"""
using System;
using System.IO;
using System.Text;
public static class ArgvDump {
  public static int Main(string[] args) {
    var sb = new StringBuilder();
    foreach (var a in args) { sb.Append('[').Append(a.Length).Append(']').Append(a).Append('\n'); }
    File.WriteAllText(Environment.GetEnvironmentVariable("JHT_ARGV_OUT"), sb.ToString(), new UTF8Encoding(false));
    var code = Environment.GetEnvironmentVariable("JHT_ARGV_EXIT");
    return string.IsNullOrEmpty(code) ? 0 : int.Parse(code);
  }
}
"""

FORWARDED = [
    "compose",
    "--project-directory",
    r"C:\Users\Test User\Documents\Job Hunter Team",
    'say "hi"',
    "trailing\\",
    r"with space and slash\\",
    "",
    "--format={{.Names}}",
    "a\tb",
]


def _shim(shell: str, tmp_path: Path) -> Path:
    """The enabler's docker.exe, pointed at a backend that writes back its argv."""
    dumper_source = tmp_path / "ArgvDump.cs"
    dumper_source.write_text(ARGV_DUMPER, encoding="utf-8")
    dumper = tmp_path / "argv-dump.exe"
    shim = tmp_path / "bin" / "docker.exe"
    command = (
        _import(ENABLE, "New-DockerShim")
        + f"Add-Type -TypeDefinition ([IO.File]::ReadAllText('{dumper_source}')) "
        + f"-OutputAssembly '{dumper}' -OutputType ConsoleApplication; "
        + f"New-Item -ItemType Directory -Force -Path '{shim.parent}' | Out-Null; "
        + f"New-DockerShim -Destination '{shim}' -PodmanPath '{dumper}'"
    )
    result = _run(shell, command)
    assert result.returncode == 0, result.stdout + result.stderr
    assert shim.is_file()
    return shim


def _call_shim(shim: Path, tmp_path: Path, args: list[str], exit_code: int) -> tuple[int, str]:
    out = tmp_path / "argv.txt"
    out.unlink(missing_ok=True)
    env = {**os.environ, "JHT_ARGV_OUT": str(out), "JHT_ARGV_EXIT": str(exit_code)}
    # Python builds the command line with the same Windows rules the shim
    # parses with, so what the shim sees as argv is exactly `args`.
    result = subprocess.run([str(shim), *args], capture_output=True, text=True, timeout=60, env=env)
    return result.returncode, out.read_text(encoding="utf-8")


@pytest.mark.parametrize("shell_name", SHELLS)
def test_the_enabler_docker_shim_forwards_every_argument_and_the_exit_code(shell_name, tmp_path):
    shim = _shim(_shell(shell_name), tmp_path)

    code, received = _call_shim(shim, tmp_path, FORWARDED, 0)
    assert code == 0
    assert received == "".join(f"[{len(arg)}]{arg}\n" for arg in FORWARDED)

    code, received = _call_shim(shim, tmp_path, ["compose", "up"], 23)
    assert code == 23
    assert received == "[7]compose\n[2]up\n"


def _map(shell: str, script: Path, paths: list[str], tmp_path: Path, cwd: Path | None = None) -> list[dict]:
    """ConvertTo-WslPath on every path in one PowerShell: {"ok": mapped} or {"error": message}.

    The paths travel in a UTF-8 JSON file, not on the command line: no quoting
    of their own, and a non-ASCII name arrives as it is.
    """
    paths_file = tmp_path / "windows-paths.json"
    paths_file.write_text(json.dumps(paths), encoding="utf-8")
    command = (
        _import(script, "ConvertTo-WslPath")
        + f"$paths = [IO.File]::ReadAllText('{paths_file}', [Text.Encoding]::UTF8) | ConvertFrom-Json; "
        + "$results = foreach ($p in $paths) { "
        + "try { @{ ok = (ConvertTo-WslPath $p) } } catch { @{ error = $_.Exception.Message } } }; "
        + "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); "
        + "[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($results)))"
    )
    result = _run(shell, command, cwd=cwd)
    assert result.returncode == 0, result.stdout + result.stderr
    answers = json.loads(result.stdout)
    assert len(answers) == len(paths), answers
    return answers


MAPPED = [
    (
        r"C:\Users\Test User\Documents\Job Hunter Team\.jht",
        "/mnt/c/Users/Test User/Documents/Job Hunter Team/.jht",
    ),
    (r"D:\data\jht", "/mnt/d/data/jht"),
    (r"c:\lower\drive", "/mnt/c/lower/drive"),
    ("C:/Users/forward/slashes", "/mnt/c/Users/forward/slashes"),
    (r"C:\a\..\b\.\c", "/mnt/c/b/c"),
    ("C:\\Users\\Zoë Ünïcode\\Job Hunter Team", "/mnt/c/Users/Zoë Ünïcode/Job Hunter Team"),
]

UNMAPPABLE = [r"\\server\share\jht", r"\\?\C:\Users\jht", r"\\.\pipe\podman"]

SCRIPTS = (ENABLE, NETWORK)

_answers: dict[tuple[str, Path], dict[str, dict]] = {}


def _answer(shell_name: str, script: Path, path: str, tmp_path: Path) -> dict:
    key = (shell_name, script)
    if key not in _answers:
        paths = [windows for windows, _ in MAPPED] + UNMAPPABLE
        _answers[key] = dict(zip(paths, _map(_shell(shell_name), script, paths, tmp_path)))
    return _answers[key][path]


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda s: s.stem)
@pytest.mark.parametrize("shell_name", SHELLS)
@pytest.mark.parametrize(("windows_path", "wsl_path"), MAPPED, ids=[m[1] for m in MAPPED])
def test_a_windows_path_maps_into_the_wsl_mount(shell_name, script, windows_path, wsl_path, tmp_path):
    assert _answer(shell_name, script, windows_path, tmp_path) == {"ok": wsl_path}


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda s: s.stem)
@pytest.mark.parametrize("shell_name", SHELLS)
@pytest.mark.parametrize("windows_path", UNMAPPABLE)
def test_a_path_wsl_cannot_mount_is_refused(shell_name, script, windows_path, tmp_path):
    answer = _answer(shell_name, script, windows_path, tmp_path)
    assert list(answer) == ["error"], answer
    assert answer["error"].startswith("Cannot map path into WSL: "), answer


@pytest.mark.parametrize("script", SCRIPTS, ids=lambda s: s.stem)
@pytest.mark.parametrize("shell_name", SHELLS)
def test_a_relative_path_maps_from_the_working_directory(shell_name, script, tmp_path):
    work = tmp_path / "Job Hunter Team"
    work.mkdir()
    [answer] = _map(_shell(shell_name), script, [r"sub dir\file.yml"], tmp_path, cwd=work)
    # The runner's TEMP can be a short 8.3 name (RUNNER~1): the drive and the
    # tail are what the working directory decides.
    drive = str(work)[0].lower()
    assert list(answer) == ["ok"], answer
    assert answer["ok"].startswith(f"/mnt/{drive}/"), answer
    assert answer["ok"].endswith("/Job Hunter Team/sub dir/file.yml"), answer
    assert "\\" not in answer["ok"], answer
