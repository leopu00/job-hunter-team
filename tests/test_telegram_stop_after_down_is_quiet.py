"""After `jht integration add telegram` and a `jht down`, every `jht up` printed a raw podman line.

The resume plan of a Telegram with no bot is «stop». After a down the container is not there, and podman-compose says
«Error: no container with name or ID "jht-telegram" found: no such container» on stderr: rc 0, the team starts, but the person
read an error (giro Mac 14, 100%). The stop now goes through compose_quiet, whose noise filter takes that line away; any other line
of a failed stop is still shown. `jht integration list` said «creato, container spento» for a container that did not exist: it now
says it was added, that the service is off and how it starts again.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
INTEGRATION = (ROOT / "scripts" / "jht-integration.sh").read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")


def _functions(*names: str) -> str:
    return "\n".join(re.search(rf"^{n}\(\) \{{\n.*?^\}}\n", WRAPPER, re.S | re.M).group(0) for n in names)


def _stop(tmp_path: Path, compose_says: str, compose_rc: int) -> subprocess.CompletedProcess:
    script = f"""
set -u
CONTAINER_RUNTIME=podman
JHT_COMPOSE_VERBOSE=0
TELEGRAM_SERVICE=jht-telegram
TMPDIR="{tmp_path}"
compose() {{ [ "$1" = stop ] || return 98; printf '%s\\n' "$COMPOSE_SAYS" >&2; return {compose_rc}; }}
telegram_lifecycle_verify() {{ return 0; }}
err() {{ printf 'error: %s\\n' "$*" >&2; }}
{_functions("compose_noise_filter", "compose_quiet", "telegram_lifecycle_steps")}
telegram_lifecycle_steps stop assistente; echo "rc=$?"
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                          env={**os.environ, "COMPOSE_SAYS": compose_says})


def test_the_stop_of_a_telegram_that_is_not_there_says_nothing(tmp_path):
    done = _stop(tmp_path, 'Error: no container with name or ID "jht-telegram" found: no such container', 0)
    assert "rc=0" in done.stdout
    assert done.stderr == ""


def test_another_line_of_a_failed_stop_is_still_shown(tmp_path):
    done = _stop(tmp_path, "Error: the engine refused: permission denied", 125)
    assert "rc=125" in done.stdout
    assert "permission denied" in done.stderr


def test_the_stop_goes_through_the_quiet_compose():
    steps = re.search(r"^telegram_lifecycle_steps\(\) \{\n.*?^\}\n", WRAPPER, re.S | re.M).group(0)
    stop = steps[steps.index("      stop)"):steps.index("      pair)")]
    assert 'compose_quiet stop "$TELEGRAM_SERVICE"' in stop
    assert 'compose stop "$TELEGRAM_SERVICE"' not in stop.replace("compose_quiet stop", "")


def test_integration_list_says_a_telegram_without_container_is_added_and_off():
    assert "creato, container spento" not in INTEGRATION
    assert "aggiunto, servizio spento: jht telegram pair assistente" in INTEGRATION
    assert "'ready|aggiunto, container spento" in INTEGRATION
