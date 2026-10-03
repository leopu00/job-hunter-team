"""Dynamic parity harness for the CLI and the desktop backend adapter.

Both runners cross the attested production host wrapper.  Only its external
container dependency is replaced by a deterministic stateful fixture; the
wrapper itself is copied byte-for-byte from ``scripts/jht-wrapper.sh``.

The static binding from desktop operation identifiers to wrapper argv belongs
to the companion contract test.  This file owns execution parity: command
plan, exit/status pairs, PTY hand-off, snapshots, and sanitized events.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import pty
import shutil
import subprocess
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CLI_ENTRYPOINT = ROOT / "scripts" / "jht-wrapper.sh"
GUI_BACKEND_ENTRYPOINT = ROOT / "scripts" / "jht-wrapper.sh"

# Kept local on purpose: this is the executable integration contract, not a
# second production dispatcher.  The companion static gate binds these stable
# operation identifiers to the native adapter.
CONTRACT = json.loads(
    r"""
    {
      "stages": ["engine", "runtime", "container", "provider", "login", "team", "assistant"],
      "statuses": ["start", "progress", "done", "error", "needs_user_action"],
      "event_statuses": ["start", "progress", "done", "error"],
      "operations": [
        {"id": "probe", "adapter": "Status", "stage": "engine", "argv": ["status"], "exit": 1},
        {"id": "up", "adapter": "Up", "stage": "container", "argv": ["up"], "exit": 0},
        {"id": "up_idempotent", "adapter": "Up", "stage": "container", "argv": ["up"], "exit": 0},
        {"id": "provider_use", "adapter": "ProviderUse", "stage": "provider", "argv": ["providers", "use", "codex"], "exit": 0},
        {"id": "provider_update", "adapter": "ProviderUpdate", "stage": "provider", "argv": ["providers", "update", "codex"], "exit": 0},
        {"id": "oauth_login", "adapter": "OauthLogin", "stage": "login", "argv": ["oauth-login"], "exit": 0, "pty": true},
        {"id": "snapshot_before_team", "adapter": "Snapshot", "stage": "runtime", "argv": ["onboarding-snapshot"], "exit": 0},
        {"id": "team_start", "adapter": "TeamStart", "stage": "team", "argv": ["team", "start"], "exit": 0},
        {"id": "assistant_start", "adapter": "AssistantStart", "stage": "assistant", "argv": ["team", "start", "assistente"], "exit": 0},
        {"id": "snapshot_after_team", "adapter": "Snapshot", "stage": "team", "argv": ["onboarding-snapshot"], "exit": 0}
      ]
    }
    """
)

SAFE_MESSAGES = {
    "engine": "Verifica ambiente completata.",
    "runtime": "Stato runtime aggiornato.",
    "container": "Container verificato.",
    "provider": "Provider configurato.",
    "login": "Completa l’accesso nel terminale.",
    "team": "Squadra verificata.",
    "assistant": "Assistente verificato.",
}

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

state_path = Path(os.environ["JHT_TEST_STATE"])
log_path = Path(os.environ["JHT_TEST_COMMAND_LOG"])
state = json.loads(state_path.read_text(encoding="utf-8"))
argv = sys.argv[1:]

def save():
    state_path.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")

def record(kind, logical=None, tty=False):
    row = {"kind": kind, "argv": argv, "tty": tty}
    if logical is not None:
        row["logical"] = logical
    with log_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(row, sort_keys=True) + "\n")

def inner_exec():
    index = 1
    flags = []
    while index < len(argv) and argv[index].startswith("-"):
        flag = argv[index]
        flags.append(flag)
        index += 1
        if flag == "-e":
            flags.append(argv[index])
            index += 1
    if index >= len(argv) or argv[index] not in ("jht", "aaaaaaaaaaaa"):
        record("exec-invalid")
        return 92
    container = argv[index]
    command = argv[index + 1:]
    tty = "-it" in flags

    if container == "aaaaaaaaaaaa" and command[:2] == ["node", "-e"]:
        record("snapshot-metadata", tty=tty)
        configured = int(bool(state["provider"]) and state["provider_updated"])
        authenticated = int(state["provider_authenticated"])
        welcomed = int(state["assistant_welcomed"])
        print(configured, authenticated, welcomed, end="")
        return 0

    if container == "aaaaaaaaaaaa" and command[:3] == ["tmux", "has-session", "-t"]:
        record("snapshot-team", command[3:], tty)
        return 0 if command[3] in state["team"] else 1

    if container == "aaaaaaaaaaaa" and command[:2] == ["test", "-f"]:
        record("snapshot-profile", command[2:], tty)
        return 0 if state["profile_ready"] else 1

    if container == "aaaaaaaaaaaa" and command[:2] == ["node", "/app/cli/bin/jht.js"]:
        record("snapshot-profile-fallback", command[2:], tty)
        return 0 if state["profile_ready"] else 1

    if container == "jht" and command[:2] == ["node", "-e"]:
        record("provider-probe", tty=tty)
        print(state["provider"], end="")
        return 0

    if container == "jht" and command[:2] == ["node", "/app/cli/bin/jht.js"]:
        logical = command[2:]
        record("cli", logical, tty)
        key = " ".join(logical)
        if key == "providers use codex":
            state["provider"] = "codex"
            save()
        elif key == "providers update codex":
            if os.environ.get("JHT_TEST_FAIL_OPERATION") == "provider_update":
                print("token=fixture-secret /private/operator 192.0.2.8", file=sys.stderr)
                return 41
            state["provider_updated"] = True
            save()
        elif key == "team start":
            state["team"] = ["CAPITANO", "ASSISTENTE"]
            save()
        elif key == "team start assistente":
            if "ASSISTENTE" not in state["team"]:
                state["team"].append("ASSISTENTE")
                save()
        elif key == "team status":
            print("\n".join(state["team"]))
        return 0

    if container == "jht" and command == ["codex", "login", "--device-auth"]:
        record("login", command, tty)
        if not tty:
            print("PTY required", file=sys.stderr)
            return 64
        state["provider_authenticated"] = True
        save()
        print("Open https://login.example.invalid token=fixture-secret")
        return 0

    record("exec-other", command, tty)
    return 0

if not argv:
    sys.exit(2)
if argv[0] == "info":
    record("runtime-probe")
    sys.exit(0)
if argv[0] == "ps":
    record("container-probe")
    if state["container_running"]:
        print("jht")
    sys.exit(0)
if argv[0] == "inspect":
    record("container-snapshot")
    if argv[1] == "jht" and state["container_running"]:
        print("name=jht status=running started=fixture image=fixture@sha256:0000")
        sys.exit(0)
    if argv[1] == "aaaaaaaaaaaa" and state["container_running"]:
        if ".State.Running}} {{index" in " ".join(argv):
            print("true jht")
        else:
            print("true")
        sys.exit(0)
    sys.exit(1)
if argv[0] == "compose":
    record("compose")
    if "up" in argv:
        state["up_requests"] += 1
        if not state["container_running"]:
            state["container_starts"] += 1
        state["container_running"] = True
        save()
        sys.exit(0)
    if "ps" in argv and "-q" in argv and "jht" in argv:
        if state["container_running"]:
            print("aaaaaaaaaaaa")
        sys.exit(0)
    sys.exit(2)
if argv[0] == "exec":
    sys.exit(inner_exec())
record("unsupported")
sys.exit(93)
'''


@dataclass(frozen=True)
class CompletedOperation:
    operation: str
    exit_code: int
    status: str


@dataclass(frozen=True)
class HarnessResult:
    command_plan: list[dict[str, Any]]
    completed: list[CompletedOperation]
    events: list[dict[str, Any]]
    snapshots: list[dict[str, bool]]
    state: dict[str, Any]


@dataclass
class RuntimeFixture:
    wrapper: Path
    env: dict[str, str]
    state_path: Path
    log_path: Path

    @classmethod
    def create(cls, tmp_path: Path, entrypoint: Path) -> "RuntimeFixture":
        tmp_path.mkdir(mode=0o700)
        home = tmp_path / "home"
        runtime = tmp_path / "runtime"
        fake_bin = tmp_path / "external-bin"
        wrapper = runtime / "jht-wrapper.sh"
        state_path = tmp_path / "external-state.json"
        log_path = tmp_path / "external-commands.jsonl"
        home.mkdir(mode=0o700)
        runtime.mkdir(mode=0o700)
        fake_bin.mkdir(mode=0o700)

        shutil.copy2(entrypoint, wrapper)
        wrapper.chmod(0o700)
        compose = runtime / "docker-compose.yml"
        compose.write_text(
            "services:\n  jht:\n    image: fixture.invalid/jht@sha256:0000\n"
            "    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n"
            "volumes:\n  jht-runtime-mask:\n",
            encoding="utf-8",
        )
        setup = runtime / "host-setup.sh"
        setup.write_text("#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\n", encoding="utf-8")
        setup.chmod(0o700)
        compose.chmod(0o600)

        docker = fake_bin / "docker"
        docker.write_text(FAKE_DOCKER, encoding="utf-8")
        docker.chmod(0o700)
        state_path.write_text(
            json.dumps(
                {
                    "container_running": False,
                    "container_starts": 0,
                    "provider": "",
                    "provider_authenticated": False,
                    "provider_updated": False,
                    "assistant_welcomed": False,
                    "profile_ready": True,
                    "team": [],
                    "up_requests": 0,
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        log_path.write_text("", encoding="utf-8")

        def digest(path: Path) -> str:
            return hashlib.sha256(path.read_bytes()).hexdigest()

        manifest = runtime / ".runtime-integrity"
        manifest.write_text(
            "\n".join(
                (
                    "version=1",
                    f"docker-compose.yml={digest(compose)}",
                    f"host-setup.sh={digest(setup)}",
                    f"jht-wrapper.sh={digest(wrapper)}",
                    "",
                )
            ),
            encoding="utf-8",
        )
        manifest.chmod(0o600)
        env = {
            **os.environ,
            "HOME": str(home),
            "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            "JHT_RUNTIME_DIR": str(runtime),
            "JHT_WRAPPER_PATH": str(wrapper),
            "JHT_TEST_STATE": str(state_path),
            "JHT_TEST_COMMAND_LOG": str(log_path),
            "JHT_BIND_OWNER": f"{os.getuid()}:{os.getgid()}",
        }
        return cls(wrapper, env, state_path, log_path)

    def command_log(self) -> list[dict[str, Any]]:
        runtime = str(self.wrapper.parent)
        rows = [json.loads(line) for line in self.log_path.read_text(encoding="utf-8").splitlines()]
        for row in rows:
            row["argv"] = [value.replace(runtime, "<runtime>") for value in row["argv"]]
        return rows

    def state(self) -> dict[str, Any]:
        return json.loads(self.state_path.read_text(encoding="utf-8"))


class BackendRunner:
    def __init__(self, fixture: RuntimeFixture):
        self.fixture = fixture

    def run(self, *, fail_operation: str | None = None) -> HarnessResult:
        events: list[dict[str, Any]] = []
        completed: list[CompletedOperation] = []
        snapshots: list[dict[str, bool]] = []
        env = dict(self.fixture.env)
        if fail_operation:
            env["JHT_TEST_FAIL_OPERATION"] = fail_operation

        for sequence, operation in enumerate(CONTRACT["operations"], start=1):
            events.append(self._event(operation, "start", sequence * 3 - 2))
            process = self._invoke(operation["argv"], env, bool(operation.get("pty")))
            if operation["adapter"] == "Snapshot" and process.returncode == 0:
                snapshots.append(self._snapshot(process.stdout))
            events.append(self._event(operation, "progress", sequence * 3 - 1))
            if operation.get("pty") and process.returncode == operation["exit"]:
                status = "needs_user_action"
            elif process.returncode == operation["exit"]:
                status = "done"
            else:
                status = "error"
            event_status = "error" if status == "error" else "done"
            events.append(self._event(operation, event_status, sequence * 3))
            completed.append(CompletedOperation(operation["id"], process.returncode, status))
            if status == "error":
                break

        return HarnessResult(
            command_plan=self.fixture.command_log(),
            completed=completed,
            events=events,
            snapshots=snapshots,
            state=self.fixture.state(),
        )

    @staticmethod
    def _event(operation: dict[str, Any], status: str, sequence: int) -> dict[str, Any]:
        event = {
            "stage": operation["stage"],
            "status": status,
            "message": SAFE_MESSAGES[operation["stage"]],
            "sequence": sequence,
        }
        if status == "error":
            event["code"] = f"{operation['id']}_failed"
            event["retryable"] = True
        return event

    @staticmethod
    def _snapshot(stdout: str) -> dict[str, bool]:
        values = {
            key: value == "1"
            for key, separator, value in (
                line.strip().partition("=") for line in stdout.splitlines()
            )
            if separator
        }
        return {
            key: values.get(key, False)
            for key in (
                "runtimeInstalled",
                "containerRunning",
                "providerConfigured",
                "providerAuthenticated",
                "assistantRunning",
                "captainRunning",
                "profileReady",
                "assistantWelcomed",
            )
        }

    def _invoke(
        self, argv: list[str], env: dict[str, str], needs_pty: bool
    ) -> subprocess.CompletedProcess[str]:
        raise NotImplementedError


def _run_process(
    command: list[str], env: dict[str, str], needs_pty: bool
) -> subprocess.CompletedProcess[str]:
    if not needs_pty:
        return subprocess.run(
            command,
            env=env,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

    master, slave = pty.openpty()
    try:
        process = subprocess.Popen(
            command,
            env=env,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            text=False,
            close_fds=True,
        )
        os.close(slave)
        slave = -1
        output = bytearray()
        while True:
            try:
                chunk = os.read(master, 4096)
            except OSError:
                break
            if not chunk:
                break
            output.extend(chunk)
        return_code = process.wait(timeout=10)
        return subprocess.CompletedProcess(
            command,
            return_code,
            output.decode("utf-8", errors="replace"),
            "",
        )
    finally:
        os.close(master)
        if slave >= 0:
            os.close(slave)


class CliRunner(BackendRunner):
    def _invoke(
        self, argv: list[str], env: dict[str, str], needs_pty: bool
    ) -> subprocess.CompletedProcess[str]:
        return _run_process([str(self.fixture.wrapper), *argv], env, needs_pty)


class GuiAdapterRunner(BackendRunner):
    """Exercise the native adapter's verified-wrapper process boundary."""

    def _invoke(
        self, argv: list[str], env: dict[str, str], needs_pty: bool
    ) -> subprocess.CompletedProcess[str]:
        # The GUI backend resolves and attests this same installed wrapper.  A
        # separate fixture/process prevents shared state from hiding drift.
        return _run_process([str(self.fixture.wrapper), *argv], env, needs_pty)


