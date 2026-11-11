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
    env = {"TEST_RUNTIME_DIR": str(runtime_dir), **env}
    script = f"""
set -euo pipefail
HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"
err() {{ echo "error: $*" >&2; }}; info() {{ echo "info: $*" >&2; }}
RUNTIME_DIR="$TEST_RUNTIME_DIR"; COMPOSE_FILE="{host.compose}"
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


def cookies(host, content: bytes = b"cookies") -> Path:
    """The cookie database of the profile, as the browser leaves it (the content is not read by the host: only its size and time)."""
    path = host.tmp / "jht-home" / "secrets" / "linkedin-profile" / "Default" / "Network" / "Cookies"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def runs(host) -> int:
    return host.log.read_text().count("run --rm")


def test_status_asks_the_profile_in_a_one_shot_only_when_there_is_a_cookie_file_and_the_image(host):
    profile = host.tmp / "jht-home" / "secrets" / "linkedin-profile"
    nothing = run(host, "status --json", FAKE_CHECK_WORD="logged_in")
    assert last_line(nothing)["linkedin"] == "login_required" and "run --rm" not in host.log.read_text()
    profile.mkdir(parents=True)
    empty = run(host, "status --json", FAKE_CHECK_WORD="logged_in")  # a profile with no cookie file: nobody is signed in, nothing is asked
    assert last_line(empty)["linkedin"] == "login_required" and runs(host) == 0
    cookies(host)
    run(host, "status --json", FAKE_NO_IMAGE="1", FAKE_CHECK_WORD="logged_in")
    assert runs(host) == 0
    yes = last_line(run(host, "status --json", FAKE_CHECK_WORD="logged_in"))
    assert yes["linkedin"] == "logged_in"
    log = host.log.read_text()
    assert "profiles=login" in log and "--no-deps -T --entrypoint python3 jht-login /app/shared/login/login_session.py check /linkedin-profile" in log


def test_a_word_that_is_not_in_the_closed_list_is_not_a_sign_in_and_is_not_kept(host):
    cookies(host)
    other = last_line(run(host, "status --json", FAKE_CHECK_WORD="whatever; rm"))
    assert other["linkedin"] == "login_required" and not (host.runtime / "linkedin-status.cache").exists()
    run(host, "status --json", FAKE_CHECK_WORD="whatever; rm")
    assert runs(host) == 2, "what was not a clean answer is asked again"


def test_looking_again_and_again_costs_one_container_not_one_per_look(host):
    cookies(host)
    answers = [last_line(run(host, "status --json", FAKE_CHECK_WORD="logged_in"))["linkedin"] for _ in range(6)]
    assert answers == ["logged_in"] * 6 and runs(host) == 1
    cache = (host.runtime / "linkedin-status.cache").read_text().strip().split("|")
    assert len(cache) == 3 and cache[0].isdigit() and cache[2] == "logged_in" and REF in cache[1]
    assert stat.S_IMODE((host.runtime / "linkedin-status.cache").stat().st_mode) == 0o600
    assert not [line for line in host.log.read_text().splitlines() if line.startswith("DOCKER image inspect")][1:], "the image is not asked after the first answer"


def test_a_no_is_kept_the_same_way(host):
    cookies(host)
    for _ in range(3):
        assert last_line(run(host, "status --json", FAKE_CHECK_WORD="login_required"))["linkedin"] == "login_required"
    assert runs(host) == 1


def test_the_one_shot_runs_again_when_the_cookie_files_change_when_the_image_moves_and_when_the_time_is_up(host):
    path = cookies(host)
    run(host, "status --json", FAKE_CHECK_WORD="login_required")
    assert runs(host) == 1
    path.write_bytes(b"the person signed in: more bytes")  # the browser wrote its cookies
    assert last_line(run(host, "status --json", FAKE_CHECK_WORD="logged_in"))["linkedin"] == "logged_in" and runs(host) == 2
    (path.parent / "Cookies-journal").write_bytes(b"x")  # a journal of the database appears
    run(host, "status --json", FAKE_CHECK_WORD="logged_in")
    assert runs(host) == 3
    run(host, "status --json", FAKE_CHECK_WORD="logged_in", EXTRAS_IMAGE_DIGEST="sha256:" + "a" * 64)  # another image
    assert runs(host) == 4
    run(host, "status --json", FAKE_CHECK_WORD="logged_in", EXTRAS_IMAGE_DIGEST="sha256:" + "a" * 64, LINKEDIN_STATUS_TTL="0")  # time is up
    assert runs(host) == 5
    run(host, "status --json", FAKE_CHECK_WORD="logged_in", EXTRAS_IMAGE_DIGEST="sha256:" + "a" * 64)
    assert runs(host) == 5  # the entry the run above wrote is fresh again for the default time


def test_an_old_entry_is_not_used_and_neither_is_one_that_says_something_else(host):
    cookies(host)
    run(host, "status --json", FAKE_CHECK_WORD="login_required")
    cache = host.runtime / "linkedin-status.cache"
    epoch, key, word = cache.read_text().strip().split("|")
    for line in (f"{int(epoch) - 400}|{key}|logged_in", f"{epoch}|{key}|logged_in; rm", f"{epoch}|other|logged_in", f"x|{key}|logged_in",
                 f"{int(epoch) + 4000}|{key}|logged_in", f"{epoch}|{key}", f"{epoch}|{key}|logged_in|more"):
        cache.write_text(line + "\n")
        before = runs(host)
        answer = last_line(run(host, "status --json", FAKE_CHECK_WORD="login_required"))
        assert answer["linkedin"] == "login_required" and runs(host) == before + 1, line


def test_the_cache_is_never_written_through_a_link(host, tmp_path):
    cookies(host)
    target = tmp_path / "elsewhere.txt"
    target.write_text("not ours\n")
    (host.runtime / "linkedin-status.cache").symlink_to(target)
    done = run(host, "status --json", FAKE_CHECK_WORD="logged_in")
    assert last_line(done)["linkedin"] == "logged_in" and target.read_text() == "not ours\n"
    assert not [p for p in host.runtime.iterdir() if ".XXXX" in p.name or p.name.startswith("linkedin-status.cache.")]


def test_a_cookie_file_that_is_a_link_is_not_a_cookie_file(host, tmp_path):
    folder = host.tmp / "jht-home" / "secrets" / "linkedin-profile" / "Default" / "Network"
    folder.mkdir(parents=True)
    target = tmp_path / "somewhere"
    target.write_bytes(b"x")
    (folder / "Cookies").symlink_to(target)
    done = run(host, "status --json", FAKE_CHECK_WORD="logged_in")
    assert last_line(done)["linkedin"] == "login_required" and runs(host) == 0


def test_the_view_state_is_still_read_without_a_container_of_its_own(host):
    host.running.write_text("jht-login-view\n")
    cookies(host)
    done = run(host, "status --json", FAKE_CHECK_WORD="logged_in", FAKE_VIEW_STATUS='{"ok": true, "view": "connected"}')
    assert last_line(done) == {"ok": True, "view": "connected", "linkedin": "logged_in"}


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


def _runtime_named(host, tmp_path, *parts):
    folder = tmp_path.joinpath(*parts)
    folder.mkdir(parents=True, mode=0o700)
    (folder / "docker-compose.yml").write_text(host.compose.read_text())
    return folder


@pytest.mark.parametrize("parts", [("with space",), ("Library", "Application Support", "Job Hunter Team", "host-runtime"), ("quote's",), ("caf\u00e9",)])
def test_a_runtime_folder_with_spaces_or_accents_works_the_default_folder_of_a_mac_has_two_spaces(host, tmp_path, parts):
    folder = _runtime_named(host, tmp_path, *parts)
    done = run(host, "login", runtime_dir=str(folder), FAKE_GRANT=GOOD)
    assert done.returncode == 0, done.stderr
    target = folder / "jht-login-seccomp.json"
    assert hashlib.sha256(target.read_bytes()).hexdigest() == PROFILE_SHA256
    overlay = folder / "docker-compose.login-seccomp.yml"
    assert overlay.read_text() == f'services:\n  jht-login:\n    security_opt:\n      - "seccomp:{target}"\n'
    import yaml
    assert yaml.safe_load(overlay.read_text())["services"]["jht-login"]["security_opt"] == [f"seccomp:{target}"]
    assert f"COMPOSE_EXTRA {overlay}" in host.log.read_text().splitlines()


@pytest.mark.parametrize("name", ['with"quote', "with$dollar", "with:colon", "with\\backslash", "with#hash", "with\nnewline", "with\ttab", "with\x01ctl"])
def test_a_runtime_folder_whose_name_would_end_or_change_the_yaml_string_stops_the_login(host, tmp_path, name):
    folder = _runtime_named(host, tmp_path, name)
    done = run(host, "login", runtime_dir=str(folder), FAKE_GRANT=GOOD)
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "chromium_sandbox_unavailable"}
    assert "up -d" not in host.log.read_text() and not (folder / "jht-login-seccomp.json").exists()


def test_a_relative_runtime_folder_stops_the_login(host):
    done = run(host, "login", runtime_dir="relative/runtime", FAKE_GRANT=GOOD)
    assert done.returncode == 1 and last_line(done) == {"ok": False, "reason": "chromium_sandbox_unavailable"}


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
