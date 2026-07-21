-- 058_notification_prefs_and_positions_realtime.sql
--
-- [JHT-WEB-NOTIFICATIONS] Notifiche browser configurabili (solo web cloud).
--
-- (1) `notification_prefs`: preferenze per-utente come singolo JSONB
--     (master switch, notifiche messaggi, regole posizioni configurabili:
--     trigger scored/new, soglia score, location/paesi/keyword, work mode,
--     digest a soglia). Il BROWSER legge e scrive direttamente via PostgREST
--     con la sessione utente (RLS) — zero route Vercel, coerente con la
--     regola Realtime-first del 2026-07-21. Lo schema del JSON vive nel
--     client (web/lib/web-notifications.ts): qui solo storage + ownership.
--
-- (2) `positions` entra nella publication Realtime: il motore regole client
--     valuta gli eventi INSERT/UPDATE della propria riga (RLS + filtro
--     user_id) — è il trigger per "posizione trovata/valutata che matcha".
--     NB: NIENTE REPLICA IDENTITY FULL — la tabella è larga (jd_text) e al
--     client serve solo la riga NEW, che il WAL contiene comunque.

-- ── (1) Tabella preferenze ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification prefs" ON notification_prefs;
CREATE POLICY "Users manage own notification prefs"
    ON notification_prefs FOR ALL
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- Touch updated_at (riusa la funzione condivisa già in schema).
DROP TRIGGER IF EXISTS notification_prefs_updated_at ON notification_prefs;
CREATE TRIGGER notification_prefs_updated_at
    BEFORE UPDATE ON notification_prefs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── (2) positions nella publication Realtime (idempotente) ────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'positions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.positions;
  END IF;
END $$;
