"""Regressions for provider-neutral role prompts used by the runtime."""

from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SENTINEL_PROMPTS = [
    REPO_ROOT / "agents" / "sentinella" / name
    for name in (
        "sentinella.md",
        "sentinella.it.md",
        "sentinella.es.md",
        "sentinella.fr.md",
        "sentinella.de.md",
        "sentinella.hu.md",
        "sentinella.pt.md",
    )
]


@pytest.mark.parametrize("prompt", SENTINEL_PROMPTS, ids=lambda path: path.name)
def test_sentinel_points_each_provider_to_its_runtime_skill_directory(prompt):
    """Codex must not be told to inspect Claude Code's private directory.

    The launcher installs the same role skills under both provider-native
    roots. Every localized system prompt must therefore preserve both paths.
    """
    text = prompt.read_text(encoding="utf-8")

    assert ".claude/skills/" in text
    assert ".agents/skills/" in text
