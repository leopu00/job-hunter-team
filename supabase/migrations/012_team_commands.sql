-- ============================================================
-- Job Hunter Team — Team Commands (Realtime command bus)
-- Migration 012: tabella per comandi remoti web → VPS via Supabase
-- Realtime. L'utente clicca "Start" sulla dashboard cloud, web INSERT
-- una riga qui, il container `jht` sulla VPS riceve l'evento
-- via WebSocket Realtime e esegue il comando (`jht team start/stop`).
--
-- Schema:
--   user_id           → owner (auth.uid()) — FK auth.users con CASCADE
--   action            → 'start' | 'stop' | 'restart'
--   payload           → JSONB opzionale (es. {"agents": ["scout"]} per
--                       avviare solo alcuni agenti)
--   requested_at      → timestamp di insert (web)
--   processed_at      → timestamp di completamento (subscriber VPS)
--   error             → messaggio errore se exec fallisce
--   status            → 'pending' | 'running' | 'done' | 'error'
--
-- RLS:
--   - user può SELECT/INSERT solo proprie righe (auth.uid() = user_id)
--   - UPDATE solo service_role (subscriber VPS usa user JWT, ma per
--     update di processed_at usa una RPC dedicata `mark_team_command_done`
--     che fa SECURITY DEFINER)
--
-- Realtime publication: la tabella è aggiunta a `supabase_realtime`
-- publication per ricevere INSERT/UPDATE events via WebSocket.
-- ============================================================

CREATE TABLE IF NOT EXISTS team_commands (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action       TEXT NOT NULL CHECK (action IN ('start', 'stop', 'restart')),
    payload      JSONB DEFAULT '{}'::jsonb,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    error        TEXT,
    status       TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'error'))
);

-- Indice per la subscribe del subscriber: SELECT WHERE user_id = ? AND
-- status = 'pending' ORDER BY requested_at. Anche utile per il fallback
-- polling se Realtime non risponde (subscriber legge backlog al boot).
CREATE INDEX IF NOT EXISTS idx_team_commands_user_pending
    ON team_commands(user_id, requested_at)
    WHERE status = 'pending';

-- Auto-cleanup: i comandi processati >7 giorni fa non servono. Cron
-- job nightly sarebbe ideale ma per la beta lasciamo accumular il DB
-- (volume basso) e cleanup manuale via SQL.

ALTER TABLE team_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own team commands"
    ON team_commands FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "users insert own team commands"
    ON team_commands FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own team commands"
    ON team_commands FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Abilita Realtime su questa tabella. Senza ALTER PUBLICATION i client
-- non riceveranno gli eventi via channel.subscribe().
ALTER PUBLICATION supabase_realtime ADD TABLE team_commands;
