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
import sys
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
  pull) echo "$*" >> "$FAKE/pulls"; n=0; while [ -e "$FAKE/pull-hold" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n+1)); done; [ -e "$FAKE/pull-fails" ] && exit 1; : > "$FAKE/full-present"; exit 0 ;;
esac
exit 0
"""

# The part of the harness every case shares: the variables the wrapper has, the library, then the case.
PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$RuntimeDir = $env:T_RUNTIME; $JhtHome = $env:T_HOME; $DefaultRuntimeImage = $env:T_FULL; $CoreImageDigest = $env:T_CORE
$RuntimeTierFile = Join-Path $RuntimeDir 'runtime-tier'; $RuntimeImageFile = Join-Path $RuntimeDir 'runtime-image'
$RuntimeTierIntegrity = Join-Path $RuntimeDir '.runtime-tier-integrity'
$RuntimeManifest = Join-Path $RuntimeDir '.runtime-integrity'; $RuntimeTierIntegrity = Join-Path $RuntimeDir '.runtime-tier-integrity'; $ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'
$WrapperPath = $env:T_STUB; $ContainerRuntime = 'docker'
function Write-Err { param([string]$Msg) [Console]::Error.WriteLine("error: $Msg") }
. $env:T_TOOLS
"""

# Stands for the wrapper: `tools ...` runs the library, `up` leaves a trace.
STUB = r"""
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$RuntimeDir = $env:T_RUNTIME; $JhtHome = $env:T_HOME; $DefaultRuntimeImage = $env:T_FULL
$RuntimeTierFile = Join-Path $RuntimeDir 'runtime-tier'
$RuntimeTierIntegrity = Join-Path $RuntimeDir '.runtime-tier-integrity'
# the wrapper has it: the detached job of `tools_kick` runs `up` and `down` through it
$WrapperPath = $env:T_STUB
# the wrapper's own: a `jht down` of the person
function Test-JhtTeamStoppedByPerson { return (Test-Path -LiteralPath (Join-Path $env:FAKE 'team-stopped')) }
function Write-Err { param([string]$Msg) [Console]::Error.WriteLine("error: $Msg") }
# the switch under way while it stops and starts the team: .tools-switching holds the pid of a living job
$switching = Join-Path $RuntimeDir '.tools-switching'
if ($Rest[0] -in @('down', 'up')) {
  $said = 'quiet'
  if (Test-Path -LiteralPath $switching) { $pidText = ([IO.File]::ReadAllText($switching)).Trim(); if ($pidText -match '^[0-9]+$' -and (Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue)) { $said = 'switching' } }
  Add-Content -LiteralPath (Join-Path $env:FAKE 'switching-calls') -Value ($Rest[0] + ' ' + $said)
}
if ($Rest[0] -eq 'down') { Add-Content -LiteralPath (Join-Path $env:FAKE 'tier-calls') -Value ("down " + $(if (Test-Path -LiteralPath $RuntimeTierFile) { 'core' } else { 'full' })); Add-Content -LiteralPath (Join-Path $env:FAKE 'wrapper-calls') -Value 'down'; New-Item -ItemType File -Force -Path (Join-Path $env:FAKE 'downed') | Out-Null; exit 0 }
if ($Rest[0] -eq 'up') {
  $tier = if (Test-Path -LiteralPath $RuntimeTierFile) { 'core' } else { 'full' }
  Add-Content -LiteralPath (Join-Path $env:FAKE 'wrapper-calls') -Value ("up image=" + $env:JHT_IMAGE)
  Add-Content -LiteralPath (Join-Path $env:FAKE 'tier-calls') -Value ("up " + $tier)
  # up-refused: the engine refuses the up until a down (a team started with another configuration); up-fails: always
  if (Test-Path -LiteralPath (Join-Path $env:FAKE 'up-fails')) { exit 1 }
  if ((Test-Path -LiteralPath (Join-Path $env:FAKE 'up-refused')) -and -not (Test-Path -LiteralPath (Join-Path $env:FAKE 'downed'))) { exit 1 }
  exit 0
}
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
        # Output goes to files, not pipes: on Linux the detached pull inherits the pipes of the harness and `capture_output` would wait
        # for it to close them, that is for the whole pull (Windows starts it with a window of its own and holds nothing).
        out, err = tmp_path / "harness.out", tmp_path / "harness.err"
        with open(out, "wb") as stdout, open(err, "wb") as stderr:
            ran = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, stdout=stdout, stderr=stderr, timeout=180)
        done = subprocess.CompletedProcess(ran.args, ran.returncode, out.read_text(encoding="utf-8", errors="replace"),
                                           err.read_text(encoding="utf-8", errors="replace"))
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
        # The pull runs in a process of its own: on the gate's Windows runner, with Windows PowerShell 5.1 and the other tests of the
        # slice starting shells of their own, it took more than 30 seconds to write its end. What this waits for is the state.
        for _ in range(600):
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
    # the fake pull waits for the test to let it go: "pulling" is there to be seen by construction, not because a child is slower
    (box.fake / "pull-hold").write_text("", encoding="utf-8")
    done = box.run("exit (Invoke-ToolsCommand @('pull'))")
    assert done.returncode == 0 and _lines(done) == ["JHT_PHASE tools_pull"], done.stdout + done.stderr
    assert box.notice()["state"] == "pulling" and box.notice()["tier"] == "core"
    again = box.run("exit (Invoke-ToolsCommand @('pull'))")
    assert again.returncode == 0 and _lines(again) == [], again.stdout + again.stderr
    assert status(box)["state"] == "pulling"
    (box.fake / "pull-hold").unlink()
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


def test_switch_drops_the_tier_and_its_integrity_and_ups_the_full_image(box):
    tier = box.tier()
    integrity = box.runtime / ".runtime-tier-integrity"
    integrity.write_text("runtime-tier=x\n", encoding="utf-8")
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-10T09:00:00Z\n", encoding="utf-8")
    done = box.run("$env:JHT_IMAGE = 'stale'\nexit (Invoke-ToolsCommand @('switch'))")
    assert done.returncode == 0 and _lines(done) == ["JHT_PHASE tools_ready"], done.stdout + done.stderr
    assert not tier.exists() and not integrity.exists()
    assert (box.fake / "wrapper-calls").read_text(encoding="utf-8").split() == ["up", "image="]
    assert box.notice()["tier"] == "full" and box.notice()["state"] == "ready"


def test_an_unknown_subcommand_is_a_usage_error(box):
    done = box.run("exit (Invoke-ToolsCommand @('unknown'))")
    # said in the language the wrapper decided (integration.tools.usage, 7 languages): the command is the same in every one
    assert done.returncode == 2 and "jht tools status --json | pull | switch" in done.stderr


# ── the wrapper: which image, and whether the tier file can be believed ──────────────────────────────────────────────────────

TRUST = r"""
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:T_WRAPPER_SRC, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Write-RuntimeManifest', 'Test-RuntimeExtrasPin', 'Test-RuntimeBundleTrusted')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
$RuntimeExtrasFile = Join-Path $RuntimeDir 'runtime-extras-image'; $RuntimeExtrasIntegrity = Join-Path $RuntimeDir '.runtime-extras-integrity'
function Test-RuntimePathAuthority { $true }
function Test-RuntimeAncestorsWithoutReparsePoint { param($p) $true }
function Test-ProtectedRuntimeNode { param($p, [switch]$Directory) $true }
function Set-ProtectedRuntimeNodeOwner { param($p) $true }
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
        # what the installer writes beside it: the hash of the file as it was written
        import hashlib
        digest = hashlib.sha256((box.runtime / "runtime-tier").read_bytes()).hexdigest()
        (box.runtime / ".runtime-tier-integrity").write_text(f"runtime-tier={digest}\n", encoding="utf-8", newline="\n")
    body = (TRUST + f"$CoreImageDigest = '{core}'\nWrite-RuntimeManifest\n"
            + case)
    return box.run(body, T_WRAPPER_SRC=str(WRAPPER))


