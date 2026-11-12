"""A computer that still runs JHT on Docker is told, by `jht up` and every command, how to move to Podman.

Since 0.4 JHT runs only on Podman. An install made before (Colima, Docker Desktop, Docker Engine) keeps working while its engine
answers; when the engine is off, `jht up` no longer starts it (no Colima, no Docker Desktop) and says, in the person's language,
what stays (~/.jht and the documents), what has to be given again (the API key, the mail password, the Telegram tokens, which live
in Docker's volumes) and the three steps. The functions are taken from the wrapper and run with a made-up docker and colima.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")


def _functions(*names: str) -> str:
    return "\n".join(re.search(rf"^{n}\(\) \{{\n.*?^\}}\n", SOURCE, re.S | re.M).group(0) for n in names)


def _run(tmp_path: Path, function: str, *, kernel: str, lang: str = "en") -> subprocess.CompletedProcess:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    for tool in ("docker", "colima", "open", "systemctl"):
        (bin_dir / tool).write_text(f'#!/bin/sh\necho "{tool} $*" >> "{log}"\nexit 1\n', encoding="utf-8")
        (bin_dir / tool).chmod(0o755)
    script = f"""set -u
HOST_KERNEL={kernel}
PODMAN_RUNTIME_MODE=""
CONTAINER_RUNTIME=docker
JHT_SAY_LANG={lang}
err_runtime=""
info() {{ printf 'info: %s\\n' "$*"; }}
err() {{ printf 'err: %s\\n' "$*"; }}
uname() {{ echo {kernel}; }}
require_confined_podman_machine() {{ :; }}
require_rootless_podman_native() {{ :; }}
docker_compose_plugin_missing() {{ return 1; }}
{_functions("jht_text_en", "jht_text_it", "jht_say", function)}
{function}
echo "RC=$?"
"""
    env = {"HOME": str(tmp_path), "PATH": f"{bin_dir}:/usr/bin:/bin"}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)


def _calls(tmp_path: Path) -> list[str]:
    log = tmp_path / "calls.log"
    return log.read_text().splitlines() if log.exists() else []


@pytest.mark.parametrize("function", ["wake_container_runtime_for_up", "require_docker"])
@pytest.mark.parametrize("kernel", ["Darwin", "Linux"])
def test_an_engine_that_does_not_answer_is_not_started_and_the_way_to_podman_is_said(tmp_path, function, kernel):
    done = _run(tmp_path, function, kernel=kernel)
    assert "RC=" not in done.stdout  # it stops
    text = done.stdout
    assert "err: This computer runs JHT on Docker" in text and "only on Podman" in text
    assert "~/.jht" in text and "~/Documents/Job Hunter Team" in text
    assert "API key" in text and "mail password" in text and "Telegram tokens" in text
    assert text.index("jht uninstall --confirm") < text.index("run the installer again") < text.index("jht setup")
    # only asked, never started: no colima, no Docker Desktop, no systemctl
    assert [c for c in _calls(tmp_path) if not c.startswith("docker info")] == []


def test_the_words_are_in_the_language_of_the_person(tmp_path):
    done = _run(tmp_path, "wake_container_runtime_for_up", kernel="Darwin", lang="it")
    assert "err: Questo computer fa girare JHT su Docker" in done.stdout
    assert "jht uninstall --confirm" in done.stdout and "jht setup" in done.stdout


def test_nothing_of_colima_is_left_in_the_start_of_the_team():
    for gone in ("wake_jht_colima", "jht_colima_profile_of_runtime", "SYSTEM_DOCKER_SOCKET", "up.colima_",
                 "colima start", "open -a Docker", "systemctl start docker"):
        assert gone not in SOURCE, gone
