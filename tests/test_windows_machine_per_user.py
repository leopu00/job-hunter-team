"""JHT-T305: one Podman machine per Windows user.

The pipe a Podman machine opens is named after it (\\\\.\\pipe\\podman-<machine>) and is global to the computer: with the fixed
name jht-podman, the installer of a second Windows user found the pipe held by the first one's machine and never got to
«PODMAN JHT RUNTIME ENABLED». A user who has no machine now gets jht-podman-<8 hex of the SHA-256 of their SID>; a user who
already has jht-podman (an earlier install, attested in the runtime's podman-machine file) keeps it. The installer marks the machine
it CREATED (podman-machine-created); the uninstalls remove a machine of any other name only with that mark.

The functions are read from the real scripts (the harness of test_windows_podman_wsl_branches): off Windows under pwsh, on Windows
under the shell JHT_TEST_SHELL names. Two fake users are two SIDs.
"""
from __future__ import annotations

import hashlib
import re

import pytest

from test_windows_podman_wsl_branches import (
    ENABLER, INSTALLER, MACHINE_BLOCK_BODY, PODMAN_CASES, SCRIPTS, WRAPPER, _fake, _machines, _run,
)

APP_UNINSTALL = SCRIPTS / "jht-uninstall-windows.ps1"
SID_A = "S-1-5-21-1111111111-2222222222-3333333333-1001"
SID_B = "S-1-5-21-1111111111-2222222222-3333333333-1002"


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def expected_name(sid: str) -> str:
    return "jht-podman-" + hashlib.sha256(sid.encode("ascii")).hexdigest()[:8]


def _names(tmp_path, script, sids):
    (tmp_path / "bin").mkdir()
    body = "foreach ($sid in ($env:SIDS -split ',')) { [Console]::Out.WriteLine('NAME ' + $sid + ' ' + (Get-JhtUserMachineName -Sid $sid)) }"
    result, _ = _run(tmp_path, script, ["Get-JhtUserMachineName"], body, {"SIDS": ",".join(sids)})
    assert result.returncode == 0, result.stdout + result.stderr
    return dict(re.findall(r"^NAME (\S+) (\S*)$", result.stdout.replace("\r\n", "\n"), flags=re.MULTILINE))


def test_two_users_get_two_names_and_the_same_user_always_the_same(tmp_path):
    names = _names(tmp_path, INSTALLER, [SID_A, SID_B, "not-a-sid"])
    assert names[SID_A] == expected_name(SID_A) and names[SID_B] == expected_name(SID_B)
    assert names[SID_A] != names[SID_B]
    for name in (names[SID_A], names[SID_B]):
        assert re.fullmatch(r"jht-podman-[0-9a-f]{8}", name)
    # no Windows identity to read: the standard name, as before
    assert names["not-a-sid"] == "jht-podman"


@pytest.mark.parametrize("script", [WRAPPER, APP_UNINSTALL], ids=["wrapper-uninstall", "app-uninstall"])
def test_the_three_scripts_derive_the_same_name(tmp_path, script):
    (tmp_path / "installer").mkdir()
    (tmp_path / "other").mkdir()
    here = _names(tmp_path / "installer", INSTALLER, [SID_A, SID_B])
    there = _names(tmp_path / "other", script, [SID_A, SID_B])
    assert here == there and len(here) == 2


RESOLVE_BODY = r"""
$runtime = $env:RUNTIME
$existing = @($env:EXISTING -split ',' | Where-Object { $_ })
[Console]::Out.WriteLine('MACHINE ' + (Resolve-JhtPodmanMachineName -RuntimePath $runtime -ExistingMachines $existing -Sid $env:SID))
"""


def _resolve(tmp_path, *, sid, attested=None, existing=()):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "bin").mkdir()
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    if attested is not None:
        (runtime / "podman-machine").write_text(attested, encoding="utf-8")
    result, _ = _run(tmp_path, INSTALLER, ["Get-JhtUserMachineName", "Resolve-JhtPodmanMachineName"], RESOLVE_BODY,
                     {"RUNTIME": str(runtime), "EXISTING": ",".join(existing), "SID": sid})
    assert result.returncode == 0, result.stdout + result.stderr
    return re.search(r"^MACHINE (\S+)", result.stdout, flags=re.MULTILINE).group(1)


def test_a_user_with_no_machine_gets_a_name_of_their_own_and_another_user_another(tmp_path):
    assert _resolve(tmp_path / "a", sid=SID_A) == expected_name(SID_A)
    assert _resolve(tmp_path / "b", sid=SID_B) == expected_name(SID_B)


def test_a_user_who_has_jht_podman_keeps_it(tmp_path):
    # attested by the earlier install of this user
    assert _resolve(tmp_path / "attested", sid=SID_A, attested="jht-podman\n") == "jht-podman"
    # the file is gone but the user's own Podman lists the machine
    assert _resolve(tmp_path / "listed", sid=SID_A, existing=["somebody", "jht-podman"]) == "jht-podman"
    # another machine of the user is not ours to adopt
    assert _resolve(tmp_path / "other", sid=SID_A, existing=["somebody"]) == expected_name(SID_A)


def test_an_earlier_install_of_the_per_user_name_continues_and_a_broken_file_is_ignored(tmp_path):
    assert _resolve(tmp_path / "mine", sid=SID_A, attested=expected_name(SID_A) + "\n") == expected_name(SID_A)
    assert _resolve(tmp_path / "broken", sid=SID_A, attested="not a machine; name\n") == expected_name(SID_A)