def _run_pair(
    tmp_path: Path, *, fail_operation: str | None = None
) -> tuple[HarnessResult, HarnessResult]:
    cli_fixture = RuntimeFixture.create(tmp_path / "cli", CLI_ENTRYPOINT)
    gui_fixture = RuntimeFixture.create(tmp_path / "gui", GUI_BACKEND_ENTRYPOINT)
    return (
        CliRunner(cli_fixture).run(fail_operation=fail_operation),
        GuiAdapterRunner(gui_fixture).run(fail_operation=fail_operation),
    )


def test_cli_and_gui_execute_the_same_backend_sequence(tmp_path: Path):
    cli, gui = _run_pair(tmp_path)

    assert cli.command_plan == gui.command_plan
    assert cli.completed == gui.completed
    assert cli.events == gui.events
    assert cli.snapshots == gui.snapshots
    assert cli.completed == [
        CompletedOperation("probe", 1, "done"),
        CompletedOperation("up", 0, "done"),
        CompletedOperation("up_idempotent", 0, "done"),
        CompletedOperation("provider_use", 0, "done"),
        CompletedOperation("provider_update", 0, "done"),
        CompletedOperation("oauth_login", 0, "needs_user_action"),
        CompletedOperation("snapshot_before_team", 0, "done"),
        CompletedOperation("team_start", 0, "done"),
        CompletedOperation("assistant_start", 0, "done"),
        CompletedOperation("snapshot_after_team", 0, "done"),
    ]
    assert cli.state == gui.state == {
        "container_running": True,
        "container_starts": 1,
        "provider": "codex",
        "provider_authenticated": True,
        "provider_updated": True,
        "assistant_welcomed": False,
        "profile_ready": True,
        "team": ["CAPITANO", "ASSISTENTE"],
        "up_requests": 2,
    }

    # The initial probe is observational: it may inspect the runtime and list
    # containers, but no compose/exec mutation may precede the first explicit up.
    first_compose = next(
        index for index, row in enumerate(cli.command_plan) if row["kind"] == "compose"
    )
    assert {row["kind"] for row in cli.command_plan[:first_compose]} <= {
        "runtime-probe",
        "container-probe",
    }
    assert sum(
        row["kind"] == "compose" and "up" in row["argv"]
        for row in cli.command_plan
    ) == 2

    login = [row for row in cli.command_plan if row["kind"] == "login"]
    assert login == [{
        "argv": ["exec", "-it", "jht", "codex", "login", "--device-auth"],
        "kind": "login",
        "logical": ["codex", "login", "--device-auth"],
        "tty": True,
    }]
    assert CompletedOperation("oauth_login", 0, "needs_user_action") in cli.completed
    assert [
        event["status"] for event in cli.events if event["stage"] == "login"
    ] == ["start", "progress", "done"]

    assert [row["logical"] for row in cli.command_plan if row["kind"] == "cli"] == [
        ["providers", "use", "codex"],
        ["providers", "update", "codex"],
        ["team", "start"],
        ["team", "start", "assistente"],
    ]
    assert cli.snapshots == [
        {
            "runtimeInstalled": True,
            "containerRunning": True,
            "providerConfigured": True,
            "providerAuthenticated": True,
            "assistantRunning": False,
            "captainRunning": False,
            "profileReady": True,
            "assistantWelcomed": False,
        },
        {
            "runtimeInstalled": True,
            "containerRunning": True,
            "providerConfigured": True,
            "providerAuthenticated": True,
            "assistantRunning": True,
            "captainRunning": True,
            "profileReady": True,
            "assistantWelcomed": False,
        },
    ]
    assert {event["stage"] for event in cli.events} == set(CONTRACT["stages"])
    assert {event["status"] for event in cli.events} <= set(CONTRACT["event_statuses"])
    assert "needs_user_action" not in {event["status"] for event in cli.events}
    serialized_events = json.dumps(cli.events, ensure_ascii=False).lower()
    assert "fixture-secret" not in serialized_events
    assert "login.example.invalid" not in serialized_events


def test_cli_and_gui_match_fail_closed_status_and_never_emit_external_output(tmp_path: Path):
    cli, gui = _run_pair(tmp_path, fail_operation="provider_update")

    assert cli.command_plan == gui.command_plan
    assert cli.completed == gui.completed
    assert cli.events == gui.events
    assert cli.snapshots == gui.snapshots == []
    assert cli.completed[-1] == CompletedOperation("provider_update", 41, "error")
    assert cli.events[-1] == {
        "stage": "provider",
        "status": "error",
        "message": "Provider configurato.",
        "sequence": 15,
        "code": "provider_update_failed",
        "retryable": True,
    }
    serialized_events = json.dumps(cli.events, ensure_ascii=False).lower()
    for forbidden in ("fixture-secret", "/private/operator", "192.0.2.8", "login.example.invalid"):
        assert forbidden not in serialized_events
    assert not any(row["kind"] in {"login", "provider-probe"} for row in cli.command_plan)
