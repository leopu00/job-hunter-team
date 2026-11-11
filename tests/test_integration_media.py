"""`jht integration add|remove|status media`: the extras image by the digest the wrapper carries, then the `media` profile of the
compose. Same fake engine and fake compose as test_integration_command.py, with one more thing logged: the image the compose was
given."""
from __future__ import annotations

import json
import re
import subprocess

import pytest

from test_integration_command import LIBRARY, host, wrapper_functions  # noqa: F401

DIGEST = "sha256:" + "e" * 64
REF = f"ghcr.io/leopu00/jht@{DIGEST}"


def run(host, args: str, **env) -> subprocess.CompletedProcess:
    script = f"""
set -euo pipefail
HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"
err() {{ echo "error: $*" >&2; }}; info() {{ echo "info: $*" >&2; }}
RUNTIME_DIR="{host.runtime}"; COMPOSE_FILE="{host.compose}"
BROKER_SERVICE=jht-broker; TELEGRAM_SERVICE=jht-telegram; JHT_HOST_TYPE=local
{wrapper_functions("runtime_stat", "runtime_node_safe")}
compose_project_name() {{ echo jht; }}
docker_reachable() {{ docker info >/dev/null 2>&1; }}
require_docker() {{ docker_reachable || {{ err "motore spento"; exit 1; }}; }}
ensure_up() {{ ATTESTED_CONTAINER_ID=agent-id; }}
read_only_service_id() {{ grep -qx "$1" "$FAKE_RUNNING" && {{ echo "id-$1"; return 0; }}; return 3; }}
compose() {{
  printf 'COMPOSE profiles=%s image=%s %s\\n' "${{COMPOSE_PROFILES:-}}" "${{JHT_EXTRAS_IMAGE:-}}" "$*" >> "$FAKE_LOG"
  [ -z "${{FAKE_COMPOSE_FAIL:-}}" ] || return 1
  case "$1 $2" in
    "up -d") echo "$3" >> "$FAKE_RUNNING" ;;
    "stop "*) grep -vx "$2" "$FAKE_RUNNING" > "$FAKE_RUNNING.new" || true; mv "$FAKE_RUNNING.new" "$FAKE_RUNNING" ;;
  esac
}}
. "{LIBRARY}"
integration_main {args}
"""
    import os
    return subprocess.run(["bash", "-c", script], env={**host.env, **env}, capture_output=True, text=True, timeout=30)


def add(host, **env):
    return run(host, "add media --json", EXTRAS_IMAGE_DIGEST=DIGEST, **env)


def test_a_release_without_an_extras_image_says_not_available_yet_and_touches_nothing(host):
    done = run(host, "add media --json")
    assert done.returncode == 3 and json.loads(done.stdout)["reason"] == "non disponibile ancora"
    assert host.log.read_text() == "" or "pull" not in host.log.read_text()


@pytest.mark.parametrize("digest", ["sha256:xyz", "$(touch HIT)", "sha256", ";rm -rf x", "sha256:e;touch HIT", "sha256:" + "e" * 64 + " --privileged", "sha256:" + "e" * 63])
def test_a_digest_that_is_not_one_is_not_used(host, digest):
    done = run(host, "add media --json", EXTRAS_IMAGE_DIGEST=digest)
    assert done.returncode == 3 and "pull" not in host.log.read_text()
    assert not (host.tmp / "HIT").exists()


def test_add_pulls_the_image_by_digest_and_starts_only_the_media_profile_with_it(host):
    done = add(host)
    assert done.returncode == 0, done.stderr
    answer = json.loads(done.stdout)
    assert answer["ok"] is True and answer["state"] == "running"
    log = host.log.read_text().splitlines()
    assert f"DOCKER pull {REF}" in log
    assert f"COMPOSE profiles=media image={REF} up -d jht-media" in log
    assert log.index(f"DOCKER pull {REF}") < log.index(f"COMPOSE profiles=media image={REF} up -d jht-media")


def test_the_state_is_running_then_ready_when_the_container_is_off_then_not_installed(host):
    assert json.loads(run(host, "status media --json").stdout)["state"] == "not_installed"
    add(host)
    assert json.loads(run(host, "status media --json").stdout)["state"] == "running"
    host.running.write_text("")  # a reboot: the container does not come back on its own
    ready = json.loads(run(host, "status media --json").stdout)
    assert ready["state"] == "ready" and "jht integration add media" in ready["reason"]
    run(host, "remove media --json")
    assert json.loads(run(host, "status media --json").stdout)["state"] == "not_installed"


