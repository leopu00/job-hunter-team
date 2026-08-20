from pathlib import Path
import os
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / ".githooks" / "pre-commit"
PUSH_HOOK = ROOT / ".githooks" / "pre-push"


def bash_executable() -> str:
    if os.name == "nt":
        git_bash = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
        if git_bash.is_file():
            return str(git_bash)
    return shutil.which("bash") or "bash"


def run_hook(repo: Path, staged_path: str) -> subprocess.CompletedProcess[str]:
    target = repo / staged_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"public media fixture\n")
    subprocess.run(["git", "add", staged_path], cwd=repo, check=True)
    return subprocess.run(
        [bash_executable(), HOOK.as_posix()],
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


def test_systemd_instance_unit_is_not_treated_as_private_email(tmp_path: Path) -> None:
    repo = tmp_path / "systemd-unit"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    target = repo / "unit.txt"
    target.write_text("Requires=user-runtime-dir@1000.service\n", encoding="utf-8")
    subprocess.run(["git", "add", "unit.txt"], cwd=repo, check=True)

    result = subprocess.run(
        [bash_executable(), HOOK.as_posix()],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    expected_filter = "^user-runtime-dir@[0-9]+\\.service$"
    assert expected_filter in HOOK.read_text(encoding="utf-8")
    assert expected_filter in PUSH_HOOK.read_text(encoding="utf-8")
