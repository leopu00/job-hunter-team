"""Executable least-privilege census for every GitHub Actions workflow."""

from pathlib import Path

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
        "eslint-web": READ_CONTENTS,
        "eslint-desktop-payload": READ_CONTENTS,
        "prettier": READ_CONTENTS,
        "review-log": READ_CONTENTS,
        "workflow-gates": READ_CONTENTS,
    },
    "release.yml": {
        "check-version": READ_CONTENTS,
        "build-game": READ_CONTENTS,
        "release": {"contents": "write"},
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
}


def _load_workflow(path: Path) -> dict:
    # BaseLoader keeps GitHub's `on` key as text instead of YAML 1.1 boolean.
    return yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_all_workflows_have_only_the_minimum_explicit_permissions():
    workflow_paths = {path.name: path for path in WORKFLOW_DIR.glob("*.yml")}

    assert set(workflow_paths) == set(EXPECTED_EFFECTIVE_PERMISSIONS)
    assert len(workflow_paths) == 12

    for name, expected_jobs in EXPECTED_EFFECTIVE_PERMISSIONS.items():
        workflow = _load_workflow(workflow_paths[name])
        workflow_permissions = workflow.get("permissions")

        assert workflow_permissions == READ_CONTENTS, name
        assert set(workflow["jobs"]) == set(expected_jobs), name

        for job_name, expected_permissions in expected_jobs.items():
            job = workflow["jobs"][job_name]
            effective_permissions = job.get("permissions", workflow_permissions)
            assert effective_permissions == expected_permissions, f"{name}:{job_name}"
