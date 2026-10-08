from pathlib import Path


START_AGENT = Path(__file__).parents[1] / ".launcher" / "start-agent.sh"


def test_start_agent_finds_clis_installed_in_persistent_dependency_volume() -> None:
    source = START_AGENT.read_text(encoding="utf-8")
    first_path_export = next(
        line for line in source.splitlines() if line.startswith("export PATH=")
    )

    # providers autoupdate persists npm CLIs in this volume-backed prefix.
    # A coordinator's command host may provide only /usr/local/bin:/usr/bin,
    # so start-agent.sh must restore the persistent paths itself (an agent's
    # TUI spawning workers depends on it).
    assert "/opt/jht-deps/bin" in first_path_export
    assert "/opt/jht-deps/npm-global/bin" in first_path_export
    assert "/opt/jht-deps/python/bin" in first_path_export
    assert "/jht_home/.npm-global/bin" in first_path_export
