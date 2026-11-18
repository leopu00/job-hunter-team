"""After the cleaning of the old images on Windows, the person is told what the disk of the machine of JHT takes.

With Podman the images live in the machine of JHT, a WSL distro whose disk is one .vhdx file on the Windows disk. In the collaudo of
build 9 to 10 the old images went, but the .vhdx went from 9.89 to 16.48 GiB and C: lost 6.6 GiB: the file does not shrink by itself.
Measured on WSL 3.0.5 with Podman 6.0.2: the .vhdx is not sparse and fstrim gives nothing back; on a sparse one the trimmed space comes
back to Windows when the machine stops. Now the cleaning runs fstrim in the distro and says one line in the person's language: for a
sparse disk how much comes back and when, for one that is not sparse how much JHT takes and that jht uninstall frees it all. No manual
steps are advised, nothing is stopped, the distro is not changed and nothing needs an administrator.

The wrapper's own functions are read through the AST; wsl.exe is a native fake (on Windows, the shell JHT_TEST_SHELL names). The
registry, the sparse flag and the size on disk are the wrapper's small readers, replaced here by fakes.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env
from wrapper_ps_texts import UTF8_OUTPUT

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
SOURCE = WRAPPER.read_text(encoding="utf-8")
GIB = 1 << 30

FAKE_WSL = r"""#!/bin/sh
echo "$*" >> "$FAKE/calls"
[ "$1 $3 $5" = "-d -u --" ] || exit 98
shift 5
case "$1" in
  fstrim) [ ! -e "$FAKE/fstrim-fails" ] || exit 1; echo "/: 6.6 GiB (7086696448 bytes) trimmed"; exit 0 ;;
  df) printf 'Used\n%s\n' "$(cat "$FAKE/used")"; exit 0 ;;
esac
exit 97
"""

PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:T_WRAPPER_SRC, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in @('Get-JhtTextTable', 'Get-JhtText', 'Format-JhtText', 'Get-JhtPodmanDistroName', 'Invoke-JhtMachineRoot', 'Invoke-MachineSpaceReturn',
                    'Get-JhtMachineSpaceText', 'Write-JhtMachineSpaceLog', 'Write-JhtMachineSpaceNote')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "missing $name" }
  Invoke-Expression $fn.Extent.Text
}
function Get-JhtTextLanguage { return $env:T_LANG }
function Write-UpgradeNote { param([string]$Message) Write-Output "NOTE: $Message" }
function Get-JhtMachineVhdx { param([string]$Distro) if ($Distro -ceq 'podman-jht-podman') { return $env:T_VHDX } return '' }
function Test-JhtSparseFile { param([string]$Path) return $env:T_SPARSE -eq '1' }
function Get-JhtFileSizeOnDisk { param([string]$Path) return [long]$env:T_ONDISK }
function Write-Info { param([string]$Msg) Write-Output "INFO: $Msg" }
$ContainerRuntime = $env:T_RUNTIME
$JhtHome = $env:T_HOME
$RuntimeDir = $env:T_RUNTIME_DIR
$env:CONTAINER_CONNECTION = 'jht-podman'
if ($env:T_SAY_NOTE -eq '1') { Write-JhtMachineSpaceNote; exit 0 }
$script:MachineSpaceNote = $null
$script:UpgradePrune = [ordered]@{ removed = 2; freedBytes = 7000000000 }
Invoke-MachineSpaceReturn
Write-Output ("DISK: " + ($script:UpgradePrune['machineDisk'] | ConvertTo-Json -Compress))
Write-Output ("KEPT: " + $script:MachineSpaceNote)
"""


