"""`jht linkedin login|status` (linkedin_main of the helper): the profile of LinkedIn made by the person and never reached through a link,
the three containers of the profile `login` started only by `login`, the line the app reads checked in its exact shape, the reasons of the
contract and nothing else, the state of the engine. Same fake engine and compose as test_integration_screen.py; the view is a fake too."""
from __future__ import annotations

import hashlib
import json
import re
import stat
import subprocess
from pathlib import Path

import pytest

from test_integration_command import LIBRARY, host, wrapper_functions  # noqa: F401

DIGEST = "sha256:" + "e" * 64
REF = f"ghcr.io/leopu00/jht@{DIGEST}"
TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE"
PROFILE_SOURCE = Path(__file__).resolve().parents[1] / "shared" / "login" / "seccomp" / "jht-login.json"
PROFILE_SHA256 = hashlib.sha256(PROFILE_SOURCE.read_bytes()).hexdigest()
GOOD = ('{"ok": true, "port": 6081, "path": "/websockify", "token": "%s", "expires_at": "2026-11-11T10:00:00Z", "session": "a1b2c3d4e5f6"}' % TOKEN)


def run(host, args: str, runtime_dir=None, **env) -> subprocess.CompletedProcess:
    runtime_dir = runtime_dir or host.runtime
    script = f"""
set -euo pipefail
HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"
err() {{ echo "error: $*" >&2; }}; info() {{ echo "info: $*" >&2; }}
RUNTIME_DIR="{runtime_dir}"; COMPOSE_FILE="{host.compose}"
BROKER_SERVICE=jht-broker; TELEGRAM_SERVICE=jht-telegram; JHT_HOST_TYPE=local
{wrapper_functions("runtime_stat", "runtime_node_safe", "runtime_sha256")}
compose_project_name() {{ echo jht; }}
docker_reachable() {{ docker info >/dev/null 2>&1; }}
require_docker() {{ docker_reachable || {{ err "motore spento"; exit 1; }}; }}
read_only_service_id() {{ grep -qx "$1" "$FAKE_RUNNING" && {{ echo "id-$1"; return 0; }}; return 3; }}
compose() {{
  printf 'COMPOSE profiles=%s image=%s %s\\n' "${{COMPOSE_PROFILES:-}}" "${{JHT_EXTRAS_IMAGE:-}}" "$*" >> "$FAKE_LOG"
  [ -z "${{COMPOSE_EXTRA_FILE:-}}" ] || printf 'COMPOSE_EXTRA %s\\n' "$COMPOSE_EXTRA_FILE" >> "$FAKE_LOG"
  [ -z "${{FAKE_COMPOSE_FAIL:-}}" ] || return 1
  if [ "$1" = run ]; then echo "${{FAKE_CHECK_WORD:-login_required}}"; return 0; fi
  case "$1" in
    up) shift 2; for s in "$@"; do echo "$s" >> "$FAKE_RUNNING"; done ;;
    stop) grep -vx "$2" "$FAKE_RUNNING" > "$FAKE_RUNNING.new" || true; mv "$FAKE_RUNNING.new" "$FAKE_RUNNING" ;;
  esac
}}
docker() {{
  printf 'DOCKER %s\\n' "$*" >> "$FAKE_LOG"
  case "$1" in
    exec)
      case "$*" in
        *" grant") [ -z "${{FAKE_SWAP_FOR_LINK:-}}" ] || true; echo "${{FAKE_GRANT:-}}" ;;
        *" status") echo "${{FAKE_VIEW_STATUS:-{{\\"ok\\": true, \\"view\\": \\"waiting\\"}}}}" ;;
      esac ;;
    inspect) [ -z "${{FAKE_EXIT_CODE:-}}" ] || echo "$FAKE_EXIT_CODE" ;;
    image) [ -z "${{FAKE_NO_IMAGE:-}}" ] && return 0 || return 1 ;;
    run) case "$*" in *"--entrypoint cat "*) cat "${{FAKE_PROFILE_SRC:-{PROFILE_SOURCE}}}" ;; esac; [ -z "${{FAKE_PROFILE_FAIL:-}}" ] || return 1 ;;
    info|pull|rmi|volume) : ;;
  esac
  return 0
}}
. "{LIBRARY}"
export LINKEDIN_POLL_SECONDS=0
linkedin_main {args}
"""
    home = host.tmp / "jht-home"
    return subprocess.run(["bash", "-c", script], env={**host.env, "JHT_HOME_HOST": str(home), "EXTRAS_IMAGE_DIGEST": DIGEST, **env},
                          capture_output=True, text=True, timeout=60)


