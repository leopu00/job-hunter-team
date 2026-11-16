"""`jht artifact upload <file>` on Windows with the CLI only copies a file that lies outside the shared folder into its allegati folder.

The container reads Documents\\Job Hunter Team and nothing else of the computer: the CLI refused a file from the Desktop with
artifact_host_path_unavailable. The wrapper, on the host, now puts a copy in <Documents>\\Job Hunter Team\\allegati and gives the team that path.
The functions are taken out of the wrapper and run in PowerShell (7 here, 5.1 and 7 on the Windows gate) on synthetic folders.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from script_texts import LANGUAGES, catalog  # noqa: E402
from wrapper_ps_texts import UTF8_OUTPUT, say_functions  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
SHELLS = ("powershell", "pwsh")
FUNCTIONS = ("Get-JhtSharedFolderPath", "Get-JhtFileSha256", "Copy-JhtArtifactIntoShared")


def _shell(name: str) -> str:
    if name == "powershell":
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(os.environ.get("JHT_TEST_PWSH") or "pwsh")
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


def _function(name: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8").replace("\r\n", "\n")
    start = source.index(f"\nfunction {name} {{") + 1
    return source[start : source.index("\n}\n", start) + 3]


def _run(shell: str, tmp_path: Path, args: list[str], *, lang="en", cwd: Path | None = None, shared_env: str | None = None):
    profile = tmp_path / "profile"
    profile.mkdir(exist_ok=True)
    # always there: without it the function falls back on the folder Windows has for Documents, which in a test is the real one of whoever runs it
    (profile / "Documents").mkdir(exist_ok=True)
    quoted = ", ".join("'" + a.replace("'", "''") + "'" for a in args)
    script = tmp_path / "case.ps1"
    script.write_text("\n".join([
        UTF8_OUTPUT, "$ErrorActionPreference = 'Stop'", say_functions(lang), *[_function(name) for name in FUNCTIONS],
        "function Write-Err { param([string]$Msg) [Console]::Error.WriteLine($Msg) }",
        f"$result = Copy-JhtArtifactIntoShared @({quoted})",
        "if ($null -eq $result) { 'RESULT=FAILED' } else { 'RESULT=' + ($result -join '|') }", ""]), encoding="ascii")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "FLEET"))}
    env.update(USERPROFILE=str(profile), HOME=str(profile))
    if shared_env:
        env["JHT_USER_DIR_HOST"] = shared_env
    done = subprocess.run([_shell(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                          capture_output=True, text=True, encoding="utf-8", timeout=120, env=env, cwd=cwd or tmp_path)
    assert done.returncode == 0, done.stdout + done.stderr
    out = done.stdout.replace("\r\n", "\n")
    return out, re.search(r"^RESULT=(.*)$", out, re.M).group(1)


def _desktop_file(tmp_path: Path, name="cv.pdf", data=b"%PDF-1.4 synthetic\n") -> Path:
    desktop = tmp_path / "profile" / "Desktop"
    desktop.mkdir(parents=True, exist_ok=True)
    path = desktop / name
    path.write_bytes(data)
    return path


def _allegati(tmp_path: Path) -> Path:
    return tmp_path / "profile" / "Documents" / "Job Hunter Team" / "allegati"


@pytest.mark.parametrize("shell", SHELLS)
def test_a_file_outside_the_shared_folder_is_copied_into_allegati_and_the_team_gets_the_copy(shell, tmp_path):
    source = _desktop_file(tmp_path)
    out, result = _run(shell, tmp_path, [str(source), "--json"])
    copy = _allegati(tmp_path) / "cv.pdf"
    assert copy.read_bytes() == source.read_bytes() and source.exists()
    assert result == f"{copy}|--json"
    assert catalog("en")["wrapper.ps.artifact_copied"].replace("%s", str(source), 1).replace("%s", str(copy), 1) in out


@pytest.mark.parametrize("shell", SHELLS)
def test_a_relative_path_is_taken_from_the_current_folder(shell, tmp_path):
    source = _desktop_file(tmp_path)
    _out, result = _run(shell, tmp_path, ["cv.pdf"], cwd=source.parent)
    assert result == str(_allegati(tmp_path) / "cv.pdf")


@pytest.mark.parametrize("shell", SHELLS)
def test_a_file_already_in_the_shared_folder_is_left_where_it_is(shell, tmp_path):
    shared = tmp_path / "profile" / "Documents" / "Job Hunter Team"
    shared.mkdir(parents=True)
    inside = shared / "cv.pdf"
    inside.write_bytes(b"x")
    _out, result = _run(shell, tmp_path, [str(inside)])
    assert result == str(inside) and not (shared / "allegati").exists()


@pytest.mark.parametrize("shell", SHELLS)
def test_the_same_name_with_other_bytes_gets_a_number_and_the_same_bytes_are_reused(shell, tmp_path):
    first = _desktop_file(tmp_path, data=b"one")
    _run(shell, tmp_path, [str(first)])
    other = _desktop_file(tmp_path / "second", data=b"two")
    _out, result = _run(shell, tmp_path, [str(other)])
    assert result == str(_allegati(tmp_path) / "cv-2.pdf") and (_allegati(tmp_path) / "cv.pdf").read_bytes() == b"one"
    _out, again = _run(shell, tmp_path, [str(first)])
    assert again == str(_allegati(tmp_path) / "cv.pdf") and sorted(p.name for p in _allegati(tmp_path).iterdir()) == ["cv-2.pdf", "cv.pdf"]


@pytest.mark.parametrize("shell", SHELLS)
def test_a_container_path_stdin_a_missing_file_and_no_file_change_nothing(shell, tmp_path):
    for args in (["/jht_user/cv.pdf"], ["--stdin", "--name", "cv.pdf"], [str(tmp_path / "nope.pdf")], [], ["--json"]):
        _out, result = _run(shell, tmp_path, args)
        assert result == "|".join(args), args
    assert not _allegati(tmp_path).exists()


@pytest.mark.parametrize("shell", SHELLS)
def test_the_folder_of_the_team_is_the_one_it_is_started_with(shell, tmp_path):
    source = _desktop_file(tmp_path)
    elsewhere = tmp_path / "chosen"
    _out, result = _run(shell, tmp_path, [str(source)], shared_env=str(elsewhere))
    assert result == str(elsewhere / "allegati" / "cv.pdf")


@pytest.mark.skipif(os.name == "nt", reason="creating a link needs a privilege on Windows")
@pytest.mark.parametrize("shell", SHELLS)
def test_a_link_is_not_copied(shell, tmp_path):
    target = _desktop_file(tmp_path, "real.pdf")
    link = target.parent / "link.pdf"
    link.symlink_to(target)
    _out, result = _run(shell, tmp_path, [str(link)])
    assert result == str(link) and not _allegati(tmp_path).exists()


@pytest.mark.parametrize("shell", SHELLS)
def test_a_copy_that_cannot_be_made_says_why_and_stops(shell, tmp_path):
    source = _desktop_file(tmp_path)
    blocker = tmp_path / "profile" / "Documents"
    blocker.mkdir(parents=True)
    (blocker / "Job Hunter Team").write_text("a file where the folder should be", encoding="utf-8")
    out, result = _run(shell, tmp_path, [str(source)])
    assert result == "FAILED"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_sentences_are_in_the_7_catalogs(lang):
    texts = catalog(lang)
    assert texts["wrapper.ps.artifact_copied"].count("%s") == 2 and texts["wrapper.ps.artifact_copy_failed"].count("%s") == 2


def test_the_artifact_branch_copies_before_it_asks_the_container():
    source = WRAPPER.read_text(encoding="utf-8")
    branch = source[source.index("{ $_ -eq 'artifact' -and $Rest.Count -gt 0"):]
    branch = branch[: branch.index("'desktop-apply'")]
    assert branch.index("Copy-JhtArtifactIntoShared") < branch.index("Require-ComposeFile") < branch.index("docker inspect")
