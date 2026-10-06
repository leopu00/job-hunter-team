"""Release exports block on game gates, never on observation-only tests."""

from pathlib import Path
import re

import yaml

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts" / "build-release.sh"
WORKFLOWS = ROOT / ".github" / "workflows"
GAME_WORKFLOW = WORKFLOWS / "game.yml"
# `bash game/tools/run.sh test gate`, `./game/tools/run.ps1 test watch`, ...
RUNNER_RE = re.compile(r'tools/run\.(?:sh|ps1)"?\s+test(?:\s+(\w+))?')


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


def _game_runner_steps() -> list[tuple[str, str, dict]]:
    """Every workflow step that invokes the Godot test runner."""
    found = []
    for workflow in sorted(WORKFLOWS.glob("*.yml")):
        # BaseLoader keeps `on` as text and Actions expressions intact.
        data = yaml.load(workflow.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
        for job_name, job in (data.get("jobs") or {}).items():
            for step in job.get("steps") or []:
                if RUNNER_RE.search(str(step.get("run", ""))):
                    found.append((workflow.name, job_name, step))
    return found


def test_watch_tier_never_blocks_a_workflow() -> None:
    steps = _game_runner_steps()

    # Since the Tauri 2 switch (d3a9d4bbb) `game.yml` is the Tauri distribution
    # matrix and `game/` is legacy that no workflow tests or ships
    # (docs/internal/ops/release.md). The gate/watch steps this test used to
    # pin were removed on purpose. Whoever brings the Godot runner back into a
    # workflow must update this line, and the tier rule below then applies.
    assert steps == []

    for workflow, job, step in steps:
        tiers = [
            match.group(1) for match in RUNNER_RE.finditer(str(step["run"]))
        ]
        where = f"{workflow}:{job}:{step.get('name')}"
        assert tiers and all(tier in {"gate", "watch"} for tier in tiers), where
        if "watch" in tiers:
            assert step.get("continue-on-error") == "true", where
        else:
            assert "continue-on-error" not in step, where
