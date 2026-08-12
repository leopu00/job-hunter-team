"""JHT-SKILLS-SYMLINK-TEST — distribuzione riproducibile per ruolo.

Il test non avvia provider o sessioni tmux: esercita il distributore reale con
un piccolo albero ``agents/`` temporaneo.  Il ``skills.list`` della fixture
resta la sola autorita' per le skill condivise; le private vengono scoperte
dal pool del ruolo, come nel contratto del launcher.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _bash_path(path: Path) -> str:
    posix = path.resolve().as_posix()
    if len(posix) >= 3 and posix[1:3] == ":/":
        return f"/mnt/{posix[0].lower()}/{posix[3:]}"
    return posix


def _skill(pool: Path, name: str, marker: str) -> None:
    skill = pool / name
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(marker, encoding="utf-8")


def _names(path: Path) -> set[str]:
    return {entry.name for entry in path.iterdir() if entry.is_dir()}


def test_role_distribution_is_identical_and_isolated_for_both_providers(
    tmp_path: Path,
) -> None:
    app = tmp_path / "app"
    shared = app / "agents" / "_skills"
    captain_private = app / "agents" / "capitano" / "_skills"
    sentinel_private = app / "agents" / "sentinella" / "_skills"

    _skill(shared, "shared-alpha", "shared alpha")
    _skill(shared, "shared-beta", "shared beta")
    _skill(shared, "_lib", "implementation detail")
    _skill(captain_private, "captain-private", "captain only")
    _skill(captain_private, "_lib", "private implementation detail")
    _skill(sentinel_private, "sentinel-private", "sentinel only")
    (app / "agents" / "capitano" / "skills.list").write_text(
        "# source of truth for shared skills\n"
        "shared-alpha  # inline comments are allowed\n"
        "_lib          # must never become a discoverable skill\n",
        encoding="utf-8",
    )

    workdir = tmp_path / "runtime" / "capitano"
    for provider_dir in (".claude", ".agents"):
        leaked = workdir / provider_dir / "skills" / "sentinel-private"
        leaked.mkdir(parents=True)
        (leaked / "SKILL.md").write_text("stale leakage", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            "-c",
            f'export JHT_APP_ROOT="{_bash_path(app)}" JHT_LANG=en; '
            'source ".launcher/spawn-lib.sh"; '
            f'jht_spawn_copy_skills capitano "{_bash_path(workdir)}" TEST',
        ],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    expected = {"shared-alpha", "captain-private"}
    claude = workdir / ".claude" / "skills"
    agents = workdir / ".agents" / "skills"
    assert _names(claude) == expected
    assert _names(agents) == expected
    assert (claude / "shared-alpha" / "SKILL.md").read_text() == "shared alpha"
    assert (agents / "captain-private" / "SKILL.md").read_text() == "captain only"


def test_start_agent_uses_the_shared_distribution_authority() -> None:
    source = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")

    assert 'jht_spawn_copy_skills "$ROLE" "$AGENT_DIR"' in source


@pytest.mark.parametrize(
    ("provider", "discovery_dir"),
    [
        ("claude", ".claude"),
        ("codex", ".agents"),
        ("kimi", ".agents"),
    ],
)
def test_known_provider_populates_only_its_official_discovery_tree(
    tmp_path: Path,
    provider: str,
    discovery_dir: str,
) -> None:
    app = tmp_path / "app"
    _skill(app / "agents" / "_skills", "shared-alpha", "shared alpha")
    role = app / "agents" / "capitano"
    role.mkdir(parents=True)
    (role / "skills.list").write_text("shared-alpha\n", encoding="utf-8")
    workdir = tmp_path / "runtime" / "capitano"
    for provider_dir in (".claude", ".agents"):
        _skill(workdir / provider_dir / "skills", "stale", "must disappear")

    result = subprocess.run(
        [
            "bash",
            "-c",
            f'export JHT_APP_ROOT="{_bash_path(app)}" JHT_LANG=en; '
            'source ".launcher/spawn-lib.sh"; '
            f'jht_spawn_copy_skills capitano "{_bash_path(workdir)}" TEST '
            f'"{provider}"',
        ],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert _names(workdir / discovery_dir / "skills") == {"shared-alpha"}
    unused_dir = ".agents" if discovery_dir == ".claude" else ".claude"
    unused = workdir / unused_dir / "skills"
    assert not unused.exists() or _names(unused) == set()
