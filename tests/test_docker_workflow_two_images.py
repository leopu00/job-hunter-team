"""The docker workflow builds, checks and publishes THREE images from one Dockerfile (T307 A, then the extras image).

The checks that matter are the ORDER (the tiers check runs before anything is pushed) and the
SHAPE (core on the core prefix, extras on the extras prefix, all with the commit label, three digests written out). The
workflow is read as YAML, not as text."""
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = yaml.safe_load((ROOT / ".github" / "workflows" / "docker.yml").read_text(encoding="utf-8"))
STEPS = WORKFLOW["jobs"]["build-and-push"]["steps"]


def index(name_part: str) -> int:
    matches = [i for i, step in enumerate(STEPS) if name_part in step.get("name", "")]
    assert len(matches) == 1, f"{name_part}: {len(matches)} steps"
    return matches[0]


def test_the_core_image_is_built_on_the_core_prefix_only():
    for name in ("Build the core image (amd64, local)", "Build & push the core image"):
        step = STEPS[index(name)]
        assert step["with"]["target"] == "runtime"
        assert step["with"]["build-args"].strip() == "BASE=prefix-core"
    full = STEPS[index("Build for the agent-shell check")]
    assert "build-args" not in full["with"] and "target" not in full["with"], "the full image is the default build"


def test_the_checks_run_before_the_first_push():
    push_full = next(i for i, step in enumerate(STEPS) if step.get("id") == "push-full")
    push_core = index("Build & push the core image")
    push_extras = index("Build & push the extras image")
    tiers = index("Core, full and extras carry the same code")
    privileges_core = index("Core image cannot reach root")
    privileges_extras = index("Extras image cannot reach root")
    assert privileges_core < privileges_extras < tiers < push_full < push_core < push_extras
    assert "image_tiers.py jht:core-check jht:agent-shell-check --extras jht:extras-check" in STEPS[tiers]["run"]
    assert "--revision" not in STEPS[tiers]["run"], "the expected commit differs between push and pull_request events: the images are compared with each other"


def test_the_extras_image_is_built_on_the_extras_prefix_only():
    for name in ("Build the extras image (amd64, local)", "Build & push the extras image"):
        step = STEPS[index(name)]
        assert step["with"]["target"] == "runtime"
        assert step["with"]["build-args"].strip() == "BASE=prefix-extras"
    assert STEPS[index("Build the extras image (amd64, local)")]["with"]["labels"] == "${{ steps.meta-extras.outputs.labels }}"
    assert "suffix=-extras" in STEPS[index("Extract image metadata (extras)")]["with"]["flavor"]


def test_both_local_builds_carry_the_commit_label_the_check_reads():
    assert STEPS[index("Build for the agent-shell check")]["with"]["labels"] == "${{ steps.meta.outputs.labels }}"
    assert STEPS[index("Build the core image (amd64, local)")]["with"]["labels"] == "${{ steps.meta-core.outputs.labels }}"


def test_the_core_tags_are_suffixed_and_the_three_digests_are_written_out():
    meta = STEPS[index("Extract image metadata (core)")]
    assert "suffix=-core" in meta["with"]["flavor"]
    digests = STEPS[index("The three digests")]
    assert digests["if"] == "github.event_name != 'pull_request'"
    assert "steps.push-full.outputs.digest" in digests["run"] and "steps.push-core.outputs.digest" in digests["run"]
    assert "steps.push-extras.outputs.digest" in digests["run"]


def test_a_requirements_tools_change_rebuilds_the_image():
    triggers = WORKFLOW.get("on", WORKFLOW.get(True))  # YAML reads a bare `on:` as the boolean True
    for event in ("push", "pull_request"):
        assert "requirements-tools.txt" in triggers[event]["paths"]
