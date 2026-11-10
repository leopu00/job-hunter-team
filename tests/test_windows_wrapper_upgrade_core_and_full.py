"""`jht upgrade` of the Windows wrapper on an install of the core image, with the full one maybe already downloaded (P7): the PowerShell
port of the cases of test_upgrade_core_and_full_images.py.

The wrapper's own functions are read through the AST; docker is a native fake (on Windows, the shell JHT_TEST_SHELL names: Windows
PowerShell 5.1 by default). The cases that run a shell skip where there is none; the text cases at the end run everywhere.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
SOURCE = WRAPPER.read_text(encoding="utf-8")

REPO = "ghcr.io/leopu00/jht"
OLD_CORE, NEW_CORE = "sha256:" + "1" * 64, "sha256:" + "2" * 64
OLD_FULL, NEW_FULL = "sha256:" + "3" * 64, "sha256:" + "4" * 64
ID_OLD_FULL, ID_NEW_FULL = "a3" * 32, "a4" * 32

# `refs` holds "<reference> <id>" (what a pull by digest makes); `pull-result` says what a pull of a reference leaves.
FAKE_DOCKER = r"""#!/bin/sh
echo "$*" >> "$FAKE/calls"
id_of() { awk -v r="$1" '$1 == r { print $2 }' "$FAKE/refs" | head -n 1; }
case "$1 $2" in
  "image inspect")
    shift 2
    fmt=""; [ "$1" = --format ] && { fmt="$2"; shift 2; }
    id="$(id_of "$1")"; [ -n "$id" ] || exit 1
    [ "$fmt" = "{{.Id}}" ] && echo "sha256:$id"
    exit 0 ;;
  "pull "*)
    [ ! -e "$FAKE/pull-fails" ] || exit 1
    id="$(awk -v r="$2" '$1 == r { print $2 }' "$FAKE/pull-result" | head -n 1)"; [ -n "$id" ] || exit 1
    echo "$2 $id" >> "$FAKE/refs"; exit 0 ;;
esac
exit 97
"""

PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$RuntimeDir = $env:T_RUNTIME; $DefaultRuntimeImage = $env:T_FULL
$RuntimeTierFile = Join-Path $RuntimeDir 'runtime-tier'
function Write-UpgradeNote { param([string]$Message) Write-Output "NOTE: $Message" }
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:T_WRAPPER_SRC, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Get-PlainImageId', 'Get-UpgradeCandidateConstant', 'Initialize-UpgradeTierPlan', 'Invoke-UpgradeFullPull', 'Get-UpgradeTierKeepIds')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "missing $name" }
  Invoke-Expression $fn.Extent.Text
}
$script:UpgradeCoreRef = ''; $script:UpgradeFullRef = ''; $script:UpgradeFullKeep = ''
"""


@pytest.fixture()
def box(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    fake = tmp_path / "fake"
    bin_dir = tmp_path / "bin"
    fake.mkdir()
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE_DOCKER)
    (fake / "refs").write_text(f"{REPO}@{OLD_FULL} {ID_OLD_FULL}\n", encoding="utf-8", newline="\n")
    (fake / "pull-result").write_text(f"{REPO}@{NEW_FULL} {ID_NEW_FULL}\n", encoding="utf-8", newline="\n")

    def candidate(core: str | None, full: str = NEW_FULL, line_core: str | None = None) -> Path:
        path = tmp_path / "candidate-wrapper.ps1"
        path.write_text(
            f"$DefaultRuntimeImage = '{REPO}@{full}'\n"
            + (line_core if line_core is not None else f"$CoreImageDigest = '{core or ''}'\n"),
            encoding="utf-8", newline="\n")
        return path

    def run(body: str):
        harness = tmp_path / "harness.ps1"
        harness.write_text(ENGINE_CHECK + PRELUDE + body, encoding="utf-8")
        engine = tmp_path / "engine.txt"
        env = {
            **(windows_env(tmp_path) if WINDOWS else os.environ),
            "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
            "JHT_ENGINE_FILE": str(engine), "FAKE": str(fake), "T_RUNTIME": str(runtime), "T_FULL": f"{REPO}@{OLD_FULL}",
            "T_WRAPPER_SRC": str(WRAPPER),
        }
        done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=180)
        assert_engine(engine, done.stderr)
        return done

    def tier() -> None:
        (runtime / "runtime-tier").write_text("core\n", encoding="utf-8", newline="\n")

    def calls() -> list[str]:
        path = fake / "calls"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    return type("Box", (), {"run": run, "tier": tier, "candidate": staticmethod(candidate), "fake": fake, "calls": calls})


def lines(done) -> list[str]:
    return [line.strip() for line in done.stdout.splitlines() if line.strip()]


def test_the_core_the_upgrade_goes_to_is_the_one_the_candidate_wrapper_names(box):
    box.tier()
    done = box.run(f"$ok = Initialize-UpgradeTierPlan '{box.candidate(NEW_CORE)}'; \"$ok $script:UpgradeCoreRef $script:UpgradeFullRef\"")
    assert lines(done)[-1] == f"True {REPO}@{NEW_CORE} {REPO}@{NEW_FULL}", done.stdout + done.stderr