def last_line(done) -> dict:
    return json.loads(done.stdout.strip().splitlines()[-1])


def test_login_makes_the_profile_private_pulls_starts_the_three_containers_and_prints_the_grant_as_it_got_it(host):
    done = run(host, "login", FAKE_GRANT=GOOD)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip().splitlines()[-1] == GOOD
    profile = host.tmp / "jht-home" / "secrets" / "linkedin-profile"
    assert profile.is_dir() and stat.S_IMODE(profile.stat().st_mode) == 0o700
    assert stat.S_IMODE(profile.parent.stat().st_mode) == 0o700
    log = host.log.read_text().splitlines()
    up = f"COMPOSE profiles=login image={REF} up -d jht-login-proxy jht-login-view jht-login"
    assert log.index(f"DOCKER pull {REF}") < log.index(up)
    assert any(line.startswith("DOCKER exec id-jht-login-view python3 /app/shared/login/login_view.py grant") for line in log)
    assert not [line for line in log if "up -d" in line and "profiles=login" not in line], "only the login profile is started"


def test_a_release_without_an_extras_image_touches_nothing(host):
    done = run(host, "login", EXTRAS_IMAGE_DIGEST="")
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "view_unavailable"}
    assert "up -d" not in host.log.read_text() and not (host.tmp / "jht-home").exists()


def test_a_session_already_there_is_view_busy_and_nothing_is_touched(host):
    host.running.write_text("jht-login-view\n")
    done = run(host, "login", FAKE_GRANT=GOOD)
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "view_busy"}
    log = host.log.read_text()
    assert "up -d" not in log and "rm -f" not in log


def test_what_an_ended_session_left_is_removed_before_the_next_one(host):
    done = run(host, "login", FAKE_GRANT=GOOD)
    assert done.returncode == 0
    log = host.log.read_text().splitlines()
    first_up = next(i for i, line in enumerate(log) if "up -d" in line)
    assert any("rm -f jht-login" in line for line in log[:first_up])


@pytest.mark.parametrize("make_bad", ["secrets_link", "profile_link", "profile_file", "base_link"])
def test_a_link_or_a_file_at_any_step_down_to_the_profile_is_refused_and_never_followed(host, make_bad):
    target = host.tmp / "somewhere-else"
    target.mkdir()
    home = host.tmp / "jht-home"
    home.mkdir()
    if make_bad == "base_link":
        home.rmdir()
        home.symlink_to(target, target_is_directory=True)
    elif make_bad == "secrets_link":
        (home / "secrets").symlink_to(target, target_is_directory=True)
    elif make_bad == "profile_link":
        (home / "secrets").mkdir()
        (home / "secrets" / "linkedin-profile").symlink_to(target, target_is_directory=True)
    else:
        (home / "secrets").mkdir()
        (home / "secrets" / "linkedin-profile").write_text("x")
    done = run(host, "login", FAKE_GRANT=GOOD)
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "view_unavailable"}
    assert "up -d" not in host.log.read_text() and list(target.iterdir()) == []


@pytest.mark.parametrize("line", [
    "", "not json", '{"ok": true}',
    GOOD.replace(TOKEN, TOKEN[:-1]), GOOD.replace('6081', '6082'), GOOD.replace('/websockify', '/other'),
    GOOD + ", \"extra\": 1", GOOD.replace('"ok": true', '"ok":true'),
    '{"ok": false, "reason": "something_new"}', '{"ok": false, "reason": "view_busy; rm -rf x"}',
])
def test_a_line_that_is_not_exactly_the_contract_never_reaches_the_app_as_a_grant(host, line):
    done = run(host, "login", FAKE_GRANT=line)
    assert done.returncode == 1
    printed = done.stdout.strip().splitlines()[-1]
    assert TOKEN not in done.stdout
    assert json.loads(printed) == {"ok": False, "reason": "view_unavailable"}


