"""The Podman machine must not keep Windows' memory for its page cache.

Measured on a 12 GB Windows computer after a full setup with the team idle: the WSL2 virtual machine held 6 GB, and inside it only
0.7 GB was used: the rest (5.3 GB) was clean page cache the pull of the image and the team's first start had filled. Windows counted it
as the machine's memory (93% used). `sync; echo 3 > /proc/sys/vm/drop_caches` inside the machine gave it back in 20 seconds (63%) with
the team still running. The setup now does that after the pull and at its end, best effort: it never stops a setup.

The function is read from the real scripts (the harness of test_windows_podman_wsl_branches), with a stand-in podman.
"""
from __future__ import annotations

import pytest

from test_windows_podman_wsl_branches import ENABLER, _fake, _run

DROP = "machine ssh jht-podman sync && echo 3 | sudo timeout 30 tee /proc/sys/vm/drop_caches >/dev/null"
CASES = '''  "machine ssh jht-podman "*) [ -n "$FAKE_SSH_EXIT" ] && { echo 'Error: ssh failed' >&2; exit "$FAKE_SSH_EXIT"; }; exit 0 ;;'''
BODY = """
$done = Invoke-JhtMachineDropCaches -PodmanPath $env:FAKE_PODMAN -MachineName 'jht-podman'
[Console]::Out.WriteLine('DONE=' + [string]$done)
"""


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _drop(tmp_path, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", CASES)
    return _run(tmp_path, ENABLER, ["Invoke-Checked"], BODY, {"FAKE_PODMAN": str(bin_dir / "podman.exe"), **env})


def test_the_machine_is_told_to_sync_and_drop_its_clean_page_cache(tmp_path):
    result, calls = _drop(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "DONE=True" in result.stdout
    assert calls == [DROP], "one command, in the machine, with a deadline (no sudo prompt can hang it)"
    assert "echo 3 |" in calls[0] and calls[0].index("sync") < calls[0].index("drop_caches"), "sync first: nothing dirty is dropped"


@pytest.mark.parametrize("exit_code", ["1", "125", "255"])
def test_a_machine_that_does_not_do_it_is_no_error_and_no_stop(tmp_path, exit_code):
    result, calls = _drop(tmp_path, FAKE_SSH_EXIT=exit_code)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "DONE=False" in result.stdout
    assert calls == [DROP]


def test_the_setup_drops_the_cache_after_the_pull_and_again_before_it_says_it_is_enabled():
    source = ENABLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    call = "[void](Invoke-JhtMachineDropCaches -PodmanPath $Podman -MachineName $MachineName)"
    assert source.count(call) == 2
    first = source.index(call)
    assert source.index("Invoke-PodmanPull -PodmanPath $Podman") < first < source.index("& (Join-Path $BinDir 'jht.ps1') up")
    second = source.index(call, first + 1)
    assert source.index("Install-JhtContainerService -PodmanPath $Podman") < second < source.index("PODMAN JHT RUNTIME ENABLED (machine=")


# ── .wslconfig: only what is absent, recorded, and taken out again exactly ──

import os
import re
from pathlib import Path

from test_windows_podman_wsl_branches import ROOT

COMMENT = '# Job Hunter Team added the next line (its installer); "jht uninstall" removes it. Edit or delete it freely.'
BRIDGE = ENABLER.parent / "podman-machine-bridge.ps1"

ADD_BODY = r"""
$entries = @(); foreach ($pair in ($env:WANT -split ';')) { $p = $pair -split '\|'; $entries += @{ Section = $p[0]; Key = $p[1]; Value = $p[2] } }
$answer = Add-JhtWslConfigKeys -Path $env:CONFIG -Entries $entries
[Console]::Out.WriteLine('STATUS=' + $answer.Status + ' CREATED=' + [string]$answer.Created + ' REASON=' + $answer.Reason + ' ADDED=' + (@($answer.Added | ForEach-Object { $_.Section + '/' + $_.Key + '/' + $_.Value + '/' + [string]$_.SectionCreated }) -join ','))
if ($answer.Status -eq 'added') { [IO.File]::WriteAllText($env:RECORD, (ConvertTo-JhtWslConfigRecord -Path $env:CONFIG -Created $answer.Created -Added $answer.Added), [Text.UTF8Encoding]::new($false)) }
"""
REMOVE_BODY = r"""
$answer = Remove-JhtWslConfigKeys -RecordText (Read-JhtWslConfigRecord -Path $env:RECORD) -ProfilePath $env:PROFILEDIR
[Console]::Out.WriteLine('REMOVED=' + $answer.Removed + ' KEPT=' + $answer.Kept + ' REASON=' + $answer.Reason)
"""
WANT_BOTH = "wsl2|memory|3GB;experimental|autoMemoryReclaim|gradual"


def _ps(tmp_path, body, **env):
    (tmp_path / "bin").mkdir(exist_ok=True)
    result, _ = _run(tmp_path, ENABLER, [], body, {"CONFIG": str(tmp_path / ".wslconfig"), "RECORD": str(tmp_path / "record"), "PROFILEDIR": str(tmp_path), **env})
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.replace("\r\n", "\n")


def _add(tmp_path, want=WANT_BOTH):
    return _ps(tmp_path, ADD_BODY, WANT=want)


def _remove(tmp_path):
    return _ps(tmp_path, REMOVE_BODY)


def _config(tmp_path) -> Path:
    return tmp_path / ".wslconfig"


def test_a_computer_with_no_wslconfig_gets_one_with_only_what_was_added(tmp_path):
    out = _add(tmp_path)
    assert "STATUS=added CREATED=True" in out
    assert "wsl2/memory/3GB/True,experimental/autoMemoryReclaim/gradual/True" in out
    text = _config(tmp_path).read_bytes().decode("utf-8")
    assert text == f"[wsl2]\r\n{COMMENT}\r\nmemory=3GB\r\n\r\n[experimental]\r\n{COMMENT}\r\nautoMemoryReclaim=gradual\r\n"
    assert not text.startswith("﻿")
    assert _remove(tmp_path).strip() == "REMOVED=2 KEPT=0 REASON="
    assert not _config(tmp_path).exists(), "a file this setup made and nothing else is in goes away"


def test_a_key_is_put_in_the_section_the_person_already_has_and_nothing_else_changes(tmp_path):
    original = "[wsl2]\nprocessors=2\nlocalhostForwarding=true\n\n# my notes\n[general]\ninstanceIdleTimeout=15000\n"
    _config(tmp_path).write_bytes(original.encode())
    out = _add(tmp_path, "wsl2|memory|3GB")
    assert "STATUS=added CREATED=False" in out and "wsl2/memory/3GB/False" in out
    assert _config(tmp_path).read_bytes().decode() == (
        f"[wsl2]\nprocessors=2\nlocalhostForwarding=true\n{COMMENT}\nmemory=3GB\n\n# my notes\n[general]\ninstanceIdleTimeout=15000\n")
    assert _remove(tmp_path).strip() == "REMOVED=1 KEPT=0 REASON="
    assert _config(tmp_path).read_bytes().decode() == original, "the uninstall gives the file back as it was, byte for byte"


@pytest.mark.parametrize("existing", ["memory=8GB", "Memory = 1GB", "  MEMORY=512MB"])
def test_a_key_the_person_has_is_never_touched_whatever_its_spelling(tmp_path, existing):
    original = f"[wsl2]\n{existing}\n"
    _config(tmp_path).write_bytes(original.encode())
    out = _add(tmp_path, "wsl2|memory|3GB")
    assert "STATUS=unchanged" in out
    assert _config(tmp_path).read_bytes().decode() == original


def test_the_same_key_in_another_section_is_not_the_persons_key(tmp_path):
    original = "[wsl2]\nprocessors=2\n[experimental]\nmemory=1GB\n"
    _config(tmp_path).write_bytes(original.encode())
    _add(tmp_path, "wsl2|memory|3GB")
    assert "[wsl2]\nprocessors=2\n" + COMMENT + "\nmemory=3GB\n[experimental]\nmemory=1GB\n" == _config(tmp_path).read_bytes().decode()


def test_a_commented_out_key_is_not_a_key(tmp_path):
    _config(tmp_path).write_bytes(b"[wsl2]\n# memory=8GB\n; memory=4GB\n")
    assert "STATUS=added" in _add(tmp_path, "wsl2|memory|3GB")


@pytest.mark.parametrize(("raw", "label"), [
    (b"[wsl2]\r\nprocessors=2\r\n", "crlf"),
    (b"[wsl2]\nprocessors=2", "no-final-newline"),
    (b"\xef\xbb\xbf[wsl2]\nprocessors=2\n", "utf8-bom"),
    (b"", "empty"),
])
def test_the_style_of_the_file_is_kept_and_the_uninstall_restores_it(tmp_path, raw, label):
    _config(tmp_path).write_bytes(raw)
    out = _add(tmp_path, WANT_BOTH)
    assert "STATUS=added" in out
    after = _config(tmp_path).read_bytes()
    if label == "crlf":
        assert b"\r\n" in after and re.search(rb"[^\r]\n", after) is None
    if label == "utf8-bom":
        assert after.startswith(b"\xef\xbb\xbf") and after.count(b"\xef\xbb\xbf") == 1
    _remove(tmp_path)
    restored = _config(tmp_path).read_bytes() if _config(tmp_path).exists() else b""
    if label == "no-final-newline":
        assert restored.rstrip(b"\n") == raw, "only the missing final newline can differ"
    elif label == "empty":
        assert restored.strip() == b""
    else:
        assert restored == raw


@pytest.mark.parametrize(("raw", "reason"), [
    ("[wsl2]\nmemory=1GB\n".encode("utf-16"), "UTF-16"),
    ("[wsl2]\nnote=café\n".encode("latin-1"), "not UTF-8"),
    (b"[wsl2]\n\x00\x01\n", "not plain text"),
])
def test_a_file_that_is_not_safe_to_rewrite_is_left_as_it_is_and_said(tmp_path, raw, reason):
    _config(tmp_path).write_bytes(raw)
    out = _add(tmp_path, "wsl2|memory|3GB")
    assert "STATUS=skipped" in out and reason in out
    assert _config(tmp_path).read_bytes() == raw
    assert not (tmp_path / "record").exists()


@pytest.mark.skipif(os.name == "nt", reason="a symbolic link needs a privilege on Windows")
def test_a_wslconfig_that_is_a_link_is_never_followed(tmp_path):
    target = tmp_path / "elsewhere"
    target.write_text("[wsl2]\nprocessors=2\n", encoding="utf-8")
    _config(tmp_path).symlink_to(target)
    out = _add(tmp_path, "wsl2|memory|3GB")
    assert "STATUS=skipped" in out and "link or a folder" in out
    assert target.read_text(encoding="utf-8") == "[wsl2]\nprocessors=2\n"


def test_what_the_person_changed_after_the_setup_stays_and_is_counted(tmp_path):
    _add(tmp_path)
    text = _config(tmp_path).read_bytes().decode("utf-8").replace("memory=3GB", "memory=2GB")
    _config(tmp_path).write_bytes(text.encode("utf-8"))
    out = _remove(tmp_path)
    assert "REMOVED=1 KEPT=1" in out
    left = _config(tmp_path).read_text(encoding="utf-8")
    assert "memory=2GB" in left and "autoMemoryReclaim" not in left
    assert COMMENT in left, "the comment of the line that stays stays too"


def test_a_line_whose_comment_is_gone_is_not_ours_any_more(tmp_path):
    _add(tmp_path)
    text = _config(tmp_path).read_bytes().decode("utf-8").replace(COMMENT + "\r\nmemory=3GB", "memory=3GB")
    _config(tmp_path).write_bytes(text.encode("utf-8"))
    out = _remove(tmp_path)
    assert "REMOVED=1 KEPT=1" in out
    assert "memory=3GB" in _config(tmp_path).read_text(encoding="utf-8")


def test_a_record_without_a_file_or_with_nothing_to_do_is_not_an_error(tmp_path):
    (tmp_path / "record").write_text("version=1\nfile=" + str(_config(tmp_path)) + "\ncreated=1\nadd=wsl2|memory|3GB|1\n", encoding="utf-8")
    assert _remove(tmp_path).strip() == "REMOVED=0 KEPT=0 REASON="
    (tmp_path / "record").write_text("nonsense\n", encoding="utf-8")
    assert "REASON=no record" in _remove(tmp_path)


def test_a_record_names_nothing_outside_an_absolute_path(tmp_path):
    (tmp_path / "record").write_text("version=1\nfile=..\\..\\x\ncreated=1\nadd=wsl2|memory|3GB|1\n", encoding="utf-8")
    assert "REASON=no record" in _remove(tmp_path)


def test_the_record_says_each_fact_on_a_line(tmp_path):
    _add(tmp_path)
    record = (tmp_path / "record").read_text(encoding="utf-8").replace("\r\n", "\n").splitlines()
    assert record == ["version=1", f"file={_config(tmp_path)}", "created=1", "add=wsl2|memory|3GB|1", "add=experimental|autoMemoryReclaim|gradual|1"]


# ── what is wanted, from the facts of the computer ──

WANT_BODY = r"""
$names = if ($env:NAMES -eq 'UNKNOWN') { $null } else { , @($env:NAMES -split ',' | Where-Object { $_ }) }
$wanted = @(Get-JhtWslConfigWanted -TotalMegabytes ([long]$env:RAM) -DistributionNames $names -OwnDistribution 'podman-jht-podman')
[Console]::Out.WriteLine('WANTED=' + (@($wanted | ForEach-Object { $_.Section + '/' + $_.Key + '=' + $_.Value }) -join ','))
"""


@pytest.mark.parametrize(("ram", "names", "expected"), [
    (12166, "podman-jht-podman", "wsl2/memory=3GB"),
    (12166, "", "wsl2/memory=3GB"),
    (16384, "podman-jht-podman", "wsl2/memory=3GB"),
    (8000, "podman-jht-podman", "wsl2/memory=2GB"),
    (8192, "podman-jht-podman", "wsl2/memory=2GB"),
    (8193, "podman-jht-podman", "wsl2/memory=3GB"),
    (6144, "podman-jht-podman", "wsl2/memory=2GB"),
    (4200, "podman-jht-podman", "wsl2/memory=2GB"),
    (4096, "podman-jht-podman", ""),
    (12166, "podman-jht-podman,Ubuntu", ""),
    (12166, "podman-machine-default,podman-jht-podman", ""),
    (12166, "UNKNOWN", ""),
    (0, "podman-jht-podman", ""),
    (0, "Ubuntu", ""),
], ids=["12gb-alone", "12gb-none-yet", "16gb", "8gb", "exactly-8gb", "just-above-8gb", "6gb", "4.2gb", "4gb-default-is-already-2gb", "another-distro",
        "another-podman", "unknown-distros", "ram-unknown", "nothing"])
def test_what_is_wanted_depends_on_the_computer_and_never_exceeds_what_wsl_takes_anyway(tmp_path, ram, names, expected):
    out = _ps(tmp_path, WANT_BODY, RAM=str(ram), NAMES=names)
    assert f"WANTED={expected}\n" in out


def test_autoMemoryReclaim_is_not_written_because_the_measure_did_not_show_it_helps():
    source = _text(BRIDGE)
    assert "autoMemoryReclaim" in source, "the comment says why it is not there"
    wanted = source[source.index("function Get-JhtWslConfigWanted"):]
    wanted = wanted[:wanted.index("\n}\n")]
    assert "autoMemoryReclaim" not in wanted and "experimental" not in wanted


# ── the whole step, with stand-ins for what Windows says ──

STEP_BODY = r"""
function Get-JhtTotalMemoryMegabytes { return [long]$env:RAM }
function Test-JhtWslVmRunning { return ($env:WSL_ON -eq '1') }
function Get-JhtWslDistributionNames { return ,@($env:NAMES -split ',' | Where-Object { $_ }) }
Set-JhtWslConfigForMachine -RuntimeDir $env:RUNTIME -MachineName 'jht-podman' -ProfilePath $env:PROFILE
"""


def _step(tmp_path, names="podman-jht-podman", ram="12166", wsl_on="0"):
    profile = tmp_path / "profile"
    profile.mkdir(exist_ok=True)
    (tmp_path / "bin").mkdir(exist_ok=True)
    result, _ = _run(tmp_path, ENABLER, [], STEP_BODY, {"RAM": ram, "NAMES": names, "WSL_ON": wsl_on, "RUNTIME": str(tmp_path / "runtime"), "PROFILE": str(profile)})
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.replace("\r\n", "\n"), profile / ".wslconfig", tmp_path / "runtime" / "wslconfig-added"


def test_the_step_adds_records_and_tells_the_person_what_it_wrote_and_how_to_undo_it(tmp_path):
    out, config, record = _step(tmp_path)
    assert f"WSL settings added to {config}:" in out
    assert "[wsl2] memory=3GB" in out and "autoMemoryReclaim" not in out
    assert "jht uninstall takes these lines out, or delete them by hand" in out
    assert config.is_file() and record.is_file()
    assert "created=1" in record.read_text(encoding="utf-8")
    # WSL was off: the machine's start, right after, reads the file
    assert "already running" not in out and "wsl --shutdown" not in out


def test_with_wsl_already_running_the_step_answers_so_for_the_enabler_to_apply_it(tmp_path):
    out, config, _ = _step(tmp_path, wsl_on="1")
    assert "memory=3GB" in config.read_text(encoding="utf-8")
    assert "vm-running" in out  # test_windows_wsl_limit_restart.py: what the enabler does with it
    assert "WSL is already running" not in out


def test_the_check_of_a_running_wsl_reads_its_vm_and_says_yes_when_it_cannot_read():
    source = ENABLER.parent.joinpath("podman-machine-bridge.ps1").read_text(encoding="utf-8")
    check = source[source.index("function Test-JhtWslVmRunning"):]
    check = check[:check.index("\n}\n") + 3]
    assert "Get-Process -Name 'vmmemWSL', 'vmmem'" in check and "catch { return $true }" in check
    assert "wsl.exe" not in check and "--shutdown" not in check


def test_a_computer_with_another_distribution_gets_no_file_at_all(tmp_path):
    out, config, record = _step(tmp_path, names="podman-jht-podman,Ubuntu")
    assert "WSL settings" not in out and not config.exists() and not record.exists()


def test_a_small_computer_gets_the_smaller_ceiling(tmp_path):
    out, config, _ = _step(tmp_path, ram="7900")
    assert "[wsl2] memory=2GB" in out and "memory=2GB" in config.read_text(encoding="utf-8")


def test_a_second_setup_changes_nothing_and_keeps_the_record(tmp_path):
    _, config, record = _step(tmp_path)
    before = (config.read_bytes(), record.read_bytes())
    out, _, _ = _step(tmp_path)
    assert "WSL settings added" not in out
    assert (config.read_bytes(), record.read_bytes()) == before


GROWTH_BODY = r"""
function Get-JhtTotalMemoryMegabytes { return 12166 }
function Get-JhtWslDistributionNames { return ,@('podman-jht-podman') }
function Get-JhtWslConfigWanted { param([long]$TotalMegabytes, $DistributionNames, [string]$OwnDistribution)
  $wanted = @(@{ Section = 'wsl2'; Key = 'memory'; Value = '3GB' })
  if ($env:ALSO) { $wanted += @{ Section = 'experimental'; Key = 'autoMemoryReclaim'; Value = $env:ALSO } }
  return $wanted }
Set-JhtWslConfigForMachine -RuntimeDir $env:RUNTIME -MachineName 'jht-podman' -ProfilePath $env:PROFILE
"""


def test_a_setup_that_adds_more_later_grows_the_record_instead_of_losing_the_first(tmp_path):
    # a later release may want one more key: the earlier setup's record stays and grows, and the uninstall takes out both
    profile = tmp_path / "profile"
    profile.mkdir()
    (tmp_path / "bin").mkdir()
    env = {"RUNTIME": str(tmp_path / "runtime"), "PROFILE": str(profile)}
    for also in ("", "dropCache"):
        result, _ = _run(tmp_path, ENABLER, [], GROWTH_BODY, {**env, "ALSO": also})
        assert result.returncode == 0, result.stdout + result.stderr
    text = (tmp_path / "runtime" / "wslconfig-added").read_text(encoding="utf-8")
    assert text.count("add=") == 2 and "add=wsl2|memory|3GB" in text and "add=experimental|autoMemoryReclaim|dropCache" in text
    assert text.count("created=1") == 1
    (tmp_path / "record").write_text(text, encoding="utf-8")
    assert "REMOVED=2 KEPT=0" in _ps(tmp_path, REMOVE_BODY, PROFILEDIR=str(profile))
    assert not (profile / ".wslconfig").exists()


def test_an_unsafe_file_is_said_and_never_blocks_the_setup(tmp_path):
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / ".wslconfig").write_bytes("[wsl2]\n".encode("utf-16"))
    out, config, record = _step(tmp_path)
    assert "was left as it is (it is saved as UTF-16)" in out
    assert not record.exists()


def test_the_enabler_asks_for_it_before_the_machine_exists_and_never_stops_for_it():
    source = ENABLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    start = source.index("$machineCreatedHere = $false")
    block = source[start:source.index("configure-podman-windows-network.ps1", start)]
    call = block.index("Set-JhtWslConfigForMachine -RuntimeDir $RuntimeDir -MachineName $MachineName")
    assert block.index("-ceq 'denied') { throw (Get-JhtPodmanPipeAdvice") < call < block.index("'machine' 'init'")
    line = block[block.rindex("\n", 0, call) + 1:block.index("\n", call)].strip()
    assert line.startswith("try {") and "} catch {" in line, "a failure is a yellow line, never a stop"


def test_no_other_script_of_the_setup_mentions_the_persons_wslconfig():
    for script in sorted((ROOT / "scripts").glob("*.ps1")):
        text = script.read_text(encoding="utf-8")
        if ".wslconfig" in text and script.name not in {"podman-machine-bridge.ps1", "jht-uninstall-windows.ps1", "jht-wrapper.ps1", "install.ps1"}:
            raise AssertionError(f"{script.name} mentions .wslconfig")


# ── the uninstalls give the file back ──

from test_windows_podman_wsl_branches import WRAPPER

UNINSTALL = ENABLER.parent / "jht-uninstall-windows.ps1"
BLOCK = re.compile(r"# WSLCONFIG-BEGIN\n.*?# WSLCONFIG-END\n", re.S)
BLOCK_FUNCTIONS = ["Read-JhtWslConfigFile", "Write-JhtWslConfigFile", "Get-JhtWslConfigSections", "Add-JhtWslConfigKeys",
                   "ConvertTo-JhtWslConfigRecord", "Remove-JhtWslConfigKeys", "Read-JhtWslConfigRecord", "Test-JhtWslConfigRecordTarget"]


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def test_the_bridge_the_wrapper_and_the_app_uninstaller_carry_the_same_block():
    blocks = {path.name: BLOCK.findall(_text(path)) for path in (BRIDGE, WRAPPER, UNINSTALL)}
    assert all(len(found) == 1 for found in blocks.values()), {name: len(found) for name, found in blocks.items()}
    assert len({found[0] for found in blocks.values()}) == 1, "the three copies of the .wslconfig block must agree"


def _setup_then_runtime(tmp_path, original: bytes | None):
    """A setup that added both keys (to `original`, or to no file), and the runtime folder that holds its record."""
    if original is not None:
        _config(tmp_path).write_bytes(original)
    _add(tmp_path)
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "wslconfig-added").write_bytes((tmp_path / "record").read_bytes())
    return runtime


