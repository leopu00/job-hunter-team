"""`install.ps1` writes host.env without following a link an agent put in its place.

host.env sits in a folder mounted in the container, so an agent can replace it with a junction or a symbolic link that dangles in
the container and points into the person's profile on the host. `Set-Content` followed it and overwrote the file it named. The
installer now writes a temporary of the same folder and moves it over the path, which replaces the link itself.

The check of the source runs everywhere; the rest runs the real function in Windows PowerShell 5.1 and in PowerShell 7. The Windows
config ACL gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`: a missing shell is a failure, not a skip.
"""


from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.ps1"
SHELLS = ("powershell", "pwsh")
windows_only = pytest.mark.skipif(os.name != "nt", reason="needs Windows PowerShell 5.1, which only Windows has")

VICTIM = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample person@laptop\r\n"
# a value that, unescaped, becomes more arguments for the engine
EVIL = 'local" --user root --privileged -e NODE_OPTIONS=--require=C:\\agent\\x.js "'


def _function(source: str, name: str) -> str:
    match = re.search(rf"^function {re.escape(name)} \{{.*?^\}}\n", source, re.S | re.M)
    assert match, f"{name} is missing"
    return match.group(0)


# ── the source, on every machine ───────────────────────────────────────────

def test_the_installer_no_longer_writes_host_env_with_set_content():
    source = INSTALL.read_text(encoding="utf-8")
    assert "Set-Content -Path $hostEnvFile" not in source
    assert "Write-HostEnvFile -Path $hostEnvFile" in source
    writer = _function(source, "Write-HostEnvFile")
    assert "Move-Item -LiteralPath $tmp -Destination $Path" in writer and "ReparsePoint" in writer


# ── the real function, in both shells ──────────────────────────────────

def _shell(name: str) -> str:
    if name == "powershell":
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(name)
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


def _run(shell: str, script: str, tmp_path: Path, **env: str) -> subprocess.CompletedProcess:
    path = tmp_path / "probe.ps1"
    path.write_text("$ErrorActionPreference = 'Stop'\n" + script, encoding="utf-8-sig")
    return subprocess.run(
        [_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(path)],
        env={**os.environ, **env}, capture_output=True, text=True, timeout=120, check=False,
    )


def _writer_script(target: Path) -> str:
    return (_function(INSTALL.read_text(encoding="utf-8"), "Write-HostEnvFile")
            + f"\nWrite-HostEnvFile -Path '{target}' -Content \"JHT_HOST_TYPE=local`nJHT_LANG=en`nJHT_USER_TZ=UTC\"\n")


def _leftovers(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir())


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_regular_host_env_is_replaced_and_no_temporary_stays(shell: str, tmp_path: Path):
    host_env = tmp_path / "host.env"
    host_env.write_text("JHT_LANG=it\n", encoding="utf-8")
    done = _run(shell, _writer_script(host_env), tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "JHT_HOST_TYPE=local" in host_env.read_text(encoding="utf-8-sig")
    assert _leftovers(tmp_path) == ["host.env", "probe.ps1"]


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_junction_to_a_folder_is_replaced_and_the_folder_stays_as_it_was(shell: str, tmp_path: Path):
    documents = tmp_path / "Documents"
    documents.mkdir()
    (documents / "note.txt").write_text("keep\n", encoding="utf-8")
    mounted = tmp_path / "jht"
    mounted.mkdir()
    link = mounted / "host.env"
    made = _run(shell, f"New-Item -ItemType Junction -Path '{link}' -Target '{documents}' | Out-Null", tmp_path)
    assert made.returncode == 0, made.stdout + made.stderr

    done = _run(shell, _writer_script(link), tmp_path)

    assert done.returncode == 0, done.stdout + done.stderr
    assert _leftovers(documents) == ["note.txt"] and (documents / "note.txt").read_text(encoding="utf-8") == "keep\n"
    assert link.is_file() and not link.is_symlink() and "JHT_HOST_TYPE=local" in link.read_text(encoding="utf-8-sig")
    assert _leftovers(mounted) == ["host.env"]


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_symbolic_link_to_a_file_is_replaced_and_the_file_stays_intact(shell: str, tmp_path: Path):
    victim = tmp_path / "authorized_keys"
    victim.write_bytes(VICTIM.encode("ascii"))
    mounted = tmp_path / "jht"
    mounted.mkdir()
    link = mounted / "host.env"
    made = _run(shell, f"New-Item -ItemType SymbolicLink -Path '{link}' -Target '{victim}' | Out-Null", tmp_path)
    if made.returncode != 0:
        pytest.skip("this account cannot create symbolic links: " + made.stderr.strip()[:120])

    done = _run(shell, _writer_script(link), tmp_path)

    assert done.returncode == 0, done.stdout + done.stderr
    assert victim.read_bytes() == VICTIM.encode("ascii"), "the file the link named was written through"
    assert link.is_file() and not link.is_symlink() and "JHT_HOST_TYPE=local" in link.read_text(encoding="utf-8-sig")
    assert _leftovers(mounted) == ["host.env"]


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_folder_in_place_of_host_env_is_refused_and_left_alone(shell: str, tmp_path: Path):
    folder = tmp_path / "host.env"
    folder.mkdir()
    (folder / "inside").write_text("keep\n", encoding="utf-8")
    done = _run(shell, _writer_script(folder), tmp_path)
    assert done.returncode != 0
    assert _leftovers(folder) == ["inside"]
