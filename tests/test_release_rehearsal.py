"""The release rehearsal builds, signs and notarizes like release.yml and publishes nothing.

.github/workflows/release-rehearsal.yml repeats the `build-desktop` job of release.yml (same steps, same Apple
secrets) so that the first signature and notarization of a version are not made on the tag. Two things must
stay true, and they are what this file holds:

- the build steps are the steps of release.yml, not a copy that drifted: a step of the release that changes
  has to change in the rehearsal, or the rehearsal proves something the release no longer does;
- the rehearsal reaches nothing outside the runner: no tag, no image tag on GHCR, no Release, no artifact
  (on a public repository every signed-in GitHub user can download an artifact), no write permission.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
RELEASE_TEXT = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
REHEARSAL_TEXT = (ROOT / ".github/workflows/release-rehearsal.yml").read_text(encoding="utf-8")
RELEASE = yaml.safe_load(RELEASE_TEXT)
REHEARSAL = yaml.safe_load(REHEARSAL_TEXT)
# PyYAML reads the key `on` as the boolean True
TRIGGERS = REHEARSAL.get("on", REHEARSAL.get(True))


def _steps(workflow: dict, job: str) -> list[dict]:
    return workflow["jobs"][job]["steps"]


def _by_name(steps: list[dict]) -> dict[str, dict]:
    return {step["name"]: step for step in steps if "name" in step}


def test_it_starts_only_by_hand() -> None:
    assert list(TRIGGERS) == ["workflow_dispatch"]
    assert "push" not in TRIGGERS and "release" not in TRIGGERS and "schedule" not in TRIGGERS


def test_the_build_job_is_the_one_of_the_release() -> None:
    release, rehearsal = RELEASE["jobs"]["build-desktop"], REHEARSAL["jobs"]["build-desktop"]
    for key in ("runs-on", "timeout-minutes", "strategy", "defaults", "env"):
        assert rehearsal[key] == release[key], key
    assert "needs" not in rehearsal                                 # no check-version: it asks for production

    release_steps, rehearsal_steps = _by_name(_steps(RELEASE, "build-desktop")), _by_name(_steps(REHEARSAL, "build-desktop"))
    shared = set(release_steps) & set(rehearsal_steps)
    # every build, signing, notarization and smoke step of the release is in the rehearsal, unchanged
    for name, step in release_steps.items():
        if name == "Record immutable build identity":
            continue                                                 # needs a git tag: rewritten for the runner
        assert name in rehearsal_steps, f"missing from the rehearsal: {name}"
        assert rehearsal_steps[name] == step, f"differs from the release: {name}"
    # and what the rehearsal adds is only its own record step
    assert set(rehearsal_steps) - shared == {"Record the build identity of the rehearsal (runner-local tag, nothing is pushed)"}


def test_the_signing_and_notarization_steps_are_really_there() -> None:
    names = _by_name(_steps(REHEARSAL, "build-desktop"))
    for needed in (
        "Require Apple release credentials",
        "Select the Developer ID signing identity",
        "Build Tauri bundles",
        "Gate macOS bundle — shell and companion shipped",
        "Collect and verify signed macOS installer",
        "Install the signed DMG and open the app",
        "Collect and inspect Linux packages",
        "Gate collected artifact bytes",
    ):
        assert needed in names, needed
    run = names["Collect and verify signed macOS installer"]["run"]
    for check in ("codesign --verify", "spctl --assess", "xcrun stapler validate", "hdiutil verify"):
        assert check in run, check
    build_env = names["Build Tauri bundles"]["env"]
    assert {"APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"} <= set(build_env)


def test_it_checks_out_the_commit_it_was_asked_and_keeps_no_credentials() -> None:
    for job in REHEARSAL["jobs"].values():
        checkout = next(step for step in job["steps"] if str(step.get("uses", "")).startswith("actions/checkout@"))
        assert checkout["with"]["ref"] == "${{ inputs.ref || github.sha }}"
        assert checkout["with"]["persist-credentials"] is False


FORBIDDEN = (
    "upload-artifact",                  # signed bytes must not leave the runner
    "action-gh-release",                # no Release
    "gh release",
    "docker/login-action",              # no registry login: nothing can be pushed
    "packages: write",
    "contents: write",
    "id-token",
    "git push",
    "publish --claim",                  # runtime_image_pin.py publish creates the image tag on GHCR
    "imagetools create",
    "tag-production-release",
    "origin/production",                # the rehearsal does not ask for production
    "secrets.VERCEL",
    "secrets.GITHUB_TOKEN",
)


@pytest.mark.parametrize("text", FORBIDDEN)
def test_nothing_that_publishes_or_writes_is_in_the_rehearsal(text: str) -> None:
    # the header comment says what is NOT there; look at the workflow without its comments
    body = "\n".join(line for line in REHEARSAL_TEXT.splitlines() if not line.lstrip().startswith("#"))
    assert text not in body, text


def test_every_permission_is_read_only_and_every_action_is_pinned_to_a_commit() -> None:
    assert REHEARSAL["permissions"] == {"contents": "read"}
    for name, job in REHEARSAL["jobs"].items():
        assert job.get("permissions", {"contents": "read"}) == {"contents": "read"}, name
        for step in job["steps"]:
            if "uses" in step:
                assert re.fullmatch(r"[\w./-]+@[0-9a-f]{40}", step["uses"]), step["uses"]


def test_the_read_only_pin_job_reads_the_registry_and_never_writes_it() -> None:
    runs = "\n".join(step.get("run", "") for step in _steps(REHEARSAL, "runtime-pin-read-only"))
    assert "runtime_image_pin.py verify-tree" in runs
    assert "runtime_image_pin.py verify-source" in runs
    assert "runtime_image_pin.py publish" not in runs
    assert "runtime_image_pin.py update" not in runs


def test_the_record_step_tags_only_the_runner_and_the_tag_is_one_the_provenance_script_accepts() -> None:
    from scripts import release_artifacts

    step = _by_name(_steps(REHEARSAL, "build-desktop"))[
        "Record the build identity of the rehearsal (runner-local tag, nothing is pushed)"
    ]
    tag = re.search(r"--tag (\S+)", step["run"]).group(1)
    assert release_artifacts.TAG_RE.fullmatch(tag)
    assert f'git tag {tag} "$HEAD_SHA"' in step["run"]            # the tag record asks git for is the one made here
    assert "push" not in step["run"]
