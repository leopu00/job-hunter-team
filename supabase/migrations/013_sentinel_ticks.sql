-- ============================================================
-- Job Hunter Team — Sentinel / Bridge ticks
-- Migration 013: storico rate-budget sincronizzato dalla VPS al cloud.
--
-- Source locale:
--   /jht_home/logs/sentinel-data.jsonl
--
-- Flow:
--   sentinel-bridge.py scrive un sample JSONL a ogni tick →
--   `jht cloud daemon` include gli ultimi sample nel payload push →
--   /api/cloud-sync/push fa upsert idempotente su (user_id, sample_key) →
--   /api/sentinella/data legge questa tabella su jobhunterteam.ai.
-- ============================================================

CREATE TABLE IF NOT EXISTS sentinel_ticks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sample_key TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    provider TEXT NOT NULL,
    usage NUMERIC NOT NULL,
    delta NUMERIC,
    velocity NUMERIC,
    velocity_smooth NUMERIC,
    velocity_ideal NUMERIC,
    projection NUMERIC,
    projection_naive NUMERIC,
    velocity_decreasing BOOLEAN,
    status TEXT NOT NULL,
    throttle INTEGER,
    reset_at TEXT,
    weekly_usage NUMERIC,
    source TEXT,
    session_id TEXT,
    host JSONB,
    host_level TEXT,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, sample_key)
);

CREATE INDEX IF NOT EXISTS idx_sentinel_ticks_user_ts
    ON sentinel_ticks(user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_sentinel_ticks_user_source_ts
    ON sentinel_ticks(user_id, source, ts DESC);

ALTER TABLE sentinel_ticks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sentinel ticks" ON sentinel_ticks;
CREATE POLICY "Users can view own sentinel ticks"
    ON sentinel_ticks FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT/UPDATE arrivano dal service-role usato da /api/cloud-sync/push.
