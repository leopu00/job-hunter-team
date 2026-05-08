-- ============================================================
-- Job Hunter Team — Cloud Sync Pairing Sessions (device flow)
-- Migration 008: ephemeral pairing sessions for `jht cloud login`
-- ============================================================
--
-- Implementa il pattern OAuth 2.0 Device Authorization Grant (RFC 8628)
-- per il pairing CLI ↔ account web SENZA token paste manuale:
--
--   1. CLI POST /api/cloud-sync/device-init (no auth) → genera (device_code, user_code)
--   2. CLI mostra "vai su /cli-link, digita CODE-1234"
--   3. Utente loggato apre /cli-link, digita user_code, conferma
--   4. Web POST /api/cloud-sync/device-confirm (auth) → genera jht_sync_* token,
--      lo associa alla sessione, status='approved'
--   5. CLI poll /api/cloud-sync/device-poll → riceve token, lo salva, fa push
--   6. Sessione cancellata dopo first read (one-shot redemption)
--
-- Rationale colonne:
-- - device_code (PK): token bearer-like che il CLI usa per polling. Random 32 chars.
-- - user_code: stringa human-readable (formato AAAA-1234) che l'utente
--   digita sul browser. Range entropy ~36^8 ≈ 2.8 trilioni, sufficiente
--   per finestra 10min con rate limit anti-brute-force.
-- - status: pending → approved → consumed. Non riapribile.
-- - approved_token: il jht_sync_* generato; nullable finche' status='pending'.
--   Vivente solo finche' status='approved' E non ancora letto. Cancellato
--   appena CLI lo legge (one-shot).
-- - approved_token_id: FK al cloud_sync_tokens, per tracciare quale token
--   e' stato emesso da questo pairing (audit + revoca).
-- - expires_at: 10 min default. Cleanup periodico via cron job lato server.

CREATE TABLE IF NOT EXISTS cloud_sync_pairing_sessions (
    device_code TEXT PRIMARY KEY,
    user_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'consumed', 'expired')),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    approved_token TEXT,
    approved_token_id UUID REFERENCES cloud_sync_tokens(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pairing_sessions_user_code
    ON cloud_sync_pairing_sessions(user_code) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pairing_sessions_expires_at
    ON cloud_sync_pairing_sessions(expires_at) WHERE status IN ('pending', 'approved');

-- RLS policies: device-init e device-poll sono PUBBLICI (no user context),
-- vengono chiamati con service_role lato server. device-confirm richiede
-- user autenticato. Quindi:
-- - Anonimo (anon role): NESSUN accesso diretto (le route API gestiscono).
-- - User autenticato: puo' leggere SOLO le proprie sessioni approved
--   (utile se UI futura vuole mostrare "VPS connesso da X")
-- - Service role: bypass RLS (usato da API routes)

ALTER TABLE cloud_sync_pairing_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own approved pairings" ON cloud_sync_pairing_sessions;
CREATE POLICY "Users can view own approved pairings"
    ON cloud_sync_pairing_sessions FOR SELECT
    USING (auth.uid() = user_id AND status IN ('approved', 'consumed'));

-- Cleanup function: una utility da chiamare via cron job esterno (Supabase
-- Edge Functions, GitHub Actions, ecc.). Marca expired le sessioni vecchie
-- e cancella quelle consumed da > 1 ora (audit retention minima).

CREATE OR REPLACE FUNCTION cleanup_pairing_sessions()
RETURNS TABLE(expired_count INT, deleted_count INT) AS $$
DECLARE
    expired INT;
    deleted INT;
BEGIN
    UPDATE cloud_sync_pairing_sessions
    SET status = 'expired'
    WHERE status IN ('pending', 'approved')
      AND expires_at < now();
    GET DIAGNOSTICS expired = ROW_COUNT;

    DELETE FROM cloud_sync_pairing_sessions
    WHERE (status = 'consumed' AND consumed_at < now() - interval '1 hour')
       OR (status = 'expired' AND expires_at < now() - interval '1 day');
    GET DIAGNOSTICS deleted = ROW_COUNT;

    RETURN QUERY SELECT expired, deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
