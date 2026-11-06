"""`jht artifact upload <Windows path>` in a PowerShell terminal reaches the app, which reads the file (JHT upload piece).

The Node CLI runs in the container, where a Windows path does not exist: the command ended with ENOENT. jht.ps1 has one branch for
it and it decides nothing: it calls `jht-desktop.exe --artifact-upload <args>` and ends with the app's exit code. The app does the rest
(artifact_upload.rs, tested in Rust). Here: the branch is where it must be, before the default one that would `docker exec` the path
into the container, and the Rust side takes the flag before it starts anything.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8-sig").replace("\r\n", "\n")
LIB = (ROOT / "desktop" / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8").replace("\r\n", "\n")


def _branch() -> str:
    start = WRAPPER.index("{ $_ -eq 'artifact' -and $Rest.Count -gt 0 -and $Rest[0] -eq 'upload' } {")
    end = WRAPPER.index("\n  }\n", start)
    return WRAPPER[start:end]


def test_the_upload_branch_comes_before_the_default_one_that_would_run_the_path_in_the_container():
    assert WRAPPER.index("-eq 'artifact' -and $Rest.Count") < WRAPPER.index("\n  default {\n    Require-ComposeFile")


def test_the_branch_only_calls_the_app_and_ends_with_its_exit_code():
    branch = _branch()
    assert "jht-desktop.exe" in branch
    assert "& $uploader '--artifact-upload' @uploadArgs | Out-Host" in branch
    assert "exit $LASTEXITCODE" in branch
    # no logic of its own: no container, no file read, no path handling
    for forbidden in ("docker", "Get-Content", "ReadAllBytes", "Resolve-Path", "Test-Path -LiteralPath $", "[IO.File]"):
        assert forbidden not in branch.replace("Test-Path -LiteralPath $uploader -PathType Leaf", ""), forbidden
    # stderr is not merged: under 'Stop' Windows PowerShell 5.1 turns a native program's stderr line into an error
    assert "2>&1" not in branch


def test_the_app_takes_the_flag_before_it_starts_anything_else():
    run = LIB[LIB.index("pub fn run() {") :]
    first_lines = run.split("\n", 8)
    assert "artifact_upload::run_if_asked()" in "\n".join(first_lines[:6])
    assert run.index("artifact_upload::run_if_asked()") < run.index("linux_render::apply()")
    assert run.index("artifact_upload::run_if_asked()") < run.index("tauri::Builder::default()")