@pytest.fixture()
def box(tmp_path):
    fake = tmp_path / "fake"
    bin_dir = tmp_path / "bin"
    fake.mkdir()
    bin_dir.mkdir()
    install_fake(bin_dir, "wsl.exe", FAKE_WSL)
    vhdx = tmp_path / "wsldist" / "jht-podman" / "ext4.vhdx"
    vhdx.parent.mkdir(parents=True)
    home = tmp_path / "jht"
    (home / "logs").mkdir(parents=True)
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()

    def run(*, on_disk_gib: float = 16.48, used_gib: float = 9.89, sparse: bool = False, runtime: str = "podman", lang: str = "it",
            vhdx_found: bool = True, used_text: str | None = None, say_note: bool = False):
        vhdx.write_bytes(b"")
        used = str(int(used_gib * GIB)) if used_text is None else used_text
        (fake / "used").write_text(used, encoding="utf-8", newline="\n")
        harness = tmp_path / "harness.ps1"
        harness.write_text(UTF8_OUTPUT + ENGINE_CHECK + PRELUDE, encoding="utf-8")
        engine = tmp_path / "engine.txt"
        env = {
            **(windows_env(tmp_path) if WINDOWS else os.environ),
            "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
            "JHT_ENGINE_FILE": str(engine), "FAKE": str(fake), "T_WRAPPER_SRC": str(WRAPPER),
            "T_VHDX": str(vhdx) if vhdx_found else "", "T_SPARSE": "1" if sparse else "0", "T_RUNTIME": runtime, "T_LANG": lang,
            "T_ONDISK": str(int(on_disk_gib * GIB)), "T_HOME": str(home), "T_RUNTIME_DIR": str(runtime_dir),
            "T_SAY_NOTE": "1" if say_note else "0",
        }
        done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True,
                              encoding="utf-8", timeout=180)
        assert_engine(engine, done.stderr)
        assert done.returncode == 0, done.stdout + done.stderr
        return done

    def calls() -> list[str]:
        path = fake / "calls"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    return type("Box", (), {"run": staticmethod(run), "calls": staticmethod(calls), "fake": fake, "home": home, "runtime": runtime_dir})


def notes(done) -> list[str]:
    return [line.strip()[len("NOTE: "):] for line in done.stdout.splitlines() if line.strip().startswith("NOTE: ")]


def disk(done) -> dict | None:
    # No block: Windows PowerShell 5.1 turns $null into nothing, PowerShell 7 into «null».
    line = [line.strip() for line in done.stdout.splitlines() if line.strip().startswith("DISK:")][-1]
    text = line[len("DISK:"):].strip()
    return json.loads(text) if text else None


TRIM = "-d podman-jht-podman -u root -- fstrim -a"
DF = "-d podman-jht-podman -u root -- df -B1 --output=used /"


def test_the_collaudo_disk_that_is_not_sparse_is_trimmed_and_the_person_reads_what_jht_takes(box):
    done = box.run()
    assert box.calls() == [TRIM, DF]
    assert notes(done) == ["JHT occupa circa 16 GB nel suo disco virtuale; si liberano del tutto con jht uninstall."]
    assert disk(done) == {"sparse": False, "trimmed": True, "onDiskBytes": int(16.48 * GIB),
                          "recoverableBytes": int(16.48 * GIB) - int(9.89 * GIB)}


@pytest.mark.parametrize("lang", ["en", "it", "hu", "es", "de", "fr", "pt"])
def test_the_line_is_said_in_the_language_of_the_person(box, lang):
    from script_texts import catalog

    assert notes(box.run(lang=lang)) == [catalog(lang)["wrapper.ps.machine_space_not_returned"].replace("%s", "16")]
    sparse = catalog(lang)["wrapper.ps.machine_space_back_on_stop"].replace("%s", "6", 1).replace("%s", "jht-podman", 1)
    assert notes(box.run(lang=lang, sparse=True)) == [sparse]


def test_no_step_is_advised_to_the_person_only_what_jht_takes_and_jht_uninstall():
    from script_texts import LANGUAGES, catalog

    for lang in LANGUAGES:
        for key in ("wrapper.ps.machine_space_not_returned", "wrapper.ps.machine_space_back_on_stop"):
            text = catalog(lang)[key]
            for word in ("set-sparse", "wsl --", "Optimize-VHD", "diskpart", "--shutdown"):
                assert word not in text, (lang, key, word)
        assert "jht uninstall" in catalog(lang)["wrapper.ps.machine_space_not_returned"]


def test_a_sparse_disk_says_how_much_comes_back_when_the_machine_stops(box):
    done = box.run(sparse=True)
    assert box.calls() == [TRIM, DF]
    assert notes(done) == ["Circa 6 GB liberati nella macchina di JHT tornano a Windows quando la macchina si ferma: dopo jht down, "
                           "con podman machine stop jht-podman, o al riavvio del computer."]
    assert disk(done)["sparse"] is True


