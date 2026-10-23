"""`jht apply request|cancel` in the host's terminal records the authorisation in the broker.

The container shows the preview and its digest, the person confirms in a real terminal, the
container writes the flag only for the position that was seen, and the host records the instant
and the destination in the broker. Every field from the container is closed again on the host
before it reaches a command line. Synthetic only: a fake `docker`, no container, no broker.
"""

from __future__ import annotations

import errno
import os
import pty
import re
import select
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
DIGEST = "ab" * 32
INSTANT = "2026-10-23T18:04:05.123Z"

FAKE_DOCKER = r"""#!/bin/sh
printf 'ARGV %s\n' "$*" >> "$FAKE_LOG"
[ "$1" = exec ] || exit 0
shift
while [ $# -gt 0 ]; do case "$1" in -i|-it) shift ;; *) break ;; esac; done
target="$1"; shift
tab=$(printf '\t')
case "$target:$*" in
  agent-id:"python3 /app/shared/skills/apply_request.py show 4 --host")
    printf '1%sauthorisable%s%s%s%s%s-%sSynthetic role @ Synthetic company · jobs.example.com\n' \
      "$tab" "$tab" "$FAKE_CONFIRM" "$tab" "$FAKE_SHOW_DESTINATION" "$tab" "$tab" ;;
  agent-id:"python3 /app/shared/skills/apply_request.py request 4 --expect $FAKE_CONFIRM --host")
    printf 'REQUEST\n' >> "$FAKE_LOG"
    printf '1%sauthorised%s-%s%s%s%s%s-\n' "$tab" "$tab" "$tab" "$FAKE_REQUEST_DESTINATION" "$tab" "$FAKE_INSTANT" "$tab" ;;
  agent-id:"python3 /app/shared/skills/apply_request.py cancel 4 --host")
    printf 'CANCEL\n' >> "$FAKE_LOG"
    printf '1%swithdrawn%s-%s-%s-%s-\n' "$tab" "$tab" "$tab" "$tab" "$tab" ;;
  broker-id:"jht-broker-admin apply record "*)
    printf 'RECORD %s\n' "$*" >> "$FAKE_LOG"
    [ "${FAKE_BROKER_RC:-0}" = 0 ] && printf '{"ok": true, "status": "recorded"}\n'
    exit "${FAKE_BROKER_RC:-0}" ;;
  *) printf 'UNEXPECTED %s:%s\n' "$target" "$*" >> "$FAKE_LOG"; exit 97 ;;
esac
"""


