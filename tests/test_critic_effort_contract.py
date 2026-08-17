"""O-77 — provider configuration wins over prompt instructions.

The Writer used to duplicate the provider-to-CLI table in seven localized
``critic-loop`` skills and create tmux sessions directly.  A standing directive
could therefore replace that command with an obsolete absolute Claude path.
The contract is now structural: the skill only supplies role+Writer instance;
the canonical launcher owns provider, model, CLI, path and flags.
"""

from __future__ import annotations

import re
import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher" / "start-agent.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
DOCTOR_SPAWN = ROOT / ".launcher" / "spawn-doctor.sh"
MAINTAINER_SPAWN = ROOT / ".launcher" / "spawn-maintainer.sh"
TEAM_ROSTER = ROOT / "shared" / "skills" / "team_roster.py"
SKILLS = sorted((ROOT / "agents" / "_skills" / "critic-loop").glob("SKILL*.md"))
TRIAGE_SKILLS = sorted((ROOT / "agents" / "_skills" / "pipeline-triage").glob("SKILL*.md"))

EXPECTED_LOCALES = {"", ".it", ".es", ".de", ".fr", ".pt", ".hu"}
CANONICAL_CALL = 'bash /app/.launcher/start-agent.sh critico "$MY_NUMBER"'


def test_all_seven_locales_are_present() -> None:
    found = {p.name.replace("SKILL", "").replace(".md", "") for p in SKILLS}
    assert found == EXPECTED_LOCALES


@pytest.mark.parametrize("skill", SKILLS, ids=lambda p: p.name)
def test_every_locale_delegates_critic_launch_to_the_canonical_launcher(skill: Path) -> None:
    text = skill.read_text(encoding="utf-8")
    assert text.count(CANONICAL_CALL) == 1
    assert "Bash(bash /app/.launcher/start-agent.sh *)" in text

    # Provider selection in prose is allowed for explaining the policy; these
    # executable seams are not.  Their return would recreate a second source
    # of truth that a directive can override.
    forbidden = (
        "tmux new-session",
        "CRITICO_CMD",
        "CRITICO_PATH",
        "CRITICO_BIN",
        "PROVIDER=$(",
        'case "$PROVIDER"',
        "tmux send-keys",
    )
    assert not [token for token in forbidden if token in text]


def _spawn_name(role: str, prefix: str, instance: str = "") -> subprocess.CompletedProcess[str]:
    script = (
        f"source {SPAWN_LIB}; "
        f"jht_spawn_session_name {role!r} {prefix!r} {instance!r}"
    )
    return subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, timeout=30
    )


def test_launcher_resolves_writer_owned_critic_session_without_selecting_a_provider() -> None:
    result = _spawn_name("critico", "CRITICO", "2")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "CRITICO-S2"

    singleton = _spawn_name("critico", "CRITICO")
    assert singleton.returncode == 0
    assert singleton.stdout == "CRITICO"

    spec = importlib.util.spec_from_file_location("team_roster_o77", TEAM_ROSTER)
    roster = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(roster)
    assert roster.session_name("critico", 2) == "CRITICO-S2"


@pytest.mark.parametrize("bad", ["0", "01", "-1", "2;touch /tmp/x", "abc", "2/3"])
def test_critic_instance_is_fail_closed_and_never_becomes_shell_or_path_input(bad: str) -> None:
    result = _spawn_name("critico", "CRITICO", bad)
    assert result.returncode != 0
    assert result.stdout == ""


def test_launcher_has_no_implicit_provider_fallback() -> None:
    text = LAUNCHER.read_text(encoding="utf-8")
    assert '""|anthropic|claude)' not in text
    assert "falling back to claude" not in text
    assert "active_provider is missing or unsupported" in text
    assert re.search(r"case \"\$PROVIDER\" in", text)


def test_all_agent_repl_launchers_fail_closed_without_provider_configuration(tmp_path: Path) -> None:
    script = (
        f"export JHT_HOME={str(tmp_path)!r}; source {SPAWN_LIB}; "
        "jht_spawn_active_provider"
    )
    missing = subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, timeout=30
    )
    assert missing.returncode != 0
    assert missing.stdout == ""
    assert "active_provider is missing" in missing.stderr

    lib = SPAWN_LIB.read_text(encoding="utf-8")
    assert "get('active_provider','claude')" not in lib
    assert "|| echo claude" not in lib
    for launcher in (DOCTOR_SPAWN, MAINTAINER_SPAWN):
        text = launcher.read_text(encoding="utf-8")
        assert 'ACTIVE_PROVIDER="$(jht_spawn_active_provider)" || exit 1' in text
        assert 'jht_spawn_repl_cmd "$ACTIVE_PROVIDER"' in text


@pytest.mark.parametrize("skill", TRIAGE_SKILLS, ids=lambda p: p.name)
def test_captain_never_spawns_orphan_critics(skill: Path) -> None:
    text = skill.read_text(encoding="utf-8")
    assert "CRITICO-S2/S3/S4" not in text
    assert "CRITICO-SN" in text