def test_without_a_tier_file_nothing_is_planned(box):
    done = box.run(f"$ok = Initialize-UpgradeTierPlan '{box.candidate(NEW_CORE)}'; \"$ok [$script:UpgradeCoreRef] [$script:UpgradeFullRef]\"")
    assert lines(done)[-1] == "True [] []", done.stdout + done.stderr
    assert box.calls() == []


def test_the_full_image_is_named_only_when_the_one_of_today_is_already_here(box):
    box.tier()
    (box.fake / "refs").write_text("", encoding="utf-8")
    done = box.run(f"$ok = Initialize-UpgradeTierPlan '{box.candidate(NEW_CORE)}'; \"$ok $script:UpgradeCoreRef [$script:UpgradeFullRef]\"")
    assert lines(done)[-1] == f"True {REPO}@{NEW_CORE} []", done.stdout + done.stderr


@pytest.mark.parametrize("line_core", [
    "$CoreImageDigest = ''\n", "$CoreImageDigest = 'sha256:abc'\n", "$CoreImageDigest = 'sha256:" + "G" * 64 + "'\n",
    "$CoreImageDigest = '" + "2" * 64 + "'\n", "# no such line\n",
], ids=["empty", "short", "not-hex", "no-prefix", "absent"])
def test_a_candidate_without_a_valid_core_is_refused_before_anything_is_downloaded(box, line_core):
    box.tier()
    done = box.run(f"Initialize-UpgradeTierPlan '{box.candidate(None, line_core=line_core)}'")
    assert lines(done)[-1] == "False", done.stdout + done.stderr
    assert not [call for call in box.calls() if call.startswith("pull")]


def test_the_new_full_image_is_pulled_by_digest_and_kept(box):
    box.tier()
    done = box.run(f"$null = Initialize-UpgradeTierPlan '{box.candidate(NEW_CORE)}'; Invoke-UpgradeFullPull; \"keep=$script:UpgradeFullKeep\"")
    assert lines(done)[-1] == f"keep={REPO}@{NEW_FULL}", done.stdout + done.stderr
    assert f"pull {REPO}@{NEW_FULL}" in box.calls()


def test_a_full_pull_that_fails_keeps_the_old_full_image_and_says_so(box):
    box.tier()
    (box.fake / "pull-fails").write_text("", encoding="utf-8")
    done = box.run(f"$null = Initialize-UpgradeTierPlan '{box.candidate(NEW_CORE)}'; Invoke-UpgradeFullPull; \"keep=[$script:UpgradeFullKeep]\"")
    assert lines(done)[-1] == "keep=[]" and "full_pull_failed" in done.stdout, done.stdout + done.stderr


def test_a_full_image_with_the_same_digest_is_not_pulled_again(box):
    box.tier()
    done = box.run(f"$null = Initialize-UpgradeTierPlan '{box.candidate(NEW_CORE, full=OLD_FULL)}'; Invoke-UpgradeFullPull; \"keep=$script:UpgradeFullKeep\"")
    assert lines(done)[-1] == f"keep={REPO}@{OLD_FULL}", done.stdout + done.stderr
    assert not [call for call in box.calls() if call.startswith("pull")]


def test_a_core_install_keeps_the_full_image_that_waits_for_the_switch(box):
    box.tier()
    assert lines(box.run("(Get-UpgradeTierKeepIds) -join ','"))[-1] == ID_OLD_FULL


def test_an_install_with_no_tier_file_keeps_no_full_image_apart(box):
    assert lines(box.run("\"[$((Get-UpgradeTierKeepIds) -join ',')]\""))[-1] == "[]"


# ── the text of the wrapper: where the upgrade reads the plan and pulls the full image (runs everywhere) ───────────────────────

def function_text(name: str) -> str:
    start = SOURCE.index(f"function {name} {{")
    return SOURCE[start:SOURCE.index("\n}\n", start) + 3]


def test_the_plan_is_read_before_the_pull_and_the_core_image_is_the_one_of_the_whole_upgrade():
    body = function_text("Invoke-RuntimeUpgrade")
    plan = body.index("Initialize-UpgradeTierPlan $newWrapper")
    assert body.index("$env:JHT_IMAGE = $script:UpgradeCoreRef") > plan
    assert body.index("$env:JHT_IMAGE = $script:UpgradeCoreRef") < body.index("Invoke-UpgradeCompose $newCompose 'pull' $Container")
    assert body.index("Il rilascio non porta un nucleo valido") < body.index("Invoke-UpgradeCompose $newCompose 'pull' $Container")


def test_the_full_image_is_pulled_after_the_commit_and_before_the_pruning_never_on_a_check():
    body = function_text("Invoke-RuntimeUpgrade")
    pull_full = body.index("Invoke-UpgradeFullPull")
    assert body.index("Remove-UpgradeTransaction\n    # Il broker") < pull_full < body.index("Remove-OldJhtImages $candidateImage $oldImage")
    assert body.count("Invoke-UpgradeFullPull") == 1
    assert pull_full > body.index("if ($checkOnly)")


def test_the_pruning_keeps_the_full_image_that_waits_for_the_switch():
    body = function_text("Remove-OldJhtImages")
    assert "$keepIds = @($previousId) + @(Get-UpgradeTierKeepIds)" in body
    assert "$keepIds -contains $plain" in body and "$plain -eq $previousId" not in body
