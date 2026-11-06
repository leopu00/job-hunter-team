"""On Mac and Linux too, the container engine of the team is named by the runtime's own file, never by a variable.

jht-wrapper.sh obeyed JHT_CONTAINER_RUNTIME before the attested `container-runtime` file; the Windows wrapper stopped doing so
(a value an older terminal still carries must not choose the engine). Now the file decides, a test names another engine with its
own variable (JHT_TEST_CONTAINER_RUNTIME), and the variable of the person is cleared. The block of the wrapper runs under bash with
made-up values.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


def _block() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    start = text.index('if [ -n "${JHT_TEST_CONTAINER_RUNTIME:-}" ]; then')
    end = text.index("unset JHT_CONTAINER_RUNTIME\n", start) + len("unset JHT_CONTAINER_RUNTIME\n")
    return text[start:end]


def _run(tmp_path: Path, file_text: str | None, **env: str) -> str:
    selection = tmp_path / "container-runtime"
    selection.unlink(missing_ok=True)
    if file_text is not None:
        selection.write_bytes(file_text.encode())
    script = f'RUNTIME_SELECTION_FILE="{selection}"\n{_block()}\nprintf "ENGINE=%s;VARIABLE=%s" "$CONTAINER_RUNTIME" "${{JHT_CONTAINER_RUNTIME:-}}"\n'
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin", **env}, timeout=30)
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_the_engine_in_the_runtime_file_wins_over_a_variable_an_older_terminal_still_carries(tmp_path):
    assert _run(tmp_path, "podman\n", JHT_CONTAINER_RUNTIME="docker") == "ENGINE=podman;VARIABLE="
    assert _run(tmp_path, "docker\r\n", JHT_CONTAINER_RUNTIME="podman") == "ENGINE=docker;VARIABLE="
    assert _run(tmp_path, "Podman\n") == "ENGINE=podman;VARIABLE="


def test_without_the_runtime_file_the_engine_is_docker_and_the_variable_is_still_ignored(tmp_path):
    assert _run(tmp_path, None, JHT_CONTAINER_RUNTIME="podman") == "ENGINE=docker;VARIABLE="


def test_only_the_test_variable_names_another_engine_than_the_file(tmp_path):
    assert _run(tmp_path, "podman\n", JHT_CONTAINER_RUNTIME="podman", JHT_TEST_CONTAINER_RUNTIME="Docker") == "ENGINE=docker;VARIABLE="


def test_the_wrapper_never_reads_the_engine_variable_to_choose_the_engine():
    code = "\n".join(line for line in WRAPPER.read_text(encoding="utf-8").split("\n") if not line.lstrip().startswith("#"))
    reads = [line for line in code.split("\n") if "JHT_CONTAINER_RUNTIME" in line and "JHT_TEST_CONTAINER_RUNTIME" not in line]
    assert reads == ["unset JHT_CONTAINER_RUNTIME"], reads
    # a value outside the closed list is still refused afterwards
    assert 'case "$CONTAINER_RUNTIME" in docker|podman) ;;' in code
