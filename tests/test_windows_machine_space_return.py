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
foreach ($name in @('Get-JhtTextTable', 'Get-JhtText', 'Format-JhtText', 'Get-JhtPodmanDistroName', 'Invoke-JhtMachineRoot', 'Invoke-MachineSpaceReturn')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "missing $name" }
  Invoke-Expression $fn.Extent.Text
}
function Get-JhtTextLanguage { return $env:T_LANG }
function Write-UpgradeNote { param([string]$Message) Write-Output "NOTE: $Message" }
function Get-JhtMachineVhdx { param([string]$Distro) if ($Distro -ceq 'podman-jht-podman') { return $env:T_VHDX } return '' }
function Test-JhtSparseFile { param([string]$Path) return $env:T_SPARSE -eq '1' }
function Get-JhtFileSizeOnDisk { param([string]$Path) return [long]$env:T_ONDISK }
$ContainerRuntime = $env:T_RUNTIME
$env:CONTAINER_CONNECTION = 'jht-podman'
$script:UpgradePrune = [ordered]@{ removed = 2; freedBytes = 7000000000 }
Invoke-MachineSpaceReturn
Write-Output ("DISK: " + ($script:UpgradePrune['machineDisk'] | ConvertTo-Json -Compress))
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

    def run(*, on_disk_gib: float = 16.48, used_gib: float = 9.89, sparse: bool = False, runtime: str = "podman", lang: str = "it",
            vhdx_found: bool = True, used_text: str | None = None):
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
            "T_ONDISK": str(int(on_disk_gib * GIB)),
        }
        done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True,
                              encoding="utf-8", timeout=180)
        assert_engine(engine, done.stderr)
        assert done.returncode == 0, done.stdout + done.stderr
        return done

    def calls() -> list[str]:
        path = fake / "calls"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    return type("Box", (), {"run": staticmethod(run), "calls": staticmethod(calls), "fake": fake})


def notes(done) -> list[str]:
    return [line.strip()[len("NOTE: "):] for line in done.stdout.splitlines() if line.strip().startswith("NOTE: ")]


def disk(done) -> dict | None:
    line = [line.strip() for line in done.stdout.splitlines() if line.strip().startswith("DISK: ")][-1]
    text = line[len("DISK: "):]
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
