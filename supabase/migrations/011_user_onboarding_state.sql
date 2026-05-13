-- ============================================================
-- Job Hunter Team — User Onboarding State
-- Migration 011: flag espliciti per il funnel di onboarding cloud.
-- Decisione 2026-05-14: il dashboard /(protected)/dashboard deve
-- distinguere 3 stati e mostrare 3 schermi diversi:
--
--   A) Utente loggato sul web, MAI fatto setup → CloudDownloadLanding
--      (push verso scarica app desktop + setup VPS/locale)
--   B) VPS pairing completato MA profilo non ancora configurato
--      → VpsSetupCompleteLanding (celebrazione + CTA Telegram/web)
--   C) Setup VPS + profilo configurato → dashboard normale
--
-- Prima usavamo l'inferenza (cloud_sync_tokens presente = setup VPS,
-- candidate_profiles presente = profilo OK), fragile perche' un token
-- attivo non garantisce che il pairing sia effettivamente arrivato a
-- termine, e il dashboard collassava B+C in un unico stato.
--
-- Ora i due punti chiave segnano lo stato esplicitamente:
--   - device-register/route.ts (consume pairing token) → vps_setup_completed_at
--   - push/route.ts (upsert candidate_profiles success) → profile_configured_at
--
-- I valori sono "primo successo": una volta settati non vengono
-- sovrascritti da pair successivi o sync ripetuti.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_onboarding_state (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    vps_setup_completed_at TIMESTAMPTZ,
    profile_configured_at  TIMESTAMPTZ,
    first_team_run_at      TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_state_vps_setup
    ON user_onboarding_state(user_id)
    WHERE vps_setup_completed_at IS NOT NULL;

-- RLS: l'utente puo' leggere solo il proprio stato. Scrittura sempre
-- server-side via service role (device-register / push) — non esponiamo
-- INSERT/UPDATE al client per evitare che un user marchi se stesso come
-- "setup completato" senza aver effettivamente fatto il pairing.
ALTER TABLE user_onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own onboarding state"
    ON user_onboarding_state FOR SELECT
    USING (auth.uid() = user_id);

-- ============================================================
-- Backfill: utenti gia' attivi prima di questa migration.
--
-- 1) Chi ha gia' un cloud_sync_token non revocato aveva completato
--    il pairing VPS (cloud_sync_tokens viene inserito SOLO dopo
--    consume del pairing token in device-register).
-- 2) Chi ha gia' una riga in candidate_profiles aveva configurato
--    il profilo (e' l'unica strada di inserimento via push).
--
-- Usiamo MIN(created_at) per vps_setup_completed_at in modo che il
-- valore rispecchi il momento storico del primo pairing, non il
-- momento della migration. Per profile_configured_at non abbiamo il
-- timestamp originale (candidate_profiles non lo conserva esplicitamente
-- a livello di "primo sync"), quindi usiamo now() come fallback.
-- ============================================================

INSERT INTO user_onboarding_state (user_id, vps_setup_completed_at, created_at, updated_at)
SELECT
    user_id,
    MIN(created_at) AS vps_setup_completed_at,
    now(),
    now()
FROM cloud_sync_tokens
WHERE revoked_at IS NULL
GROUP BY user_id
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_onboarding_state (user_id, profile_configured_at, created_at, updated_at)
SELECT user_id, now(), now(), now()
FROM candidate_profiles
ON CONFLICT (user_id) DO UPDATE
    SET profile_configured_at = COALESCE(
        user_onboarding_state.profile_configured_at,
        EXCLUDED.profile_configured_at
    ),
    updated_at = now();
