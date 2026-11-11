"""`jht integration add|remove|status screen` (what `jht screen on|off|status` runs): the extras image by the digest the wrapper carries,
the browser of the closer copied into its volume, then the `screen` profile of the compose. Same fake engine and compose as
test_integration_media.py, with the digest the one-shot is given logged as well."""
from __future__ import annotations

import json
import os
import stat
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
  printf 'COMPOSE profiles=%s image=%s digest=%s %s\\n' "${{COMPOSE_PROFILES:-}}" "${{JHT_EXTRAS_IMAGE:-}}" "${{JHT_EXTRAS_DIGEST:-}}" "$*" >> "$FAKE_LOG"
  [ -z "${{FAKE_COMPOSE_FAIL_PROFILE:-}}" ] || [ "${{FAKE_COMPOSE_FAIL_PROFILE}}" != "${{COMPOSE_PROFILES:-}}" ] || return 1
  if [ "$1" = run ] && [ -n "${{FAKE_SWAP_FOR_LINK:-}}" ]; then rm -rf "$JHT_HOME_HOST/live-screen"; ln -s "$FAKE_SWAP_FOR_LINK" "$JHT_HOME_HOST/live-screen"; fi
  case "$1 $2" in
    "up -d") echo "$3" >> "$FAKE_RUNNING" ;;
    "stop "*) grep -vx "$2" "$FAKE_RUNNING" > "$FAKE_RUNNING.new" || true; mv "$FAKE_RUNNING.new" "$FAKE_RUNNING" ;;
  esac
}}
. "{LIBRARY}"
integration_main {args}
"""
    home = host.tmp / "jht-home"
    return subprocess.run(["bash", "-c", script], env={**host.env, "JHT_HOME_HOST": str(home), **env}, capture_output=True, text=True, timeout=30)


def add(host, **env):
    return run(host, "add screen --json", EXTRAS_IMAGE_DIGEST=DIGEST, **env)


def test_a_release_without_an_extras_image_says_not_available_yet_and_touches_nothing(host):
    done = run(host, "add screen --json")
    assert done.returncode == 3 and json.loads(done.stdout)["reason"] == "non disponibile ancora"
    assert "pull" not in host.log.read_text() and not (host.tmp / "jht-home").exists()


def test_add_pulls_fills_the_browser_volume_and_only_then_starts_only_the_screen_profile(host):
    done = add(host)
    assert done.returncode == 0, done.stderr
    answer = json.loads(done.stdout)
    assert answer["ok"] is True and answer["state"] == "running"
    log = host.log.read_text().splitlines()
    populate = f"COMPOSE profiles=playwright image={REF} digest={DIGEST} run --rm --no-deps -T jht-playwright-populate"
    start = f"COMPOSE profiles=screen image={REF} digest= up -d jht-screen"
    assert log.index(f"DOCKER pull {REF}") < log.index(populate) < log.index(start)
    assert not [line for line in log if "up -d" in line and "jht-screen" not in line], "nothing else is started"


def test_the_folder_the_app_reads_the_password_from_is_made_private_by_the_person(host):
    add(host)
    folder = host.tmp / "jht-home" / "live-screen"
    assert folder.is_dir() and stat.S_IMODE(folder.stat().st_mode) == 0o700


def test_the_state_is_running_then_ready_when_the_container_is_off_then_not_installed(host):
    assert json.loads(run(host, "status screen --json").stdout)["state"] == "not_installed"
    add(host)
    running = json.loads(run(host, "status screen --json").stdout)
    assert running["state"] == "running" and "sola vista" in running["reason"]
    host.running.write_text("")  # a reboot: the container does not come back on its own
    ready = json.loads(run(host, "status screen --json").stdout)
    assert ready["state"] == "ready" and "jht screen on" in ready["reason"]
    run(host, "remove screen --json")
    assert json.loads(run(host, "status screen --json").stdout)["state"] == "not_installed"


def test_a_browser_that_does_not_copy_stops_before_the_screen_starts(host):
    done = add(host, FAKE_COMPOSE_FAIL_PROFILE="playwright")
    assert done.returncode == 1 and "browser del closer" in json.loads(done.stdout)["reason"]
    assert not any("up -d" in line for line in host.log.read_text().splitlines())
    assert json.loads(run(host, "status screen --json", EXTRAS_IMAGE_DIGEST=DIGEST).stdout)["state"] == "error"


def test_a_screen_that_does_not_start_is_an_error_with_a_reason_and_no_marker(host):
    done = add(host, FAKE_COMPOSE_FAIL_PROFILE="screen")
    assert done.returncode == 1 and "non parte" in json.loads(done.stdout)["reason"]
    assert not list((host.runtime / "integrations").glob("screen.ok"))


def test_remove_takes_the_container_and_purge_the_shared_display_folder_but_the_image_stays(host):
    add(host)
    done = run(host, "remove screen --purge --yes --json", EXTRAS_IMAGE_DIGEST=DIGEST)
    assert done.returncode == 0, done.stderr
    log = host.log.read_text().splitlines()
    assert "COMPOSE profiles=screen image= digest= stop jht-screen" in log and "COMPOSE profiles=screen image= digest= rm -f jht-screen" in log
    assert not any(line.startswith("DOCKER rmi") for line in log)


def test_off_keeps_the_extras_image_and_says_its_weight_and_the_command_that_frees_the_space(host):
    add(host)
    done = run(host, "remove screen --json", EXTRAS_IMAGE_DIGEST=DIGEST, FAKE_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stderr
    assert not any(line.startswith("DOCKER rmi") for line in host.log.read_text().splitlines())
    reason = json.loads(done.stdout)["reason"]
    assert "3084 MB" in reason and "resta sul disco" in reason and "jht screen off --remove-image" in reason
    assert reason.startswith("schermo spento e container tolto")


def test_off_without_a_size_from_the_engine_still_says_the_image_stays_and_does_not_invent_a_number(host):
    add(host)
    reason = json.loads(run(host, "remove screen --json", EXTRAS_IMAGE_DIGEST=DIGEST).stdout)["reason"]
    assert "resta sul disco" in reason and "MB" not in reason


def test_off_with_no_image_on_the_disk_says_nothing_about_it(host):
    add(host)
    reason = json.loads(run(host, "remove screen --json", EXTRAS_IMAGE_DIGEST=DIGEST, FAKE_IMAGE_ABSENT="1").stdout)["reason"]
    assert reason == "schermo spento e container tolto"


def test_the_next_on_after_an_off_finds_the_image_and_starts_again(host):
    add(host)
    run(host, "remove screen --json", EXTRAS_IMAGE_DIGEST=DIGEST)
    done = add(host)
    assert done.returncode == 0 and json.loads(done.stdout)["state"] == "running"


def test_off_with_remove_image_takes_the_image_away_and_says_what_was_freed(host):
    add(host)
    done = run(host, "remove screen --remove-image --json", EXTRAS_IMAGE_DIGEST=DIGEST, FAKE_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stderr
    log = host.log.read_text().splitlines()
    assert f"DOCKER rmi {REF}" in log
    assert log.index("COMPOSE profiles=screen image= digest= rm -f jht-screen") < log.index(f"DOCKER rmi {REF}")
    assert "immagine degli strumenti tolta (fino a 3084 MB)" in json.loads(done.stdout)["reason"]


def test_remove_image_keeps_the_image_while_another_tool_of_it_is_still_added_and_says_which(host):
    add(host)
    integ = host.runtime / "integrations"
    (integ / "media.ok").write_text("ok\n")
    (integ / "media.ok").chmod(0o600)
    done = run(host, "remove screen --remove-image --json", EXTRAS_IMAGE_DIGEST=DIGEST)
    assert done.returncode == 0, done.stderr
    assert not any(line.startswith("DOCKER rmi") for line in host.log.read_text().splitlines())
    assert "non e' tolta: la usa ancora media" in json.loads(done.stdout)["reason"]


def test_remove_image_that_the_engine_refuses_is_an_error_with_a_reason(host):
    add(host)
    done = run(host, "remove screen --remove-image --json", EXTRAS_IMAGE_DIGEST=DIGEST, FAKE_RMI_RC="1")
    assert done.returncode == 1
    assert "non toglie l'immagine" in json.loads(done.stdout)["reason"]


@pytest.mark.parametrize("args", ["add screen --remove-image", "status screen --remove-image", "remove telegram --remove-image",
                                   "remove google --remove-image"])
def test_remove_image_is_only_for_remove_of_screen_or_media(host, args):
    done = run(host, args, EXTRAS_IMAGE_DIGEST=DIGEST)
    assert done.returncode == 2 and not any(line.startswith("DOCKER rmi") for line in host.log.read_text().splitlines())


def test_remove_without_purge_leaves_the_volumes_alone(host):
    add(host)
    run(host, "remove screen --json", EXTRAS_IMAGE_DIGEST=DIGEST)
    assert not any(line.startswith("DOCKER volume rm") for line in host.log.read_text().splitlines())


@pytest.mark.parametrize("digest", ["sha256:xyz", "$(touch HIT)", "sha256:e;touch HIT", "sha256:" + "e" * 64 + " --privileged"])
def test_a_digest_that_is_not_one_is_not_used(host, digest):
    done = run(host, "add screen --json", EXTRAS_IMAGE_DIGEST=digest)
    assert done.returncode == 3 and "pull" not in host.log.read_text()
    assert not (host.tmp / "HIT").exists()


def test_the_powershell_wrapper_has_the_same_screen_command_as_the_bash_one():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "scripts"
    power = (root / "jht-wrapper.ps1").read_text(encoding="utf-8")
    shell = (root / "jht-wrapper.sh").read_text(encoding="utf-8")
    assert "$Sub -ceq 'screen' -and $Rest.Count -eq 1" in power and "screen_help" in shell and "Write-ScreenHelp" in power
    assert "'on' { 'add' } 'off' { 'remove' } 'status' { 'status' }" in power
    assert "on) screen_verb=add ;;" in shell and "off) screen_verb=remove ;;" in shell
    # the read-only answer before the helper is there, and a download only for on and off, in both
    assert "Write-RuntimeHelperAbsentAnswer 'integration' $screenArgs" in power
    assert 'runtime_helper_absent_answer integration status screen' in shell
    assert "@('add', 'remove') -cnotcontains $screenVerb" in power


def test_a_link_in_place_of_the_password_folder_is_refused_and_never_followed(host):
    target = host.tmp / "somewhere-else"
    target.mkdir()
    home = host.tmp / "jht-home"
    home.mkdir()
    (home / "live-screen").symlink_to(target, target_is_directory=True)
    done = add(host)
    assert done.returncode == 1 and "non e' una cartella normale" in json.loads(done.stdout)["reason"]
    log = host.log.read_text()
    assert "up -d" not in log and "run --rm" not in log
    assert list(target.iterdir()) == [], "nothing was made in what the link points to"
    assert not list((host.runtime / "integrations").glob("screen.ok"))


def test_a_file_in_place_of_the_password_folder_is_refused(host):
    home = host.tmp / "jht-home"
    home.mkdir()
    (home / "live-screen").write_text("x", encoding="utf-8")
    done = add(host)
    assert done.returncode == 1 and "up -d" not in host.log.read_text()


def test_a_link_put_there_while_the_browser_was_copied_stops_the_run_before_the_screen_starts(host):
    target = host.tmp / "elsewhere"
    target.mkdir()
    done = add(host, FAKE_SWAP_FOR_LINK=str(target))
    assert done.returncode == 1 and "non e' una cartella normale" in json.loads(done.stdout)["reason"]
    log = host.log.read_text()
    assert "run --rm" in log and "up -d" not in log


def test_a_plain_folder_already_there_is_used_as_it_is(host):
    folder = host.tmp / "jht-home" / "live-screen"
    folder.mkdir(parents=True)
    folder.chmod(0o755)
    assert add(host).returncode == 0
    assert stat.S_IMODE(folder.stat().st_mode) == 0o755, "a folder that exists is not touched"