WRAPPER_BODY = r"""
Restore-JhtWslConfigAtUninstall -RuntimePath $env:RUNTIME -ProfilePath $env:PROFILEDIR
[Console]::Out.WriteLine('AFTER')
"""
WRAPPER_IMPORTS = [*BLOCK_FUNCTIONS, "Restore-JhtWslConfigAtUninstall", "Get-JhtUninstallText", "Get-JhtTextLanguage", "Format-JhtUninstallReason"]


def _wrapper_uninstall(tmp_path, runtime, language=""):
    env = {"RUNTIME": str(runtime), "JHT_HOST_ENV_FILE": str(tmp_path / "host.env"), "PROFILEDIR": str(tmp_path)}
    if language:
        env["JHT_LANG"] = language
    result, _ = _run(tmp_path, WRAPPER, WRAPPER_IMPORTS, WRAPPER_BODY, env)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.replace("\r\n", "\n")


def test_jht_uninstall_gives_the_wslconfig_back_as_it_was_and_says_so(tmp_path):
    original = b"[wsl2]\nprocessors=2\n"
    runtime = _setup_then_runtime(tmp_path, original)
    out = _wrapper_uninstall(tmp_path, runtime)
    assert _config(tmp_path).read_bytes() == original
    assert f"Tolte da {_config(tmp_path)} le righe aggiunte dall'installer (memoria di WSL)." in out and out.strip().endswith("AFTER")


