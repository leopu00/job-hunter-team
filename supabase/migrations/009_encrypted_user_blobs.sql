-- ============================================================
-- Job Hunter Team — Encrypted User Blobs
-- Migration 009: client-side encrypted blobs for cross-device sync
-- (launcher config, preferences, VPS metadata, tailscale auth-key).
--
-- Threat model: the server stores ciphertext only. The decryption key
-- is derived client-side from a user-chosen passphrase via PBKDF2-
-- SHA512 (with future migration path to Argon2id, tracked via
-- kdf_version). Server admin holding raw DB cannot decrypt.
--
-- Hetzner API token and SSH keys NEVER hit this table — they stay in
-- the local OS keychain on each device. See JHT-DESKTOP-SYNC spec.
-- ============================================================

CREATE TABLE IF NOT EXISTS encrypted_user_blobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Logical name for the blob (e.g. 'config_v1', 'vps_metadata_v1').
    -- Versioning is intentional: bumping the suffix is how we ship
    -- breaking schema changes without orphaning old clients.
    blob_type TEXT NOT NULL CHECK (char_length(blob_type) BETWEEN 1 AND 64),
    -- Algorithm/format envelope identifier. 1 = PBKDF2-SHA512-100k +
    -- AES-256-GCM. Future: 2 = Argon2id + AES-256-GCM.
    kdf_version SMALLINT NOT NULL DEFAULT 1,
    kdf_salt BYTEA NOT NULL,
    kdf_iterations INTEGER NOT NULL,
    cipher_iv BYTEA NOT NULL,
    cipher_auth_tag BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    -- Free-form client-side metadata (non-sensitive: schema version,
    -- device label, etc.). Plain JSON, NOT encrypted.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, blob_type)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_user_blobs_user_id
    ON encrypted_user_blobs(user_id);

-- Auto-update updated_at on row modifications.
CREATE OR REPLACE FUNCTION encrypted_user_blobs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS encrypted_user_blobs_updated_at ON encrypted_user_blobs;
CREATE TRIGGER encrypted_user_blobs_updated_at
    BEFORE UPDATE ON encrypted_user_blobs
    FOR EACH ROW
    EXECUTE FUNCTION encrypted_user_blobs_set_updated_at();

ALTER TABLE encrypted_user_blobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own encrypted blobs" ON encrypted_user_blobs;
CREATE POLICY "Users can view own encrypted blobs"
    ON encrypted_user_blobs FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own encrypted blobs" ON encrypted_user_blobs;
CREATE POLICY "Users can insert own encrypted blobs"
    ON encrypted_user_blobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own encrypted blobs" ON encrypted_user_blobs;
CREATE POLICY "Users can update own encrypted blobs"
    ON encrypted_user_blobs FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own encrypted blobs" ON encrypted_user_blobs;
CREATE POLICY "Users can delete own encrypted blobs"
    ON encrypted_user_blobs FOR DELETE
    USING (auth.uid() = user_id);