MACHINE_FLAG_BODY = MACHINE_BLOCK_BODY + "\n[Console]::Out.WriteLine('CREATED=' + [string]($machineCreatedHere -eq $true))\n"


@pytest.mark.parametrize(("machines", "created"), [
    (_machines(), True),
    (_machines(("jht-podman", False)), False),
    (_machines(("jht-podman", True)), False),
], ids=["absent-then-created", "stopped-adopted", "running-adopted"])
def test_the_enabler_knows_it_created_the_machine_only_when_its_init_ran(tmp_path, machines, created):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", PODMAN_CASES)
    result, _ = _run(tmp_path, ENABLER, ["Invoke-Checked", "Write-JhtPhase"], MACHINE_FLAG_BODY, {
        "FAKE_PODMAN": str(bin_dir / "podman.exe"), "FAKE_MACHINES": machines, "INITIALIZE": "1", "FAKE_FAIL": "", "WELCOME": "Skip-WslWelcome",
    })
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"CREATED={created}" in result.stdout


def test_the_mark_is_written_once_next_to_the_attestation_and_is_not_in_the_manifest():
    source = ENABLER.read_text(encoding="utf-8")
    assert "$machineCreatedHere = $true" in source
    block = source[source.index("if ($machineCreatedHere) {"):]
    block = block[:block.index("\n}\n")]
    assert "'podman-machine-created'" in block and '"$MachineName`n"' in block
    manifest = source[source.index('$manifest = "version=1'):]
    manifest = manifest[:manifest.index("\n")]
    assert "podman-machine-created" not in manifest
    # the init that succeeded is what sets the flag: nothing else does
    assert source.count("$machineCreatedHere = $true") == 1
    init = source.index("'machine' 'init'")
    assert source.index("$machineCreatedHere = $true") > init
    assert source.index("$machineCreatedHere = $true") < source.index("Write-JhtPhase podman_machine_start", init)


def test_the_installer_hands_the_resolved_name_to_the_enabler_and_not_a_fixed_one():
    source = INSTALLER.read_text(encoding="utf-8")
    assert "'-MachineName', 'jht-podman'" not in source
    assert "'-MachineName', $machineName" in source


# A win-sshproxy.exe of another user can outlive its machine and keep the pipe: said plainly instead of a mute «permission denied».
PIPE_FAKE = "function Get-JhtPodmanPipeState { param([string]$MachineName) return $env:FAKE_PIPE }\n"


def _machine_block(tmp_path, pipe: str, machines: str, **extra):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", PODMAN_CASES)
    return _run(tmp_path, ENABLER, ["Invoke-Checked", "Write-JhtPhase", "Get-JhtPodmanPipeAdvice"], PIPE_FAKE + MACHINE_BLOCK_BODY, {
        "FAKE_PODMAN": str(bin_dir / "podman.exe"), "FAKE_MACHINES": machines, "INITIALIZE": "1", "FAKE_FAIL": "",
        "WELCOME": "Skip-WslWelcome", "FAKE_PIPE": pipe, **extra,
    })


@pytest.mark.parametrize("machines", [_machines(), _machines(("jht-podman", False))], ids=["no-machine-yet", "stopped-machine"])
def test_a_pipe_held_by_another_users_program_is_said_before_anything_is_started(tmp_path, machines):
    result, calls = _machine_block(tmp_path, "denied", machines)
    err = result.stderr.replace("\r\n", "\n")
    assert result.returncode == 22, result.stdout + err
    assert "podman_machine_unavailable:" in err and "held by a program of another Windows user" in err
    assert "podman-jht-podman" in err and "win-sshproxy.exe" in err and "Task Manager" in err and "run the installer again" in err
    assert not any(call.startswith("machine init") or call.startswith("machine start") for call in calls), calls


@pytest.mark.parametrize("pipe", ["absent", "connected", "unknown", "busy"])
def test_a_pipe_nobody_holds_or_that_answers_this_user_is_no_error(tmp_path, pipe):
    # 'absent' on a running machine with nothing in it: the one restart brings the forwarding up (test_windows_podman_api_pipe_must_be_up.py
    # has the cases where it does not)
    result, calls = _machine_block(tmp_path, pipe, _machines(("jht-podman", True)), FAKE_PIPE_AFTER_STARTS="1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert any(call.endswith("info") for call in calls)


def test_the_pipe_state_is_unknown_where_there_are_no_windows_pipes_and_the_advice_names_the_way_out(tmp_path):
    (tmp_path / "bin").mkdir()
    body = "[Console]::Out.WriteLine('STATE ' + (Get-JhtPodmanPipeState -MachineName 'jht-podman-ab12cd34'))\n[Console]::Out.WriteLine('ADVICE ' + (Get-JhtPodmanPipeAdvice -MachineName 'jht-podman-ab12cd34'))"
    result, _ = _run(tmp_path, ENABLER, ["Get-JhtPodmanPipeState", "Get-JhtPodmanPipeAdvice"], body, {})
    out = result.stdout.replace("\r\n", "\n")
    assert result.returncode == 0, out + result.stderr
    assert "ADVICE The Podman pipe" in out and "podman-jht-podman-ab12cd34" in out and "win-sshproxy.exe" in out
    state = re.search(r"^STATE (\S+)", out, flags=re.MULTILINE).group(1)
    assert state in {"unknown", "absent"}, state
