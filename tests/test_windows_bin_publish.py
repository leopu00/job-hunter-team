"""The files install.ps1 publishes in the bin folder take the place of the old ones; they are never written in place.

Writing a file in place truncates it first. A program that holds the file open for a moment (a scanner that looks at a
command file just written) then makes the write fail, and the file stays EMPTY: `jht` does nothing and the install ends
with an error that names a stream, not the cause. `Publish-JhtFile` (windows-private-acl.ps1) writes the bytes to a
temporary file beside it and takes the place of the file with it, tries again a few times while the file is held, leaves
a file that is already these bytes alone, and leaves the old file as it was when it never works. The wrapper's check of
the runtime folder counts the same rights as the desktop app's.

The first block reads the sources (any host); the second runs PowerShell (a Mac needs pwsh; Windows runs it under
JHT_TEST_SHELL), and its lock cases need Windows, where a file opened without sharing really refuses the take-over.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
HELPER = SCRIPTS / "windows-private-acl.ps1"
INSTALL = SCRIPTS / "install.ps1"
ENABLER = SCRIPTS / "enable-podman-windows-runtime.ps1"
WRAPPER = SCRIPTS / "jht-wrapper.ps1"
RUST = ROOT / "desktop" / "src-tauri" / "src" / "windows_runtime.rs"
PWSH = shutil.which("pwsh")

needs_powershell = pytest.mark.skipif(not WINDOWS and PWSH is None, reason="needs PowerShell")
needs_windows = pytest.mark.skipif(not WINDOWS, reason="a file opened without sharing refuses the take-over only on Windows")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def _code(path: Path) -> str:
    return "\n".join(line for line in _text(path).split("\n") if not line.lstrip().startswith("#"))


def test_the_command_file_is_published_by_taking_its_place_not_written_in_place():
    code = _code(INSTALL)
    assert "Publish-JhtFile -Destination $shimDest" in code
    assert not re.search(r"Set-Content[^\n]*\$shimDest", code)
    # the function is there (the helper was published and dot-sourced) before the file is published
    assert code.index(". $helperDest") < code.index("Publish-JhtFile -Destination $shimDest")
    # CRLF whatever the line ending of the installer, ASCII
    assert '-replace "`r?`n", "`r`n"' in code and "[Text.Encoding]::ASCII.GetBytes" in code


def test_the_files_the_enabler_publishes_in_bin_take_their_place_too():
    code = _code(ENABLER)
    assert "Publish-JhtFile -Destination $entry.Value" in code
    assert not re.search(r"Copy-Item[^\n]*\$entry", code)
    assert code.index(". $helperSource") < code.index("Publish-JhtFile -Destination $entry.Value")


def test_the_publisher_never_writes_the_destination_in_place():
    source = _text(HELPER)
    function = source[source.index("function Publish-JhtFile") :]
    body = "\n".join(line for line in function.split("\n") if not line.lstrip().startswith("#"))
    # the new bytes go to a temporary beside the file, created new; the file is replaced by it, or the name is taken
    assert "[IO.FileMode]::CreateNew" in body
    assert "[IO.File]::Replace($temporary, $Destination, [NullString]::Value)" in body and "[IO.File]::Move($temporary, $Destination)" in body
    for in_place in ("Set-Content", "Out-File", "WriteAllBytes($Destination", "WriteAllText($Destination", "Copy-Item"):
        assert in_place not in body, in_place
    # the work stops being retried: a few attempts, a short wait; the temporary is always removed
    assert "$Attempts = 6" in body and "$DelayMilliseconds = 500" in body
    assert "finally" in body and "[IO.File]::Delete($temporary)" in body
    # the helper stays ASCII: Windows PowerShell 5.1 reads it without a BOM
    HELPER.read_bytes().decode("ascii")


def test_the_uninstaller_knows_an_empty_or_cut_command_file_as_ours():
    code = _code(SCRIPTS / "jht-uninstall-windows.ps1")
    assert "$shim.StartsWith($text, [StringComparison]::Ordinal)" in code


# write data / add file, append / add folder, write extended attributes, delete child, write attributes, delete,
# change permissions, take ownership, generic write, generic all
CHANGING_RIGHTS = 0x2 | 0x4 | 0x10 | 0x40 | 0x100 | 0x10000 | 0x40000 | 0x80000 | 0x40000000 | 0x10000000


def test_the_wrappers_check_of_the_runtime_folder_counts_every_right_that_changes_it():
    wrapper = _text(WRAPPER)
    function = wrapper[wrapper.index("function Test-RuntimeDirectoryAcl") :]
    function = function[: function.index("\n}\n")]
    found = re.search(r"-band 0x([0-9A-Fa-f]+)", function)
    assert found, "the wrapper masks the rights with one number"
    assert int(found.group(1), 16) == CHANGING_RIGHTS
    # the old set (Write, Modify, FullControl) missed delete, change permissions and take ownership
    assert "FileSystemRights]::Write" not in function
    # reading, listing and running (ReadAndExecute + Synchronize, 0x1200A9) change nothing
    assert 0x1200A9 & CHANGING_RIGHTS == 0


def test_the_wrapper_and_the_app_count_the_same_rights_once_the_app_has_its_mask():
    rust = RUST.read_text(encoding="utf-8")
    if "pub(crate) fn mask_allows_changing" not in rust:
        pytest.skip("the app's mask is not in this tree yet")
    block = rust[rust.index("pub(crate) fn mask_allows_changing") :]
    block = block[: block.index("mask & CHANGING")]
    app_mask = 0
    for literal in re.findall(r"0x[0-9A-Fa-f_]+", block):
        app_mask |= int(literal.replace("_", ""), 16)
    assert app_mask == CHANGING_RIGHTS


def _ps(tmp_path: Path, text: str, timeout=90) -> subprocess.CompletedProcess:
    script = tmp_path / "case.ps1"
    engine = tmp_path / "engine.txt"
    engine.unlink(missing_ok=True)
    script.write_text(ENGINE_CHECK + text, encoding="utf-8")
    if WINDOWS:
        env = {**windows_env(tmp_path), "PATH": ""}
    else:
        env = {"PATH": "/usr/bin:/bin"}
    env.update({"HOME": str(tmp_path), "JHT_ENGINE_FILE": str(engine)})
    done = subprocess.run([*powershell_argv(), "-File", str(script)], capture_output=True, text=True, timeout=timeout, env=env)
    assert_engine(engine, done.stderr)
    return done


def _load(tmp_path: Path) -> str:
    # only the function: the helper's other functions need Windows
    source = _text(HELPER)
    function = source[source.index("function Publish-JhtFile") :]
    path = tmp_path / "publish.ps1"
    path.write_text(function, encoding="utf-8")
    return f". '{path}'\n"


def _folder(tmp_path: Path) -> Path:
    folder = tmp_path / "bin"
    folder.mkdir()
    return folder


@needs_powershell
def test_a_new_file_is_published_and_no_temporary_is_left(tmp_path):
    folder = _folder(tmp_path)
    done = _ps(tmp_path, _load(tmp_path) + f"Publish-JhtFile -Destination '{folder / 'jht.cmd'}' -Bytes ([byte[]](65,66,67))\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert (folder / "jht.cmd").read_bytes() == b"ABC"
    assert [p.name for p in folder.iterdir()] == ["jht.cmd"]


@needs_powershell
def test_an_empty_or_different_file_is_replaced_whole(tmp_path):
    folder = _folder(tmp_path)
    for old in (b"", b"@echo off\r\n", b"something else entirely"):
        (folder / "jht.cmd").write_bytes(old)
        done = _ps(tmp_path, _load(tmp_path) + f"Publish-JhtFile -Destination '{folder / 'jht.cmd'}' -Bytes ([byte[]](1,2,3,4))\n")
        assert done.returncode == 0, done.stdout + done.stderr
        assert (folder / "jht.cmd").read_bytes() == bytes([1, 2, 3, 4])
    assert [p.name for p in folder.iterdir()] == ["jht.cmd"]


@needs_powershell
def test_a_file_that_is_already_these_bytes_is_not_touched(tmp_path):
    folder = _folder(tmp_path)
    target = folder / "jht.cmd"
    target.write_bytes(bytes([9, 8, 7]))
    os.utime(target, (1_000_000_000, 1_000_000_000))
    done = _ps(tmp_path, _load(tmp_path) + f"Publish-JhtFile -Destination '{target}' -Bytes ([byte[]](9,8,7))\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert int(target.stat().st_mtime) == 1_000_000_000, "not rewritten"
    assert [p.name for p in folder.iterdir()] == ["jht.cmd"]


@needs_windows
def test_a_file_that_stays_held_is_left_as_it_was_with_the_cause_and_no_temporary(tmp_path):
    folder = _folder(tmp_path)
    target = folder / "jht.cmd"
    target.write_bytes(b"old text")
    hold = (
        f"$held = [IO.File]::Open('{target}', [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)\n"
        "try {\n"
        f"  Publish-JhtFile -Destination '{target}' -Bytes ([byte[]](1,2,3)) -Attempts 3 -DelayMilliseconds 20\n"
        "  'PUBLISHED'\n"
        "} catch { 'REFUSED: ' + $_.Exception.Message } finally { $held.Dispose() }\n"
    )
    done = _ps(tmp_path, _load(tmp_path) + hold)
    assert "REFUSED:" in done.stdout and "another program holds it open" in done.stdout, done.stdout + done.stderr
    assert "PUBLISHED" not in done.stdout
    assert target.read_bytes() == b"old text", "never truncated"
    assert [p.name for p in folder.iterdir()] == ["jht.cmd"], "the temporary is removed"


@needs_windows
def test_a_file_held_for_a_moment_is_published_when_it_is_let_go(tmp_path):
    folder = _folder(tmp_path)
    target = folder / "jht.cmd"
    target.write_bytes(b"")
    hold = (
        f"$held = [IO.File]::Open('{target}', [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)\n"
        "$script:busy = 0\n"
        f"Publish-JhtFile -Destination '{target}' -Bytes ([byte[]](5,6,7)) -Attempts 5 -DelayMilliseconds 20 "
        "-OnBusy { param($n) $script:busy = $n; if ($n -eq 2) { $held.Dispose() } }\n"
        "'BUSY=' + $script:busy\n"
    )
    done = _ps(tmp_path, _load(tmp_path) + hold)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "BUSY=2" in done.stdout, done.stdout
    assert target.read_bytes() == bytes([5, 6, 7])
    assert [p.name for p in folder.iterdir()] == ["jht.cmd"]
