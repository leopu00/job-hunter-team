"""An update succeeds while the docker.exe shim runs, and a setup that stops half way puts the runtime back as it was.

The Assistente's chat holds a `docker exec` open through the runtime's docker.exe, and reconnects on its own after a restart of
the machine. Windows refuses to write a running program, so compiling the new shim onto it stopped the update ("the file is used
by another process", "Native docker shim compiler exited with 1"); the files published before it stayed new under the old
manifest, and the wrapper then refused the whole runtime as untrusted. Now the shim is compiled beside it and takes its place by
renames (a running program can be renamed), and every file the enabler changes is saved before the first one is published and
put back if the setup stops before the new manifest attests them.

The first block reads the sources (any host); the second runs the functions in PowerShell (a Mac needs pwsh), and the cases with
a program really running need Windows.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
ENABLER = SCRIPTS / "enable-podman-windows-runtime.ps1"
HELPER = SCRIPTS / "windows-private-acl.ps1"
PWSH = shutil.which("pwsh")

needs_powershell = pytest.mark.skipif(not WINDOWS and PWSH is None, reason="needs PowerShell")
needs_windows = pytest.mark.skipif(not WINDOWS, reason="only Windows refuses to write a running program")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def _code(path: Path) -> str:
    return "\n".join(line for line in _text(path).split("\n") if not line.lstrip().startswith("#"))


def _function(source: str, name: str) -> str:
    # up to the line that closes it at column 0 (the shim's C# here-string has its own closing braces at column 0 too, so the
    # shim is read up to the next function)
    start = source.index(f"function {name}")
    if name == "New-DockerShim":
        return source[start : source.index("\nfunction ", start)]
    return source[start : source.index("\n}\n", start) + 3]


def test_the_shim_is_compiled_beside_it_and_takes_its_place_by_renames():
    shim = _function(_code(ENABLER), "New-DockerShim")
    assert "-OutputAssembly '$quotedFresh'" in shim
    assert "-OutputAssembly '$quotedDestination'" not in shim
    assert "Set-JhtProgramInPlace -Fresh $fresh -Destination $Destination" in shim
    assert "Remove-JhtProgramsSetAside -Destination $Destination" in shim
    # the compiled file and its source never stay behind
    assert "Remove-Item -LiteralPath $fresh" in shim and "Remove-Item -LiteralPath $sourcePath" in shim
    swap = _function(_code(ENABLER), "Set-JhtProgramInPlace")
    # renamed aside, never written, replaced or deleted while it may run; given back when the new one cannot take the name
    assert "[IO.File]::Move($Destination, $aside)" in swap and "[IO.File]::Move($Fresh, $Destination)" in swap
    assert "[IO.File]::Move($aside, $Destination)" in swap
    for in_place in ("Replace(", "WriteAll", "Copy-Item", "Set-Content"):
        assert in_place not in swap, in_place


def test_every_file_of_the_new_runtime_is_saved_before_the_first_publish_and_put_back_on_a_stop():
    code = _code(ENABLER)
    saved_at = code.index("$runtimeBefore = Save-JhtRuntimeFiles")
    assert saved_at < code.index("Publish-JhtFile -Destination $entry.Value")
    assert code.index("try {", saved_at) < code.index("$files = @{")
    snapshot = code[saved_at : code.index("try {", saved_at)]
    # the catch is after the owners of the last file and before anything else: the manifest is the last file it covers
    owners = code.index("foreach ($bundleFile in $bundleFiles) { Set-JhtOwnerToCurrentUser -Path $bundleFile }")
    owners_end = code.index("\n", owners)
    catch = code.index("} catch {", owners)
    assert code[owners_end:catch].strip() == "", "the catch comes right after the owners of the last file"
    assert code.index(".runtime-integrity'), $manifest") < owners
    handler = code[catch : code.index("\n}\n", catch)]
    assert "Restore-JhtRuntimeFiles -Saved $runtimeBefore -Programs @($shim)" in handler
    assert "throw $stopped" in handler, "the setup still says it failed"
    # every file the manifest attests and every file written between the two is in the snapshot
    bundle = code[code.index("$bundleFiles = @(") : owners]
    names = set(re.findall(r"Join-Path \$(?:RuntimeDir|BinDir) '([^']+)'", bundle))
    names |= {"container-runtime", "podman-machine", "jht-container.service", "runtime-image", "runtime-tier",
              ".runtime-tier-integrity", "runtime-extras-image", ".runtime-extras-integrity", ".runtime-helpers"}
    files = code[code.index("$files = @{") : code.index("Publish-JhtFile -Destination $entry.Value")]
    names |= set(re.findall(r"= \(Join-Path \$(?:RuntimeDir|BinDir) '([^']+)'\)", files))
    for name in sorted(names):
        assert f"'{name}'" in snapshot, name
    assert "$shim" in snapshot


def _ps(tmp_path: Path, text: str, timeout=120) -> subprocess.CompletedProcess:
    script = tmp_path / "case.ps1"
    engine = tmp_path / "engine.txt"
    engine.unlink(missing_ok=True)
    source = _text(ENABLER)
    functions = "".join(_function(source, name) for name in
                        ("Set-JhtProgramInPlace", "Remove-JhtProgramsSetAside", "Save-JhtRuntimeFiles", "Restore-JhtRuntimeFiles"))
    functions += _function(_text(HELPER), "Publish-JhtFile")
    script.write_text(ENGINE_CHECK + "$ErrorActionPreference = 'Stop'\n" + functions + text, encoding="utf-8")
    if WINDOWS:
        env = {**windows_env(tmp_path), "PATH": ""}
    else:
        env = {"PATH": "/usr/bin:/bin"}
    env.update({"HOME": str(tmp_path), "JHT_ENGINE_FILE": str(engine)})
    done = subprocess.run([*powershell_argv(), "-File", str(script)], capture_output=True, text=True, timeout=timeout, env=env)
    assert_engine(engine, done.stderr)
    return done


def _bin(tmp_path: Path) -> Path:
    folder = tmp_path / "runtime" / "bin"
    folder.mkdir(parents=True)
    return folder


@needs_powershell
def test_a_program_nothing_runs_is_swapped_and_nothing_is_left_beside_it(tmp_path):
    folder = _bin(tmp_path)
    (folder / "docker.exe").write_bytes(b"old shim")
    (folder / "fresh.exe").write_bytes(b"new shim")
    done = _ps(tmp_path, f"Set-JhtProgramInPlace -Fresh '{folder / 'fresh.exe'}' -Destination '{folder / 'docker.exe'}'\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert (folder / "docker.exe").read_bytes() == b"new shim"
    assert sorted(p.name for p in folder.iterdir()) == ["docker.exe"]


@needs_powershell
def test_only_the_copies_set_aside_go_away(tmp_path):
    folder = _bin(tmp_path)
    keep = ["docker.exe", "docker.exe.old-notours", "docker.exe.old-" + "A" * 32, "podman.exe.old-" + "a" * 32]
    for name in keep + ["docker.exe.old-" + "0123456789abcdef" * 2]:
        (folder / name).write_bytes(b"x")
    done = _ps(tmp_path, f"Remove-JhtProgramsSetAside -Destination '{folder / 'docker.exe'}'\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert sorted(p.name for p in folder.iterdir()) == sorted(keep)


@needs_powershell
def test_a_stop_puts_back_every_file_as_it_was_an_empty_one_too_and_removes_the_ones_that_were_not_there(tmp_path):
    runtime = tmp_path / "runtime"
    folder = _bin(tmp_path)
    (runtime / "docker-compose.yml").write_bytes(b"old compose")
    (runtime / ".runtime-integrity").write_bytes(b"old manifest")
    (runtime / "runtime-tier").write_bytes(b"")
    (folder / "docker.exe").write_bytes(b"old shim")
    paths = [runtime / "docker-compose.yml", runtime / ".runtime-integrity", runtime / "runtime-tier", runtime / "runtime-image",
             folder / "docker.exe"]
    listed = ", ".join(f"'{p}'" for p in paths)
    case = (
        f"$saved = Save-JhtRuntimeFiles -Paths @({listed})\n"
        f"[IO.File]::WriteAllText('{runtime / 'docker-compose.yml'}', 'new compose')\n"
        f"[IO.File]::WriteAllText('{runtime / 'runtime-tier'}', 'core')\n"
        f"[IO.File]::WriteAllText('{runtime / 'runtime-image'}', 'new pin')\n"
        f"[IO.File]::WriteAllText('{folder / 'docker.exe'}', 'new shim')\n"
        f"if (Restore-JhtRuntimeFiles -Saved $saved -Programs @('{folder / 'docker.exe'}')) {{ 'RESTORED' }}\n"
    )
    done = _ps(tmp_path, case)
    assert done.returncode == 0 and "RESTORED" in done.stdout, done.stdout + done.stderr
    assert (runtime / "docker-compose.yml").read_bytes() == b"old compose"
    assert (runtime / ".runtime-integrity").read_bytes() == b"old manifest"
    assert (runtime / "runtime-tier").read_bytes() == b"", "an empty file is a file, not one that was not there"
    assert not (runtime / "runtime-image").exists()
    assert (folder / "docker.exe").read_bytes() == b"old shim"
    assert sorted(p.name for p in folder.iterdir()) == ["docker.exe"]


def _running(folder: Path) -> str:
    # a real program under the shim's name, running for a while: the system's ping, copied
    return (
        f"Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\\PING.EXE') -Destination '{folder / 'docker.exe'}'\n"
        f"$running = Start-Process -FilePath '{folder / 'docker.exe'}' -ArgumentList '-n','60','127.0.0.1' -WindowStyle Hidden -PassThru\n"
        "Start-Sleep -Milliseconds 500\n"
    )


@needs_windows
def test_a_running_shim_cannot_be_written_but_is_swapped_and_its_old_copy_goes_away_once_it_ends(tmp_path):
    folder = _bin(tmp_path)
    (folder / "fresh.exe").write_bytes(b"MZ new shim")
    case = _running(folder) + (
        "try {\n"
        f"  try {{ [IO.File]::WriteAllBytes('{folder / 'docker.exe'}', [byte[]](1)); 'WRITTEN' }} catch {{ 'WRITE REFUSED' }}\n"
        f"  Set-JhtProgramInPlace -Fresh '{folder / 'fresh.exe'}' -Destination '{folder / 'docker.exe'}'\n"
        "  'SWAPPED'\n"
        f"  @(Get-ChildItem -LiteralPath '{folder}' -Force | ForEach-Object Name) -join ','\n"
        "} finally { Stop-Process -Id $running.Id -Force; $running.WaitForExit() }\n"
        f"Remove-JhtProgramsSetAside -Destination '{folder / 'docker.exe'}'\n"
    )
    done = _ps(tmp_path, case)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "WRITE REFUSED" in done.stdout and "WRITTEN" not in done.stdout, "the premise: a running program refuses the write"
    assert "SWAPPED" in done.stdout
    assert re.search(r"docker\.exe,docker\.exe\.old-[0-9a-f]{32}", done.stdout), done.stdout
    assert (folder / "docker.exe").read_bytes() == b"MZ new shim"
    assert sorted(p.name for p in folder.iterdir()) == ["docker.exe"], "the old copy is deleted once nothing runs it"


@needs_windows
def test_a_running_new_shim_is_put_back_to_the_old_one_on_a_stop(tmp_path):
    folder = _bin(tmp_path)
    shim = folder / "docker.exe"
    case = (
        f"[IO.File]::WriteAllBytes('{shim}', [byte[]](77,90,1,2,3))\n"
        f"$saved = Save-JhtRuntimeFiles -Paths @('{shim}')\n"
        f"Remove-Item -LiteralPath '{shim}'\n"
        + _running(folder)
        + "try {\n"
        f"  if (Restore-JhtRuntimeFiles -Saved $saved -Programs @('{shim}')) {{ 'RESTORED' }}\n"
        "} finally { Stop-Process -Id $running.Id -Force; $running.WaitForExit() }\n"
        f"Remove-JhtProgramsSetAside -Destination '{shim}'\n"
    )
    done = _ps(tmp_path, case)
    assert done.returncode == 0 and "RESTORED" in done.stdout, done.stdout + done.stderr
    assert shim.read_bytes() == bytes([77, 90, 1, 2, 3])
    assert sorted(p.name for p in folder.iterdir()) == ["docker.exe"]
