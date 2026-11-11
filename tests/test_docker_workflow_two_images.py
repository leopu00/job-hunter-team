"""The docker workflow builds, checks and publishes THREE images from one Dockerfile (T307 A, then the extras image).

Three jobs: `check` builds the three images for amd64 locally and runs the checks; `build` builds every image on
every architecture in parallel, on native runners, and pushes it by digest only (no tag, no name); `publish` needs
both, joins amd64 and arm64 into one index per image, tags it and writes the three digests out.

The checks that matter are the GATE (nothing is tagged or announced unless the checks passed), the SHAPE (core on
the core prefix, extras on the extras prefix, all with the commit label, three digests written out) and the SPEED
(no emulation, one cache scope per architecture and image). The workflow is read as YAML, not as text."""
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = yaml.safe_load((ROOT / ".github" / "workflows" / "docker.yml").read_text(encoding="utf-8"))
JOBS = WORKFLOW["jobs"]
CHECK = JOBS["check"]["steps"]
BUILD = JOBS["build"]
PUBLISH = JOBS["publish"]


def step(steps: list, name_part: str) -> dict:
    matches = [s for s in steps if name_part in s.get("name", "")]
    assert len(matches) == 1, f"{name_part}: {len(matches)} steps"
    return matches[0]


def index(steps: list, name_part: str) -> int:
    return steps.index(step(steps, name_part))


def matrix_image(image: str) -> dict:
    found = [entry for entry in BUILD["strategy"]["matrix"]["include"] if entry.get("image") == image and "target" in entry]
    assert len(found) == 1, image
    return found[0]


def test_the_core_image_is_built_on_the_core_prefix_only():
    local = step(CHECK, "Build the core image (amd64, local)")
    assert local["with"]["target"] == "runtime"
    assert local["with"]["build-args"].strip() == "BASE=prefix-core"
    assert matrix_image("core")["target"] == "runtime"
    assert matrix_image("core")["build-args"] == "BASE=prefix-core"
    full = step(CHECK, "Build for the agent-shell check")
    assert "build-args" not in full["with"] and "target" not in full["with"], "the full image is the default build"
    assert matrix_image("full")["target"] == "" and matrix_image("full")["build-args"] == ""


def test_the_extras_image_is_built_on_the_extras_prefix_only():
    local = step(CHECK, "Build the extras image (amd64, local)")
    assert local["with"]["target"] == "runtime"
    assert local["with"]["build-args"].strip() == "BASE=prefix-extras"
    assert local["with"]["labels"] == "${{ steps.meta-extras.outputs.labels }}"
    assert matrix_image("extras")["target"] == "runtime"
    assert matrix_image("extras")["build-args"] == "BASE=prefix-extras"
    assert "suffix=-extras" in step(PUBLISH["steps"], "Extract image metadata (extras)")["with"]["flavor"]


def test_the_checks_run_in_their_own_job_and_push_nothing():
    privileges_core = index(CHECK, "Core image cannot reach root")
    privileges_extras = index(CHECK, "Extras image cannot reach root")
    tiers = index(CHECK, "Core, full and extras carry the same code")
    assert privileges_core < privileges_extras < tiers
    run = CHECK[tiers]["run"]
    assert "image_tiers.py jht:core-check jht:agent-shell-check --extras jht:extras-check" in run
    assert "--revision" not in run, "the expected commit differs between push and pull_request events: the images are compared with each other"
    assert JOBS["check"]["permissions"] == {"contents": "read"}, "the checks cannot write to the registry"
    for s in CHECK:
        if "docker/build-push-action" in s.get("uses", ""):
            assert s["with"]["push"] is False and s["with"]["load"] is True


def test_nothing_is_tagged_or_announced_before_the_checks_pass():
    assert set(PUBLISH["needs"]) == {"check", "build"}
    assert PUBLISH["if"] == "github.event_name != 'pull_request'"
    build = step(BUILD["steps"], "Build and push by digest")
    outputs = build["with"]["outputs"]
    assert "push-by-digest=true" in outputs and "name-canonical=true" in outputs
    assert "tags" not in build["with"], "a build job never tags: only publish does, after the checks"
    assert "push=${{ github.event_name != 'pull_request' }}" in outputs


def test_both_local_builds_carry_the_commit_label_the_check_reads():
    assert step(CHECK, "Build for the agent-shell check")["with"]["labels"] == "${{ steps.meta.outputs.labels }}"
    assert step(CHECK, "Build the core image (amd64, local)")["with"]["labels"] == "${{ steps.meta-core.outputs.labels }}"
    assert step(BUILD["steps"], "Build and push by digest")["with"]["labels"] == "${{ steps.meta.outputs.labels }}"


def test_every_image_is_built_on_both_architectures_natively():
    matrix = BUILD["strategy"]["matrix"]
    assert matrix["arch"] == ["amd64", "arm64"] and matrix["image"] == ["full", "core", "extras"]
    runners = {entry["arch"]: entry["runner"] for entry in matrix["include"] if "runner" in entry}
    assert runners == {"amd64": "ubuntu-24.04", "arm64": "ubuntu-24.04-arm"}
    assert BUILD["runs-on"] == "${{ matrix.runner }}"
    text = (ROOT / ".github" / "workflows" / "docker.yml").read_text(encoding="utf-8")
    assert "setup-qemu-action" not in text, "arm64 is built on an arm64 runner, never emulated"
    assert step(BUILD["steps"], "Build and push by digest")["with"]["platforms"] == "linux/${{ matrix.arch }}"


def test_each_architecture_and_image_has_its_own_cache_scope():
    build = step(BUILD["steps"], "Build and push by digest")["with"]
    assert build["cache-to"] == "type=gha,mode=max,scope=${{ matrix.arch }}-${{ matrix.image }}"
    assert "type=gha,scope=${{ matrix.arch }}-${{ matrix.image }}" in build["cache-from"]


def test_the_core_tags_are_suffixed_and_the_three_digests_are_written_out():
    assert "suffix=-core" in step(PUBLISH["steps"], "Extract image metadata (core)")["with"]["flavor"]
    join = step(PUBLISH["steps"], "Join amd64 and arm64")
    for image in ("full", "core", "extras"):
        assert f"join {image} " in join["run"]
    digests = step(PUBLISH["steps"], "The three digests")
    for image in ("full", "core", "extras"):
        assert f"steps.join.outputs.{image}" in digests["run"]
    for label in ("- piena:", "- nucleo:", "- su richiesta:", "- revisione:"):
        assert label in digests["run"], "the recipes read these four lines from the run"


def test_a_requirements_tools_change_rebuilds_the_image():
    triggers = WORKFLOW.get("on", WORKFLOW.get(True))  # YAML reads a bare `on:` as the boolean True
    for event in ("push", "pull_request"):
        assert "requirements-tools.txt" in triggers[event]["paths"]
