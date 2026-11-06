"""Codex keeps its SQLite databases in the container's own volume, not in the host bind (docs/adr/0013).

On Windows the bind of ~/.jht is C:\\ seen through 9p, where a commit costs ~150x more than on the VM's disk and
seven agents opening the same WAL databases meet "database is locked". CODEX_SQLITE_HOME moves the six databases and
nothing else: auth.json (the one login), config.toml, version.json and sessions/ stay in the bind.
Synthetic folders only.
"""

from __future__ import annotations

import os
import re
import stat
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "docker-compose.yml"
DIRECTORIES = ROOT / ".launcher" / "agent-directories.sh"


def _service(name: str = "jht") -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"][name]


def _environment(service: dict) -> dict[str, str]:
    values: dict[str, str] = {}
    for item in service["environment"]:
        key, _, value = str(item).partition("=")
        values[key] = value
    return values


def test_the_compose_puts_the_codex_databases_in_the_deps_volume() -> None:
    service = _service()
    home = _environment(service)["CODEX_SQLITE_HOME"]
    assert home == "/opt/jht-deps/codex-state"
    # It is a volume of the VM, not a bind of the host: that is what makes it fast on Windows.
    mounts = [str(volume) for volume in service["volumes"]]
    assert "jht-deps:/opt/jht-deps" in mounts
    # A named volume has no path in front of it; a bind would start with one.
    assert not any(volume.endswith(":/opt/jht-deps") and volume[0] in "/$.~" for volume in mounts)
    # The directory the login lives in is not the one the databases move to.
    assert not home.startswith("/jht_home")


def test_the_login_and_the_rest_of_the_home_do_not_move() -> None:
    environment = _environment(_service())
    assert environment["HOME"] == "/jht_home"
    assert "CODEX_HOME" not in environment  # auth.json stays in /jht_home/.codex, one file for every agent


def test_the_other_services_do_not_get_the_variable() -> None:
    for name, service in yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"].items():
        if name == "jht":
            continue
        environment = _environment(service) if service.get("environment") else {}
        assert "CODEX_SQLITE_HOME" not in environment, name


def _run_block(cli: str, target: Path | None, logs: Path | None = None) -> subprocess.CompletedProcess[str]:
    assert target is not None or logs is not None, "use only synthetic folders"
    logs = logs if logs is not None else target.parent / "logs"
    root = logs.parent
    env = {
        "PATH": os.environ["PATH"], "CLI_BIN": cli, "ROLE": "analista",
        "JHT_HOME": str(root / "home"), "JHT_AGENTS_DIR": str(root / "agents"),
        "JHT_USER_DIR": str(root / "documents"), "JHT_LOGS_DIR": str(logs),
    }
    if target is not None:
        env["CODEX_SQLITE_HOME"] = str(target)
    return subprocess.run(
        ["bash", "-c", 'set -euo pipefail; source "$1"', "bash", str(DIRECTORIES)],
        env=env, capture_output=True, text=True, timeout=30,
    )


def test_the_launcher_makes_the_folder_for_codex_only_and_only_the_owner_reads_it(tmp_path: Path) -> None:
    target = tmp_path / "volume" / "codex-state"
    done = _run_block("codex", target)
    assert done.returncode == 0, done.stderr
    assert target.is_dir()
    assert stat.S_IMODE(target.stat().st_mode) == 0o700

    other = tmp_path / "volume" / "claude-state"
    assert _run_block("claude", other).returncode == 0
    assert not other.exists()


def test_without_the_variable_the_launcher_makes_nothing(tmp_path: Path) -> None:
    done = _run_block("codex", None, tmp_path / "logs")
    assert done.returncode == 0, done.stderr
    assert not (tmp_path / "home" / ".codex").exists()
    assert not list(tmp_path.rglob("*.sqlite"))


@pytest.mark.skipif(os.name == "nt", reason="the mode bits of a folder mean nothing on Windows")
def test_a_folder_that_cannot_be_made_is_said_and_does_not_stop_the_agent(tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("x")
    done = _run_block("codex", blocker / "inside", tmp_path / "logs")
    assert done.returncode == 0
    assert "cannot be created" in done.stdout


def _log_lines(logs: Path) -> list[str]:
    log = logs / "codex-state.log"
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def test_a_new_folder_is_written_to_the_log_once_and_not_again(tmp_path: Path) -> None:
    target, logs = tmp_path / "volume" / "codex-state", tmp_path / "logs"
    logs.mkdir()
    assert _run_block("codex", target, logs).returncode == 0
    lines = _log_lines(logs)
    assert len(lines) == 1
    assert re.match(r"^\[\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\] codex-state: new folder ", lines[0])
    assert str(target) in lines[0] and "analista" in lines[0]
    # Seven agents starting before Codex has made its first database: still one line.
    for _ in range(6):
        assert _run_block("codex", target, logs).returncode == 0
    assert len(_log_lines(logs)) == 1


def test_a_folder_that_already_has_databases_says_nothing(tmp_path: Path) -> None:
    target, logs = tmp_path / "volume" / "codex-state", tmp_path / "logs"
    target.mkdir(parents=True)
    logs.mkdir()
    (target / "state_5.sqlite").write_bytes(b"")
    assert _run_block("codex", target, logs).returncode == 0
    assert _log_lines(logs) == []
    assert not (target / ".announced").exists()


def test_seven_agents_starting_together_write_one_announcement(tmp_path: Path) -> None:
    target, logs = tmp_path / "volume" / "codex-state", tmp_path / "logs"
    with ThreadPoolExecutor(max_workers=7) as pool:
        results = list(pool.map(lambda _: _run_block("codex", target, logs), range(7)))
    assert all(result.returncode == 0 for result in results)
    assert len(_log_lines(logs)) == 1


def test_a_volume_that_comes_back_empty_is_written_again(tmp_path: Path) -> None:
    target, logs = tmp_path / "volume" / "codex-state", tmp_path / "logs"
    logs.mkdir()
    assert _run_block("codex", target, logs).returncode == 0
    (target / "state_5.sqlite").write_bytes(b"")
    assert _run_block("codex", target, logs).returncode == 0
    assert len(_log_lines(logs)) == 1
    # The volume is recreated: the folder and its marker are gone with it.
    for entry in list(target.iterdir()):
        if entry.is_dir():
            entry.rmdir()
        else:
            entry.unlink()
    target.rmdir()
    assert _run_block("codex", target, logs).returncode == 0
    assert len(_log_lines(logs)) == 2


def test_a_log_that_cannot_be_written_does_not_stop_the_agent_and_can_be_retried(tmp_path: Path) -> None:
    target, logs = tmp_path / "volume" / "codex-state", tmp_path / "logs"
    blocker = logs / "codex-state.log"
    blocker.mkdir(parents=True)
    done = _run_block("codex", target, logs)
    assert done.returncode == 0
    assert "cannot write the new-folder announcement" in done.stderr
    assert not (target / ".announced").exists()
    blocker.rmdir()
    assert _run_block("codex", target, logs).returncode == 0
    assert len(_log_lines(logs)) == 1
    assert (target / ".announced").is_dir()
    assert _run_block("codex", target, logs).returncode == 0
    assert len(_log_lines(logs)) == 1


def test_the_module_prepares_the_same_team_and_document_folders(tmp_path: Path) -> None:
    assert _run_block("claude", None, tmp_path / "logs").returncode == 0
    expected = ["home", "agents", "logs", "documents/cv", "documents/critiche",
                "documents/allegati", "documents/output"]
    assert all((tmp_path / folder).is_dir() for folder in expected)
