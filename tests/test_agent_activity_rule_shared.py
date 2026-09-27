"""The agents' status has ONE rule: the Godot game's pane reader.

The game pipes game/scripts/backend/payloads/agent_activity.py into the
container; the cloud daemon cannot, because game/ stays out of the image
(.dockerignore), so it runs shared/skills/agent_activity.py
(cli/src/lib/agents-status.js). The two must be the same file, byte for
byte: a change to one without the other would give the desktop office and
the game two different ideas of who is working.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game/scripts/backend/payloads/agent_activity.py"
SHARED = ROOT / "shared/skills/agent_activity.py"


def test_the_shared_rule_is_the_games_byte_for_byte():
    assert SHARED.read_bytes() == GAME.read_bytes()


def test_the_daemon_runs_the_shared_copy():
    js = (ROOT / "cli/src/lib/agents-status.js").read_text(encoding="utf-8")
    assert "shared/skills/agent_activity.py" in js
    assert "game/" not in js.split("RULE_SCRIPT =", 1)[1].split("\n", 1)[0]


def test_the_shared_copy_is_in_the_image():
    ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    rules = [line.strip() for line in ignore if line.strip() and not line.startswith("#")]
    assert not any(r.rstrip("/") in ("shared", "shared/skills", "**/shared", "**/skills") for r in rules)
