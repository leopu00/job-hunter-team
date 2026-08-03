import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "shared/config/provider-touchpoints.json"


def test_provider_touchpoint_inventory_is_machine_verifiable():
    inventory = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert inventory["canonical_team_providers"] == ["claude", "openai", "kimi"]
    rows = inventory["touchpoints"]
    assert len(rows) >= 10
    assert len({row["id"] for row in rows}) == len(rows)

    for row in rows:
        path = ROOT / row["path"]
        assert path.is_file(), f"missing provider touchpoint: {row['path']}"
        content = path.read_text(encoding="utf-8")
        for anchor in row["anchors"]:
            assert anchor in content, f"stale anchor {anchor!r} in {row['path']}"


def test_inventory_keeps_local_scorer_out_of_canonical_team_provider_enum():
    inventory = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert "local-scorer" not in inventory["canonical_team_providers"]
    assert any(row["id"] == "local-scorer-adapter" for row in inventory["touchpoints"])
