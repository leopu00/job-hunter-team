"""The two distributed Compose providers must emit one effective project."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import yaml

from scripts.ci.compose_provider_parity import (
    ComposeProviderParityError,
    assert_projects_equal,
)


ROOT = Path(__file__).resolve().parents[1]

PODMAN_PROJECT = {
    "services": {
        "jht": {
            "image": "example.invalid/jht@sha256:" + "a" * 64,
            "network_mode": "host",
            "userns_mode": "keep-id:uid=1001,gid=1001",
            "depends_on": {"broker": {"condition": "service_started"}},
            "extra_hosts": ["host.docker.internal:host-gateway"],
            "volumes": ["state:/state:ro", "C:\\JHT User\\.jht:/jht_home"],
        },
        "broker": {"networks": ["default"]},
    },
    "volumes": {"state": None},
}

DOCKER_PROJECT = {
    "name": "jht",
    "networks": {"default": {"name": "jht_default", "ipam": {}}},
    "services": {
        "jht": {
            "image": "example.invalid/jht@sha256:" + "a" * 64,
            "entrypoint": None,
            "network_mode": "host",
            "userns_mode": "keep-id:uid=1001,gid=1001",
            "depends_on": {
                "broker": {"condition": "service_started", "required": True}
            },
            "extra_hosts": ["host.docker.internal=host-gateway"],
            "volumes": [
                {
                    "type": "volume",
                    "source": "state",
                    "target": "/state",
                    "read_only": True,
                    "volume": {},
                },
                {
                    "type": "bind",
                    "source": "C:\\JHT User\\.jht",
                    "target": "/jht_home",
                    "bind": {},
                },
            ],
        },
        "broker": {"networks": {"default": None}},
    },
    "volumes": {"state": {"name": "jht_state"}},
}


def test_provider_syntax_differences_normalize_to_one_project():
    assert_projects_equal(PODMAN_PROJECT, DOCKER_PROJECT)


@pytest.mark.parametrize(
    ("case", "mutate"),
    [
        ("network", lambda project: project["services"]["jht"].update(network_mode="bridge")),
        ("volume", lambda project: project["volumes"]["state"].update(name="foreign_state")),
        (
            "mount",
            lambda project: project["services"]["jht"]["volumes"][0].update(
                read_only=False
            ),
        ),
        (
            "override",
            lambda project: project["services"]["jht"].update(
                userns_mode="keep-id:uid=1000,gid=1000"
            ),
        ),
    ],
)
def test_network_volume_mount_and_override_drift_are_red(case, mutate):
    drifted = deepcopy(DOCKER_PROJECT)
    mutate(drifted)
    with pytest.raises(ComposeProviderParityError, match="merged Compose projects differ"):
        assert_projects_equal(PODMAN_PROJECT, drifted)


def test_ci_runs_the_exact_distributed_providers_on_windows():
    workflow = yaml.load(
        (ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8"),
        Loader=yaml.BaseLoader,
    )
    job = workflow["jobs"]["compose-provider-parity"]
    assert job["runs-on"] == "windows-2022"
    commands = "\n".join(str(step.get("run", "")) for step in job["steps"])
    assert "podman-compose==1.6.0" in commands
    assert "Docker.DockerCompose" in commands
    assert "--version 5.1.2" in commands
    assert "scripts/ci/compose_provider_parity.py" in commands
