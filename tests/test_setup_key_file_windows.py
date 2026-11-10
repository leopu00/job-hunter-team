"""`jht setup --api-key-file <file on the Windows host>` for glm and kimi: the wrapper hands the key to the setup on its input.

The setup runs in the container, which sees neither C:\\... nor any mode on ~/.jht. The wrapper reads the file on the host and sends
the key on the standard input of the setup (`--api-key-stdin`), so the key is in no argument, no log and no config. The function and the
branch of the dispatcher are taken from the wrapper and run with pwsh (the CI runs it on Linux and on windows-latest); `docker` is a
function that records what it was given. Keys are made up, built from parts.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
KEY = "-".join(["synthetic", "glm", "key", "ab" * 8])


def _function(name: str) -> str:
    return re.search(rf"^function {name} \{{\n.*?^\}}\n", WRAPPER, re.S | re.M).group(0)


def _branch() -> str:
    """The body of the `'setup' {` branch of the dispatcher."""
    return re.search(r"^  'setup' \{\n(.*?)^  \}\n", WRAPPER, re.S | re.M).group(1)


def _pwsh() -> str:
    shell = os.environ.get("JHT_TEST_SHELL") or "pwsh"
    if not shutil.which(shell):
        pytest.skip(f"{shell} not installed")
    return shell


def _run(tmp_path: Path, body: str, **env: str) -> subprocess.CompletedProcess:
    script = tmp_path / "case.ps1"
    script.write_text(body, encoding="utf-8")
    return subprocess.run([_pwsh(), "-NoProfile", "-File", str(script)], text=True, capture_output=True, timeout=90,
                          cwd=tmp_path, env={**os.environ, **env})


def _convert(tmp_path: Path, args: list[str]) -> list[str]:
    quoted = ", ".join("'%s'" % a.replace("'", "''") for a in args)
    body = "$ErrorActionPreference = 'Stop'\n" + _function("Convert-SetupKeyFileArgs") + f"""