def test_an_attested_core_tier_selects_the_core_image_by_digest(box):
    done = _trust(box, "if (Test-RuntimeBundleTrusted) { 'trusted ' + $env:JHT_IMAGE } else { 'untrusted' }", tier_text="core\n")
    assert _lines(done) == [f"trusted ghcr.io/leopu00/jht@{CORE_DIGEST}"], done.stdout + done.stderr
    assert "runtime-tier" not in (box.runtime / ".runtime-integrity").read_text(encoding="utf-8"), "the app compares the exact keys of the main manifest"


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
    assert "$RuntimeHelpers = @('jht-integration.ps1', 'jht-tools.ps1', 'configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py')" in wrapper
    assert re.search(r"'tools' \{\n    Require-ComposeFile\n", wrapper)
    tools_branch = wrapper.split("  'tools' {")[1].split("\n  'telegram' {")[0]
    assert "Install-RuntimeHelpers" not in tools_branch, "no command of jht tools downloads a missing helper (A3)"
    assert ". (Join-Path $RuntimeDir 'jht-tools.ps1')\n    exit (Invoke-ToolsCommand $Rest)" in wrapper
    assert "'integration', 'screen', 'linkedin', 'tools'," in wrapper, "its --help is the local one"
    assert "'scripts/jht-tools.ps1'" in installer and "(Join-Path $RuntimeDir 'jht-tools.ps1')" in installer
    assert "jht-tools.ps1=$toolsHash" in enabler and "(Join-Path $RuntimeDir 'jht-tools.ps1')" in enabler
    assert "$toolsHash" not in next(line for line in enabler.splitlines() if line.startswith('$manifest = "version=1'))
    assert _text(TOOLS).count("\n# JHT_RUNTIME_HELPER=1\n") == 1
    assert (ROOT / "web" / "public" / "install.ps1").read_bytes() == (ROOT / "scripts" / "install.ps1").read_bytes()