def test_jht_uninstall_says_it_in_english_when_the_person_chose_another_language(tmp_path):
    runtime = _setup_then_runtime(tmp_path, None)
    out = _wrapper_uninstall(tmp_path, runtime, language="de")
    assert not _config(tmp_path).exists()
    assert f"Removed from {_config(tmp_path)} the lines the installer added (WSL memory)." in out


def test_jht_uninstall_leaves_what_the_person_changed_and_says_so(tmp_path):
    runtime = _setup_then_runtime(tmp_path, b"[wsl2]\nprocessors=2\n")
    text = _config(tmp_path).read_bytes().decode().replace("memory=3GB", "memory=2GB")
    _config(tmp_path).write_bytes(text.encode())
    out = _wrapper_uninstall(tmp_path, runtime)
    assert "Tolte da" in out and f"Lasciate in {_config(tmp_path)} le righe che hai cambiato tu: sono tue." in out
    assert "memory=2GB" in _config(tmp_path).read_bytes().decode()


def test_jht_uninstall_never_stops_for_a_wslconfig_it_cannot_rewrite(tmp_path):
    runtime = _setup_then_runtime(tmp_path, None)
    _config(tmp_path).write_bytes("[wsl2]\nmemory=1GB\n".encode("utf-16"))
    out = _wrapper_uninstall(tmp_path, runtime)
    assert "Non toccato" in out and "it is saved as UTF-16" in out and "Toglile a mano" in out and out.strip().endswith("AFTER")


