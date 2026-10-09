#!/usr/bin/env python3
"""Compare the merged Compose project emitted by JHT's two providers."""

from __future__ import annotations

import argparse
from copy import deepcopy
import difflib
from importlib import metadata
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any

import yaml


PODMAN_COMPOSE_VERSION = "1.6.0"
DOCKER_COMPOSE_VERSION = "5.1.2"
PROJECT = "jht"


class ComposeProviderParityError(RuntimeError):
    """The providers do not describe the same effective project."""


def _canonical_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    if re.match(r"^[A-Z]:/", normalized):
        normalized = normalized[0].lower() + normalized[1:]
    return normalized.rstrip("/") or "/"


def _short_mount(value: str) -> dict[str, Any]:
    read_only = False
    if value.endswith(":ro"):
        value = value[:-3]
        read_only = True
    separator = value.rfind(":/")
    if separator < 1:
        raise ComposeProviderParityError(f"unsupported short mount: {value}")
    source = value[:separator]
    target = value[separator + 1 :]
    is_bind = bool(
        source.startswith(("/", ".", "~")) or re.match(r"^[A-Za-z]:[\\/]", source)
    )
    return {
        "type": "bind" if is_bind else "volume",
        "source": _canonical_path(source) if is_bind else source,
        "target": target,
        "read_only": read_only,
    }


