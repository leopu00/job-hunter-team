"""`jht-wrapper.ps1` only takes from host.env the values that have the domain of the bash wrapper.

host.env is writable by the agents, and the wrapper hands its values to `docker exec -e "JHT_HOST_TYPE=..."`. Windows PowerShell 5.1
does not escape the quotes of a native argument, so a value like `local" --user root "` becomes more arguments for the engine. The
values now have the domain of `jht_host_env_value_valid` in the bash wrapper (`local|vps`, the seven languages, the characters of a
time zone name) or are ignored, as the bash wrapper ignores them.

The check of the source runs everywhere; the rest runs the wrapper's real function and reading block in Windows PowerShell 5.1 and in
PowerShell 7, with the argument form against a native program that records what it received. The Windows config ACL gate runs this
file with `JHT_REQUIRE_WINDOWS_SHELLS=1`: a missing shell is a failure, not a skip.
"""

from __future__ import annotations

import base64
import re
from pathlib import Path

import pytest
from test_windows_host_env_is_not_written_through_a_link import EVIL, ROOT, SHELLS, _function, _run, windows_only

WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"


def _reading_block() -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    match = re.search(r"^\$AllowedHostEnvNames = .*?^if \(-not \$env:JHT_USER_TZ\)[^\n]*\n", source, re.S | re.M)
    assert match, "the host.env reading block is missing"
    return match.group(0)


# ── the source, on every machine ───────────────────────────────────────────

def test_the_wrapper_checks_the_domain_before_it_sets_the_environment():
    source = WRAPPER.read_text(encoding="utf-8")
    check = source.index("Test-HostEnvValue -Name $name -Value $value")
    assert check < source.index('Set-Item -Path "env:$name" -Value $value')
    domain = _function(source, "Test-HostEnvValue")
    for expected in ("'local'", "'vps'", "en|it|hu|es|de|fr|pt", "A-Za-z0-9_+./-"):
        assert expected in domain


# ── the real code, in both shells ──────────────────────────────────────────

DOMAIN = (
    ("JHT_HOST_TYPE", "local", True), ("JHT_HOST_TYPE", "vps", True),
    ("JHT_HOST_TYPE", "Local", False), ("JHT_HOST_TYPE", "server", False), ("JHT_HOST_TYPE", "", False),
    ("JHT_HOST_TYPE", "local ", False), ("JHT_HOST_TYPE", EVIL, False),
    ("JHT_LANG", "en", True), ("JHT_LANG", "pt", True), ("JHT_LANG", "xx", False), ("JHT_LANG", "en --user root", False),
    ("JHT_USER_TZ", "Europe/Rome", True), ("JHT_USER_TZ", "Etc/GMT+1", True), ("JHT_USER_TZ", "UTC", True),
    ("JHT_USER_TZ", "", False), ("JHT_USER_TZ", "Europe/Rome; calc", False), ("JHT_USER_TZ", "a b", False),
    ("JHT_USER_TZ", 'Europe/Rome" --user root "', False), ("JHT_OTHER", "local", False),
)


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_the_domain_is_the_one_of_the_bash_wrapper(shell: str, tmp_path: Path):
    function = _function(WRAPPER.read_text(encoding="utf-8"), "Test-HostEnvValue")
    lines = [function]
    for name, value, _ in DOMAIN:
        encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
        lines.append(f"$v = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}'))")
        lines.append(f"Write-Output ('{name}|{encoded}|' + (Test-HostEnvValue -Name '{name}' -Value $v))")
    done = _run(shell, "\n".join(lines) + "\n", tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    answered = [line.split("|") for line in done.stdout.split()]
    assert [(n, base64.b64decode(v).decode("utf-8"), r == "True") for n, v, r in answered] == list(DOMAIN)


FAKE_SOURCE = r"""
using System;
using System.IO;
using System.Text;

public static class FakeEngine
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
        return 0;
    }
}
"""


def _received(shell: str, tmp_path: Path, host_env_text: str) -> list[str]:
    """What the engine receives from the wrapper's real reading block and its `-e "JHT_HOST_TYPE=..."` argument."""
    source = tmp_path / "FakeEngine.cs"
    source.write_text(FAKE_SOURCE, encoding="utf-8")
    exe = tmp_path / "docker.exe"
    compiled = _run("powershell", "Add-Type -Path $env:FAKE_SOURCE -OutputAssembly $env:FAKE_EXE -OutputType ConsoleApplication\n",
                    tmp_path, FAKE_SOURCE=str(source), FAKE_EXE=str(exe))
    assert compiled.returncode == 0 and exe.is_file(), compiled.stdout + compiled.stderr
    host_env = tmp_path / "host.env"
    host_env.write_bytes(host_env_text.encode("utf-8"))
    log = tmp_path / "engine.log"
    script = (
        f"$HostEnvFile = '{host_env}'\n"
        + _function(WRAPPER.read_text(encoding="utf-8"), "Test-HostEnvValue")
        + "\n" + _reading_block()
        + f"\n& '{exe}' exec -i -e \"JHT_HOST_TYPE=$env:JHT_HOST_TYPE\" -e \"JHT_LANG=$env:JHT_LANG\" -e \"JHT_USER_TZ=$env:JHT_USER_TZ\" container node\n"
    )
    done = _run(shell, script, tmp_path, FAKE_LOG=str(log), JHT_HOST_TYPE="", JHT_LANG="", JHT_USER_TZ="")
    assert done.returncode == 0, done.stdout + done.stderr
    (line,) = log.read_text(encoding="utf-8").splitlines()
    return [base64.b64decode(part).decode("utf-8") for part in line.split(",")]


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_value_with_quotes_never_adds_arguments_to_the_engine(shell: str, tmp_path: Path):
    args = _received(shell, tmp_path, f"JHT_HOST_TYPE={EVIL}\nJHT_LANG=en\nJHT_USER_TZ=Europe/Rome\n")
    assert args == ["exec", "-i", "-e", "JHT_HOST_TYPE=unknown", "-e", "JHT_LANG=en", "-e", "JHT_USER_TZ=Europe/Rome", "container", "node"]


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_valid_values_still_reach_the_engine(shell: str, tmp_path: Path):
    args = _received(shell, tmp_path, "# written by the installer\nJHT_HOST_TYPE=vps\nJHT_LANG=\"it\"\nJHT_USER_TZ='Europe/Rome'\n")
    assert args == ["exec", "-i", "-e", "JHT_HOST_TYPE=vps", "-e", "JHT_LANG=it", "-e", "JHT_USER_TZ=Europe/Rome", "container", "node"]
