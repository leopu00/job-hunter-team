import base64
import json
from pathlib import Path


PAYLOAD = (
    Path(__file__).parents[1]
    / "game"
    / "scripts"
    / "backend"
    / "payloads"
    / "hours_save.py"
)


def _run_payload(tmp_path: Path, initial: object | None = None) -> dict:
    config = tmp_path / "jht.config.json"
    if initial is not None:
        config.write_text(json.dumps(initial), encoding="utf-8")

    hours = {
        "timezone": "Europe/Rome",
        "windows": [
            {
                "days": ["mon", "tue", "wed", "thu", "fri"],
                "start": "09:00",
                "end": "18:00",
            }
        ],
    }
    encoded = base64.b64encode(json.dumps(hours).encode()).decode()
    source = PAYLOAD.read_text(encoding="utf-8")
    source = source.replace("/jht_home/jht.config.json", str(config)) % encoded
    exec(compile(source, str(PAYLOAD), "exec"), {})
    return json.loads(config.read_text(encoding="utf-8"))


def test_hours_can_be_first_setup_step(tmp_path: Path) -> None:
    config = _run_payload(tmp_path)

    assert config["team"]["working_hours"]["timezone"] == "Europe/Rome"


def test_hours_preserve_existing_config(tmp_path: Path) -> None:
    config = _run_payload(
        tmp_path,
        {"active_provider": "codex", "provider": {"plan": "plus"}},
    )

    assert config["active_provider"] == "codex"
    assert config["provider"] == {"plan": "plus"}