def _mount(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return _short_mount(value)
    if not isinstance(value, dict):
        raise ComposeProviderParityError(f"unsupported mount: {value!r}")
    result = {
        "type": value.get("type", "volume"),
        "source": value.get("source"),
        "target": value.get("target"),
        "read_only": bool(value.get("read_only", False)),
    }
    if result["type"] == "bind" and isinstance(result["source"], str):
        result["source"] = _canonical_path(result["source"])
    for option in ("bind", "volume", "tmpfs", "consistency"):
        if value.get(option) not in (None, {}, ""):
            result[option] = value[option]
    return result


def _key_value(value: Any, separator: str = "=") -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    result: dict[str, Any] = {}
    for item in value or []:
        key, found, entry = str(item).partition(separator)
        result[key] = entry if found else None
    return result


def _extra_hosts(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(key): str(entry) for key, entry in value.items()}
    result: dict[str, str] = {}
    for item in value or []:
        text = str(item)
        if "=" in text:
            host, address = text.split("=", 1)
        else:
            host, address = text.split(":", 1)
        result[host] = address
    return result


def _depends_on(value: Any) -> dict[str, dict[str, Any]]:
    if isinstance(value, list):
        value = {name: {} for name in value}
    result: dict[str, dict[str, Any]] = {}
    for name, condition in (value or {}).items():
        if isinstance(condition, str):
            condition = {"condition": condition}
        normalized = dict(condition or {})
        normalized.setdefault("condition", "service_started")
        normalized.setdefault("required", True)
        result[str(name)] = normalized
    return result


def _networks(value: Any) -> dict[str, dict[str, Any]]:
    if isinstance(value, list):
        value = {name: {} for name in value}
    return {
        str(name): dict(options or {})
        for name, options in (value or {}).items()
    }


def _service(value: dict[str, Any]) -> dict[str, Any]:
    service = deepcopy(value)
    if service.get("entrypoint") is None:
        service.pop("entrypoint", None)
    if "environment" in service:
        service["environment"] = _key_value(service["environment"])
    if "labels" in service:
        service["labels"] = _key_value(service["labels"])
    if "extra_hosts" in service:
        service["extra_hosts"] = _extra_hosts(service["extra_hosts"])
    if "depends_on" in service:
        service["depends_on"] = _depends_on(service["depends_on"])
    if "volumes" in service:
        service["volumes"] = sorted(
            (_mount(mount) for mount in service["volumes"]),
            key=lambda mount: (str(mount.get("target")), str(mount.get("source"))),
        )
    if "networks" in service:
        service["networks"] = _networks(service["networks"])
    elif "network_mode" not in service:
        service["networks"] = {"default": {}}
    return service


def _project_volumes(value: Any, project: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for name, options in (value or {}).items():
        normalized = dict(options or {})
        normalized.setdefault("name", f"{project}_{name}")
        result[str(name)] = normalized
    return result


def _project_networks(value: Any, project: str) -> dict[str, dict[str, Any]]:
    source = dict(value or {"default": {}})
    result: dict[str, dict[str, Any]] = {}
    for name, options in source.items():
        normalized = dict(options or {})
        if normalized.get("ipam") == {}:
            normalized.pop("ipam")
        normalized.setdefault("name", f"{project}_{name}")
        result[str(name)] = normalized
    return result


def normalize_project(value: dict[str, Any], project: str = PROJECT) -> dict[str, Any]:
    """Collapse provider-specific syntax while retaining effective semantics."""
    result: dict[str, Any] = {
        "name": value.get("name", project),
        "services": {
            str(name): _service(service)
            for name, service in (value.get("services") or {}).items()
        },
        "volumes": _project_volumes(value.get("volumes"), project),
        "networks": _project_networks(value.get("networks"), project),
    }
    for section in ("configs", "secrets"):
        if section in value:
            result[section] = deepcopy(value[section])
    return result


def assert_projects_equal(podman_project: dict[str, Any], docker_project: dict[str, Any]) -> None:
    podman = normalize_project(podman_project)
    docker = normalize_project(docker_project)
    if podman == docker:
        return
    podman_text = json.dumps(podman, indent=2, sort_keys=True).splitlines()
    docker_text = json.dumps(docker, indent=2, sort_keys=True).splitlines()
    difference = "\n".join(
        difflib.unified_diff(
            podman_text,
            docker_text,
            fromfile="podman-compose-1.6.0",
            tofile="docker-compose.exe-5.1.2",
            lineterm="",
        )
    )
    raise ComposeProviderParityError("merged Compose projects differ:\n" + difference)


def _run(command: list[str], root: Path, environment: dict[str, str]) -> str:
    completed = subprocess.run(
        command,
        cwd=root,
        env=environment,
        text=True,
        capture_output=True,
        timeout=90,
        check=False,
    )
    if completed.returncode != 0:
        raise ComposeProviderParityError(
            f"provider failed ({completed.returncode}): {' '.join(command)}\n"
            f"{completed.stdout}{completed.stderr}"
        )
    return completed.stdout


def render_and_compare(root: Path, podman_compose: str, podman: str, docker_compose: str) -> None:
    if metadata.version("podman-compose") != PODMAN_COMPOSE_VERSION:
        raise ComposeProviderParityError("podman-compose must be exactly 1.6.0")
    environment = os.environ.copy()
    with tempfile.TemporaryDirectory(prefix="jht-compose-parity-") as temporary:
        home = Path(temporary) / "JHT User"
        (home / ".jht").mkdir(parents=True)
        (home / "Documents" / "Job Hunter Team").mkdir(parents=True)
        environment.update(
            {
                "HOME": str(home),
                "JHT_IMAGE": "ghcr.io/leopu00/jht@sha256:" + "a" * 64,
                "JHT_HOST_TYPE": "vps",
                "JHT_LANG": "it",
                "JHT_USER_TZ": "Europe/Rome",
                "JHT_SCOUT_COORD_DB": "",
                "ANTHROPIC_API_KEY": "",
                "OPENAI_API_KEY": "",
                "MOONSHOT_API_KEY": "",
                "NEXT_PUBLIC_SUPABASE_URL": "",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": "",
                "JHT_LIVE_SCREEN_PORT": "6080",
                "JHT_PODMAN_HTTP_PROXY": "http://127.0.0.1:3128",
                "JHT_PODMAN_HTTPS_PROXY": "http://127.0.0.1:3128",
                "JHT_PODMAN_ALL_PROXY": "",
                "JHT_PODMAN_NO_PROXY": "localhost,127.0.0.1,::1",
                "JHT_TELEGRAM_SERVICE_ENABLED": "0",
                "JHT_TELEGRAM_BURST_LIMIT": "10",
                "JHT_TELEGRAM_DAILY_LIMIT": "300",
            }
        )
        compose = root / "docker-compose.yml"
        override = root / "docker-compose.podman.yml"
        common = ["-p", PROJECT, "-f", str(compose), "-f", str(override), "config"]
        podman_yaml = _run(
            [podman_compose, "--podman-path", podman, *common], root, environment
        )
        docker_version = _run([docker_compose, "version"], root, environment)
        if f"version {DOCKER_COMPOSE_VERSION}" not in docker_version:
            raise ComposeProviderParityError("docker-compose.exe must be exactly 5.1.2")
        docker_json = _run([docker_compose, *common, "--format", "json"], root, environment)
        assert_projects_equal(yaml.safe_load(podman_yaml), json.loads(docker_json))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--podman-compose", required=True)
    parser.add_argument("--podman", required=True)
    parser.add_argument("--docker-compose", required=True)
    arguments = parser.parse_args()
    render_and_compare(
        arguments.root.resolve(),
        arguments.podman_compose,
        arguments.podman,
        arguments.docker_compose,
    )
    print("Compose provider parity: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
