-- ============================================================
-- Job Hunter Team — Profile redesign (1/3): core + contacts
-- Migration 033.  Vedi docs/internal/candidate-profile-cloud-sync-redesign-2026-06-05.md
--
-- Modello a 3 livelli. Questo file:
--   (a) estende candidate_profiles con i pochi scalari L1 mancanti
--   (b) crea candidate_contacts (PII, 1:1) — separata per poterla
--       trattare a parte (reveal-on-click UI + cifratura a-riposo).
--
-- Additivo e idempotente: NON tocca dati esistenti, non rimuove colonne.
-- Le colonne JSONB legacy (skills/languages/positioning) restano per
-- retro-compat durante il cutover; il push le popolera' in parallelo alle
-- nuove tabelle finche' il web non migra a leggere da queste (Fase 4).
-- ============================================================

-- ── (a) candidate_profiles: scalari L1 mancanti ──────────────
ALTER TABLE candidate_profiles
    ADD COLUMN IF NOT EXISTS timezone       TEXT,
    ADD COLUMN IF NOT EXISTS industry       TEXT,
    ADD COLUMN IF NOT EXISTS schema_version SMALLINT NOT NULL DEFAULT 1;

-- ── (b) candidate_contacts (PII, 1:1) ────────────────────────
-- ⚠️ PII. Oggi in chiaro con RLS select-own (l'utente legge solo i propri
-- contatti; la scrittura e' server-side via service role). Il masking
-- "reveal-on-click" e' lato UI. La cifratura A-RIPOSO (pgcrypto o
-- encrypted_user_blobs) e' un follow-up DA FARE prima del go-live con
-- utenti reali — tracciato nel design doc §PII.
CREATE TABLE IF NOT EXISTS candidate_contacts (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT,
    phone      TEXT,
    linkedin   TEXT,
    github     TEXT,
    website    TEXT,
    address    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE candidate_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "candidate_contacts select own" ON candidate_contacts;
CREATE POLICY "candidate_contacts select own"
    ON candidate_contacts FOR SELECT
    USING ((select auth.uid()) = user_id);
