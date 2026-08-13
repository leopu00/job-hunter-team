"""Contract tests for the production-only manual-application RPC hotfix.

The CI PG16 job executes this migration against its production-like schema;
these source checks keep the small hotfix from silently absorbing batch-sync
functions or losing its tenant/lock/idempotency guards.
"""
from pathlib import Path

ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / "supabase/migrations/077_application_mark_undo_hotfix.sql"


def test_hotfix_is_narrow_and_reapplicable():
    sql = MIGRATION.read_text()
    assert sql.count("CREATE OR REPLACE FUNCTION") == 2
    assert "mark_position_applied" in sql
    assert "undo_manual_position_application" in sql
    assert "CREATE OR REPLACE FUNCTION public.sync_upsert_applications" not in sql
    assert "CREATE OR REPLACE" in sql  # rerun is an intentional no-op install
    assert "SECURITY INVOKER" in sql
    assert "auth.uid()" in sql
    assert "FOR UPDATE" in sql
    assert "ON CONFLICT (position_id) DO UPDATE" in sql
    assert "ON CONFLICT (user_id, position_legacy_id, ts, by_agent, to_state)" in sql


def test_hotfix_preserves_double_click_and_undo_guards():
    sql = MIGRATION.read_text()
    assert "position_row.status IS DISTINCT FROM 'applied'" in sql
    assert "applied_by_team" in sql
    assert "applied = FALSE" in sql
    assert "applied_at = NULL" in sql
    assert "applied_via = NULL" in sql
    assert "GRANT EXECUTE" in sql
    assert "REVOKE ALL" in sql
    assert "FROM anon, service_role" in sql