def test_a_runtime_without_a_record_is_silent(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    out = _wrapper_uninstall(tmp_path, runtime)
    assert out.strip() == "AFTER"


def test_the_app_uninstaller_restores_it_and_reports_the_line(tmp_path):
    original = b"[wsl2]\nprocessors=2\n"
    runtime = _setup_then_runtime(tmp_path, original)
    body = r"""
$answer = Restore-JhtWslConfig -Runtime $env:RUNTIME -ProfilePath $env:PROFILEDIR
[Console]::Out.WriteLine('RESTORED removed=' + $answer.Removed + ' kept=' + $answer.Kept + ' failed=' + [string]$answer.Failed + ' path=' + $answer.Path)
"""
    result, _ = _run(tmp_path, UNINSTALL, [*BLOCK_FUNCTIONS, "Restore-JhtWslConfig"], body, {"RUNTIME": str(runtime), "PROFILEDIR": str(tmp_path)})
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"RESTORED removed=2 kept=0 failed=False path={_config(tmp_path)}" in result.stdout.replace("\r\n", "\n")
    assert _config(tmp_path).read_bytes() == original


def test_the_app_uninstaller_has_the_line_in_every_language_and_takes_it_out_before_the_runtime():
    source = _text(UNINSTALL)
    for language in ("it", "en", "de", "es", "fr", "hu", "pt"):
        table = re.search(rf"(?ms)^  {language} = @\{{\n(.*?)^  \}}\n", source).group(1)
        assert re.search(r"^    WslConfig = '.+'$", table, re.M), language
        assert ".wslconfig" in table
    remove = source[source.index("  # Remove. The commands that are ours"):]
    assert remove.index("Restore-JhtWslConfig -Runtime $plan.Runtime -ProfilePath $Roots.Profile") < remove.index("$items = @(, @('runtime'")
    # a failure to restore is reported as not removed; it does not retry the uninstall (nothing else depends on it)
    assert "$retry = $true" not in remove[remove.index("$wslConfig = Restore-JhtWslConfig"):remove.index("$items = @(, @('runtime'")]


def test_the_wrapper_takes_it_out_before_the_runtime_folder_goes():
    source = _text(WRAPPER)
    assert source.index("Restore-JhtWslConfigAtUninstall -RuntimePath $runtimePath -ProfilePath $ProfilePath") < source.index("Write-JhtUninstallPhase uninstall_runtime\n  if (Test-Path -LiteralPath $runtimePath)")


# ── a record is data in a folder the person can write: it never names another file, and is never read through a link ──


def test_a_record_that_names_a_file_outside_the_profile_deletes_nothing(tmp_path):
    victim = tmp_path / "elsewhere" / "important.ini"
    victim.parent.mkdir()
    victim.write_text(f"[wsl2]\r\n{COMMENT}\r\nmemory=3GB\r\n", encoding="utf-8", newline="")
    (tmp_path / "record").write_text(f"version=1\nfile={victim}\ncreated=1\nadd=wsl2|memory|3GB|1\n", encoding="utf-8")
    assert "REASON=no record" in _remove(tmp_path)
    assert victim.is_file() and "memory=3GB" in victim.read_text(encoding="utf-8")


def test_a_record_for_another_profiles_wslconfig_is_not_this_ones(tmp_path):
    other = tmp_path / "other-user"
    other.mkdir()
    (other / ".wslconfig").write_text(f"[wsl2]\n{COMMENT}\nmemory=3GB\n", encoding="utf-8", newline="")
    (tmp_path / "record").write_text(f"version=1\nfile={other / '.wslconfig'}\ncreated=1\nadd=wsl2|memory|3GB|1\n", encoding="utf-8")
    assert "REASON=no record" in _remove(tmp_path)
    assert (other / ".wslconfig").is_file()


def test_the_profiles_wslconfig_is_matched_whatever_the_case(tmp_path):
    _add(tmp_path)
    text = (tmp_path / "record").read_text(encoding="utf-8").replace(".wslconfig", ".WSLConfig")
    (tmp_path / "record").write_text(text, encoding="utf-8")
    # on a case-sensitive file system the file of that name does not exist: nothing is removed, nothing breaks
    out = _remove(tmp_path)
    assert "REASON=no record" not in out


@pytest.mark.skipif(os.name == "nt", reason="a symbolic link needs a privilege on Windows")
def test_a_record_that_is_a_link_is_never_read(tmp_path):
    _add(tmp_path)
    real = tmp_path / "real-record"
    (tmp_path / "record").rename(real)
    (tmp_path / "record").symlink_to(real)
    assert "REASON=no record" in _remove(tmp_path)
    assert _config(tmp_path).is_file(), "nothing was taken out through the link"


def test_a_record_too_big_to_be_ours_is_not_read(tmp_path):
    _add(tmp_path)
    with (tmp_path / "record").open("a", encoding="utf-8") as record:
        record.write("#" * 5000 + "\n")
    assert "REASON=no record" in _remove(tmp_path)


# ── other WSL distributions: no limit written, but said, and kept in jht doctor ──

def test_with_another_distribution_the_setup_says_why_there_is_no_limit_and_how_to_set_one(tmp_path):
    out, config, record = _step(tmp_path, names="podman-jht-podman,Ubuntu")
    assert not config.exists() and not record.exists()
    assert "WSL memory: no limit was set, because other WSL distributions are registered" in out
    assert f"To set one yourself: in {config}, under [wsl2], add memory=3GB" in out
    assert (tmp_path / "runtime" / "wslconfig-advice").read_text(encoding="utf-8") == "memory=3GB\n"


def test_with_another_distribution_and_a_limit_of_the_person_nothing_is_said(tmp_path):
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / ".wslconfig").write_text("[wsl2]\nmemory=6GB\n", encoding="utf-8")
    out, _, _ = _step(tmp_path, names="podman-jht-podman,Ubuntu")
    assert "WSL memory" not in out and not (tmp_path / "runtime" / "wslconfig-advice").exists()


