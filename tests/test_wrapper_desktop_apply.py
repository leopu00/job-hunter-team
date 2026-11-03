"""`jht desktop-apply record`: the app asks the host to record an authorisation to apply in the broker.

The app shows the preview with its digest, the person confirms with a click, the container writes the flag, and the app
asks THIS branch of the host's wrapper to record the instant and the destination in the broker (the agents' container
cannot). It never starts anything, closes every field before it reaches a command line, and answers one closed line.
Synthetic only: a fake `docker`, no container, no broker.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTANT = "2026-11-03T09:30:00.123Z"

FAKE_DOCKER = r"""#!/bin/sh
printf 'ARGV %s\n' "$*" >> "$FAKE_LOG"
[ "$1" = exec ] || { printf 'UNEXPECTED %s\n' "$*" >> "$FAKE_LOG"; exit 97; }
shift
while [ $# -gt 0 ]; do case "$1" in -i|-it) shift ;; *) break ;; esac; done
target="$1"; shift
case "$target:$*" in
  broker-id:"jht-broker-admin apply record "*)
    printf '%s\n' "${FAKE_BROKER_ANSWER-{\"ok\": true, \"status\": \"recorded\"}}"
    exit "${FAKE_BROKER_RC:-0}" ;;
  *) printf 'UNEXPECTED %s:%s\n' "$target" "$*" >> "$FAKE_LOG"; exit 97 ;;
esac
"""


def _function(name: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
    assert match, name
    return match.group(0)


@pytest.fixture
def fake(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    log.write_text("")
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_LOG": str(log)}
    return env, log


def _run(env, *args, broker_up=True):
    script = (
        "set -u\nBROKER_SERVICE=jht-broker\n"
        + ('read_only_service_id() { [ "$1" = jht-broker ] && echo broker-id; }\n' if broker_up else "read_only_service_id() { return 1; }\n")
        + _function("desktop_apply")
        + 'desktop_apply "$@"\n'
    )
    return subprocess.run(["bash", "-c", script, "bash", *args], env=env, text=True, capture_output=True, timeout=20, check=False)


def test_it_records_in_the_broker_with_the_three_fields_and_answers_one_closed_line(fake):
    env, log = fake
    done = _run(env, "record", "4", INSTANT, "portal:ashby")
    assert (done.returncode, done.stdout) == (0, '{"ok":true}\n'), done.stderr
    assert log.read_text().splitlines() == [f"ARGV exec -i broker-id jht-broker-admin apply record 4 {INSTANT} portal:ashby"]
    done = _run(env, "record", "4", INSTANT, "web:jobs.example.com")
    assert done.stdout == '{"ok":true}\n'
    # the same record again is the broker saying so, and it is fine
    env["FAKE_BROKER_ANSWER"] = '{"ok": true, "status": "already_recorded"}'
    assert _run(env, "record", "4", INSTANT, "email:hr.example.com").stdout == '{"ok":true}\n'


@pytest.mark.parametrize("answer, code", [
    ('{"ok": false, "error": "no"}', 0),
    ("recorded", 0),
    ("", 0),
    ('{"ok": true, "status": "recorded"}', 1),
    ('{"status": "other"}', 0),
])
def test_anything_but_a_recorded_answer_is_refused_in_a_closed_line_that_holds_none_of_the_brokers_text(fake, answer, code):
    env, _ = fake
    env.update(FAKE_BROKER_ANSWER=answer, FAKE_BROKER_RC=str(code))
    done = _run(env, "record", "4", INSTANT, "portal:ashby")
    assert (done.returncode, done.stdout) == (1, '{"ok":false,"error":"apply_record_refused"}\n')
    assert answer.strip() not in done.stdout or not answer.strip()


def test_with_the_broker_down_it_says_so_and_starts_nothing(fake):
    env, log = fake
    done = _run(env, "record", "4", INSTANT, "portal:ashby", broker_up=False)
    assert (done.returncode, done.stdout) == (113, '{"ok":false,"error":"apply_record_no_broker"}\n')
    assert log.read_text() == "", "docker was not even called"


@pytest.mark.parametrize("args", [
    (),
    ("record",),
    ("record", "4", INSTANT),
    ("record", "4", INSTANT, "portal:ashby", "extra"),
    ("revoke", "4", INSTANT, "portal:ashby"),
    ("record", "0", INSTANT, "portal:ashby"),
    ("record", "04", INSTANT, "portal:ashby"),
    ("record", "4; reboot", INSTANT, "portal:ashby"),
    ("record", "12345678901", INSTANT, "portal:ashby"),
    ("record", "4", "2026-11-03 09:30:00", "portal:ashby"),
    ("record", "4", "2026-11-03T09:30:00Z", "portal:ashby"),
    ("record", "4", INSTANT + "\n", "portal:ashby"),
    ("record", "4", INSTANT, "portal:ash by"),
    ("record", "4", INSTANT, "ftp:example.com"),
    ("record", "4", INSTANT, "web:EXAMPLE.com"),
    ("record", "4", INSTANT, "web:ab"),
    ("record", "4", INSTANT, "portal:ashby\nweb:x.com"),
    ("record", "4", INSTANT, "$(id)"),
])
def test_a_request_that_is_not_closed_is_refused_before_the_broker_is_even_looked_for(fake, args):
    env, log = fake
    done = _run(env, *args)
    assert (done.returncode, done.stdout) == (2, '{"ok":false,"error":"apply_record_invalid"}\n')
    assert log.read_text() == ""


def test_the_branch_never_starts_anything_and_the_protocol_marker_is_published_in_both_wrappers():
    function = _function("desktop_apply")
    for forbidden in ("ensure_up", "compose", "machine", "require_docker", " up ", "start"):
        assert forbidden not in function, forbidden
    lines = WRAPPER.read_text(encoding="utf-8").splitlines()
    assert "JHT_DESKTOP_APPLY_PROTOCOL=1" in lines
    ps = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    assert "$JHT_DESKTOP_APPLY_PROTOCOL = 1" in ps.splitlines()
    # dispatched like agent-control, ahead of the generic branch, and not treated as a request for help
    source = WRAPPER.read_text(encoding="utf-8")
    assert re.search(r"\n  desktop-apply\)\n    shift \|\| true\n    desktop_apply \"\$@\"\n    ;;\n", source)
    assert "'desktop-apply' {\n    Invoke-DesktopApply $Rest\n    exit $script:DesktopApplyExitCode\n  }" in ps
    assert "'agent-control', 'desktop-apply')" in ps


needs_powershell = pytest.mark.skipif(os.name != "nt" and shutil.which("pwsh") is None, reason="needs PowerShell")