@pytest.mark.parametrize("reason", ["view_busy", "login_timeout", "token_expired", "chromium_sandbox_unavailable"])
def test_a_reason_of_the_contract_from_the_view_is_passed_on_and_the_containers_are_taken_down(host, reason):
    done = run(host, "login", FAKE_GRANT=json.dumps({"ok": False, "reason": reason}))
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": reason}
    assert host.running.read_text().strip() == "", "nothing is left running"


def test_stop_takes_all_three_down_and_says_ok(host):
    host.running.write_text("jht-login\njht-login-proxy\njht-login-view\n")
    done = run(host, "login --stop")
    assert done.returncode == 0 and last_line(done) == {"ok": True}
    assert host.running.read_text().strip() == ""
    log = host.log.read_text()
    for service in ("jht-login", "jht-login-proxy", "jht-login-view"):
        assert f"stop {service}" in log and f"rm -f {service}" in log


def test_status_idle_waiting_connected_and_how_the_last_session_ended(host):
    idle = run(host, "status --json")
    assert last_line(idle) == {"ok": True, "view": "idle", "linkedin": "login_required"}
    host.running.write_text("jht-login-view\n")
    waiting = last_line(run(host, "status --json", FAKE_VIEW_STATUS='{"ok": true, "view": "waiting"}'))
    assert waiting["view"] == "waiting"
    connected = last_line(run(host, "status --json", FAKE_VIEW_STATUS='{"ok": true, "view": "connected"}'))
    assert connected["view"] == "connected"
    host.running.write_text("")
    for code, reason in (("10", "logged_in"), ("11", "login_timeout"), ("12", "token_expired"), ("13", "stopped")):
        ended = last_line(run(host, "status --json", FAKE_EXIT_CODE=code))
        assert ended["last_session"] == {"reason": reason}
    assert "last_session" not in last_line(run(host, "status --json", FAKE_EXIT_CODE="14"))
    assert "last_session" not in last_line(run(host, "status --json", FAKE_EXIT_CODE="99"))


def test_status_asks_the_profile_in_a_one_shot_only_when_there_is_one_and_the_image(host):
    profile = host.tmp / "jht-home" / "secrets" / "linkedin-profile"
    nothing = run(host, "status --json", FAKE_CHECK_WORD="logged_in")
    assert last_line(nothing)["linkedin"] == "login_required" and "run --rm" not in host.log.read_text()
    profile.mkdir(parents=True)
    run(host, "status --json", FAKE_NO_IMAGE="1", FAKE_CHECK_WORD="logged_in")
    assert "run --rm" not in host.log.read_text()
    yes = last_line(run(host, "status --json", FAKE_CHECK_WORD="logged_in"))
    assert yes["linkedin"] == "logged_in"
    other = last_line(run(host, "status --json", FAKE_CHECK_WORD="whatever; rm"))
    assert other["linkedin"] == "login_required"
    log = host.log.read_text()
    assert "profiles=login" in log and "--no-deps -T --entrypoint python3 jht-login /app/shared/login/login_session.py check /linkedin-profile" in log


def test_status_does_not_run_the_one_shot_over_a_link(host):
    target = host.tmp / "elsewhere"
    target.mkdir()
    (host.tmp / "jht-home" / "secrets").mkdir(parents=True)
    (host.tmp / "jht-home" / "secrets" / "linkedin-profile").symlink_to(target, target_is_directory=True)
    done = run(host, "status --json", FAKE_CHECK_WORD="logged_in")
    assert last_line(done)["linkedin"] == "login_required" and "run --rm" not in host.log.read_text()


@pytest.mark.parametrize("args", ["", "login now", "status", "logout", "login --stop now", "status --json extra"])
def test_anything_else_is_the_usage_with_code_2_and_the_engine_is_not_asked(host, args):
    done = run(host, args)
    assert done.returncode == 2 and "uso: jht linkedin" in done.stderr
    assert host.log.read_text() == ""


