"""The PowerShell wrapper on a profile where nothing has been set up yet: the files it reads and that do not exist are not errors (T319 class).

T319: a state the code reads only exists after a first pass, and the computer it was tried on already had it. The Windows side
reads three such things, and no test started from "it is not there":

  - `host.env` (language, time zone, host type): absent, empty, or only comments, the wrapper takes its defaults
    (`unknown`, `en`, `UTC`) and goes on. The reading block of the wrapper runs for real, in Windows PowerShell 5.1 and in
    PowerShell 7, on any machine that has the shell (the Ubuntu CI has pwsh, so this part runs before Windows does);
  - the private-folder check of `~/.jht` (`Test-PrivateJhtHomeAcl`): a folder that is not there is "not private", said as a
    plain False, never an exception that escapes the function, and the check never creates the folder as a side effect;
  - the runtime's own files (`Test-ProtectedRuntimeNode`), the integrity manifest first: a file that is not there is an untrusted
    runtime, said as a False. A bundle without its manifest is refused before one value of it is read.

What is NOT pinned is the wording of the refusals or whether a missing `~/.jht` should be made by the wrapper: that is decided
elsewhere and these tests must not stand in its way. They pin the safe direction (never "trusted", never "private") and that
the absence does not crash.

Windows ACL checks run on Windows only. The Windows config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`: a missing
shell is a failure, not a skip.

Run:
    pytest tests/test_windows_pristine_profile.py -v
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from test_windows_host_env_is_not_written_through_a_link import SHELLS, ROOT, _function, _run, windows_only

WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
ACL_HELPER = ROOT / "scripts" / "windows-private-acl.ps1"


def _reading_block() -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    match = re.search(r"^\$AllowedHostEnvNames = .*?^if \(-not \$env:JHT_USER_TZ\)[^\n]*\n", source, re.S | re.M)
    assert match, "the host.env reading block is missing"
    return match.group(0)


# ── host.env: absent, empty, only comments ─────────────────────────────────

HOST_ENV_CASES = [
    pytest.param(None, ("unknown", "en", "UTC"), id="no-file"),
    pytest.param("", ("unknown", "en", "UTC"), id="empty-file"),
    pytest.param("# nothing chosen yet\n\n   \n", ("unknown", "en", "UTC"), id="only-comments"),
    pytest.param("JHT_HOST_TYPE=vps\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n", ("vps", "it", "Europe/Rome"), id="the-three-values"),
    pytest.param("JHT_LANG=it\n", ("unknown", "it", "UTC"), id="one-value-the-others-default"),
]


@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize(("content", "expected"), HOST_ENV_CASES)
def test_a_profile_without_host_env_takes_the_defaults_and_goes_on(shell, content, expected, tmp_path):
    target = tmp_path / "host.env"
    if content is not None:
        target.write_text(content, encoding="utf-8", newline="")
    script = (
        "foreach ($n in 'JHT_HOST_TYPE', 'JHT_LANG', 'JHT_USER_TZ') { Remove-Item \"env:$n\" -ErrorAction SilentlyContinue }\n"
        f"$HostEnvFile = '{target}'\n" + _reading_block() +
        "[Console]::Out.WriteLine(\"SEEN=$env:JHT_HOST_TYPE|$env:JHT_LANG|$env:JHT_USER_TZ\")\n"
    )
    done = _run(shell, script, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    seen = [line for line in done.stdout.splitlines() if line.startswith("SEEN=")]
    assert seen == ["SEEN=" + "|".join(expected)], done.stdout + done.stderr
    assert not done.stderr.strip(), done.stderr


def test_the_wrapper_asks_whether_host_env_is_there_before_it_reads_it():
    """The read is behind a Test-Path and never behind a bare Get-Content: under $ErrorActionPreference = 'Stop' a bare read of a
    file that is not there ends the script."""
    block = _reading_block()
    assert block.count("Get-Content $HostEnvFile") == 1
    assert block.index("if (Test-Path $HostEnvFile)") < block.index("Get-Content $HostEnvFile")


# ── the manifest and the runtime's files, in the source (every machine) ────

def test_a_bundle_without_its_manifest_is_refused_before_one_value_of_it_is_read():
    bundle = _function(WRAPPER.read_text(encoding="utf-8"), "Test-RuntimeBundleTrusted")
    guard = "if (-not (Test-ProtectedRuntimeNode $RuntimeManifest)) { return $false }"
    assert guard in bundle, "the manifest has no node check any more"
    assert bundle.index(guard) < bundle.index("Get-Content -LiteralPath $RuntimeManifest"), "the manifest is read before it is checked"
    assert bundle.index(guard) < bundle.index("ConvertFrom-StringData"), "a value is parsed before the manifest is checked"


def test_a_node_that_is_not_there_is_answered_inside_the_function_not_thrown():
    node = _function(WRAPPER.read_text(encoding="utf-8"), "Test-ProtectedRuntimeNode")
    assert "catch { return $false }" in node
    assert node.index("try {") < node.index("Get-Item -LiteralPath $Path -Force -ErrorAction Stop")


def test_the_private_folder_check_answers_false_inside_the_function_not_thrown():
    check = _function(ACL_HELPER.read_text(encoding="utf-8"), "Test-PrivateJhtHomeAcl")
    assert "catch { return $false }" in check
    assert check.index("try {") < check.index("Get-Acl -LiteralPath $Path -ErrorAction Stop")


# ── the same functions, run for real on Windows, in both shells ────────────

@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_private_folder_that_is_not_there_is_not_private_and_is_not_made_by_the_check(shell, tmp_path):
    missing = tmp_path / "no-such-jht-home"
    script = (
        f". '{ACL_HELPER}'\n"
        f"$missing = '{missing}'\n"
        "$result = Test-PrivateJhtHomeAcl -Path $missing\n"
        "[Console]::Out.WriteLine(\"RESULT=$result\")\n"
        "[Console]::Out.WriteLine(\"CREATED=$(Test-Path -LiteralPath $missing)\")\n"
    )
    done = _run(shell, script, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "RESULT=False" in done.stdout and "CREATED=False" in done.stdout, done.stdout + done.stderr


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_runtime_file_that_is_not_there_is_not_trusted_and_is_not_an_exception(shell, tmp_path):
    node = _function(WRAPPER.read_text(encoding="utf-8"), "Test-ProtectedRuntimeNode")
    runtime = tmp_path / "host-runtime"
    runtime.mkdir()
    script = (
        node + "\n"
        f"$manifest = '{runtime / '.runtime-integrity'}'\n"
        f"$folder = '{tmp_path / 'no-such-runtime'}'\n"
        "[Console]::Out.WriteLine(\"MANIFEST=$(Test-ProtectedRuntimeNode $manifest)\")\n"
        "[Console]::Out.WriteLine(\"FOLDER=$(Test-ProtectedRuntimeNode $folder -Directory)\")\n"
    )
    done = _run(shell, script, tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "MANIFEST=False" in done.stdout and "FOLDER=False" in done.stdout, done.stdout + done.stderr