def test_the_folders_every_jht_up_makes_do_not_make_it_added(host):
    host.volumes.write_text("jht_jht-media-in\njht_jht-media-out\n")
    assert json.loads(run(host, "status media --json").stdout)["state"] == "not_installed"


def test_a_failed_pull_or_start_is_an_error_with_a_reason_and_no_marker(host):
    host.env["FAKE_COMPOSE_FAIL"] = "1"
    done = add(host)
    assert done.returncode == 1 and "non parte" in json.loads(done.stdout)["reason"]
    assert json.loads(run(host, "status media --json", EXTRAS_IMAGE_DIGEST=DIGEST).stdout)["state"] == "error"
    assert not list((host.runtime / "integrations").glob("media.ok"))


def test_remove_takes_the_container_but_neither_the_image_nor_the_folders_of_jht(host):
    add(host)
    done = run(host, "remove media --purge --yes --json", EXTRAS_IMAGE_DIGEST=DIGEST, FAKE_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stderr
    log = host.log.read_text().splitlines()
    assert "COMPOSE profiles=media image= stop jht-media" in log and "COMPOSE profiles=media image= rm -f jht-media" in log
    assert not any(line.startswith("DOCKER rmi") for line in log)
    assert not any(line.startswith("DOCKER volume rm") for line in log), "the two folders belong to jht: never removed by this"
    reason = json.loads(done.stdout)["reason"]
    assert "restano" in reason and "3084 MB" in reason and "jht integration remove media --remove-image" in reason


def test_remove_image_takes_the_image_of_the_media_tools_away(host):
    add(host)
    done = run(host, "remove media --remove-image --json", EXTRAS_IMAGE_DIGEST=DIGEST, FAKE_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stderr
    assert f"DOCKER rmi {REF}" in host.log.read_text().splitlines()
    assert "immagine degli strumenti tolta (fino a 3084 MB)" in json.loads(done.stdout)["reason"]


def test_remove_image_keeps_the_image_while_another_tool_of_it_is_still_added(host):
    add(host)
    integ = host.runtime / "integrations"
    (integ / "screen.ok").write_text("ok\n")
    (integ / "screen.ok").chmod(0o600)
    done = run(host, "remove media --remove-image --json", EXTRAS_IMAGE_DIGEST=DIGEST)
    assert not any(line.startswith("DOCKER rmi") for line in host.log.read_text().splitlines())
    assert "la usa ancora screen" in json.loads(done.stdout)["reason"]


def test_the_library_never_builds_the_image_name_from_what_the_person_typed():
    text = LIBRARY.read_text(encoding="utf-8")
    assert "=~ ^sha256:[0-9a-f]{64}$ ]]" in text, "the digest is checked in its exact shape before it becomes a name"


WRAPPER_SH = LIBRARY.parent / "jht-wrapper.sh"
WRAPPER_PS1 = LIBRARY.parent / "jht-wrapper.ps1"


def test_every_down_and_listing_of_the_wrapper_names_the_media_profile_with_the_others():
    # A `down` without the profile leaves the media container running and the network of the project with it; a `ps` without it
    # does not see that container, so the wrapper would read the project as empty.
    shell = WRAPPER_SH.read_text(encoding="utf-8")
    assert re.search(r'^COMPOSE_ALL_PROFILES="[^"]*\bmedia\b[^"]*"$', shell, re.M)
    assert re.search(r'^COMPOSE_ALL_PROFILES="[^"]*\bplaywright\b[^"]*"$', shell, re.M)
    assert re.search(r'^COMPOSE_ALL_PROFILES="[^"]*\bscreen\b[^"]*"$', shell, re.M)
    code = [line for line in shell.splitlines() if not line.lstrip().startswith("#")]
    seen = [line for line in code if re.search(r"COMPOSE_PROFILES=\S+ compose(_stdout_quiet)? (down|ps -q)", line)]
    assert len(seen) >= 8
    assert not [line for line in seen if 'COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES"' not in line], "a down or a listing that names its own profiles"
    power = WRAPPER_PS1.read_text(encoding="utf-8")
    downs = [line for line in power.splitlines() if re.search(r"'--profile'(,| ')\s*'?telegram'?.*\b(down|ps)\b", line)]
    assert len(downs) >= 4
    assert not [line for line in downs if not all(f"'{name}'" in line for name in ("media", "playwright", "screen", "login"))], "a profile is missing"
