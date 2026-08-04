from pathlib import Path


def test_start_agent_can_spawn_workers_from_an_agent_tui():
    source = (Path(__file__).parents[1] / ".launcher" / "start-agent.sh").read_text()
    first_export = next(
        line for line in source.splitlines() if line.startswith('export PATH="')
    )

    # providers autoupdate persists npm CLIs in this volume-backed prefix.
    # A coordinator's command host may provide only /usr/local/bin:/usr/bin,
    # so start-agent.sh must restore the persistent paths itself.
    assert "/opt/jht-deps/npm-global/bin" in first_export
    assert "/opt/jht-deps/bin" in first_export
    assert "/opt/jht-deps/python/bin" in first_export


def test_start_agent_serializes_before_rewriting_agent_skills():
    source = (Path(__file__).parents[1] / ".launcher" / "start-agent.sh").read_text()
    lock = source.index('flock -w 30 9')
    early_idempotence = source.index('if tmux has-session -t "$SESSION"', lock)
    destructive_sync = source.index('rm -rf "$CLAUDE_SKILLS_DIR"')

    assert lock < early_idempotence < destructive_sync