@pytest.mark.parametrize("sparse", [False, True], ids=["not-sparse", "sparse"])
def test_less_than_a_gigabyte_free_inside_says_nothing(box, sparse):
    done = box.run(on_disk_gib=10.5, used_gib=9.89, sparse=sparse)
    assert notes(done) == []
    assert disk(done)["recoverableBytes"] == int(10.5 * GIB) - int(9.89 * GIB)


def test_a_trim_that_fails_still_measures_and_tells(box):
    (box.fake / "fstrim-fails").write_text("", encoding="utf-8")
    done = box.run()
    assert disk(done)["trimmed"] is False
    assert len(notes(done)) == 1


def test_what_the_distro_uses_unreadable_says_nothing(box):
    done = box.run(used_text="")
    assert notes(done) == []
    assert disk(done)["recoverableBytes"] == 0


@pytest.mark.parametrize("case", ["docker", "no-vhdx"])
def test_without_a_podman_machine_on_this_computer_nothing_runs(box, case):
    done = box.run(runtime="docker") if case == "docker" else box.run(vhdx_found=False)
    assert box.calls() == []
    assert notes(done) == []
    assert disk(done) is None


# ── what the file says ─────────────────────────────────────────────────────────────────────────────────────────────
def _function(name: str) -> str:
    match = re.search(r"(?m)^function " + re.escape(name) + r" \{\n(.*?)^\}\n", SOURCE, re.S)
    assert match, name
    return match.group(1)


def test_the_space_is_given_back_only_after_a_cleaning_that_removed_something():
    body = _function("Remove-OldJhtImages")
    assert "if ($removed -gt 0) { try { Invoke-MachineSpaceReturn } catch {} }" in body
    assert body.index("Write-UpgradeNote $note") < body.index("Invoke-MachineSpaceReturn")


def test_nothing_is_stopped_and_nothing_needs_an_administrator():
    code = "\n".join(_function(name) for name in (
        "Invoke-MachineSpaceReturn", "Invoke-JhtMachineRoot", "Get-JhtMachineVhdx", "Test-JhtSparseFile", "Get-JhtFileSizeOnDisk"))
    for word in ("--shutdown", "--terminate", "machine stop", "set-sparse", "Optimize-VHD", "diskpart", "HKLM", "RunAs"):
        assert word not in code, word
    assert "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss" in code


def _link(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target)
    except OSError:  # Windows without the right to make links (a user who is not an administrator, no developer mode)
        pytest.skip("this account cannot make a symbolic link")


def kept(done) -> str:
    return [line.strip() for line in done.stdout.splitlines() if line.strip().startswith("KEPT:")][-1][len("KEPT:"):].strip()


def log_lines(box) -> list[str]:
    path = box.home / "logs" / "machine-space.log"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


# ── a line in the log at every trim, and the note the detached cleaning keeps (collaudo of build 11 to 12c) ──────────────────────
LOG_LINE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ fstrim trimmed=(true|false) sparse=(true|false) on_disk_bytes=\d+ "
                      r"used_bytes=(\d+|unknown) recoverable_bytes=\d+$")


def test_every_trim_writes_one_line_in_the_log_with_its_numbers(box):
    box.run()
    box.run(on_disk_gib=10.5, used_gib=9.89)
    lines = log_lines(box)
    assert len(lines) == 2 and all(LOG_LINE.match(line) for line in lines), lines
    assert lines[0].endswith(f"fstrim trimmed=true sparse=false on_disk_bytes={int(16.48 * GIB)} used_bytes={int(9.89 * GIB)} "
                             f"recoverable_bytes={int(16.48 * GIB) - int(9.89 * GIB)}")
    assert "recoverable_bytes=" + str(int(10.5 * GIB) - int(9.89 * GIB)) in lines[1], "a trim that says nothing is still in the log"


def test_a_trim_that_fails_and_a_usage_that_cannot_be_read_are_in_the_log_too(box):
    (box.fake / "fstrim-fails").write_text("", encoding="utf-8")
    box.run(used_text="")
    [line] = log_lines(box)
    assert " fstrim trimmed=false sparse=false " in line and " used_bytes=unknown recoverable_bytes=0" in line


