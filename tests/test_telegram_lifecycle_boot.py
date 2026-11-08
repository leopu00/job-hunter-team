"""The actual VM unit delegates boot policy and confirms its engine effects."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

import pytest

from test_telegram_lifecycle import ROOT, PLANNER, lifecycle_home
from shared.telegram_service import lifecycle_state


ENGINE = r'''
import os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
i = next(n for n, value in enumerate(args) if value in ('exec','inspect','start','stop'))
operation, rest = args[i], args[i+1:]
state = Path(os.environ['ENGINE_STATE'])
if operation == 'exec':
    payload = sys.stdin.read()
    # Record the completed pipe handoff, not the concurrent process launch.
    with open(os.environ['EVENTS'], 'a') as log:
        log.write(operation + '\n')
    index = rest.index('-I')
    raise SystemExit(subprocess.run([sys.executable, '-I', os.environ['PLANNER'], *rest[index+2:]], input=payload, text=True).returncode)
with open(os.environ['EVENTS'], 'a') as log:
    log.write(operation + '\n')
if operation == 'inspect':
    print(state.read_text())
elif os.environ.get('NO_EFFECT') != operation:
    state.write_text('true' if operation == 'start' else 'false')
'''


def run_unit(home, *, configured, running=False, no_effect="", corrupt=False):
    lifecycle_state.publish(configured)
    metadata = home / "socket/lifecycle.json"
    if corrupt:
        metadata.chmod(0o600)
        metadata.write_text("broken", encoding="utf-8")
        metadata.chmod(0o444)
    engine = home / "podman"
    engine.write_text('#!' + sys.executable + '\n' + ENGINE, encoding="utf-8")
    engine.chmod(0o700)
    state, events = home / "engine-state", home / "events"
    state.write_text("true" if running else "false", encoding="utf-8")
    source = (ROOT / "scripts/enable-podman-windows-runtime.ps1").read_text()
    lines = [line for line in source.splitlines() if line.startswith("ExecStartPost=")]
    assert len(lines) == 1
    # systemd unescapes %% and $$ before handing the one shell argument over.
    command = shlex.split(lines[0].removeprefix("ExecStartPost=").replace("%%", "%").replace("$$", "$"))
    assert command[:2] == ["/bin/sh", "-ec"]
    assert command[2].count("/usr/bin/podman") == 1
    command[2] = command[2].replace("/usr/bin/podman", shlex.quote(str(engine)))
    result = subprocess.run(command, env={**os.environ, "PLANNER": str(PLANNER),
        "ENGINE_STATE": str(state), "EVENTS": str(events), "NO_EFFECT": no_effect},
        text=True, capture_output=True, timeout=30)
    return result, events.read_text().splitlines(), state.read_text()


@pytest.mark.parametrize(("configured", "running", "expected", "final"), [
    (False, False, ["inspect", "exec"], "false"),
    (True, False, ["inspect", "exec", "start", "inspect", "exec"], "true"),
    (False, True, ["inspect", "exec", "stop", "inspect", "exec"], "false"),
    (True, True, ["inspect", "exec"], "true"),
])
def test_unit_uses_the_private_configuration_hint_and_real_engine_observation(lifecycle_home, configured, running, expected, final):
    result, events, state = run_unit(lifecycle_home, configured=configured, running=running)
    assert result.returncode == 0, result.stdout + result.stderr
    assert events == expected
    assert state == final
    public = json.loads((lifecycle_home / "socket/lifecycle.json").read_text())
    assert public == {"version": 1, "configured": configured}


@pytest.mark.parametrize("operation", ["start", "stop"])
def test_unit_rejects_rc_zero_without_the_requested_effect(lifecycle_home, operation):
    result, events, _state = run_unit(lifecycle_home, configured=operation == "start",
                                    running=operation == "stop", no_effect=operation)
    assert result.returncode != 0
    assert events == ["inspect", "exec", operation, "inspect", "exec"]
    assert "state_unconfirmed" in result.stderr


def test_unsafe_configuration_hint_refuses_before_any_start_or_stop(lifecycle_home):
    result, events, _state = run_unit(lifecycle_home, configured=True, corrupt=True)
    assert result.returncode != 0
    assert events == ["inspect", "exec"]
    assert "state_unreadable" in result.stderr


@pytest.mark.parametrize("configured", [False, True])
def test_health_targets_keep_telegram_mandatory_when_configured(lifecycle_home, configured):
    lifecycle_state.publish(configured)
    result = subprocess.run([sys.executable, "-I", str(PLANNER), "expected-services"],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["jht", "jht-broker"] + (["jht-telegram"] if configured else [])


@pytest.mark.parametrize("corruption", ["missing", "writable", "symlink", "wrong-owner", "invalid-schema"])
def test_boot_rejects_untrusted_public_state(lifecycle_home, corruption):
    lifecycle_state.publish(True)
    target = lifecycle_home / "socket/lifecycle.json"
    if corruption == "missing":
        target.unlink()
    elif corruption == "writable":
        target.chmod(0o644)
    elif corruption == "symlink":
        saved = target.with_suffix(".saved")
        target.rename(saved)
        target.symlink_to(saved)
    elif corruption == "invalid-schema":
        target.chmod(0o600)
        target.write_text('{"version":true,"configured":true}', encoding="utf-8")
        target.chmod(0o444)
    env = {**os.environ}
    if corruption == "wrong-owner":
        env["JHT_TELEGRAM_SERVICE_UID"] = str(os.getuid() + 1)
    result = subprocess.run([sys.executable, "-I", str(PLANNER), "boot"], input="0\nfalse",
                            env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 1 and result.stdout == ""
    assert "state_unreadable" in result.stderr
