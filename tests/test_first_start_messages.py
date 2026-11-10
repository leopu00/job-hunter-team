"""Before the first start the wrapper says what is true: «not started yet», «install not finished», not «cannot be attested» (audit of 10/11).

`jht logs|restart|recreate` on a profile where the container was never created used to say «Container JHT non attestabile», because the
wrapper merged «there is no container» (3 of the check) with «there is one and it cannot be attested» (1). A runtime folder whose integrity
manifest is gone said «runtime host non attendibile (path, owner, permessi o SHA-256)», the words for a file somebody changed. Exit codes
were right; the words sent the person to look in the wrong place. Made-up homes and a fake engine only.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_host_env_security import WRAPPER, wrapper_runtime_env, write_trusted_runtime  # noqa: E402

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the bash wrapper and its POSIX folders; the PowerShell wrapper has its own tests")

NOT_STARTED = "Job Hunter Team non è ancora avviato"


def profile(tmp_path, docker_body='exit 0'):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    runtime = tmp_path / "protected" / "host-runtime"
    write_trusted_runtime(runtime)
    runtime = runtime.resolve()
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    log = tmp_path / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text(f'#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$JHT_TEST_DOCKER_LOG"\n{docker_body}\n', encoding="utf-8")
    docker.chmod(0o755)
    return home, runtime, fake_bin, log


def run(tmp_path, *args, docker_body='exit 0', before=None):
    home, runtime, fake_bin, log = profile(tmp_path, docker_body)
    if before:
        before(runtime)
    done = subprocess.run(["bash", str(WRAPPER), *args], env=wrapper_runtime_env(home, runtime, fake_bin, log),
                          capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls


@pytest.mark.parametrize("command", [["logs"], ["restart"], ["recreate"]])
def test_a_container_that_was_never_started_is_said_as_that_with_the_command_that_starts_it(tmp_path, command):
    done, _ = run(tmp_path, *command)
    text = done.stdout + done.stderr
    assert done.returncode == 1, text
    assert NOT_STARTED in text and "jht up" in text and "jht setup" in text, text
    assert "non attestabile" not in text, text


@pytest.mark.parametrize("command", [["logs"], ["restart"], ["recreate"]])
def test_a_container_that_cannot_be_attested_is_still_said_as_that(tmp_path, command):
    # the engine lists a container of the project, and nothing it says about it can be attested
    done, _ = run(tmp_path, *command, docker_body='case "$*" in *"ps -q"*|*" ps"*) echo deadbeef ;; esac; exit 0')
    text = done.stdout + done.stderr
    assert done.returncode == 1, text
    assert NOT_STARTED not in text, text
    assert "non attestabile" in text, text


def test_an_install_without_its_integrity_manifest_says_the_install_is_not_finished(tmp_path):
    done, calls = run(tmp_path, "up", before=lambda runtime: (runtime / ".runtime-integrity").unlink())
    text = done.stdout + done.stderr
    assert done.returncode != 0 and calls == [], (text, calls)
    assert "non è installato del tutto" in text and "installer" in text, text
    assert "non attendibile" not in text, text


def test_a_runtime_file_somebody_changed_is_still_untrusted(tmp_path):
    def tamper(runtime):
        compose = runtime / "docker-compose.yml"
        compose.write_text(compose.read_text(encoding="utf-8") + "\n# changed\n", encoding="utf-8")

    done, calls = run(tmp_path, "up", before=tamper)
    text = done.stdout + done.stderr
    assert done.returncode != 0 and calls == [], (text, calls)
    assert "non attendibile" in text and "non è installato del tutto" not in text, text
