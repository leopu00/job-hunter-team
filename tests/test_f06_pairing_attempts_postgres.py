from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/084_cloud_sync_pairing_attempts.sql"


def test_f06_migration_is_collision_gated_and_tenant_bound():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "084 collision" in sql
    assert "user_id uuid primary key" in sql
    assert "for update" in sql.lower()
    assert "invalidated_at" in sql
    assert "consume_pairing_attempt" in sql
    assert "grant execute" in sql and "service_role" in sql


def test_f06_no_raw_upstash_configuration_is_exposed():
    source = (ROOT / "web/lib/upstash-config.ts").read_text(encoding="utf-8")
    assert "UPSTASH_REDIS_REST_TOKEN" in source
    assert "return token" not in source
    assert "urlHost" in source