def functions(*names: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    found = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
        assert match, name
        found.append(match.group(0))
    return "\n".join(found)


def script(command: str) -> str:
    return (
        'set -u\nerr() { echo "error: $*" >&2; }\ninfo() { echo "info: $*" >&2; }\n'
        "ATTESTED_CONTAINER_ID=agent-id\nBROKER_SERVICE=jht-broker\n"
        'read_only_service_id() { [ "$1" = jht-broker ] && echo broker-id; }\n'
        "compose_unreadable() { return 1; }\ncompose_lacks_service() { return 1; }\n"
        + functions("broker_admin", "apply_skill", "apply_host_command")
        + "\n" + command + "\n"
    )


@pytest.fixture
def fake(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    log.write_text("")
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_LOG": str(log),
        "FAKE_CONFIRM": DIGEST,
        "FAKE_SHOW_DESTINATION": "web:example.com",
        "FAKE_REQUEST_DESTINATION": "web:example.com",
        "FAKE_INSTANT": INSTANT,
    }
    return env, log


def in_terminal(command: str, env: dict, answer: str | None) -> tuple[int, str]:
    """The command in a real terminal; `answer` is typed when the question appears."""
    master, slave = pty.openpty()
    process = subprocess.Popen(["bash", "-c", script(command)], stdin=slave, stdout=slave, stderr=slave,
                               env=env, close_fds=True)
    os.close(slave)
    output, typed = b"", False
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline:
            if answer is not None and not typed and b"[s/N]" in output:
                os.write(master, (answer + "\n").encode())
                typed = True
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(master, 4096)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output += chunk
            elif process.poll() is not None:
                break
        process.wait(timeout=5)
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
    return process.returncode, output.decode(errors="replace")


def calls(log: Path) -> list[str]:
    return [line for line in log.read_text().splitlines() if not line.startswith("ARGV ")]


def test_a_confirmed_request_is_recorded_in_the_broker_with_the_previews_destination(fake):
    env, log = fake
    code, out = in_terminal("apply_host_command request 4", env, "s")
    assert code == 0, out
    assert "Synthetic role @ Synthetic company · jobs.example.com" in out
    assert calls(log) == ["REQUEST", f"RECORD jht-broker-admin apply record 4 {INSTANT} web:example.com"]


def test_no_yes_no_authorisation(fake):
    env, log = fake
    code, out = in_terminal("apply_host_command request 4", env, "n")
    assert code == 1 and "niente autorizzato" in out
    assert calls(log) == []


def test_without_a_terminal_nothing_is_asked_nor_written(fake):
    env, log = fake
    done = subprocess.run(["bash", "-c", script("apply_host_command request 4")], env=env,
                          stdin=subprocess.DEVNULL, capture_output=True, text=True)
    assert done.returncode == 1 and "Serve un terminale" in done.stderr
    assert calls(log) == []


@pytest.mark.parametrize("field,value", [
    ("FAKE_SHOW_DESTINATION", "web:x';reboot"),
    ("FAKE_SHOW_DESTINATION", "https://example.com"),
    ("FAKE_CONFIRM", "short"),
])
def test_a_preview_whose_fields_are_not_closed_stops_before_the_question(fake, field, value):
    env, log = fake
    env[field] = value
    code, out = in_terminal("apply_host_command request 4", env, "s")
    assert code == 1 and "[s/N]" not in out
    assert not any(line.startswith(("REQUEST", "RECORD")) for line in calls(log))


@pytest.mark.parametrize("field,value", [
    ("FAKE_REQUEST_DESTINATION", "portal:linkedin"),
    ("FAKE_INSTANT", "yesterday"),
])
def test_a_write_that_is_not_the_one_confirmed_is_withdrawn_and_never_recorded(fake, field, value):
    env, log = fake
    env[field] = value
    code, out = in_terminal("apply_host_command request 4", env, "s")
    assert code == 1
    assert calls(log) == ["REQUEST", "CANCEL"]


def test_a_broker_that_does_not_record_withdraws_the_flag(fake):
    env, log = fake
    env["FAKE_BROKER_RC"] = "1"
    code, out = in_terminal("apply_host_command request 4", env, "s")
    assert code == 1 and "broker non ha registrato" in out
    assert calls(log)[-1] == "CANCEL"


@pytest.mark.parametrize("pid", ["0", "04", "4;rm", "", "12345678901"])
def test_the_position_id_is_closed(fake, pid):
    env, log = fake
    done = subprocess.run(["bash", "-c", script(f"apply_host_command request '{pid}'")], env=env,
                          stdin=subprocess.DEVNULL, capture_output=True, text=True)
    assert done.returncode == 2
    assert calls(log) == []


def test_a_withdrawal_needs_no_confirmation(fake):
    env, log = fake
    done = subprocess.run(["bash", "-c", script("apply_host_command cancel 4")], env=env,
                          stdin=subprocess.DEVNULL, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert calls(log) == ["CANCEL"]


def test_the_wrapper_routes_only_request_and_cancel_to_the_host():
    source = WRAPPER.read_text(encoding="utf-8")
    branch = source[source.index("\n  apply)\n"):]
    branch = branch[: branch.index("\n    ;;\n")]
    assert source.count("\n  apply)\n") == 1, "one branch only: a second one would never run"
    assert 'request|cancel) apply_host_command "$2" "${3:-}"; exit $? ;;' in branch
    assert 'node "$NODE_ENTRY" "$@"' in branch


POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"


def test_the_windows_wrapper_closes_the_same_fields_in_the_same_order():
    # Read as the file is, CRLF or not: a regex across lines would be red only on Windows.
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8").replace("\r\n", "\n")
    body = source[source.index("function Invoke-ApplyHostCommand {"):]
    body = body[: body.index("\n}\n")]
    order = [
        "$id -cnotmatch '^[1-9][0-9]{0,9}$'",
        "$confirm -cnotmatch '^[0-9a-f]{64}$'",
        "$shownDestination -cnotmatch '^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$'",
        "[Console]::IsInputRedirected",
        "Read-Host",
        "@('request', $id, '--expect', $confirm)",
        "$destination -cne $shownDestination",
        "Invoke-BrokerAdmin -InputText '' apply record $id $instant $destination",
    ]
    positions = [body.index(piece) for piece in order]
    assert positions == sorted(positions)
    # every refusal after the write withdraws it again
    assert body.count("$null = Invoke-ApplySkill $containerId @('cancel', $id)") == 2
    assert source.count("\n  'apply' {\n") == 1, "one branch only: PowerShell runs every matching one"
    dispatch = source[source.index("\n  'apply' {\n"):]
    dispatch = dispatch[: dispatch.index("\n  }\n")]
    assert "@('request', 'cancel') -ccontains [string]$Rest[0]" in dispatch
    assert "exit (Invoke-ApplyHostCommand $Rest)" in dispatch
