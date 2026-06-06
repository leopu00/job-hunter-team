-- ============================================================
-- Job Hunter Team — Profile redesign (3/3): blocchi L2/L3
-- Migration 035.  Vedi candidate-profile-cloud-sync-redesign-2026-06-05.md
--
-- candidate_blocks = strato semi-libero del profilo:
--   L2 = slot standard (key: about, goals, preferences, strengths…)
--   L3 = blocchi custom per-persona (key libera)
-- Entrambi tipizzati da `kind` (il "contratto" di rendering — l'analogo di
-- positions.role_family per il donut /map). Il web ha 1 renderer per kind,
-- quindi un blocco nuovo si mostra senza codice.
--
-- `content` JSONB: forma dipende dal kind (validata a monte da
-- shared/skills/validate_profile.py + shared/config/profile-schema.ts).
-- Additivo e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS candidate_blocks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,                 -- slug stabile (about, consulting_fit, …)
    kind       TEXT NOT NULL CHECK (kind IN (
                   'key_value', 'tag_list', 'timeline',
                   'narrative', 'key_points', 'distribution')),
    title      TEXT NOT NULL CHECK (char_length(title) <= 200),
    content    JSONB NOT NULL DEFAULT '[]'::jsonb,
    ord        INT NOT NULL DEFAULT 0,
    source     TEXT CHECK (source IS NULL OR source IN ('assistant', 'web', 'import')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_candidate_blocks_user ON candidate_blocks(user_id);

ALTER TABLE candidate_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "candidate_blocks select own" ON candidate_blocks;
CREATE POLICY "candidate_blocks select own"
    ON candidate_blocks FOR SELECT
    USING ((select auth.uid()) = user_id);
