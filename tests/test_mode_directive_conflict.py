import importlib.util

from pathlib import Path

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("mode_banner", ROOT / "shared/skills/mode_banner.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def test_newer_directive_wins_and_is_explicit():
    m = {"since": "2026-08-13 10:00 UTC"}
    rows = [{"id": 4, "body": "harvest only", "created_at": "2026-08-13 11:00:00", "updated_at": None}]
    assert mod.resolve_user_conflicts(m, rows, mod.MODE_HARVEST)[0]["winner"] == "directive"


def test_newer_mode_wins_symmetrically():
    m = {"since": "2026-08-13 12:00 UTC"}
    rows = [{"id": 4, "body": "harvest only", "created_at": "2026-08-13 11:00:00", "updated_at": None}]
    assert mod.resolve_user_conflicts(m, rows, mod.MODE_HARVEST)[0]["winner"] == "mode"


def test_null_and_tie_fail_closed():
    m = {"since": "2026-08-13 10:00 UTC"}
    assert mod.resolve_user_conflicts(m, [{"id": 1, "body": "harvest", "created_at": None}], mod.MODE_HARVEST)[0]["winner"] == "unknown"
    assert mod.resolve_user_conflicts(m, [{"id": 1, "body": "harvest", "created_at": "2026-08-13 10:00:00"}], mod.MODE_HARVEST)[0]["winner"] == "unknown"

def test_localized_semantic_catalog_catches_real_phrases():
    m = {"since": "2026-08-13 10:00 UTC"}
    for body in ("modalità: cura", "modo: ahorro", "nur stop scouting", "solo revisar mensajes del usuario"):
        assert mod.resolve_user_conflicts(m, [{"id": 1, "body": body, "created_at": "2026-08-13 11:00:00"}], mod.MODE_CARE)
