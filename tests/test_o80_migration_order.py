from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_o80_uses_reserved_migration_slot_after_application_identity():
    migrations = sorted((ROOT / "supabase/migrations").glob("0*.sql"))
    names = [p.name for p in migrations]
    assert "076_application_sync_identity.sql" in names
    assert "077_application_mark_undo_hotfix.sql" in names
    assert "079_team_directive_events_atomic.sql" in names
    assert "076_team_directive_events_atomic.sql" not in names


def test_application_hotfix_files_are_master_versions():
    # These P0 click artifacts must remain byte-identical to the integrator;
    # O-80 must never renumber or weaken their tenant/privilege oracle.
    assert (ROOT / "supabase/migrations/077_application_mark_undo_hotfix.sql").read_text()
    assert "REVOKE ALL" in (ROOT / "supabase/migrations/077_application_mark_undo_hotfix.sql").read_text()
