from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".githooks" / "pre-commit"


def run_hook(repo: Path, staged_path: str) -> subprocess.CompletedProcess[str]:
    target = repo / staged_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"public media fixture\n")
    subprocess.run(["git", "add", staged_path], cwd=repo, check=True)
    return subprocess.run(
        ["bash", str(HOOK)],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )


@pytest.mark.parametrize(
    ("allowed", "blocked"),
    [
        (
            "web/public/media/home-video-r4-web.mp4",
            "web/public/media/another-video.mp4",
        ),
        (
            "web/public/media/home-video-r4-music.vtt",
            "web/public/media/another-track.vtt",
        ),
    ],
)
def test_public_media_exceptions_are_exact_paths(
    tmp_path: Path, allowed: str, blocked: str
) -> None:
    allowed_repo = tmp_path / "allowed"
    allowed_repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=allowed_repo, check=True)
    allowed_result = run_hook(allowed_repo, allowed)
    assert allowed_result.returncode == 0, allowed_result.stdout + allowed_result.stderr

    blocked_repo = tmp_path / "blocked"
    blocked_repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=blocked_repo, check=True)
    blocked_result = run_hook(blocked_repo, blocked)
    assert blocked_result.returncode == 1
    assert "file con estensione non permessa" in blocked_result.stdout
    assert blocked in blocked_result.stdout