# ── the seccomp profile of the browser on Docker ─────────────────────────────────────────────────────────────────────────────────────────


def test_the_helper_holds_the_digest_of_the_profile_of_the_repository():
    from test_integration_command import LIBRARY as library
    text = Path(library).read_text(encoding="utf-8")
    assert re.search(r'^LOGIN_SECCOMP_SHA256="%s"$' % PROFILE_SHA256, text, re.M), "the profile changed: the digest in the helper goes with it"
    assert 'LOGIN_SECCOMP_IN_IMAGE="/app/shared/login/seccomp/jht-login.json"' in text


def test_on_docker_the_profile_comes_from_the_image_into_the_runtime_folder_and_only_the_login_service_gets_it(host):
    done = run(host, "login", FAKE_GRANT=GOOD)
    assert done.returncode == 0, done.stderr
    target, overlay = host.runtime / "jht-login-seccomp.json", host.runtime / "docker-compose.login-seccomp.yml"
    assert hashlib.sha256(target.read_bytes()).hexdigest() == PROFILE_SHA256 and stat.S_IMODE(target.stat().st_mode) == 0o644
    assert overlay.read_text() == f'services:\n  jht-login:\n    security_opt:\n      - "seccomp:{target}"\n'
    log = host.log.read_text().splitlines()
    extraction = next(line for line in log if line.startswith("DOCKER run "))
    for flag in ("--rm", "--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--user 1001:1001", "--entrypoint cat"):
        assert flag in extraction
    assert extraction.endswith(f"{REF} /app/shared/login/seccomp/jht-login.json")
    up = log.index(f"COMPOSE profiles=login image={REF} up -d jht-login-proxy jht-login-view jht-login")
    assert log[up + 1] == f"COMPOSE_EXTRA {overlay}"
    assert not [line for line in log if line.startswith("COMPOSE_EXTRA") and line != f"COMPOSE_EXTRA {overlay}"]
    assert [p.name for p in host.runtime.iterdir() if ".XXXX" in p.name or p.suffix not in (".json", ".yml", "")] == []


def test_a_copy_that_matches_is_used_as_it_is_and_one_that_does_not_is_taken_again_from_the_image(host):
    first = run(host, "login", FAKE_GRANT=GOOD)
    assert first.returncode == 0
    host.log.write_text("")
    host.running.write_text("")
    second = run(host, "login", FAKE_GRANT=GOOD)
    assert second.returncode == 0 and "DOCKER run " not in host.log.read_text(), "a good copy is not fetched again"
    (host.runtime / "jht-login-seccomp.json").write_text('{"defaultAction": "SCMP_ACT_ALLOW"}\n')  # an altered copy
    host.log.write_text("")
    host.running.write_text("")
    third = run(host, "login", FAKE_GRANT=GOOD)
    assert third.returncode == 0 and "DOCKER run " in host.log.read_text()
    assert hashlib.sha256((host.runtime / "jht-login-seccomp.json").read_bytes()).hexdigest() == PROFILE_SHA256


def test_an_image_whose_profile_is_not_the_attested_one_stops_the_login_and_leaves_nothing_behind(host, tmp_path):
    other = tmp_path / "other.json"
    other.write_text('{"defaultAction": "SCMP_ACT_ALLOW"}\n')
    done = run(host, "login", FAKE_GRANT=GOOD, FAKE_PROFILE_SRC=str(other))
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "chromium_sandbox_unavailable"}
    assert "up -d" not in host.log.read_text()
    assert not (host.runtime / "jht-login-seccomp.json").exists() and not (host.runtime / "docker-compose.login-seccomp.yml").exists()
    assert sorted(p.name for p in host.runtime.iterdir()) == ["docker-compose.yml"]


def test_an_image_that_does_not_answer_stops_the_login_the_same_way(host):
    done = run(host, "login", FAKE_GRANT=GOOD, FAKE_PROFILE_FAIL="1")
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "chromium_sandbox_unavailable"}
    assert "up -d" not in host.log.read_text()


