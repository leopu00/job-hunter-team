"""The Compose commands the runtime sends to podman-compose, against the real 1.6.0 parser.

The fakes of the other tests answer whatever the wrapper asks; this file asks the real tool,
read-only (`--dry-run`, a Podman that does nothing), so an option that podman-compose does not
have shows up here and not on a user's Mac. It runs where podman-compose 1.6.0 is installed
and is skipped elsewhere.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")

COMPOSE = shutil.which("podman-compose")


def _version() -> str:
    if not COMPOSE:
        return ""
    done = subprocess.run([COMPOSE, "--version"], capture_output=True, text=True, check=False)
    return done.stdout + done.stderr


pytestmark = pytest.mark.skipif(
    "podman-compose version 1.6.0" not in _version(), reason="podman-compose 1.6.0 is not installed"
)

# What the Podman branch of the wrapper sends (`compose ...`, `compose_file ... ...`), word by word.
SENT = [
    "config -q",
    "config",
    "up -d",
    "up -d jht-telegram",
    "up -d --force-recreate jht",
    "down",
    "ps -q",
    "pull jht",
    "stop jht",
    "start jht",
    "restart jht",
    "restart jht-telegram",
]
# What only Docker Compose understands: the wrapper must never send it to podman-compose.
DOCKER_ONLY = ["config --images", "config --format json", "ps -q jht"]

COMPOSE_FILE = "services:\n  jht:\n    image: example.invalid/jht@sha256:" + "0" * 64 + "\n"


def _run(tmp_path: Path, words: str) -> subprocess.CompletedProcess[str]:
    podman = tmp_path / "podman"
    podman.write_text('#!/bin/sh\ncase "$1" in --version) echo "podman version 6.1.3" ;; ps) echo "[]" ;; esac\nexit 0\n')
    podman.chmod(0o700)
    compose = tmp_path / "docker-compose.yml"
    compose.write_text(COMPOSE_FILE)
    env = {**os.environ, "PODMAN_COMPOSE_WARNING_LOGS": "false", "HOME": str(tmp_path)}
    return subprocess.run(
        [COMPOSE, "--podman-path", str(podman), "-p", "jht", "-f", str(compose), "--dry-run", *words.split()],
        capture_output=True, text=True, check=False, env=env, cwd=tmp_path, timeout=60,
    )


REFUSED = re.compile(r"unrecognized arguments|invalid choice|error: argument")


@pytest.mark.parametrize("words", SENT)
def test_what_the_wrapper_sends_is_understood_by_podman_compose(tmp_path, words):
    done = _run(tmp_path, words)
    assert not REFUSED.search(done.stderr + done.stdout), done.stderr


@pytest.mark.parametrize("words", DOCKER_ONLY)
def test_what_only_docker_compose_understands_is_refused_by_podman_compose(tmp_path, words):
    assert REFUSED.search(_run(tmp_path, words).stderr)


def test_the_wrapper_does_not_send_a_docker_only_option_on_its_podman_branch():
    # `config --images` and `ps -q <service>` live only in the Docker branches: the Podman branch asks
    # for the images through compose_file_images and lists the whole project
    assert "compose config --images" not in WRAPPER
    assert 'compose_file "$file" config --images' in WRAPPER  # inside the non-Podman branch
    assert re.search(r'CONTAINER_RUNTIME" != "podman" \]; then\n\s+compose_file "\$file" config --images', WRAPPER)
