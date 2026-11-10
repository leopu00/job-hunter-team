"""The tier of the host runtime in the Windows wrapper and in scripts/jht-tools.ps1 (the PowerShell port of the POSIX cases in
test_wrapper_tools_tier.py).

The wrapper's own functions are read through the AST; docker is a native fake (on Windows, the shell JHT_TEST_SHELL names: Windows
PowerShell 5.1 by default). The detached pull and the `up` of the switch run a stub that stands for the wrapper.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
TOOLS = ROOT / "scripts" / "jht-tools.ps1"

FULL = "ghcr.io/leopu00/jht@sha256:" + "a" * 64
CORE_DIGEST = "sha256:" + "b" * 64

FAKE_DOCKER = r"""#!/bin/sh
case "$1" in
  info) [ -e "$FAKE/engine-down" ] && exit 1; exit 0 ;;
  image) [ -e "$FAKE/full-present" ] && exit 0; exit 1 ;;
  pull) echo "$*" >> "$FAKE/pulls"; sleep "${PULL_SLEEP:-0}"; [ -e "$FAKE/pull-fails" ] && exit 1; : > "$FAKE/full-present"; exit 0 ;;
esac
exit 0
"""

# The part of the harness every case shares: the variables the wrapper has, the library, then the case.
PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$RuntimeDir = $env:T_RUNTIME; $JhtHome = $env:T_HOME; $DefaultRuntimeImage = $env:T_FULL; $CoreImageDigest = $env:T_CORE
$RuntimeTierFile = Join-Path $RuntimeDir 'runtime-tier'; $RuntimeImageFile = Join-Path $RuntimeDir 'runtime-image'
$RuntimeManifest = Join-Path $RuntimeDir '.runtime-integrity'; $ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'
$WrapperPath = $env:T_STUB; $ContainerRuntime = 'docker'
function Write-Err { param([string]$Msg) [Console]::Error.WriteLine("error: $Msg") }
. $env:T_TOOLS
"""

# Stands for the wrapper: `tools ...` runs the library, `up` leaves a trace.
STUB = r"""
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$RuntimeDir = $env:T_RUNTIME; $JhtHome = $env:T_HOME; $DefaultRuntimeImage = $env:T_FULL
$RuntimeTierFile = Join-Path $RuntimeDir 'runtime-tier'
function Write-Err { param([string]$Msg) [Console]::Error.WriteLine("error: $Msg") }
if ($Rest[0] -eq 'up') { Add-Content -LiteralPath (Join-Path $env:FAKE 'wrapper-calls') -Value ("up image=" + $env:JHT_IMAGE); exit 0 }
. $env:T_TOOLS
exit (Invoke-ToolsCommand @($Rest | Select-Object -Skip 1))
"""


@pytest.fixture()
def box(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    fake = tmp_path / "fake"
    bin_dir = tmp_path / "bin"
    fake.mkdir()
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE_DOCKER)
    stub = tmp_path / "stub.ps1"
    stub.write_text(STUB, encoding="utf-8")

    def run(body: str, **extra):
        harness = tmp_path / "harness.ps1"
        harness.write_text(ENGINE_CHECK + PRELUDE + body, encoding="utf-8")
        engine = tmp_path / "engine.txt"
        env = {
            **(windows_env(tmp_path) if WINDOWS else os.environ),
            "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
            "JHT_ENGINE_FILE": str(engine), "FAKE": str(fake), "T_RUNTIME": str(runtime), "T_HOME": str(home),
            "T_FULL": FULL, "T_CORE": CORE_DIGEST, "T_STUB": str(stub), "T_TOOLS": str(TOOLS), **extra,
        }
        done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=180)
        assert_engine(engine, done.stderr)
        return done

    def tier():
        path = runtime / "runtime-tier"
        path.write_text("core\n", encoding="utf-8", newline="\n")
        return path

    def notice():
        path = home / "state" / "tools.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def wait_for(state: str):
        for _ in range(150):
            data = notice()
            if data and data["state"] == state:
                return data
            time.sleep(0.2)
        raise AssertionError(f"the notice never reached {state}: {notice()}")

    return type("Box", (), {"run": run, "tier": tier, "runtime": runtime, "home": home, "fake": fake, "notice": notice,
                            "wait_for": wait_for})


def _lines(done) -> list[str]:
    return [line.strip() for line in done.stdout.splitlines() if line.strip()]


def status(box):
    done = box.run("exit (Invoke-ToolsCommand @('status', '--json'))")
    assert done.returncode == 0, done.stdout + done.stderr
    assert len(_lines(done)) == 1
    return json.loads(_lines(done)[0])


