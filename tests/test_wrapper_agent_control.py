"""`jht agent-control`: the desktop's agent control panel through the host wrapper.

The branch never starts anything (no ensure_up, no compose up, no machine
start): with the container down or not attested it answers the closed code
agent_control_no_team (113), and otherwise it passes the arguments, as argv and
without a TTY, to the CLI in the attested container, with its stdout and exit
code unchanged.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess

import pytest

from test_desktop_chat_wrapper import _runtime


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
NO_TEAM = '{"ok":false,"error":"agent_control_no_team"}\n'

# The CLI in the container, as the fake docker answers it: every argv item on
# its own line in the log, then the reply and the exit code the test chose.
AGENT_CONTROL_EXEC = """      node:/app/cli/bin/jht.js)
        for value in "$@"; do printf 'argv %s\\n' "$value" >> "$JHT_TEST_DOCKER_LOG"; done
        printf '%s\\n' "${JHT_TEST_AGENT_REPLY:-}"
        exit "${JHT_TEST_AGENT_EXIT:-0}" ;;
"""

STARTS = (" up", "machine start", "start ", " run ", "create", "pull", "recreate", "compose up")


def _panel_runtime(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    adapter = runtime / "bin" / "docker"
    source = adapter.read_text(encoding="utf-8")
    anchor = "      node:*)\n"
    assert source.count(anchor) == 1
    adapter.write_text(source.replace(anchor, AGENT_CONTROL_EXEC + anchor), encoding="utf-8")
    manifest = runtime / ".runtime-integrity"
    digest = hashlib.sha256(adapter.read_bytes()).hexdigest()
    manifest.write_text(
        "\n".join(
            f"docker-shim={digest}" if line.startswith("docker-shim=") else line
            for line in manifest.read_text(encoding="utf-8").splitlines()
        )
        + "\n",
        encoding="utf-8",
    )
    return wrapper, env, log


def _run(wrapper: Path, env: dict[str, str], *argv: str):
    return subprocess.run(
        [str(wrapper), "agent-control", *argv],
        env=env,
        text=True,
        capture_output=True,
        timeout=20,
        check=False,
    )


def _calls(log: Path) -> list[str]:
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def _argv(log: Path) -> list[str]:
    return [line[len("argv "):] for line in _calls(log) if line.startswith("argv ")]


def _nothing_started(log: Path) -> None:
    for line in _calls(log):
        if line.startswith("podman-compose") and "--dry-run" in line:
            continue
        assert not any(word in line for word in STARTS), line


@pytest.mark.parametrize(
    "down",
    (
        {},  # the Podman machine is not up: docker is not reachable
        {"JHT_TEST_RUNTIME_READY": "1", "JHT_TEST_PS_IDS": ""},  # no container
        {"JHT_TEST_RUNTIME_READY": "1", "JHT_TEST_INSPECT_DETAILS": "jht|false|jht|jht|jht|jht|1|x|y|1.6.0|z|w"},
    ),
)
def test_with_the_team_down_it_answers_no_team_and_starts_nothing(tmp_path: Path, down: dict[str, str]):
    wrapper, env, log = _panel_runtime(tmp_path)
    env.update(down)
    result = _run(wrapper, env, "list")
    assert (result.returncode, result.stdout) == (113, NO_TEAM), result.stderr
    assert _argv(log) == []
    _nothing_started(log)


def test_a_help_among_its_arguments_is_not_help(tmp_path: Path):
    wrapper, env, log = _panel_runtime(tmp_path)
    result = _run(wrapper, env, "stop", "--help")
    assert (result.returncode, result.stdout) == (113, NO_TEAM)
    _nothing_started(log)


def test_with_the_team_up_it_passes_argv_and_answer_through(tmp_path: Path):
    wrapper, env, log = _panel_runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    reply = '{"ok":false,"op":"start","session":"SCOUT-2","error":"agent_contained"}'
    env["JHT_TEST_AGENT_REPLY"] = reply
    env["JHT_TEST_AGENT_EXIT"] = "111"
    result = _run(wrapper, env, "stop", "SCOUT-1")
    assert result.returncode == 111, result.stderr
    assert result.stdout == reply + "\n"
    assert _argv(log) == ["node", "/app/cli/bin/jht.js", "agent-control", "stop", "SCOUT-1"]
    execs = [line for line in _calls(log) if line.startswith("docker exec")]
    assert len(execs) == 1
    # no TTY, the attested container id, never a name
    assert execs[0].startswith("docker exec -i -e JHT_HOST_TYPE=")
    assert " -it " not in execs[0]
    assert "aaaaaaaaaaaa node /app/cli/bin/jht.js agent-control" in execs[0]
    assert "same-name-decoy" not in "\n".join(_calls(log))
    _nothing_started(log)


def test_arguments_stay_single_argv_items(tmp_path: Path):
    wrapper, env, log = _panel_runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    result = _run(wrapper, env, "stop", "SCOUT-1; touch /tmp/x", "a b", "$(id)")
    assert result.returncode == 0, result.stderr
    assert _argv(log)[3:] == ["stop", "SCOUT-1; touch /tmp/x", "a b", "$(id)"]


def test_the_protocol_marker_is_published():
    lines = WRAPPER.read_text(encoding="utf-8").splitlines()
    assert "JHT_AGENT_CONTROL_PROTOCOL=1" in lines
    assert "$JHT_AGENT_CONTROL_PROTOCOL = 1" in POWERSHELL_WRAPPER.read_text(encoding="utf-8").splitlines()


def _ps_function(text: str) -> str:
    start = text.index("function Invoke-AgentControl")
    return text[start:text.index("\n}\n", start)]


def test_the_powershell_branch_reads_and_never_starts():
    # pwsh is not on every test host: the PowerShell wrapper is held by its
    # source, as tests/test_windows_desktop_local_runtime.py does.
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    body = _ps_function(text)
    assert "Test-RuntimeBundleTrusted" in body
    assert "Get-RunningComposeServiceId $Container" in body
    assert "[Console]::Out.WriteLine('{\"ok\":false,\"error\":\"agent_control_no_team\"}')" in body
    assert (
        '& docker exec -i -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $containerId node $NodeEntry agent-control @ControlArgs'
        in body
    )
    for forbidden in ("Ensure-Up", "Invoke-Compose", "Start-PodmanMachineForUp", "@ExecFlags", "$Container node"):
        assert forbidden not in body
    assert "$script:AgentControlExitCode = 113" in text
    assert "'agent-control' {\n    Invoke-AgentControl $Rest\n    exit $script:AgentControlExitCode" in text
    assert "$Sub -notin @('game', 'gui', 'agent-control')" in text


def test_the_bash_branch_is_dispatched_before_the_generic_one():
    text = WRAPPER.read_text(encoding="utf-8")
    branch = text.index("  agent-control)\n    shift || true\n    agent_control \"$@\"\n")
    generic = text.index("\n  *)\n    require_compose_file\n    require_docker\n    ensure_up\n")
    assert branch < generic
    start = text.index("agent_control() {")
    body = text[start:text.index("\n}\n", start)]
    for forbidden in ("ensure_up", "compose_file", "podman machine", "$EXEC_FLAGS", "ATTESTED_CONTAINER_ID"):
        assert forbidden not in body