def test_the_advice_goes_once_the_setup_writes_the_limit_itself(tmp_path):
    _step(tmp_path, names="podman-jht-podman,Ubuntu")
    assert (tmp_path / "runtime" / "wslconfig-advice").exists()
    _step(tmp_path)  # Ubuntu was removed: ours is the only distribution now
    assert not (tmp_path / "runtime" / "wslconfig-advice").exists()


def test_a_small_computer_with_another_distribution_is_advised_the_smaller_limit(tmp_path):
    out, _, _ = _step(tmp_path, names="podman-jht-podman,Ubuntu", ram="7900")
    assert "add memory=2GB" in out


def test_the_bridge_and_the_wrapper_read_a_limit_of_the_person_with_the_same_function():
    def function(path):
        text = path.read_text(encoding="utf-8")
        start = text.index("function Test-JhtWslConfigHasMemory {")
        return text[start:text.index("\n}\n", start)]
    assert function(BRIDGE) == function(WRAPPER)


DOCTOR_BODY = r"""
$RuntimeDir = $env:RUNTIME
$env:USERPROFILE = $env:PROFILE
[Console]::Out.WriteLine('ADVICE=' + (Get-JhtDoctorWslMemoryAdvice))
"""


def _doctor_advice(tmp_path, advice: str | None, wslconfig: str | None) -> str:
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    profile = tmp_path / "profile"
    profile.mkdir(exist_ok=True)
    (tmp_path / "bin").mkdir(exist_ok=True)
    if advice is not None:
        (runtime / "wslconfig-advice").write_text(advice, encoding="utf-8")
    if wslconfig is not None:
        (profile / ".wslconfig").write_text(wslconfig, encoding="utf-8")
    imports = ["Read-JhtWslConfigFile", "Get-JhtWslConfigSections", "Test-JhtWslConfigHasMemory", "Get-JhtDoctorWslMemoryAdvice"]
    result, _ = _run(tmp_path, WRAPPER, imports, DOCTOR_BODY, {"RUNTIME": str(runtime), "PROFILE": str(profile)})
    assert result.returncode == 0, result.stdout + result.stderr
    return re.search(r"^ADVICE=(.*)$", result.stdout.replace("\r\n", "\n"), re.M).group(1)


