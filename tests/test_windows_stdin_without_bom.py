"""What the PowerShell wrapper pipes to a native command reaches it without a byte order mark.

Windows PowerShell 5.1 writes EF BB BF in front of what it pipes to a native program when the console is in UTF-8 (code page 65001,
whatever $OutputEncoding is: measured on windows-2022) and when $OutputEncoding carries a BOM. In front of a mailbox password, a Telegram
token or a provider key, a BOM is a wrong secret. Every pipe of the wrapper into docker goes through Invoke-NativeWithStdin, which sets
both encodings to UTF-8 without a BOM for the call.

The functions are the wrapper's own, read through the AST; docker is a native fake that writes its stdin to a file (on Windows, the
shell JHT_TEST_SHELL names: Windows PowerShell 5.1 by default). Each path runs twice: with the console input encoding in UTF-8 (the
65001 case) and with a $OutputEncoding that carries a BOM as well. The values piped are synthetic and no assertion message holds them.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INTEGRATION = ROOT / "scripts" / "jht-integration.ps1"
TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE"  # the shape of the token of the sign-in window; synthetic
needs_powershell = pytest.mark.skipif(not WINDOWS and shutil.which("pwsh") is None, reason="needs PowerShell")

BOM = b"\xef\xbb\xbf"
VALUE = "synthetic-value-éè"  # not ASCII on purpose: it must reach docker as UTF-8

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Invoke-NativeWithStdin', 'Invoke-Compose', 'Invoke-BrokerAdmin', 'Invoke-TelegramAdmin', 'Get-AgentCloudField')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "$name missing" }
  Invoke-Expression $fn.Extent.Text
}
$integrationAst = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_INTEGRATION_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$grant = $integrationAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-LinkedinGrant' }, $true)
if (-not $grant) { throw 'Invoke-LinkedinGrant missing' }
Invoke-Expression $grant.Extent.Text
$BrokerContainer = 'jht-broker'; $TelegramContainer = 'jht-telegram'
$JhtHome = '.'; $ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
$ContainerRuntime = 'docker'
function Test-PrivateJhtHomeAcl { param($Path) $true }
function Assert-TrustedRuntime { }
function Get-RunningComposeServiceId { param($Name) 'abc123' }
function Write-Err { param($Message) [Console]::Error.WriteLine($Message) }
# the console in UTF-8 (code page 65001) and, in the second run, a session encoding that has a BOM too
try { [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch { $null = $_ }
if ($env:JHT_SESSION_BOM -eq '1') { $OutputEncoding = [System.Text.Encoding]::UTF8 }
$value = $env:JHT_TEST_VALUE
$null = Invoke-BrokerAdmin -InputText $value -AdminArgs @('mailbox', 'setup', '--user', 'a@example.invalid')
$null = Invoke-TelegramAdmin -InputText $value -AdminArgs @('token', 'set')
$null = Invoke-Compose -InputText $value 'run' '--rm' 'jht'
$null = Get-AgentCloudField -AgentId 'scout-1' -Field 'token'
$null = Invoke-LinkedinGrant 'abc123' $env:JHT_TEST_TOKEN
# a wrapper from before Invoke-NativeWithStdin: the same call, plain (its own file: it is the old behaviour, a BOM may come with it)
Remove-Item Function:\Invoke-NativeWithStdin
$env:FAKE_TAG = '-plain'
$null = Invoke-LinkedinGrant 'abc123' $env:JHT_TEST_TOKEN
"""

# docker writes the stdin of the call to a file named after the path
FAKE_DOCKER = r"""#!/bin/sh
case "$*" in
  *jht-broker-admin*) cat > "$FAKE_STATE/stdin-broker" ;;
  *jht-telegram-admin*) cat > "$FAKE_STATE/stdin-telegram" ;;
  compose*) cat > "$FAKE_STATE/stdin-compose" ;;
  *" node -") cat > "$FAKE_STATE/stdin-node" ;;
  *login_view.py*) cat > "$FAKE_STATE/stdin-grant${FAKE_TAG:-}" ;;
esac
exit 0
"""


