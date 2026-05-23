-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 019 — team_state refactor (desired-state + event lanes)        ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Address P0 #1 from docs/internal/cloud-sync-architecture.md:             ║
-- ║                                                                          ║
-- ║   Cambio di paradigma da command log (team_commands) a desired-state     ║
-- ║   reconciler (Kubernetes-style). Motivato dalla visione web-first        ║
-- ║   (chat agenti, like/dislike, messaggi via DB).                          ║
-- ║                                                                          ║
-- ║ Tre tabelle nuove + 1 tabella audit:                                     ║
-- ║                                                                          ║
-- ║   • team_state          — 1 riga per user, desired + observed + device   ║
-- ║   • team_state_history  — audit via trigger AFTER UPDATE                 ║
-- ║   • user_to_agent_messages — chat user → agent (event log)               ║
-- ║   • position_feedback   — like/dislike/hide/star (event log)             ║
-- ║                                                                          ║
-- ║ team_commands resta intatta: cutover graduale (vedi step 5/6 backlog).   ║
-- ║                                                                          ║
-- ║ Tutte le RLS usano `(SELECT auth.uid())` (init plan friendly, vedi 018). ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ============================================================================
-- 1. team_state
-- ============================================================================
--
-- Single row per user. Web scrive il "desired", container scrive il "observed".
-- Reconciler: container confronta should_run/agents_enabled/restart_token con
-- la realtà e applica diff (start, stop, restart agenti).
--
-- Single-team enforcement (accorpa P0 #4 originale): active_device_id viene
-- claimato al boot del container via /api/team-state/claim. Push subsequent
-- da token con device_id diverso → 409 lato push route.
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_state (
    user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- 🌐 Web → Container (desired)
    should_run               BOOLEAN NOT NULL DEFAULT false,
    agents_enabled           JSONB   NOT NULL DEFAULT '{}'::jsonb,
    restart_token            UUID,

    -- 📡 Container → Web (observed)
    is_running               BOOLEAN NOT NULL DEFAULT false,
    last_heartbeat_at        TIMESTAMPTZ,
    last_restart_token       UUID,

    -- 🔒 Single-team enforcement
    active_device_id         UUID,
    active_device_claimed_at TIMESTAMPTZ,

    -- ⚡ Polling adattivo (P1 #6)
    last_user_activity_at    TIMESTAMPTZ,

    -- 📋 Audit minimale (dettaglio in team_state_history)
    last_action              TEXT,
    last_action_at           TIMESTAMPTZ,
    last_error               TEXT,
    last_error_at            TIMESTAMPTZ,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT team_state_agents_enabled_is_object
        CHECK (jsonb_typeof(agents_enabled) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_team_state_last_heartbeat
    ON team_state(last_heartbeat_at);

ALTER TABLE team_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own team state"
    ON team_state FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users insert own team state"
    ON team_state FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "users update own team state"
    ON team_state FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- 2. team_state_history (audit)
-- ============================================================================
--
-- Trigger AFTER UPDATE su team_state cattura ogni cambio significativo. Non
-- replica l'intero stato: salva solo (campo, vecchio, nuovo) per ogni colonna
-- monitorata. Manteniamo l'audit per chi/cosa/quando senza far esplodere
-- il volume.
--
-- Colonne monitorate: tutte tranne updated_at, last_heartbeat_at e
-- last_user_activity_at (rumore alto, basso valore audit).
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_state_history (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    old_value   JSONB,
    new_value   JSONB,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by  UUID
);

CREATE INDEX IF NOT EXISTS idx_team_state_history_user_time
    ON team_state_history(user_id, changed_at DESC);

ALTER TABLE team_state_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own team state history"
    ON team_state_history FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

-- Solo trigger (SECURITY DEFINER) può inserire — utente non scrive direttamente
CREATE POLICY "no direct insert team state history"
    ON team_state_history FOR INSERT
    WITH CHECK (false);

CREATE OR REPLACE FUNCTION team_state_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
BEGIN
    IF NEW.should_run IS DISTINCT FROM OLD.should_run THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'should_run', to_jsonb(OLD.should_run), to_jsonb(NEW.should_run), actor);
    END IF;

    IF NEW.agents_enabled IS DISTINCT FROM OLD.agents_enabled THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'agents_enabled', OLD.agents_enabled, NEW.agents_enabled, actor);
    END IF;

    IF NEW.restart_token IS DISTINCT FROM OLD.restart_token THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'restart_token', to_jsonb(OLD.restart_token), to_jsonb(NEW.restart_token), actor);
    END IF;

    IF NEW.is_running IS DISTINCT FROM OLD.is_running THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'is_running', to_jsonb(OLD.is_running), to_jsonb(NEW.is_running), actor);
    END IF;

    IF NEW.active_device_id IS DISTINCT FROM OLD.active_device_id THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'active_device_id', to_jsonb(OLD.active_device_id), to_jsonb(NEW.active_device_id), actor);
    END IF;

    IF NEW.last_action IS DISTINCT FROM OLD.last_action THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'last_action', to_jsonb(OLD.last_action), to_jsonb(NEW.last_action), actor);
    END IF;

    IF NEW.last_error IS DISTINCT FROM OLD.last_error THEN
        INSERT INTO team_state_history(user_id, field, old_value, new_value, changed_by)
        VALUES (NEW.user_id, 'last_error', to_jsonb(OLD.last_error), to_jsonb(NEW.last_error), actor);
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_team_state_audit
    AFTER UPDATE ON team_state
    FOR EACH ROW
    EXECUTE FUNCTION team_state_audit_trigger();