# ── the notice for the container is written only into a real folder and over a plain file ────────────────────────────────────

def test_a_junction_in_place_of_the_state_folder_sends_the_notice_nowhere(box, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    body = ("New-Item -ItemType Junction -Path (Join-Path $JhtHome 'state') -Target $env:T_ELSEWHERE | Out-Null\n"
            "Write-ToolsNotice 'ready' 'core' '' ''\n[Console]::Out.WriteLine('done')\n")
    done = box.run(body, T_ELSEWHERE=str(elsewhere))
    assert _lines(done) == ["done"], done.stdout + done.stderr
    assert list(elsewhere.iterdir()) == [], "nothing written through the junction"


def test_a_link_in_place_of_tools_json_is_not_written_through(box, tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("keep me\n", encoding="utf-8")
    body = ("New-Item -ItemType Directory -Path (Join-Path $JhtHome 'state') -Force | Out-Null\n"
            "try { New-Item -ItemType SymbolicLink -Path (Join-Path $JhtHome 'state\\tools.json') -Target $env:T_VICTIM -ErrorAction Stop | Out-Null }\n"
            "catch { [Console]::Out.WriteLine('NO_SYMLINK'); exit 0 }\n"
            "Write-ToolsNotice 'ready' 'core' '' ''\n[Console]::Out.WriteLine('done')\n")
    done = box.run(body, T_VICTIM=str(victim))
    if _lines(done) == ["NO_SYMLINK"]:
        pytest.skip("this account may not create symbolic links")
    assert _lines(done) == ["done"], done.stdout + done.stderr
    assert victim.read_text(encoding="utf-8") == "keep me\n"


def test_a_real_state_folder_is_written_as_before(box):
    done = box.run("Write-ToolsNotice 'ready' 'core' '' '2026-11-10T00:00:00Z'\n[Console]::Out.WriteLine('done')")
    assert _lines(done) == ["done"] and box.notice()["state"] == "ready"


def test_the_detached_pull_asks_for_a_hidden_window_only_where_the_parameter_exists():
    """PowerShell 7 on Linux (the runner of the gate, the machine of the big suite) refuses `Start-Process -WindowStyle`."""
    text = _text(TOOLS)
    start = text.split("function Start-ToolsJob")[1].split("function ")[0]   # the one that starts the detached job
    assert "Start-Process -FilePath $shell -WindowStyle" not in start, "the parameter must not be on the command line itself"
    assert "if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $start.WindowStyle = 'Hidden' }" in start
    assert start.index("$start.WindowStyle") < start.index("Start-Process @start")


# ── before the helpers are there: the read-only commands the app reads answer «not installed yet» ──────────────────────────

ABSENT = r"""
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:T_WRAPPER_SRC, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$null = Invoke-Expression ($ast.Extent.Text.Substring($ast.Extent.Text.IndexOf('$IntegrationIdsAbsent = ')).Split("`n")[0])
foreach ($name in 'Get-JhtTextTable', 'Get-JhtText', 'Format-JhtText', 'Write-RuntimeHelperAbsentAnswer') {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
function Get-JhtTextLanguage { return 'it' }
$argv = @(ConvertFrom-Json -InputObject $env:T_ARGS | ForEach-Object { $_ })
$answered = Write-RuntimeHelperAbsentAnswer $argv[0] ([string[]]@($argv | Select-Object -Skip 1))
[Console]::Out.WriteLine("answered=$answered")
"""


def _absent(box, *args: str):
    import json as _json
    done = box.run(ABSENT, T_WRAPPER_SRC=str(WRAPPER), T_ARGS=_json.dumps(list(args)))
    assert done.returncode == 0, done.stdout + done.stderr
    lines = _lines(done)
    return lines[:-1], lines[-1]


IDS = ["google", "telegram", "mail", "linkedin-login", "screen", "media"]


def test_tools_status_json_answers_a_valid_state(box):
    out, answered = _absent(box, "tools", "status", "--json")
    assert answered == "answered=True"
    assert json.loads(out[0]) == {"ok": True, "state": "none", "tier": "full", "reason": "not_installed"} and len(out) == 1


def test_integration_list_and_status_answer_for_every_id_in_json_and_in_words(box):
    out, answered = _absent(box, "integration", "list", "--json")
    rows = json.loads(out[0])["integrations"]
    assert answered == "answered=True" and [r["id"] for r in rows] == IDS and {r["state"] for r in rows} == {"not_installed"}
    one, _ = _absent(box, "integration", "status", "mail", "--json")
    assert json.loads(one[0]) == {"id": "mail", "state": "not_installed", "reason": "non ancora installato"}
    words, _ = _absent(box, "integration", "list")
    assert [line.split()[0] for line in words] == IDS and all("non installato" in line for line in words)


@pytest.mark.parametrize("args", [("integration", "status", "bogus", "--json"), ("integration", "list", "--bogus"), ("integration", "list", "mail"),
                                  ("integration", "add", "media"), ("tools", "status"), ("tools", "pull"), ("tools", "switch")])
def test_anything_else_is_left_to_the_helper_and_its_error(box, args):
    out, answered = _absent(box, *args)
    assert answered == "answered=False" and out == []


def test_the_two_branches_ask_for_the_answer_only_while_the_helper_is_not_declared():
    wrapper = _text(WRAPPER)
    assert "if (-not (Test-RuntimeHelperDeclared 'jht-integration.ps1') -and (Write-RuntimeHelperAbsentAnswer 'integration' $Rest)) { exit 0 }" in wrapper
    assert "if (-not (Test-RuntimeHelperDeclared 'jht-tools.ps1') -and (Write-RuntimeHelperAbsentAnswer 'tools' $Rest)) { exit 0 }" in wrapper
    assert re.search(r"^\$IntegrationIdsAbsent = @\('google', 'telegram', 'mail', 'linkedin-login', 'screen', 'media'\)$", wrapper, re.M)


def test_the_ids_of_the_answer_are_the_ones_of_the_helper():
    theirs = re.search(r"^\$IntegrationIds = @\((.*)\)$", _text(ROOT / "scripts" / "jht-integration.ps1"), re.M).group(1)
    ours = re.search(r"^\$IntegrationIdsAbsent = @\((.*)\)$", _text(WRAPPER), re.M).group(1)
    assert ours == theirs, "two lists, one meaning: the wrapper answers for the ids the helper knows"


# ── Invoke-ToolsKick: the CLI keeps the tools moving, as the desktop app's round did ──────────────────────────────────────────

KICK_ENV = {"JHT_TOOLS_WAIT_STEP": "1", "JHT_TOOLS_SWITCH_GRACE": "0", "JHT_TOOLS_WAIT_MAX": "120", "JHT_TOOLS_QUIET_MAX": "20", "JHT_TOOLS_ONBOARDING_MAX": "0"}


def _until(check, what, rounds=600):
    for _ in range(rounds):
        if check():
            return
        time.sleep(0.2)
    raise AssertionError(what)


def _calls(box):
    path = box.fake / "wrapper-calls"
    return [line.split(" ")[0] for line in path.read_text(encoding="utf-8").splitlines() if line.strip()] if path.exists() else []


def person(box):
    return box.run("[Console]::Out.WriteLine((Get-ToolsPersonState))", **KICK_ENV).stdout.strip()


def test_kick_pulls_once_then_switches_when_the_profile_is_ready(box):
    tier = box.tier()
    (box.fake / "pull-hold").write_text("", encoding="utf-8")
    done = box.run("exit (Invoke-ToolsKick)", **KICK_ENV)
    assert done.returncode == 0 and _lines(done) == [], done.stdout + done.stderr
    assert person(box) == "arriving"
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0          # a second `jht up`: no second job
    (box.fake / "pull-hold").unlink()
    box.wait_for("ready")
    assert person(box) == "waiting" and tier.exists() and _calls(box) == []
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    _until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"the job never made the switch: {_calls(box)}")
    _until(lambda: (box.notice() or {}).get("tier") == "full", f"no notice of the full image: {box.notice()}")
    assert (box.fake / "pulls").read_text(encoding="utf-8").splitlines() == [f"pull {FULL}"]


def test_the_switch_stops_the_core_team_before_the_tier_goes_and_starts_it_on_the_full_image(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0
    path = box.fake / "tier-calls"
    _until(lambda: path.exists() and path.read_text(encoding="utf-8").split() == ["down", "core", "up", "full"],
           f"not down on core, then up on full: {path.read_text(encoding='utf-8') if path.exists() else ''}")
    _until(lambda: (box.notice() or {}).get("tier") == "full", f"no notice of the full image: {box.notice()}")
    assert not tier.exists() and box.notice()["state"] == "ready"


def test_the_switch_says_it_is_under_way_while_it_stops_and_starts_the_team(box):
    """The REPL of `jht team chat` runs in the container: the down of the switch ends it. While the job stops the core team and
    starts the full one, .tools-switching holds its pid, for the wrapper to say why the chat ended; after, it is gone."""
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0
    path = box.fake / "switching-calls"
    _until(lambda: path.exists() and path.read_text(encoding="utf-8").splitlines() == ["down switching", "up switching"],
           f"the switch did not say it was under way: {path.read_text(encoding='utf-8') if path.exists() else ''}")
    _until(lambda: (box.notice() or {}).get("tier") == "full", f"no notice of the full image: {box.notice()}")
    assert not tier.exists() and not (box.runtime / ".tools-switching").exists()


def _register_function() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    return re.search(r"^function Register-JhtRunningCommand \{\n.*?^\}\n", text, re.S | re.M).group(0)


def _running_command(box, tmp_path, command, *arguments):
    """A process that says it runs `jht <command> <arguments>` the way the wrapper does (its own Register-JhtRunningCommand)."""
    script = tmp_path / f"running-{command}.ps1"
    words = ", ".join("'" + word + "'" for word in arguments)
    script.write_text(_register_function() + f"\n$RuntimeDir = '{box.runtime}'\nRegister-JhtRunningCommand '{command}' @({words})\n"
                      "Start-Sleep -Seconds 40\n", encoding="utf-8")
    process = subprocess.Popen([*powershell_argv(), "-File", str(script)])
    marker = box.runtime / ".commands" / str(process.pid)
    _until(lambda: marker.exists(), f"`jht {command}` never said it was running", rounds=150)
    return process


def test_the_chat_of_the_onboarding_does_not_hold_the_switch_and_an_up_does(box, tmp_path):
    """Giro Linux: `jht team chat assistente`, the REPL of the onboarding the person keeps open, held the switch for its whole half
    hour. It reads and talks: the switch does not wait for it. A command that changes the runtime still holds it, on Windows
    PowerShell 5.1 too, where the command line of another process cannot be read (no Get-Process .CommandLine, Win32_Process
    refused to a standard user over ssh): every jht command says it is running in a file of the runtime folder."""
    words = ("if (Test-ToolsOtherWrapperRunning) { [Console]::Out.WriteLine('OTHER') } "
             "else { [Console]::Out.WriteLine('NONE') }")
    chat = _running_command(box, tmp_path, "team", "chat", "assistente")
    try:
        assert box.run(words).stdout.strip() == "NONE"
        up = _running_command(box, tmp_path, "up")
        try:
            assert box.run(words).stdout.strip() == "OTHER"
        finally:
            up.kill()
            up.wait(timeout=20)
        assert box.run(words).stdout.strip() == "NONE"                      # the up is over
        assert not (box.runtime / ".commands" / str(up.pid)).exists()       # and its file is taken away
    finally:
        chat.kill()
        chat.wait(timeout=20)


def test_a_file_of_another_process_with_the_same_pid_says_nothing(box, tmp_path):
    """A PID can come back for another process: the file says the start of the one that wrote it."""
    folder = box.runtime / ".commands"
    folder.mkdir()
    other = subprocess.Popen([*powershell_argv(), "-Command", "Start-Sleep -Seconds 30"])
    try:
        (folder / str(other.pid)).write_text(f"{other.pid} 1 up \n", encoding="utf-8")   # a start that is not this process's
        (folder / "notapid").write_text("1 1 up\n", encoding="utf-8")
        (folder / "2147483648").write_text("2147483648 1 up\n", encoding="utf-8")   # past [int] (sorts before most PIDs): one file, not the folder
        done = box.run("if (Test-ToolsRegisteredCommandRunning) { [Console]::Out.WriteLine('OTHER') } "
                       "else { [Console]::Out.WriteLine('NONE') }")
        assert done.stdout.strip() == "NONE", done.stdout + done.stderr
        up = _running_command(box, tmp_path, "up")              # files that cannot be believed do not hide a real `up`
        try:
            seen = box.run("if (Test-ToolsRegisteredCommandRunning) { [Console]::Out.WriteLine('OTHER') } "
                           "else { [Console]::Out.WriteLine('NONE') }")
            assert seen.stdout.strip() == "OTHER", seen.stdout + seen.stderr
        finally:
            up.kill()
            up.wait(timeout=20)
    finally:
        other.kill()
        other.wait(timeout=20)


def test_every_jht_command_says_it_is_running_before_it_does_anything(box):
    text = WRAPPER.read_text(encoding="utf-8")
    dispatch = text[text.index("[string[]]$Rest = "):text.index("\nswitch ($Sub) {")]
    assert "Register-JhtRunningCommand $Sub $Rest" in dispatch
    secret = box.run(_register_function() + "\nRegister-JhtRunningCommand 'setup' @('--api-key=sk-fake-123')\n"
                     "[Console]::Out.WriteLine([IO.File]::ReadAllText((Join-Path (Join-Path $RuntimeDir '.commands') ([string]$PID))))")
    assert "sk-fake" not in secret.stdout and secret.stdout.split()[2:] == ["setup", "-"], secret.stdout + secret.stderr
    done = box.run(_register_function() + "\nRegister-JhtRunningCommand 'config' @('set', 'a b')\n"
                   "[Console]::Out.WriteLine([IO.File]::ReadAllText((Join-Path (Join-Path $RuntimeDir '.commands') ([string]$PID))))")
    fields = done.stdout.strip().split(" ")
    assert len(fields) == 4 and fields[2:] == ["config", "set"], done.stdout + done.stderr


@pytest.mark.parametrize("line,holds", [
    ('"C:\\x\\pwsh.exe" -NoProfile -File "{w}" setup', True),
    ("pwsh -File {w} up", True), ("pwsh -File {w} down", True), ("pwsh -File {w} upgrade --json", True),
    ("pwsh -File {w} uninstall", True), ("pwsh -File {w} reset", True), ("pwsh -File {w} restart", True),
    ("pwsh -File {w} config set x", True), ("pwsh -File {w} providers use glm", True), ("pwsh -File {w} providers harness pi", True),
    ("pwsh -File {w} integration add telegram", True), ("pwsh -File {w} integration remove telegram", True),
    ("pwsh -File {w} tools pull", True), ("pwsh -File {w} tools switch", True),
    ('pwsh -File "{w}" team chat assistente', False), ("pwsh -File {w} logs", False), ("pwsh -File {w} status", False),
    ("pwsh -File {w} doctor", False), ("pwsh -File {w} help", False), ("pwsh -File {w}", False),
    ("pwsh -File {w} config get x", False), ("pwsh -File {w} providers list", False), ("pwsh -File {w} integration status", False),
    ("pwsh -File {w} tools pull-job 2026 auto", False), ("pwsh -File {w} tools status --json", False), ("pwsh -File {w} SETUP", False),
    ("pwsh -File C:\\other\\script.ps1 up", False),
])
def test_only_a_command_that_changes_the_runtime_holds_the_switch(box, line, holds):
    wrapper = "C:\\Users\\a b\\jht\\jht-wrapper.ps1"
    case = line.replace("{w}", wrapper).replace("'", "''")
    body = (f"$w = @(Get-ToolsWrapperWords '{case}' '{wrapper}'); $sub = ''; if ($w.Count -gt 1) {{ $sub = $w[1] }}\n"
            "if ($w.Count -gt 0 -and (Test-ToolsCommandChangesRuntime $w[0] $sub)) { [Console]::Out.WriteLine('HOLDS') } "
            "else { [Console]::Out.WriteLine('FREE') }")
    done = box.run(body)
    assert done.stdout.strip() == ("HOLDS" if holds else "FREE"), (line, done.stdout + done.stderr)


def _chat_end_function() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    match = re.search(r"^function Test-JhtTeamChatEndedBySwitch \{\n.*?^\}\n", text, re.S | re.M)
    assert match, "Test-JhtTeamChatEndedBySwitch"
    return match.group(0)


def test_the_chat_says_why_it_ended_only_while_a_switch_runs(box, tmp_path):
    marker = box.runtime / ".tools-switching"
    body = (_chat_end_function() + "\nif (Test-JhtTeamChatEndedBySwitch) { [Console]::Out.WriteLine('SWITCH') } "
            "else { [Console]::Out.WriteLine('NO') }")

    def said():
        return box.run(body).stdout.strip()

    assert said() == "NO"
    job = subprocess.Popen([*powershell_argv(), "-Command", "Start-Sleep -Seconds 60"])
    try:
        marker.write_text(f"{job.pid}\n", encoding="utf-8")
        assert said() == "SWITCH"
        marker.write_text("not a pid\n", encoding="utf-8")
        assert said() == "NO"
    finally:
        job.kill()
        job.wait(timeout=20)
    marker.write_text(f"{job.pid}\n", encoding="utf-8")
    assert said() == "NO"                                                   # an old file of a job that is gone


def test_a_command_that_starts_the_team_waits_for_the_switch_to_end(box):
    text = WRAPPER.read_text(encoding="utf-8")
    ensure = text[text.index("function Ensure-Up {\n"):]
    assert ensure.split("\n")[1].strip() == "Wait-JhtToolsSwitch", "first, before Test-ContainerUp and compose up"
    wait = re.search(r"^function Wait-JhtToolsSwitch \{\n.*?^\}\n", text, re.S | re.M).group(0)
    marker = box.runtime / ".tools-switching"
    body = ("function Write-Info { param([string]$Msg) [Console]::Error.WriteLine($Msg) }\n"
            "function Get-JhtText { param([string]$Key) return $Key }\n"
            + _chat_end_function() + wait + "\n$t = [Diagnostics.Stopwatch]::StartNew(); Wait-JhtToolsSwitch\n"
            "[Console]::Out.WriteLine('STARTS-NOW ' + [int]$t.Elapsed.TotalSeconds)")
    done = box.run(body)
    assert done.stdout.split()[0] == "STARTS-NOW" and "tools.switch_wait" not in done.stderr
    job = subprocess.Popen([*powershell_argv(), "-Command", "Start-Sleep -Seconds 60"])
    try:
        marker.write_text(f"{job.pid}\n", encoding="utf-8")
        capped = box.run(body, JHT_TOOLS_SWITCH_WAIT_MAX="4")
        assert capped.stdout.split()[0] == "STARTS-NOW" and int(capped.stdout.split()[1]) >= 3, capped.stdout
        assert "tools.switch_wait" in capped.stderr
    finally:
        job.kill()
        job.wait(timeout=20)


def test_jht_team_chat_comes_back_by_itself_when_the_switch_ended_it():
    text = WRAPPER.read_text(encoding="utf-8")
    arm = text[text.index("\n  default {\n    Require-ComposeFile"):]
    arm = arm[:arm.index("\n    break\n")]
    assert re.search(r"\$code = \$LASTEXITCODE\n(?:\s*#.*\n)?\s+if \(\$Sub -ceq 'team' -and \$Rest\.Count -gt 0 -and \$Rest\[0\] -ceq 'chat' "
                     r"-and \(Test-JhtTeamChatEndedBySwitch\)\) \{\n\s+Invoke-JhtTeamChatThroughSwitch \$Rest\n\s+exit \$script:JhtTeamChatCode\n", arm)
    assert "exit $code" in arm
    body = text[text.index("function Invoke-JhtTeamChatThroughSwitch {"):]
    body = body[:body.index("\n}\n")]
    for needed in ("Wait-JhtToolsSwitch -Quiet", "Ensure-Up", "Test-JhtTeamChatAgentBack $agent", "'tools.chat_reconnecting'",
                   "'tools.chat_resumed'", "'tools.chat_switched'", "node $NodeEntry 'team' @ChatArgs"):
        assert needed in body, needed


def test_the_chat_waits_for_the_agent_of_its_own_name(box):
    text = WRAPPER.read_text(encoding="utf-8")
    fn = re.search(r"^function Test-JhtTeamChatAgentBack \{\n.*?^\}\n", text, re.S | re.M).group(0)
    body = (fn + "\n$Container = 'jht'\n$r = Test-JhtTeamChatAgentBack 'scout:2'\n[Console]::Out.WriteLine([string]$r)\n")
    done = box.run(body, JHT_TOOLS_CHAT_RECONNECT_MAX="0")
    assert done.stdout.strip() == "True", done.stdout + done.stderr   # the fake docker says yes to everything


def test_the_switch_waits_for_the_end_of_the_onboarding_not_for_ready_flag(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-15T21:10:19Z\n", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **{**KICK_ENV, "JHT_TOOLS_ONBOARDING_MAX": "600"}).returncode == 0
    time.sleep(6)
    assert tier.exists() and _calls(box) == [], "the switch did not wait for the end of the onboarding"
    (box.home / "profile" / "onboarding-done.flag").write_text("2026-11-15T21:40:00Z\n", encoding="utf-8")
    _until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch after the onboarding: {_calls(box)}")


def test_without_the_end_of_the_onboarding_the_tetto_after_ready_flag_decides(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-15T21:10:19Z\n", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **{**KICK_ENV, "JHT_TOOLS_ONBOARDING_MAX": "8"}).returncode == 0
    time.sleep(3)
    assert tier.exists() and _calls(box) == [], "the switch did not wait for the tetto"
    _until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch at the tetto: {_calls(box)}")


def test_a_team_the_person_stopped_stays_stopped_only_the_tier_goes(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.fake / "team-stopped").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0
    _until(lambda: (box.notice() or {}).get("tier") == "full", f"no notice of the full image: {box.notice()}")
    assert not tier.exists() and _calls(box) == []


def test_a_switch_that_still_fails_is_said_until_an_up_goes_well(box):
    box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.fake / "up-fails").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0
    box.wait_for("failed")
    assert box.notice()["reason"] == "switch_failed"
    _until(lambda: person(box) == "switch_failed", "the failed switch is not said")
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0          # the up of the person went well
    assert person(box) == ""


def test_a_failed_pull_is_said_and_the_next_kick_tries_again(box):
    box.tier()
    (box.fake / "pull-fails").write_text("", encoding="utf-8")
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0
    box.wait_for("failed")
    _until(lambda: person(box) == "failed", "the failed pull is not said")
    (box.fake / "pull-fails").unlink()
    assert box.run("exit (Invoke-ToolsKick)", **KICK_ENV).returncode == 0
    box.wait_for("ready")


def test_jht_up_setup_and_status_keep_the_tools_moving_and_say_where_they_stand():
    text = WRAPPER.read_text(encoding="utf-8")
    up = text[text.index("{ $_ -in @('up', 'start-container') } {"):text.index("{ $_ -in @('down', 'stop-container') } {")]
    setup = text[text.index("\n  'setup' {"):text.index("\n  'download' {")]
    status = text[text.index("\n  'status' {"):text.index("\n  'shell' {")]
    assert "Write-JhtToolsNotice -Kick" in up and "Write-JhtToolsNotice -Kick" in setup
    assert "Write-JhtToolsNotice" in status and "-Kick" not in status
    body = text[text.index("function Write-JhtToolsNotice {"):]
    body = body[:body.index("\n}\n")]
    assert "catch { }" in body and "Invoke-ToolsKick" in body and "Get-ToolsPersonState" in body