def test_with_no_podman_machine_there_is_no_trim_and_no_line_in_the_log(box):
    box.run(runtime="docker")
    box.run(vhdx_found=False)
    assert log_lines(box) == []


def test_no_logs_folder_or_a_link_in_place_of_the_log_writes_nothing_and_fails_nothing(box, tmp_path):
    elsewhere = tmp_path / "elsewhere.log"
    elsewhere.write_text("", encoding="utf-8")
    _link(box.home / "logs" / "machine-space.log", elsewhere)
    assert len(notes(box.run())) == 1
    assert elsewhere.read_text(encoding="utf-8") == ""
    (box.home / "logs" / "machine-space.log").unlink()
    (box.home / "logs").rmdir()
    assert len(notes(box.run())) == 1


@pytest.mark.parametrize(("sparse", "note"), [(False, "not_returned 16"), (True, "back_on_stop 6")], ids=["not-sparse", "sparse"])
def test_the_cleaning_keeps_the_note_of_the_line_it_said(box, sparse, note):
    assert kept(box.run(sparse=sparse)) == note
    assert kept(box.run(on_disk_gib=10.5, used_gib=9.89, sparse=sparse)) == ""


@pytest.mark.parametrize("lang", ["en", "it", "hu", "es", "de", "fr", "pt"])
def test_the_kept_note_is_said_once_in_the_language_of_the_person_and_then_goes(box, lang):
    from script_texts import catalog

    marker = box.runtime / ".machine-space-note"
    marker.write_text("not_returned 17\n", encoding="utf-8")
    first = box.run(lang=lang, say_note=True)
    assert [line[len("INFO: "):] for line in first.stdout.splitlines() if line.startswith("INFO: ")] == [
        catalog(lang)["wrapper.ps.machine_space_not_returned"].replace("%s", "17")]
    assert not marker.exists()
    assert "INFO:" not in box.run(lang=lang, say_note=True).stdout
    marker.write_text("back_on_stop 3\n", encoding="utf-8")
    sparse = catalog(lang)["wrapper.ps.machine_space_back_on_stop"].replace("%s", "3", 1).replace("%s", "jht-podman", 1)
    assert sparse in box.run(lang=lang, say_note=True).stdout


@pytest.mark.parametrize("text", ["not_returned 17; rm -rf /", "back_on_stop", "say 4", "not_returned 9999999", "x" * 80])
def test_a_note_that_is_not_one_of_the_two_says_nothing_and_goes(box, text):
    marker = box.runtime / ".machine-space-note"
    marker.write_text(text, encoding="utf-8")
    assert "INFO:" not in box.run(say_note=True).stdout
    assert not marker.exists()


def test_a_link_in_place_of_the_note_is_not_read(box, tmp_path):
    target = tmp_path / "target"
    target.write_text("not_returned 17\n", encoding="utf-8")
    marker = box.runtime / ".machine-space-note"
    _link(marker, target)
    assert "INFO:" not in box.run(say_note=True).stdout
    assert target.read_text(encoding="utf-8") == "not_returned 17\n"


def test_jht_up_setup_and_status_say_the_kept_note_before_anything_else():
    body = _function("Write-JhtToolsNotice")
    assert body.index("Write-JhtMachineSpaceNote") < body.index("RuntimeTierFile"), "the note waits for a tier that is gone"


def test_the_installer_cleans_and_trims_after_its_jht_up_when_the_full_image_is_in_place():
    enabler = (ROOT / "scripts" / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    up = enabler.index("& (Join-Path $BinDir 'jht.ps1') up\n")
    tidy = enabler.index("& (Join-Path $BinDir 'jht.ps1') tools tidy")
    assert up < tidy
    guard = enabler.rindex("\n", 0, tidy)
    assert "if (-not (Test-Path -LiteralPath $runtimeTierFile -PathType Leaf)) {" in enabler[enabler.rindex("\nif ", 0, tidy):tidy]
    assert "try { & { $ErrorActionPreference = 'Continue';" in enabler[guard:tidy]