def test_status_without_a_tier_is_none_and_full(box):
    assert status(box) == {"ok": True, "state": "none", "tier": "full", "reason": ""}


def test_status_is_pending_then_ready_from_the_engine(box):
    box.tier()
    assert status(box) == {"ok": True, "state": "pending", "tier": "core", "reason": ""}
    (box.fake / "full-present").write_text("", encoding="utf-8")
    assert status(box)["state"] == "ready"


def test_status_is_an_error_when_the_engine_does_not_answer(box):
    box.tier()
    (box.fake / "engine-down").write_text("", encoding="utf-8")
    assert status(box) == {"ok": False, "error": "engine_unreachable"}


def test_pull_prints_the_phase_once_and_ends_ready_with_the_notice(box):
    box.tier()
    done = box.run("exit (Invoke-ToolsCommand @('pull'))", PULL_SLEEP="2")
    assert done.returncode == 0 and _lines(done) == ["JHT_PHASE tools_pull"], done.stdout + done.stderr
    assert box.notice()["state"] == "pulling" and box.notice()["tier"] == "core"
    again = box.run("exit (Invoke-ToolsCommand @('pull'))", PULL_SLEEP="2")
    assert again.returncode == 0 and _lines(again) == [], again.stdout + again.stderr
    ready = box.wait_for("ready")
    assert ready["schema"] == 1 and ready["reason"] == ""
    assert len((box.fake / "pulls").read_text(encoding="utf-8").splitlines()) == 1
    third = box.run("exit (Invoke-ToolsCommand @('pull'))")
    assert _lines(third) == []


def test_a_failed_pull_is_failed_with_its_code(box):
    box.tier()
    (box.fake / "pull-fails").write_text("", encoding="utf-8")
    assert _lines(box.run("exit (Invoke-ToolsCommand @('pull'))")) == ["JHT_PHASE tools_pull"]
    assert box.wait_for("failed")["reason"] == "pull_failed"
    assert status(box) == {"ok": True, "state": "failed", "tier": "core", "reason": "pull_failed"}


