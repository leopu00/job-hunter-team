"""The PowerShell wrapper before the first install says what is true (audit of 10/11, the Windows half of test_first_start_messages.py).

A `~/.jht` that does not exist yet used to be refused with «JHT_HOME ACL is not owner-only», the words for a permissions problem; a runtime
folder with no integrity manifest said «untrusted host runtime path, owner, reparse point or SHA-256», the words for a changed file. The
functions are taken from the wrapper and run with pwsh (the CI runs it on Linux and on windows-latest); the home is a made-up folder.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _functions(*names: str) -> str:
    source = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    return "\n".join(re.search(rf"^function {n} \{{\n.*?^\}}\n", source, re.S | re.M).group(0) for n in names)


def _pwsh():
    shell = os.environ.get("JHT_TEST_SHELL") or "pwsh"
    if not shutil.which(shell):
        pytest.skip(f"{shell} not installed")
    return shell


HOME = """$ErrorActionPreference = 'Stop'
$JhtHome = $env:TEST_HOME
function Test-PrivateJhtHomeAcl { param([string]$Path); return $false }
""" + _functions("Get-JhtHomeAclFailure", "Require-PrivateJhtHomeAcl") + """
try { Require-PrivateJhtHomeAcl; 'NO-THROW' } catch { $_.Exception.Message }
"""

TRUST = """$ErrorActionPreference = 'Stop'
$RuntimeDir = $env:TEST_RUNTIME
$RuntimeManifest = Join-Path $RuntimeDir '.runtime-integrity'
function Install-ProtectedRuntimeFromRelease { return $true }
function Test-RuntimeBundleTrusted { return $false }
""" + _functions("Assert-TrustedRuntime") + """
try { Assert-TrustedRuntime; 'NO-THROW' } catch { $_.Exception.Message }
"""


def _with_env(tmp_path, body, **env):
    script = tmp_path / "host.ps1"
    script.write_text(body, encoding="utf-8")
    return subprocess.run([_pwsh(), "-NoProfile", "-File", str(script)], text=True, capture_output=True, timeout=60,
                          env={**os.environ, **env})


def test_a_home_that_does_not_exist_is_a_team_not_installed_not_a_permissions_problem(tmp_path):
    done = _with_env(tmp_path, HOME, TEST_HOME=str(tmp_path / "no-such-home"))
    assert "non e' ancora installato" in done.stdout and "installer" in done.stdout and "'jht setup'" in done.stdout, done.stdout + done.stderr
    assert "owner-only" not in done.stdout


def test_a_home_that_is_there_and_refused_is_still_the_acl_message(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    done = _with_env(tmp_path, HOME, TEST_HOME=str(home))
    assert "JHT_HOME ACL is not owner-only" in done.stdout, done.stdout + done.stderr
    assert "non e' ancora installato" not in done.stdout


def test_a_runtime_without_its_manifest_is_an_install_not_finished(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    done = _with_env(tmp_path, TRUST, TEST_RUNTIME=str(runtime))
    assert "non e' installato del tutto" in done.stdout and "installer" in done.stdout, done.stdout + done.stderr
    assert "untrusted" not in done.stdout


def test_a_runtime_whose_manifest_is_there_but_wrong_is_still_untrusted(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / ".runtime-integrity").write_text("version=1\n", encoding="utf-8")
    done = _with_env(tmp_path, TRUST, TEST_RUNTIME=str(runtime))
    assert "untrusted host runtime" in done.stdout and "non e' installato del tutto" not in done.stdout, done.stdout + done.stderr
