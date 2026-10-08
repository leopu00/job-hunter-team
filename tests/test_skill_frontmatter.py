"""Every product skill must expose frontmatter that both agent CLIs can parse."""

import os
from pathlib import Path
import subprocess

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_FILES = sorted((REPO_ROOT / "agents").rglob("SKILL*.md"))
LOCALES = ("en", "it", "es", "fr", "de", "pt", "hu")


def _metadata(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines and lines[0] == "---", f"{path}: first line is not `---`"
    closing = lines.index("---", 1)
    metadata = yaml.safe_load("\n".join(lines[1:closing]))
    assert isinstance(metadata, dict), f"{path}: frontmatter is not a mapping"
    return metadata


def test_every_skill_starts_with_valid_yaml_frontmatter():
    problems = []

    for path in SKILL_FILES:
        relative = path.relative_to(REPO_ROOT)
        lines = path.read_text(encoding="utf-8").splitlines()
        if not lines or lines[0] != "---":
            problems.append(f"{relative}: first line is not `---`")
            continue

        try:
            closing = lines.index("---", 1)
        except ValueError:
            problems.append(f"{relative}: missing closing `---`")
            continue

        try:
            metadata = yaml.safe_load("\n".join(lines[1:closing]))
        except yaml.YAMLError as error:
            problems.append(f"{relative}: invalid YAML: {error}")
            continue

        if not isinstance(metadata, dict):
            problems.append(f"{relative}: frontmatter is not a mapping")
            continue
        for field in ("name", "description"):
            value = metadata.get(field)
            if not isinstance(value, str) or not value.strip():
                problems.append(f"{relative}: `{field}` must be a non-empty string")

    assert SKILL_FILES, "no product SKILL files found"
    assert not problems, "invalid skill frontmatter:\n  " + "\n  ".join(problems)


@pytest.mark.parametrize(
    ("provider", "discovery_dir"),
    (("claude", ".claude"), ("codex", ".agents")),
)
@pytest.mark.parametrize("locale", LOCALES)
def test_claude_and_codex_receive_parseable_localized_skills(
    tmp_path: Path, provider: str, discovery_dir: str, locale: str
) -> None:
    """Exercise the real distributor and the discovery tree used by each CLI."""
    workdir = tmp_path / provider / locale / "scout"
    result = subprocess.run(
        [
            "bash",
            "-c",
            'source ".launcher/spawn-lib.sh"; '
            f'jht_spawn_copy_skills scout "{workdir}" TEST "{provider}"',
        ],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_APP_ROOT": str(REPO_ROOT), "JHT_LANG": locale},
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    installed = sorted((workdir / discovery_dir / "skills").glob("*/SKILL.md"))
    assert installed, f"{provider}/{locale}: no skills installed"
    for path in installed:
        metadata = _metadata(path)
        assert isinstance(metadata.get("name"), str) and metadata["name"].strip()
        assert isinstance(metadata.get("description"), str) and metadata["description"].strip()