def test_switch_is_silent_until_the_profile_is_ready_and_the_full_image_is_here(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    assert _lines(box.run("exit (Invoke-ToolsCommand @('switch'))")) == []
    assert tier.exists() and not (box.fake / "wrapper-calls").exists()
    (box.home / "profile" / "ready.flag").write_text("2026-11-10T09:00:00Z\n", encoding="utf-8")
    (box.fake / "full-present").unlink()
    assert _lines(box.run("exit (Invoke-ToolsCommand @('switch'))")) == [] and tier.exists()


def test_switch_drops_the_tier_rewrites_the_manifest_and_ups_the_full_image(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-10T09:00:00Z\n", encoding="utf-8")
    body = ("function Write-RuntimeManifest { Add-Content -LiteralPath (Join-Path $env:FAKE 'wrapper-calls') -Value 'manifest-written' }\n"
            "$env:JHT_IMAGE = 'stale'\nexit (Invoke-ToolsCommand @('switch'))")
    done = box.run(body)
    assert done.returncode == 0 and _lines(done) == ["JHT_PHASE tools_ready"], done.stdout + done.stderr
    assert not tier.exists()
    assert (box.fake / "wrapper-calls").read_text(encoding="utf-8").split() == ["manifest-written", "up", "image="]
    assert box.notice()["tier"] == "full" and box.notice()["state"] == "ready"


def test_an_unknown_subcommand_is_a_usage_error(box):
    done = box.run("exit (Invoke-ToolsCommand @('unknown'))")
    assert done.returncode == 2 and "uso:" in done.stderr


# ── the wrapper: which image, and whether the tier file can be believed ──────────────────────────────────────────────────────

TRUST = r"""
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:T_WRAPPER_SRC, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Write-RuntimeManifest', 'Test-RuntimeBundleTrusted')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
function Test-RuntimePathAuthority { $true }
function Test-RuntimeAncestorsWithoutReparsePoint { param($p) $true }
function Test-ProtectedRuntimeNode { param($p, [switch]$Directory) $true }
function Test-RuntimeDirectoryAcl { $true }
function Test-RuntimeHelpersTrusted { $true }
$AclHelperPath = Join-Path $RuntimeDir 'windows-private-acl.ps1'
$WrapperPath = $env:T_WRAPPER_SRC
"""


def _trust(box, case: str, *, tier_text: str | None = None, core: str = CORE_DIGEST, pin: bool = False):
    (box.runtime / "docker-compose.yml").write_text("services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n", encoding="utf-8")
    (box.runtime / "windows-private-acl.ps1").write_text("helper\n", encoding="utf-8")
    if pin:
        (box.runtime / "runtime-image").write_text(FULL + "\n", encoding="utf-8", newline="\n")
    if tier_text is not None:
        (box.runtime / "runtime-tier").write_text(tier_text, encoding="utf-8", newline="\n")
    body = (TRUST + f"$CoreImageDigest = '{core}'\nWrite-RuntimeManifest\n"
            + case)
    return box.run(body, T_WRAPPER_SRC=str(WRAPPER))


def test_an_attested_core_tier_selects_the_core_image_by_digest(box):
    done = _trust(box, "if (Test-RuntimeBundleTrusted) { 'trusted ' + $env:JHT_IMAGE } else { 'untrusted' }", tier_text="core\n")
    assert _lines(done) == [f"trusted ghcr.io/leopu00/jht@{CORE_DIGEST}"], done.stdout + done.stderr
    assert "runtime-tier=" in (box.runtime / ".runtime-integrity").read_text(encoding="utf-8")


def test_no_tier_file_is_the_whole_image_of_before(box):
    done = _trust(box, "if (Test-RuntimeBundleTrusted) { 'trusted [' + $env:JHT_IMAGE + ']' } else { 'untrusted' }")
    assert _lines(done) == ["trusted []"], done.stdout + done.stderr


@pytest.mark.parametrize("what", ["other content", "wrapper without a core digest", "next to a test pin", "changed after the manifest"])
def test_a_tier_file_that_cannot_be_believed_is_untrusted(box, what):
    kwargs = {"tier_text": "core\n"}
    case = "if (Test-RuntimeBundleTrusted) { 'trusted' } else { 'untrusted' }"
    if what == "other content":
        kwargs["tier_text"] = "full\n"
    elif what == "wrapper without a core digest":
        kwargs["core"] = ""
    elif what == "next to a test pin":
        kwargs["pin"] = True
    else:
        # same word, other bytes: only the hash in the manifest can tell
        case = "[IO.File]::WriteAllText($RuntimeTierFile, \"core`r`n\")\n" + case
    done = _trust(box, case, **kwargs)
    assert _lines(done) == ["untrusted"], done.stdout + done.stderr


def test_a_manifest_that_attests_a_removed_tier_file_is_an_interrupted_switch(box):
    case = "Remove-Item -LiteralPath $RuntimeTierFile -Force\nif (Test-RuntimeBundleTrusted) { 'trusted [' + $env:JHT_IMAGE + ']' } else { 'untrusted' }"
    done = _trust(box, case, tier_text="core\n")
    assert _lines(done) == ["trusted []"], done.stdout + done.stderr


# ── the wiring: `jht tools` is a host helper like `jht integration` (static: the same files the integration test reads) ─────

def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def test_jht_tools_is_a_host_helper_the_installer_ships_the_enabler_attests_and_the_wrapper_loads_after_its_digest():
    wrapper = _text(WRAPPER)
    installer = _text(ROOT / "scripts" / "install.ps1")
    enabler = _text(ROOT / "scripts" / "enable-podman-windows-runtime.ps1")
    assert "$RuntimeHelpers = @('jht-integration.ps1', 'jht-tools.ps1')" in wrapper
    assert re.search(r"'tools' \{\n    Require-ComposeFile\n", wrapper)
    assert "[string]$Rest[0] -ceq 'pull'" in wrapper, "only pull fetches a missing helper"
    assert ". (Join-Path $RuntimeDir 'jht-tools.ps1')\n    exit (Invoke-ToolsCommand $Rest)" in wrapper
    assert "'integration', 'tools'," in wrapper, "its --help is the local one"
    assert "'scripts/jht-tools.ps1'" in installer and "(Join-Path $RuntimeDir 'jht-tools.ps1')" in installer
    assert "jht-tools.ps1=$toolsHash" in enabler and "(Join-Path $RuntimeDir 'jht-tools.ps1')" in enabler
    assert "$toolsHash" not in next(line for line in enabler.splitlines() if line.startswith('$manifest = "version=1'))
    assert _text(TOOLS).count("\n# JHT_RUNTIME_HELPER=1\n") == 1
    assert (ROOT / "web" / "public" / "install.ps1").read_bytes() == (ROOT / "scripts" / "install.ps1").read_bytes()
