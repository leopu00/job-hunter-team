"""Release metadata must remain taggable from every master commit."""

import json
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_release_check(root: Path) -> subprocess.CompletedProcess[str]:
    version = json.loads((ROOT / "package.json").read_text())["version"]
    env = {**os.environ, "JHT_RELEASE_ROOT": str(root)}
    return subprocess.run(
        [str(ROOT / "scripts/check-release-version.sh"), f"v{version}"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_all_release_components_match_root_version() -> None:
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
    version = json.loads((ROOT / "package.json").read_text())["version"]
    compose.write_text(
        compose.read_text().replace(
            f"image: ${{JHT_IMAGE:-ghcr.io/leopu00/jht:{version}}}",
            "image: ${JHT_IMAGE:-ghcr.io/leopu00/jht:latest}",
        )
    )

    result = run_release_check(sandbox)
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "docker-compose.yml" in output
