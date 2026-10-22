"""Native fakes for the tests that run the Windows scripts, on Windows as on Linux.

On Linux and macOS a fake program is a POSIX sh script, and PowerShell 7 runs a
file named podman.exe as an application. On Windows the same sh script runs
under Git for Windows' bash, behind a small native launcher named like the real
program (podman.exe, wsl.exe, docker.exe): the scripts look programs up with
Get-Command -CommandType Application and run them as native processes, so a
.cmd would not do.

The shell under test there is the one named by JHT_TEST_SHELL: `powershell`
(Windows PowerShell 5.1, the one the app uses, and the default) or `pwsh`.
Every run records which engine ran it (ENGINE_CHECK) and `assert_engine` fails
if it is not the one named: 5.1 hands a JSON array to the pipeline as one
object, 7 enumerates it. A missing shell, bash or compiler on Windows is a
failure, never a skip.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

import pytest

WINDOWS = os.name == "nt"

# PowerShell that writes, to $env:JHT_ENGINE_FILE, the engine running it.
ENGINE_CHECK = (
    "$jhtEngine = if ($PSVersionTable.PSVersion.Major -eq 5 -and @('[1,2]' | ConvertFrom-Json).Count -eq 1) { '5.1' } "
    "elseif ($PSVersionTable.PSVersion.Major -ge 7 -and @('[1,2]' | ConvertFrom-Json).Count -eq 2) { '7' } "
    "else { 'unknown' }\n"
    "[IO.File]::WriteAllText($env:JHT_ENGINE_FILE, $jhtEngine)\n"
)


def _required() -> bool:
    return bool(os.environ.get("CI")) or os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1"


def _shell_name() -> str:
    return os.environ.get("JHT_TEST_SHELL", "powershell")


def powershell() -> str:
    """The PowerShell under test: pwsh off Windows, the one JHT_TEST_SHELL names on Windows."""
    if WINDOWS:
        name = _shell_name()
        if name == "powershell":
            path = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            found = str(path) if path.is_file() else ""
        elif name == "pwsh":
            found = shutil.which("pwsh") or ""
        else:
            pytest.fail(f"JHT_TEST_SHELL={name}: expected powershell or pwsh")
    else:
        found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh") or ""
    if found:
        return found
    if _required():
        pytest.fail("the PowerShell under test is missing: these cases would go untested")
    pytest.skip("PowerShell not installed")


def expected_engine() -> str:
    return "5.1" if WINDOWS and _shell_name() == "powershell" else "7"


def assert_engine(engine_file: Path, stderr: str = "") -> None:
    ran = engine_file.read_text(encoding="utf-8").strip() if engine_file.exists() else "none"
    assert ran == expected_engine(), f"the case ran under PowerShell {ran}, not {expected_engine()}: {stderr[-400:]}"


def git_bash() -> Path:
    """Git for Windows' bash; JHT_TEST_BASH, when set, is the only candidate. Missing is a failure."""
    override = os.environ.get("JHT_TEST_BASH")
    candidates = [override] if override else []
    if not override:
        git = shutil.which("git")
        if git:
            candidates.append(str(Path(git).resolve().parents[1] / "usr" / "bin" / "bash.exe"))
        candidates.append(r"C:\Program Files\Git\usr\bin\bash.exe")
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    pytest.fail("Git for Windows' bash is missing: the sh fakes cannot run, and a skip would prove nothing")


# Runs <its own name>.sh next to it with Git's bash, every argument quoted as
# one word, and gives back its exit code. Standard streams are inherited, as a
# real child process would have them.
LAUNCHER = r"""
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
public static class FakeLauncher {
  static string Quote(string arg) {
    var sb = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); slashes = 0; continue; }
      sb.Append('\\', slashes); slashes = 0; sb.Append(c);
    }
    sb.Append('\\', slashes * 2);
    return sb.Append('"').ToString();
  }
  public static int Main(string[] args) {
    string self = Process.GetCurrentProcess().MainModule.FileName;
    var psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("JHT_FAKE_BASH"));
    var line = new StringBuilder(Quote(Path.ChangeExtension(self, ".sh")));
    foreach (string arg in args) { line.Append(' ').Append(Quote(arg)); }
    psi.Arguments = line.ToString();
    psi.UseShellExecute = false;
    using (var child = Process.Start(psi)) { child.WaitForExit(); return child.ExitCode; }
  }
}
"""


@lru_cache(maxsize=1)
def launcher() -> Path:
    root = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "Microsoft.NET"
    compilers = [root / "Framework64" / "v4.0.30319" / "csc.exe", root / "Framework" / "v4.0.30319" / "csc.exe"]
    csc = next((c for c in compilers if c.is_file()), None)
    if csc is None:
        pytest.fail("the .NET Framework C# compiler is missing: the native fakes cannot be built")
    out = Path(tempfile.mkdtemp(prefix="jht-fake-launcher-"))
    (out / "launcher.cs").write_text(LAUNCHER, encoding="utf-8")
    built = subprocess.run(
        [str(csc), "/nologo", "/target:exe", f"/out:{out / 'launcher.exe'}", str(out / "launcher.cs")],
        capture_output=True, text=True, timeout=120,
    )
    if built.returncode != 0:
        pytest.fail(f"the fake launcher does not compile:\n{built.stdout}{built.stderr}")
    return out / "launcher.exe"


def install_fake(directory: Path, name: str, script: str) -> Path:
    """Puts the sh `script` in `directory` as the program `name` and returns the path to run.

    Off Windows that is the script itself. On Windows it is <stem>.exe, the
    launcher, next to <stem>.sh; MSYS bash starts with the caller's PATH, so
    /usr/bin is appended after it: the other fakes keep winning over Git's tools."""
    if not WINDOWS:
        path = directory / name
        path.write_text(script, encoding="utf-8")
        path.chmod(0o755)
        return path
    stem = name[:-4] if name.lower().endswith(".exe") else name
    first, _, rest = script.partition("\n")
    if first.startswith("#!"):
        script = f'{first}\nPATH="$PATH:/usr/bin"\n{rest}'
    else:
        script = f'PATH="$PATH:/usr/bin"\n{script}'
    (directory / f"{stem}.sh").write_text(script, encoding="utf-8", newline="\n")
    shutil.copyfile(launcher(), directory / f"{stem}.exe")
    return directory / f"{stem}.exe"


def windows_env(tmp_path: Path) -> dict[str, str]:
    """What Windows needs to start a shell, with the person's folders moved into the test's:
    nothing the scripts touch through them is real. The caller's PATH must have no System32,
    so the real wsl.exe or podman.exe can never answer instead of a fake."""
    home = tmp_path / "user"
    for sub in ("AppData/Roaming", "AppData/Local", "Temp"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    env = {key: os.environ[key] for key in ("SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT",
                                            "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS") if key in os.environ}
    env.update({
        "USERPROFILE": str(home), "APPDATA": str(home / "AppData" / "Roaming"),
        "LOCALAPPDATA": str(home / "AppData" / "Local"), "TEMP": str(home / "Temp"), "TMP": str(home / "Temp"),
        "JHT_FAKE_BASH": str(git_bash()),
    })
    return env