def _run(tmp_path: Path, session_bom: bool) -> dict[str, bytes]:
    state = tmp_path / "state"
    state.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE_DOCKER)
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(WRAPPER), "FAKE_STATE": str(state),
        "JHT_SESSION_BOM": "1" if session_bom else "", "JHT_TEST_VALUE": VALUE,
        "JHT_INTEGRATION_UNDER_TEST": str(INTEGRATION), "JHT_TEST_TOKEN": TOKEN,
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, "the harness failed: " + done.stderr.replace(VALUE, "<value>")[-600:]
    return {path.name.removeprefix("stdin-"): path.read_bytes() for path in state.glob("stdin-*")}


@pytest.fixture(scope="module", params=[False, True], ids=["console-utf8", "console-utf8-and-session-bom"])
def stdins(request, tmp_path_factory) -> dict[str, bytes]:
    return _run(tmp_path_factory.mktemp("stdin"), request.param)


@needs_powershell
@pytest.mark.parametrize("path", ["broker", "telegram", "compose"])
def test_a_secret_reaches_the_native_command_without_a_bom(stdins, path):
    assert path in stdins, f"docker did not receive the stdin of the {path} path"
    raw = stdins[path]
    assert not raw.startswith(BOM), f"a BOM went to docker in front of the stdin of the {path} path"
    # the pipe adds the end of line; the value itself arrives whole, as UTF-8
    assert raw.rstrip(b"\r\n") == VALUE.encode("utf-8"), f"the stdin of the {path} path is not the value that was piped"


@needs_powershell
def test_the_token_of_the_signin_window_reaches_the_view_without_a_bom(stdins):
    """A token with EF BB BF in front is not a token: the view would answer `token_required` for good."""
    assert "grant" in stdins, "docker did not receive the stdin of the grant of the sign-in view"
    raw = stdins["grant"]
    assert not raw.startswith(BOM), "a BOM went to the view in front of the token of the sign-in window"
    assert raw.rstrip(b"\r\n") == TOKEN.encode("ascii")


@needs_powershell
def test_a_wrapper_without_the_helper_still_asks_the_view_for_the_grant(stdins):
    assert TOKEN.encode("ascii") in stdins.get("grant-plain", b""), "the plain pipe of an older wrapper did not reach the view"


def test_the_pipe_to_the_view_of_the_signin_is_the_helpers_or_a_plain_one_only_when_the_wrapper_has_none():
    source = INTEGRATION.read_text(encoding="utf-8")
    piped = [line for line in source.splitlines() if re.search(r"\|\s*&\s*docker\b", line)]
    assert len(piped) == 1, "the pipes into docker of the integration helper are not the one that was held"
    body = source[source.index("function Invoke-LinkedinGrant") :]
    body = body[: body.index("\n}\n")]
    assert "Invoke-NativeWithStdin $ask" in body and "Get-Command Invoke-NativeWithStdin -CommandType Function" in body


@needs_powershell
def test_the_cloud_field_script_reaches_node_without_a_bom(stdins):
    assert "node" in stdins, "docker did not receive the stdin of the cloud field path"
    raw = stdins["node"]
    assert not raw.startswith(BOM), "a BOM went to node in front of the cloud field script"
    assert raw.decode("utf-8").lstrip().startswith("const fs=require('fs');")


def test_every_pipe_of_the_wrapper_into_docker_goes_through_the_helper():
    """The paths that no harness here runs (the key of `jht setup --api-key-file`, the legacy import of the broker, `apply record`, the
    snapshot) are held by the form: a line that pipes into docker without Invoke-NativeWithStdin is a pipe with the BOM risk."""
    source = WRAPPER.read_text(encoding="utf-8")
    piped = [(n, line) for n, line in enumerate(source.splitlines(), 1) if re.search(r"\|\s*&\s*docker\b", line)]
    assert len(piped) >= 8, "the pipes into docker are no longer found: the search needs a new form"
    bare = [n for n, line in piped if "Invoke-NativeWithStdin" not in line]
    assert not bare, f"lines of jht-wrapper.ps1 pipe into docker without Invoke-NativeWithStdin: {bare}"
    helper = source[source.index("function Invoke-NativeWithStdin") :]
    helper = helper[: helper.index("\n}\n")]
    assert "[Console]::InputEncoding" in helper and "UTF8Encoding]::new($false)" in helper and "$OutputEncoding" in helper