def test_doctor_is_told_the_limit_while_the_person_has_none(tmp_path):
    assert _doctor_advice(tmp_path, "memory=3GB\n", None) == "3GB"
    assert _doctor_advice(tmp_path, "memory=3GB\n", "[wsl2]\nprocessors=4\n") == "3GB"


def test_doctor_is_told_nothing_once_the_person_set_a_limit_or_without_the_setup_s_advice(tmp_path):
    assert _doctor_advice(tmp_path, "memory=3GB\n", "[wsl2]\nmemory=4GB\n") == ""
    (tmp_path / "runtime" / "wslconfig-advice").unlink()
    (tmp_path / "profile" / ".wslconfig").unlink()
    assert _doctor_advice(tmp_path, None, None) == ""


@pytest.mark.parametrize("advice", ["memory=3GB; rm -rf\n", "memory=300GB\n", "memory=3gb\n", "x" * 80])
def test_doctor_passes_on_only_a_value_of_the_setup_s_own_shape(tmp_path, advice):
    assert _doctor_advice(tmp_path, advice, None) == ""


def test_the_wrapper_gives_the_advice_to_doctor_only():
    text = WRAPPER.read_text(encoding="utf-8")
    doctor = text[text.index("\n  'doctor' {\n"):]
    doctor = doctor[:doctor.index("\n  }\n")]
    assert "JHT_HOST_WSL_MEMORY_ADVICE=$wslAdvice" in doctor
    assert text.count("JHT_HOST_WSL_MEMORY_ADVICE=") == 1
