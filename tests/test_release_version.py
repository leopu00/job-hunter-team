"""Release metadata must remain taggable from every master commit."""

import json
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_RELEASE_VERSION = "0.4.0"


def run_release_check(root: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "JHT_RELEASE_ROOT": str(root)}
    return subprocess.run(
        [
            str(ROOT / "scripts/check-release-version.sh"),
            f"v{EXPECTED_RELEASE_VERSION}",
        ],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_all_release_components_match_root_version() -> None:
    assert json.loads((ROOT / "package.json").read_text())["version"] == EXPECTED_RELEASE_VERSION
    result = run_release_check(ROOT)
    assert result.returncode == 0, result.stdout + result.stderr


def test_release_check_rejects_a_moving_compose_image(tmp_path: Path) -> None:
    sandbox = tmp_path / "release-tree"
    sandbox.mkdir()
    for child in ROOT.iterdir():
        if child.name in {".git", "docker-compose.yml"}:
            continue
        (sandbox / child.name).symlink_to(child, target_is_directory=child.is_dir())

    compose = sandbox / "docker-compose.yml"
    shutil.copy2(ROOT / "docker-compose.yml", compose)
    manifest = json.loads((ROOT / "release/runtime-image.v1.json").read_text())
    immutable_ref = f'{manifest["repository"]}@{manifest["digest"]}'
    # The compose names the image once (a YAML anchor reused by the broker):
    # swap that one reference, and prove the swap happened, or the check
    # below would pass on an untouched file.
    original = compose.read_text()
    pinned = f"${{JHT_IMAGE:-{immutable_ref}}}"
    assert original.count(pinned) == 1
    compose.write_text(original.replace(pinned, "${JHT_IMAGE:-ghcr.io/leopu00/jht:latest}"))

    result = run_release_check(sandbox)
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "runtime image consumers" in output
