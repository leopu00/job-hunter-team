"""Detached kickoff diagnostics survive a container recreation."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")


def _function(name: str, next_name: str) -> str:
    start = SOURCE.index(f"{name}() {{")
    end = SOURCE.index(f"{next_name}() {{", start)
    return SOURCE[start:end]


def test_kickoff_log_uses_the_persistent_rotating_log_directory():
    kickoff = _function("_kickoff", "_welcome_kickoff")
    assert 'jht_daemon_log "kickoff-${sess}.log"' in kickoff
    assert 'JHT_KICKOFF_LOG="$kickoff_log"' in kickoff
    assert "/tmp/kickoff-" not in kickoff


def test_welcome_watchdog_log_uses_the_same_persistent_directory():
    start = SOURCE.index("_welcome_kickoff() {")
    welcome = SOURCE[start: SOURCE.index('\nif [ "$ROLE" = "assistente" ]', start)]
    assert 'jht_daemon_log "welcome-watchdog-${role}.log"' in welcome
    assert 'JHT_WELCOME_LOG="$welcome_log"' in welcome
    assert "/tmp/welcome-watchdog-" not in welcome
