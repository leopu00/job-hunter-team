"""The mail broker is made at its first use, not at the setup or at `jht up` (T316).

The compose keeps the broker out of `jht up` (profile `broker`); `jht` mounts only the empty socket volume, so making the
broker later never recreates the team. The real wrapper functions run against stubs of the compose and of the attestation:

- a broker that runs is left alone (no compose call);
- a broker that is not there is made with ONE compose call (profile broker, `--no-deps`, the broker alone), waited for, and
  written down in a marker, so that `jht up` brings it back after a `down`;
- a clean install (no marker, no broker) makes nothing at `up`; a broker an older install made is adopted;
- the commands that look at the WHOLE project (down, ps) name every profile.

Synthetic only: no container, no engine.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
COMPOSE = ROOT / "docker-compose.yml"


def _function(name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", WRAPPER.read_text(encoding="utf-8"), re.S | re.M)
    assert match, name
    return match.group(0)


@pytest.fixture
def host(tmp_path):
    if os.name == "nt":
        pytest.skip("the sh wrapper runs on macOS and Linux; Windows has its own (test_broker_on_request_windows.py)")
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    profiles: [broker]\n    image: x\n")
    state = tmp_path / "state"
    log = tmp_path / "calls.log"
    log.write_text("")
    return type("H", (), {"runtime": runtime, "state": state, "log": log, "tmp": tmp_path})


def run(host, body: str, state: str = "absent", **env_extra):
    host.state.write_text(state)
    script = (
        "set -u\n"
        'info() { :; }\nwarn() { echo "warn: $*" >&2; }\nerr() { echo "error: $*" >&2; }\nsleep() { :; }\n'
        f'RUNTIME_DIR="{host.runtime}"\nCOMPOSE_FILE="{host.runtime}/docker-compose.yml"\n'
        'BROKER_SERVICE="jht-broker"\nBROKER_WANTED_MARKER="$RUNTIME_DIR/.broker-made"\n'
        # what the attestation answers: running (0 and the id), absent (3), not attestable (1), stopped (3, but 0 for any-config)
        'read_only_service_id() {\n'
        f'  case "$(cat "{host.state}")" in\n'
        '    running) echo broker-id ;;\n'
        '    absent) return 3 ;;\n'
        '    unattestable) return 1 ;;\n'
        '    stopped) [ "${2:-}" = any-config ] && { echo broker-id; return 0; }; return 3 ;;\n'
        '  esac\n}\n'
        # the compose makes the broker when asked to `up` it (unless UPRC says it fails)
        'compose() {\n'
        f'  printf "PROFILES=%s ARGS=%s\\n" "${{COMPOSE_PROFILES:-}}" "$*" >> "{host.log}"\n'
        f'  [ "$1" = up ] && [ "${{UPRC:-0}}" = 0 ] && [ "${{NEVER_READY:-0}}" = 0 ] && echo running > "{host.state}"\n'
        '  [ "$1" != up ] || return "${UPRC:-0}"\n}\n'
        f'docker() {{ printf "DOCKER %s\\n" "$*" >> "{host.log}"; return "${{ADMIN_RC:-0}}"; }}\n'
        f'broker_migrate_legacy_once() {{ echo MIGRATE >> "{host.log}"; }}\n'
        f'broker_configure_web_authorisations() {{ echo CONFIGURE >> "{host.log}"; }}\n'
        + "\n".join(_function(n) for n in ("compose_lacks_service", "compose_unreadable", "ensure_broker", "broker_after_up", "broker_admin"))
        + "\n" + body
    )
    return subprocess.run(["bash", "-c", script], env={**os.environ, **env_extra}, text=True, capture_output=True, timeout=30, check=False)


def calls(host) -> list[str]:
    return host.log.read_text().splitlines()


def test_a_broker_that_runs_is_left_alone(host):
    result = run(host, "ensure_broker; echo rc=$?", state="running")
    assert "rc=0" in result.stdout
    assert calls(host) == []
    assert not (host.runtime / ".broker-made").exists()


def test_a_broker_that_is_not_there_is_made_with_one_call_that_names_the_broker_alone(host):
    result = run(host, "ensure_broker; echo rc=$?")
    assert "rc=0" in result.stdout, result.stderr
    compose_calls = [line for line in calls(host) if line.startswith("PROFILES=")]
    assert compose_calls == ["PROFILES=broker ARGS=up -d --no-deps jht-broker"]  # never `jht`: the team is not recreated
    assert (host.runtime / ".broker-made").exists()
    assert "MIGRATE" in calls(host) and "CONFIGURE" in calls(host)
    assert any(line.startswith("DOCKER exec broker-id jht-broker-admin secrets status") for line in calls(host))  # waited for it


def test_a_stopped_broker_is_started_the_same_way(host):
    result = run(host, "ensure_broker; echo rc=$?", state="stopped")
    assert "rc=0" in result.stdout, result.stderr
    assert [line for line in calls(host) if line.startswith("PROFILES=")] == ["PROFILES=broker ARGS=up -d --no-deps jht-broker"]


def test_an_old_compose_without_the_broker_points_to_upgrade_and_makes_nothing(host):
    (host.runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n")
    result = run(host, "ensure_broker; echo rc=$?")
    assert "rc=1" in result.stdout
    assert "Cosa fare: jht upgrade" in result.stderr
    assert calls(host) == [] and not (host.runtime / ".broker-made").exists()


def test_a_broker_that_does_not_attest_is_not_touched(host):
    result = run(host, "ensure_broker; echo rc=$?", state="unattestable")
    assert "rc=1" in result.stdout
    assert "non lo tocco" in result.stderr
    assert calls(host) == []


def test_a_failed_up_leaves_no_marker(host):
    result = run(host, "ensure_broker; echo rc=$?", UPRC="1")
    assert "rc=1" in result.stdout
    assert "broker_start_failed" in result.stderr
    assert not (host.runtime / ".broker-made").exists()
    assert "MIGRATE" not in calls(host)


def test_a_broker_that_never_answers_is_an_error_after_the_wait_and_leaves_no_marker(host):
    result = run(host, "ensure_broker; echo rc=$?", ADMIN_RC="1", NEVER_READY="0")
    assert "rc=1" in result.stdout
    assert "non risponde" in result.stderr
    assert not (host.runtime / ".broker-made").exists()


def test_a_clean_install_makes_nothing_at_up(host):
    result = run(host, "broker_after_up; echo rc=$?")
    assert "rc=0" in result.stdout
    assert [line for line in calls(host) if line.startswith("PROFILES=")] == []
    assert not (host.runtime / ".broker-made").exists()


def test_a_broker_made_before_comes_back_with_the_team(host):
    (host.runtime / ".broker-made").write_text("")  # `down` removed its container
    result = run(host, "broker_after_up; echo rc=$?")
    assert "rc=0" in result.stdout, result.stderr
    assert [line for line in calls(host) if line.startswith("PROFILES=")] == ["PROFILES=broker ARGS=up -d --no-deps jht-broker"]


def test_a_broker_an_older_install_made_is_adopted_not_remade(host):
    result = run(host, "broker_after_up; echo rc=$?", state="stopped")
    # the container exists in some state: the marker is written and `ensure` starts it; nothing else is created
    assert "rc=0" in result.stdout, result.stderr
    assert (host.runtime / ".broker-made").exists()
    assert [line for line in calls(host) if line.startswith("PROFILES=")] == ["PROFILES=broker ARGS=up -d --no-deps jht-broker"]
    run_ok = run(host, "broker_after_up; echo rc=$?", state="running")
    assert "rc=0" in run_ok.stdout


def test_the_admin_says_where_the_mail_comes_from_when_the_broker_was_never_made(host):
    result = run(host, "broker_admin secrets status; echo rc=$?")
    assert "rc=1" in result.stdout
    assert "Cosa fare: jht mail setup" in result.stderr
    (host.runtime / ".broker-made").write_text("")
    result = run(host, "broker_admin secrets status; echo rc=$?")
    assert result.stderr.rstrip().endswith("Cosa fare: jht up")


# ── the compose and the commands of the whole project ────────────────────────

def _service_block(name: str) -> str:
    match = re.search(rf"^  {name}:\n(.*?)(?=^  \S|^\S|\Z)", COMPOSE.read_text(encoding="utf-8"), re.S | re.M)
    assert match, name
    return match.group(1)


def test_the_compose_keeps_the_broker_out_of_a_plain_up_and_jht_mounts_only_the_empty_socket_volume():
    broker = _service_block("jht-broker")
    assert re.search(r"^    profiles: \[broker\]$", broker, re.M)
    jht = _service_block("jht")
    mounted = re.findall(r"^      - (jht-[a-z-]+):", jht, re.M)
    # no volume with data or secrets of the broker is in the team's container; the socket one has been since it was made
    assert "jht-broker-sock" in mounted
    assert not {"jht-secrets", "jht-broker-state", "jht-telegram-broker-sock"} & set(mounted)
    assert "depends_on" not in jht


def test_nothing_that_looks_at_or_takes_down_the_whole_project_forgets_the_broker_profile():
    source = WRAPPER.read_text(encoding="utf-8")
    listed = re.search(r'^COMPOSE_ALL_PROFILES="([^"]*)"$', source, re.M)
    assert listed and set(listed.group(1).split(",")) == {"telegram", "broker", "media", "playwright"}, "every profile of the project, the broker among them"
    code = [line for line in source.splitlines() if not line.lstrip().startswith("#")]
    for line in code:
        if "COMPOSE_PROFILES=telegram " in line:
            # only the Telegram service itself (up, restart, stop, run): never `down`, `ps -q` of the project or the hash dry run
            assert not re.search(r"compose (down|ps)\b", line), line
            assert "--dry-run" not in line, line
    assert sum("COMPOSE_PROFILES=\"$COMPOSE_ALL_PROFILES\"" in line for line in code) >= 10


def test_up_never_names_the_broker_and_every_after_up_goes_through_one_function():
    source = WRAPPER.read_text(encoding="utf-8")
    assert source.count("    broker_after_up\n") == 3  # up, start-container, recreate
    for line in source.splitlines():
        if re.search(r"\bcompose up\b", line) and "$BROKER_SERVICE" in line:
            assert "--no-deps" in line and "COMPOSE_PROFILES=broker" in line, line


def test_the_upgrade_recreates_the_broker_only_when_it_is_there():
    source = WRAPPER.read_text(encoding="utf-8")
    block = re.search(r'\n  # Solo se esiste.*?broker_migrate_legacy_once\n  fi', source, re.S)
    assert block, "the upgrade must test that the broker exists before recreating it"
    assert 'read_only_service_id "$BROKER_SERVICE" any-config' in block.group(0)
    assert "--no-deps" in block.group(0) and "COMPOSE_PROFILES=broker" in block.group(0)
