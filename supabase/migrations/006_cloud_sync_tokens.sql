-- ============================================================
-- Job Hunter Team — Cloud Sync Tokens
-- Migration 006: API tokens per sync CLI/headless ↔ Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_sync_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_tokens_user_id
    ON cloud_sync_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_tokens_hash_active
    ON cloud_sync_tokens(token_hash) WHERE revoked_at IS NULL;

ALTER TABLE cloud_sync_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cloud sync tokens" ON cloud_sync_tokens;
CREATE POLICY "Users can view own cloud sync tokens"
    ON cloud_sync_tokens FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own cloud sync tokens" ON cloud_sync_tokens;
CREATE POLICY "Users can insert own cloud sync tokens"
    ON cloud_sync_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own cloud sync tokens" ON cloud_sync_tokens;
CREATE POLICY "Users can update own cloud sync tokens"
    ON cloud_sync_tokens FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own cloud sync tokens" ON cloud_sync_tokens;
CREATE POLICY "Users can delete own cloud sync tokens"
    ON cloud_sync_tokens FOR DELETE
    USING (auth.uid() = user_id);