$plan = Convert-SetupKeyFileArgs @({quoted})
'ERROR=' + $plan.Error
'KEY=' + $(if ($null -eq $plan.Key) {{ '' }} else {{ 'present' }})
'KEYTEXT=' + $plan.Key
'ARGS=' + ($plan.Args -join '|')
"""
    done = _run(tmp_path, body)
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout.splitlines()


def _field(lines: list[str], name: str) -> str:
    return next(line[len(name) + 1:] for line in lines if line.startswith(name + "="))


def _key_file(tmp_path: Path, data: bytes, name="key.txt") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


def test_a_file_on_the_host_becomes_the_stdin_flag_and_the_path_leaves_the_arguments(tmp_path):
    path = _key_file(tmp_path, (KEY + "\r\n").encode())
    out = _convert(tmp_path, ["--non-interactive", "--provider", "glm", "--harness", "pi", "--api-key-file", str(path), "--skip-health"])
    assert _field(out, "ERROR") == "" and _field(out, "KEY") == "present" and _field(out, "KEYTEXT") == KEY
    assert _field(out, "ARGS") == "--non-interactive|--provider|glm|--harness|pi|--api-key-stdin|--skip-health"
    assert str(path) not in _field(out, "ARGS") and KEY not in _field(out, "ARGS")


def test_the_equals_form_works_too(tmp_path):
    path = _key_file(tmp_path, KEY.encode())
    out = _convert(tmp_path, ["--provider=kimi", f"--api-key-file={path}"])
    assert _field(out, "KEYTEXT") == KEY and _field(out, "ARGS") == "--provider=kimi|--api-key-stdin"


@pytest.mark.parametrize("encoding", ["utf-16", "utf-8-sig", "utf-16-be"])
def test_a_file_written_by_windows_tools_is_read_as_text(tmp_path, encoding):
    # `echo key > key.txt` in Windows PowerShell 5.1 writes UTF-16 with a mark; Notepad can write UTF-8 with one
    data = (KEY + "\r\n").encode(encoding)
    if encoding == "utf-16-be":
        data = b"\xfe\xff" + data
    out = _convert(tmp_path, ["--api-key-file", str(_key_file(tmp_path, data))])
    assert _field(out, "ERROR") == "" and _field(out, "KEYTEXT") == KEY


def test_a_path_of_the_container_goes_through_untouched(tmp_path):
    for args in (["--api-key-file", "/jht_user/key.txt"], ["--api-key-file=/jht_home/key.txt"]):
        out = _convert(tmp_path, args)
        assert _field(out, "KEY") == "" and _field(out, "ERROR") == "" and _field(out, "ARGS") == "|".join(args)


def test_without_the_flag_nothing_changes(tmp_path):
    out = _convert(tmp_path, ["--non-interactive", "--provider", "openai", "--api-key-stdin"])
    assert _field(out, "KEY") == "" and _field(out, "ARGS") == "--non-interactive|--provider|openai|--api-key-stdin"


@pytest.mark.parametrize("what, data, said", [
    ("empty", b"", "empty or too big"),
    ("too big", b"a" * 4097, "empty or too big"),
    ("with a space", ("one two " + KEY).encode(), "one line of 16 to 512"),
    ("too short", b"short", "one line of 16 to 512"),
    ("not ASCII", ("clé-" + KEY).encode(), "one line of 16 to 512"),
])
def test_a_file_that_cannot_hold_a_key_is_refused_without_the_key(tmp_path, what, data, said):
    path = _key_file(tmp_path, data)
    out = _convert(tmp_path, ["--api-key-file", str(path)])
    assert said in _field(out, "ERROR"), what
    assert _field(out, "KEY") == "" and "ab" * 8 not in _field(out, "ERROR")


def test_a_missing_file_a_folder_and_a_second_source_are_refused(tmp_path):
    assert "cannot be read" in _field(_convert(tmp_path, ["--api-key-file", "nope.txt"]), "ERROR")
    assert "regular file" in _field(_convert(tmp_path, ["--api-key-file", str(tmp_path)]), "ERROR")
    path = _key_file(tmp_path, KEY.encode())
    assert "not both" in _field(_convert(tmp_path, ["--api-key-file", str(path), "--api-key-stdin"]), "ERROR")
    assert "twice" in _field(_convert(tmp_path, ["--api-key-file", str(path), "--api-key-file", str(path)]), "ERROR")


@pytest.mark.skipif(os.name == "nt", reason="creating a link needs a privilege on Windows")
def test_a_link_is_refused_even_to_a_good_file(tmp_path):
    target = _key_file(tmp_path, KEY.encode())
    link = tmp_path / "link.txt"
    link.symlink_to(target)
    assert "not a folder or a link" in _field(_convert(tmp_path, ["--api-key-file", str(link)]), "ERROR")


def test_the_setup_branch_pipes_the_key_to_docker_and_never_puts_it_in_an_argument(tmp_path):
    path = _key_file(tmp_path, (KEY + "\n").encode())
    recorded = tmp_path / "recorded.txt"
    body = f"""$ErrorActionPreference = 'Stop'
{_function("Convert-SetupKeyFileArgs")}
$Rest = [string[]]@('--non-interactive', '--provider', 'glm', '--harness', 'pi', '--api-key-file', '{path}')
$Container = 'jht'
$NodeEntry = '/app/cli/bin/jht.js'
$ExecFlags = @('-it')
$env:JHT_HOST_TYPE = 'local'
function Require-ComposeFile {{}}
function Require-Docker {{}}
function Ensure-Up {{}}
function docker {{
  Add-Content -LiteralPath '{recorded}' -Value ('ARGS=' + ($args -join ' '))
  Add-Content -LiteralPath '{recorded}' -Value ('STDIN=' + (@($input) -join ''))
  $global:LASTEXITCODE = 0
}}
$Sub = 'setup'
switch ($Sub) {{
  'setup' {{
{_branch()}
  }}
}}
'DONE'
"""
    done = _run(tmp_path, body)
    assert "DONE" in done.stdout, done.stdout + done.stderr
    text = recorded.read_text(encoding="utf-8")
    assert "STDIN=" + KEY in text
    args = next(line for line in text.splitlines() if line.startswith("ARGS="))
    assert KEY not in args and str(path) not in args
    assert args == "ARGS=exec -i -e JHT_HOST_TYPE=local jht node /app/cli/bin/jht.js setup --non-interactive --provider glm --harness pi --api-key-stdin"
    assert KEY not in done.stdout + done.stderr


def test_the_setup_branch_stops_with_the_reason_before_touching_docker_when_the_file_is_wrong(tmp_path):
    body = f"""$ErrorActionPreference = 'Stop'
{_function("Convert-SetupKeyFileArgs")}
$Rest = [string[]]@('--api-key-file', 'nope.txt')
function Require-ComposeFile {{ throw 'docker must not be asked' }}
{_branch()}
"""
    done = _run(tmp_path, body)
    assert done.returncode == 1 and "cannot be read" in done.stderr and "docker must not be asked" not in done.stderr
