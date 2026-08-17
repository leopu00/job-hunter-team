"""Executable least-privilege census for every GitHub Actions workflow."""

from copy import deepcopy
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
READ_CONTENTS = {"contents": "read"}

# This is deliberately an exact 12/12 census. A new workflow or job must make
# its token contract explicit here before it can enter the repository.
EXPECTED_EFFECTIVE_PERMISSIONS = {
    "ci.yml": {
        "lint-typecheck": READ_CONTENTS,
        "build": READ_CONTENTS,
    },
    "deploy.yml": {"verify": READ_CONTENTS},
    "docker.yml": {
        "build-and-push": {"contents": "read", "packages": "write"},
    },
    "game.yml": {"test-export": READ_CONTENTS},
    "lint.yml": {
        # `eslint-desktop-payload` e' caduto con l'albero che lintava:
        # `desktop/app-payload/` non esiste piu' (#177).
        "eslint-web": READ_CONTENTS,
        "prettier": READ_CONTENTS,
        "review-log": READ_CONTENTS,
        "workflow-gates": READ_CONTENTS,
    },
    "release.yml": {
        "check-version": READ_CONTENTS,
        "build-game": READ_CONTENTS,
        "publish-runtime": {"contents": "read", "packages": "write"},
        # `release` non scrive piu': prepara il candidato e lo consegna come
        # artifact. La scrittura vive solo in publish-signed-release.yml, dopo
        # la verifica della firma detached.
        "release": READ_CONTENTS,
    },
    # La pubblicazione firmata e' un workflow a parte proprio perche' e' l'unico
    # che scrive: `publish` alza `contents: write` da solo, gli altri due job
    # restano in lettura.
    "publish-signed-release.yml": {
        "authorize": {"actions": "read", "contents": "read"},
        "installer": {"actions": "read", "contents": "read"},
        "publish": {"actions": "read", "contents": "write"},
    },
    "security.yml": {
        "audit": READ_CONTENTS,
        "secrets": READ_CONTENTS,
        "sast": READ_CONTENTS,
    },
    "tag-production-release.yml": {"tag": {"contents": "write"}},
    "test.yml": {
        "vitest": READ_CONTENTS,
        "migration-gate": READ_CONTENTS,
        "pytest": READ_CONTENTS,
        "e2e": READ_CONTENTS,
        "smoke": READ_CONTENTS,
    },
    "windows-config-acl.yml": {"acl": READ_CONTENTS},
    "windows-dev-smoke.yml": {"next-dev": READ_CONTENTS},
    "windows-installer-smoke.yml": {"nsis": READ_CONTENTS},
    "windows-update-helper.yml": {"powershell51": READ_CONTENTS},
}


def _load_workflow(path: Path) -> dict:
    # BaseLoader keeps GitHub's `on` key as text instead of YAML 1.1 boolean.
    return yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def _assert_exact_job_permissions(name: str, workflow: dict, expected_jobs: dict) -> None:
    workflow_permissions = workflow.get("permissions")

    assert workflow_permissions == READ_CONTENTS, name
    assert set(workflow["jobs"]) == set(expected_jobs), name

    for job_name, expected_permissions in expected_jobs.items():
        job = workflow["jobs"][job_name]
        effective_permissions = job.get("permissions", workflow_permissions)
        assert effective_permissions == expected_permissions, f"{name}:{job_name}"


def test_all_workflows_have_only_the_minimum_explicit_permissions():
    workflow_paths = {path.name: path for path in WORKFLOW_DIR.glob("*.yml")}

    assert set(workflow_paths) == set(EXPECTED_EFFECTIVE_PERMISSIONS)
    assert len(workflow_paths) == 14

    for name, expected_jobs in EXPECTED_EFFECTIVE_PERMISSIONS.items():
        workflow = _load_workflow(workflow_paths[name])
        _assert_exact_job_permissions(name, workflow, expected_jobs)


@pytest.mark.parametrize(
    "drifted_permissions",
    [
        {"contents": "read"},
        {"contents": "read", "packages": "write", "id-token": "write"},
    ],
    ids=("missing-package-write", "unexpected-id-token-write"),
)
def test_publish_runtime_rejects_permission_subset_and_superset(drifted_permissions):
    name = "release.yml"
    workflow = deepcopy(_load_workflow(WORKFLOW_DIR / name))
    workflow["jobs"]["publish-runtime"]["permissions"] = drifted_permissions

    with pytest.raises(AssertionError, match=r"release\.yml:publish-runtime"):
        _assert_exact_job_permissions(
            name,
            workflow,
            EXPECTED_EFFECTIVE_PERMISSIONS[name],
        )
