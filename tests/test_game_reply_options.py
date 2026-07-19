import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "agents/_skills/game-reply-options/jht-reply-options.py"


def test_reply_options_writes_valid_contextual_choices(tmp_path: Path) -> None:
    env = os.environ.copy()
    env["JHT_AGENT_DIR"] = str(tmp_path)
    result = subprocess.run(
        [str(TOOL), "--prompt", "Da dove partiamo?", "Profilo", "Mappa", "Posizioni"],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    entry = json.loads((tmp_path / "chat.jsonl").read_text().strip())
    assert entry["role"] == "assistant"
    assert entry["done"] is True
    assert entry["text"] == "Da dove partiamo?"
    assert [choice["label"] for choice in entry["choices"]] == [
        "Profilo", "Mappa", "Posizioni"
    ]


def test_reply_options_rejects_unbounded_or_single_choice(tmp_path: Path) -> None:
    env = os.environ.copy()
    env["JHT_AGENT_DIR"] = str(tmp_path)
    result = subprocess.run(
        [str(TOOL), "--prompt", "Scegli", "Una sola"],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert not (tmp_path / "chat.jsonl").exists()


def test_core_agents_install_the_skill() -> None:
    for agent in ("assistente", "capitano", "mentor"):
        manifest = (ROOT / f"agents/{agent}/skills.list").read_text()
        assert "game-reply-options" in {
            line.strip() for line in manifest.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