@pytest.mark.parametrize("which", ["profile", "overlay"])
def test_a_link_in_the_place_of_the_profile_or_of_the_overlay_stops_the_login_and_is_not_followed(host, tmp_path, which):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.write_text("not ours\n")
    name = "jht-login-seccomp.json" if which == "profile" else "docker-compose.login-seccomp.yml"
    (host.runtime / name).symlink_to(elsewhere)
    done = run(host, "login", FAKE_GRANT=GOOD)
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "chromium_sandbox_unavailable"}
    assert elsewhere.read_text() == "not ours\n" and "up -d" not in host.log.read_text()


@pytest.mark.parametrize("folder", ["with space", 'with"quote', "with$dollar", "with:colon"])
def test_a_runtime_folder_whose_name_would_not_stay_one_word_in_yaml_stops_the_login(host, tmp_path, folder):
    odd = tmp_path / folder
    odd.mkdir(mode=0o700)
    (odd / "docker-compose.yml").write_text(host.compose.read_text())
    done = run(host, "login", runtime_dir=str(odd).replace("$", "\\$").replace('"', '\\"'), FAKE_GRANT=GOOD)
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "chromium_sandbox_unavailable"}
    assert "up -d" not in host.log.read_text()


def test_on_podman_nothing_of_this_happens_the_default_profile_of_the_engine_stays(host):
    done = run(host, "login", FAKE_GRANT=GOOD, CONTAINER_RUNTIME="podman")
    assert done.returncode == 0, done.stderr
    log = host.log.read_text()
    assert "DOCKER run " not in log and "COMPOSE_EXTRA" not in log
    assert not (host.runtime / "jht-login-seccomp.json").exists() and not (host.runtime / "docker-compose.login-seccomp.yml").exists()


def test_the_profile_is_never_asked_for_by_stop_or_status(host):
    for args in ("login --stop", "status --json"):
        run(host, args)
    log = host.log.read_text()
    assert "DOCKER run " not in log and "COMPOSE_EXTRA" not in log


def _compose_file_run(host, extra: str, runtime: str = "docker") -> subprocess.CompletedProcess:
    script = f"""
set -u
err() {{ echo "error: $*" >&2; }}
RUNTIME_DIR="{host.runtime}"; CONTAINER_RUNTIME={runtime}; COMPOSE_EXTRA_FILE="{extra}"
compose_project_name() {{ echo jht; }}
docker() {{ printf 'DOCKER %s\\n' "$*"; }}
{wrapper_functions("compose_file_run")}
compose_file_run "{host.compose}" up -d jht-login
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)


def test_docker_compose_gets_the_overlay_as_a_second_file_only_when_it_is_the_one_the_helper_makes(host):
    overlay = host.runtime / "docker-compose.login-seccomp.yml"
    overlay.write_text("services: {}\n")
    done = _compose_file_run(host, str(overlay))
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == f"DOCKER compose -f {host.compose} -f {overlay} --project-directory {host.runtime} up -d jht-login"
    none = _compose_file_run(host, "")
    assert none.stdout.strip() == f"DOCKER compose -f {host.compose} --project-directory {host.runtime} up -d jht-login"


@pytest.mark.parametrize("extra", ["/etc/passwd", "relative.yml", "$RUNTIME_DIR/other.yml", "$RUNTIME_DIR/docker-compose.login-seccomp.yml.bak"])
def test_any_other_value_of_the_variable_starts_nothing(host, extra):
    done = _compose_file_run(host, extra.replace("$RUNTIME_DIR", str(host.runtime)))
    assert done.returncode == 1 and done.stdout == "" and "COMPOSE_EXTRA_FILE" in done.stderr


def test_the_overlay_that_is_a_link_or_is_not_there_starts_nothing(host, tmp_path):
    overlay = host.runtime / "docker-compose.login-seccomp.yml"
    assert _compose_file_run(host, str(overlay)).returncode == 1  # not there
    target = tmp_path / "elsewhere.yml"
    target.write_text("services: {}\n")
    overlay.symlink_to(target)
    done = _compose_file_run(host, str(overlay))
    assert done.returncode == 1 and done.stdout == ""


def test_the_wrapper_forgets_what_the_environment_says_about_the_variable():
    text = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    assert re.search(r'^COMPOSE_EXTRA_FILE=""', text, re.M)
