-- ============================================================
-- Job Hunter Team — Pending User Messages
-- Migration 010: coda notifiche agente -> utente con fallback
-- Telegram -> dashboard web (decisione 2026-05-13).
--
-- Pattern: l'agente scrive una riga locale (jobs.db pending_user_messages),
-- prova jht-telegram-send; se Telegram non e' configurato/raggiungibile
-- il messaggio resta con delivered_via='web' e viene sincronizzato qui
-- via /api/cloud-sync/push. La dashboard /(protected)/dashboard mostra
-- i messaggi non ancora ack-ati; l'eventuale risposta utente torna
-- nell'agente al tick successivo via marker prompt-injection.
--
-- Mappatura locale -> cloud:
--   id (INTEGER autoincrement locale) -> legacy_id (BIGINT, unique x user)
--   related_position_id (FK locale)   -> related_position_id (FK UUID via lookup)
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_user_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- ID locale (jobs.db pending_user_messages.id). Unique per utente
    -- per garantire idempotenza degli upsert su (user_id, legacy_id).
    legacy_id BIGINT NOT NULL,
    agent TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'notification' CHECK (kind IN (
        'notification', 'question', 'digest', 'alert'
    )),
    -- FK cloud verso positions (UUID). Risolto server-side via legacy_id.
    related_position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    delivered_via TEXT CHECK (delivered_via IN ('telegram', 'web')),
    delivered_at TIMESTAMPTZ,
    -- Acknowledgment dell'utente via dashboard. Riempire questo campo
    -- significa "ho letto, marcalo come visto"; non comporta una risposta.
    acknowledged_at TIMESTAMPTZ,
    -- Risposta utente via dashboard (canale fallback alla risposta su TG).
    -- L'agente, al tick successivo dopo il pull cloud->local, vede questo
    -- campo e lo processa via marker prompt-injection.
    user_reply TEXT,
    user_reply_at TIMESTAMPTZ,
    -- L'agente marca questa colonna dopo aver processato la risposta,
    -- per evitare di rispondere due volte allo stesso reply.
    agent_seen_reply_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, legacy_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_user_messages_user_pending
    ON pending_user_messages(user_id, acknowledged_at)
    WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_user_messages_user_replies
    ON pending_user_messages(user_id, user_reply_at)
    WHERE user_reply_at IS NOT NULL AND agent_seen_reply_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_user_messages_legacy
    ON pending_user_messages(user_id, legacy_id);

-- Auto-update updated_at on row modifications (riusa la funzione
-- `update_updated_at` definita in 001_schema.sql).
DROP TRIGGER IF EXISTS pending_user_messages_updated_at ON pending_user_messages;
CREATE TRIGGER pending_user_messages_updated_at
    BEFORE UPDATE ON pending_user_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

ALTER TABLE pending_user_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own pending messages" ON pending_user_messages;
CREATE POLICY "Users can view own pending messages"
    ON pending_user_messages FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE lato utente: SELECT + UPDATE (per acknowledged /
-- user_reply / agent_seen). Gli INSERT veri arrivano dal service-role
-- usato da /api/cloud-sync/push, che bypassa RLS.
DROP POLICY IF EXISTS "Users can update own pending messages" ON pending_user_messages;
CREATE POLICY "Users can update own pending messages"
    ON pending_user_messages FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
