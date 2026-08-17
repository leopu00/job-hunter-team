"""Release exports block on game gates, never on observation-only tests."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build-release.sh"
GAME_WORKFLOW = ROOT / ".github" / "workflows" / "game.yml"


def workflow_step(source: str, name: str) -> str:
    marker = f"      - name: {name}\n"
    assert source.count(marker) == 1
    block = source.split(marker, 1)[1].split("\n      - name:", 1)[0]
    return "\n".join(
        line for line in block.splitlines() if not line.lstrip().startswith("#")
    )


def test_release_builder_selects_only_the_blocking_tier_on_both_hosts() -> None:
    source = BUILDER.read_text(encoding="utf-8")
    runner_lines = [
        line.strip()
        for line in source.splitlines()
        if 'tools/run.sh" test' in line or 'tools/run.ps1" test' in line
    ]

    assert runner_lines == [
        "powershell.exe -NoProfile -ExecutionPolicy Bypass "
        '-File "$GAME_DIR/tools/run.ps1" test gate',
        '"$GAME_DIR/tools/run.sh" test gate',
    ]
    assert all(not line.endswith(" test") for line in runner_lines)
    assert all(
        " test all" not in line and " test watch" not in line for line in runner_lines
    )


def test_watch_tier_is_explicitly_non_blocking_only_in_game_workflow() -> None:
    source = GAME_WORKFLOW.read_text(encoding="utf-8")
    executable_source = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    )
    gate_steps = (
        workflow_step(source, "Run deterministic game tests (gate)"),
        workflow_step(source, "Run deterministic game tests through PowerShell (gate)"),
    )
    watch_steps = (
        workflow_step(
            source, "Run game tests under observation (watch - non blocking)"
        ),
        workflow_step(
            source,
            "Run game tests under observation through PowerShell (watch - non blocking)",
        ),
    )

    assert all(" test gate" in step for step in gate_steps)
    assert all("continue-on-error:" not in step for step in gate_steps)
    assert all(" test watch" in step for step in watch_steps)
    assert all("continue-on-error: true" in step for step in watch_steps)
    assert executable_source.count(" test watch") == 2
    assert " test watch" not in BUILDER.read_text(encoding="utf-8")
