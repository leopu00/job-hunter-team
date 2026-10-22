"""No double quote inside an argument the Windows scripts hand to a native program.

Windows PowerShell 5.1, the shell the app runs the scripts with, drops the double
quotes inside a native argument; PowerShell 7 keeps them, and `\\"` breaks 7. The
setup stopped on it after the pull (T71): `{{index .Config.Labels "com.docker.compose.project"}}`
reached Podman as `index .Config.Labels com.docker...`, «function "com" not defined».
The same class lived in the chat's send (`"$1" "$msg"`: the message was split into
words and globbed), in a machine shell line and in the probe.

- the gate reads every scripts/*.ps1 through the PowerShell AST and fails on a
  string with a double quote in an argument of a native call (`& ...`, a known
  program, or the scripts' own forwarders);
- it sees the old lines (counter-check carried with it);
- the chat's send keeps the message whole with the quote-free shell line, and
  the old line as 5.1 delivered it does not.

The real 5.1 next to 7 runs on Windows: test_windows_powershell51_native_quotes.py.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
WRAPPER = SCRIPTS / "jht-wrapper.ps1"

GATE = r"""
$ErrorActionPreference = 'Stop'
$native = @('docker', 'docker.exe', 'podman', 'podman.exe', 'wsl', 'wsl.exe', 'ssh', 'ssh.exe', 'ssh-keygen',
  'ssh-keyscan', 'winget', 'winget.exe', 'curl', 'curl.exe', 'sh', 'bash', 'node', 'python', 'python3', 'icacls',
  'icacls.exe', 'schtasks', 'schtasks.exe', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'git', 'tar', 'tar.exe', 'reg', 'reg.exe', 'netsh', 'netsh.exe')
$forwarders = @('Invoke-Checked', 'Invoke-NativeChecked', 'Invoke-MachineShell')
$scanned = 0
foreach ($path in ($env:JHT_GATE_FILES -split [IO.Path]::PathSeparator)) {
  if (-not $path) { continue }
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "parse ${path}: $($errors[0])" }
  foreach ($command in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    $first = $command.CommandElements[0]
    $name = $command.GetCommandName()
    $isNative = ($command.InvocationOperator -eq 'Ampersand' -and $first -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst]) -or
      ($name -and (($native -contains $name.ToLowerInvariant()) -or ($forwarders -contains $name)))
    if (-not $isNative) { continue }
    $scanned++
    for ($i = 1; $i -lt $command.CommandElements.Count; $i++) {
      $strings = $command.CommandElements[$i].FindAll({ param($n)
        $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -or
        $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] }, $true)
      foreach ($string in $strings) {
        if ($string.Value.Contains('"')) {
          [Console]::Out.WriteLine("QUOTE $([IO.Path]::GetFileName($path)):$($string.Extent.StartLineNumber)")
        }
      }
    }
  }
}
[Console]::Out.WriteLine("SCANNED $scanned")
"""


def _pwsh() -> str:
    found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if found:
        return found
    if os.environ.get("CI"):
        pytest.fail("pwsh is missing on the CI runner: the native-argument gate would go untested")
    pytest.skip("pwsh not installed")


def _gate(tmp_path: Path, files: list[Path]) -> tuple[list[str], int]:
    script = tmp_path / "gate.ps1"
    script.write_text(GATE, encoding="utf-8")
    result = subprocess.run(
        [_pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(script)],
        env={**os.environ, "JHT_GATE_FILES": os.pathsep.join(str(f) for f in files)},
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    found = sorted(set(re.findall(r"^QUOTE (\S+)$", result.stdout, flags=re.MULTILINE)))
    scanned = int(re.search(r"^SCANNED (\d+)$", result.stdout, flags=re.MULTILINE).group(1))
    return found, scanned


def test_no_native_argument_in_the_windows_scripts_carries_a_double_quote(tmp_path):
    files = sorted(SCRIPTS.glob("*.ps1"))
    assert len(files) >= 8, files
    found, scanned = _gate(tmp_path, files)
    assert found == [], "Windows PowerShell 5.1 drops these double quotes: " + ", ".join(found)
    # it read the scripts' native calls, not an empty search
    assert scanned > 100, scanned


def test_the_gate_sees_the_old_lines_and_nothing_else(tmp_path):
    old = tmp_path / "old.ps1"
    old.write_text(
        "[string]$p = (& $Podman --connection $MachineName inspect jht --format '{{index .Config.Labels \"com.docker.compose.project\"}}' 2>$null)\n"
        "& docker exec -i $containerId sh -c 'msg=$(cat); exec jht-tmux-send \"$1\" \"$msg\"' sh $ChatArgs[1]\n"
        "Invoke-MachineShell (\"set -e; \" + \"if [ `\"`$(true)`\" = yes ]; then :; fi\")\n"
        "Invoke-NativeChecked 'docker' 'exec' 'jht' 'sh' '-lc' 'test \"$(cat /x)\" = y'\n"
        "Write-Host 'a \"quoted\" word is fine for a cmdlet'\n"
        "$text = 'a \"quoted\" word is fine in a variable'\n",
        encoding="utf-8",
    )
    found, _ = _gate(tmp_path, [old])
    assert found == ["old.ps1:1", "old.ps1:2", "old.ps1:3", "old.ps1:4"]


def _chat_line() -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    found = re.findall(r"& docker exec -i \$containerId sh -c '([^']*)' sh \$ChatArgs\[1\]", source)
    assert len(found) == 1, found
    return found[0]


def _send(tmp_path: Path, script: str, message: str) -> list[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    received = tmp_path / "received"
    fake = bin_dir / "jht-tmux-send"
    fake.write_text(f"#!/bin/sh\nfor a in \"$@\"; do printf '%s\\0' \"$a\"; done > {received}\n", encoding="utf-8")
    fake.chmod(0o755)
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    for name in ("a.ps1", "b.ps1"):
        (work / name).write_text("", encoding="utf-8")
    subprocess.run(
        ["sh", "-c", script, "sh", "CAPITANO"], input=message, text=True, cwd=work, check=True, timeout=30,
        env={**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"},
    )
    return received.read_text(encoding="utf-8").split("\0")[:-1]


MESSAGE = "two  spaces\nand a new line, *.ps1 and ? stay"


@pytest.mark.skipif(os.name == "nt" or not shutil.which("sh"), reason="needs a POSIX sh, like the container's")
def test_the_chat_send_line_keeps_the_message_whole(tmp_path):
    line = _chat_line()
    assert '"' not in line
    assert _send(tmp_path, line, MESSAGE + "\n") == ["CAPITANO", MESSAGE]


@pytest.mark.skipif(os.name == "nt" or not shutil.which("sh"), reason="needs a POSIX sh, like the container's")
def test_the_old_chat_send_line_as_51_delivered_it_split_and_globbed_the_message(tmp_path):
    """The defect the quote-free line removes: 5.1 dropped the quotes of `"$1" "$msg"`."""
    as_delivered = "msg=$(cat); exec jht-tmux-send $1 $msg"
    args = _send(tmp_path, as_delivered, MESSAGE + "\n")
    assert args[0] == "CAPITANO" and args[1:] != [MESSAGE]
    assert "a.ps1" in args and "*.ps1" not in args