-- Tieni updated_at automatico
CREATE OR REPLACE FUNCTION team_state_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_team_state_touch_updated_at
    BEFORE UPDATE ON team_state
    FOR EACH ROW
    EXECUTE FUNCTION team_state_touch_updated_at();

-- ============================================================================
-- 3. user_to_agent_messages (chat in)
-- ============================================================================
--
-- Event log dei messaggi utente → agente. Il container li consuma (mark
-- delivered_at), l'agente risponde via pending_user_messages (replied_at
-- viene aggiornato dal container quando registra una risposta correlata).
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_to_agent_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent        TEXT NOT NULL CHECK (char_length(agent) BETWEEN 1 AND 64),
    message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 8000),
    payload      JSONB DEFAULT '{}'::jsonb,
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    replied_at   TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'replied', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_user_to_agent_messages_pending
    ON user_to_agent_messages(user_id, sent_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_user_to_agent_messages_user_time
    ON user_to_agent_messages(user_id, sent_at DESC);

ALTER TABLE user_to_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own messages to agent"
    ON user_to_agent_messages FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users insert own messages to agent"
    ON user_to_agent_messages FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "users update own messages to agent"
    ON user_to_agent_messages FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- 4. position_feedback (like/dislike event log)
-- ============================================================================
--
-- Separato da positions.status per evitare conflitto con il design constraint
-- web write (vedi #16 backlog): le scritture web vanno su tabelle dedicate
-- che il Mac legge ma non sovrascrive col push.
--
-- position_legacy_id è il legacy_id (TEXT) di una row in positions, non un
-- UUID hard FK. La FK logica è (user_id, position_legacy_id).
-- ============================================================================

CREATE TABLE IF NOT EXISTS position_feedback (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position_legacy_id TEXT NOT NULL,
    action             TEXT NOT NULL CHECK (action IN ('like', 'dislike', 'hide', 'star')),
    reason             TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_position_feedback_user_time
    ON position_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_position_feedback_user_position
    ON position_feedback(user_id, position_legacy_id);

ALTER TABLE position_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own position feedback"
    ON position_feedback FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users insert own position feedback"
    ON position_feedback FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- Feedback è event log: niente UPDATE/DELETE da utente (immutabile per audit).
-- Cleanup eventuale via service_role.
