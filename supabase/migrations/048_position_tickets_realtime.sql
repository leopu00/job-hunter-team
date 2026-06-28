-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 048 — position_tickets via Supabase Realtime (tappa 3)          ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Tappa 3 del piano event-driven sync                                      ║
-- ║ (docs/internal/2026-06-25-daemon-event-driven-realtime-design.md):       ║
-- ║ sposta position_tickets da poll 60s a Supabase Realtime.                 ║
-- ║                                                                          ║
-- ║ (a) aggiunge position_tickets alla publication supabase_realtime, così   ║
-- ║     il daemon VPS può iscriversi ai cambi via postgres_changes invece    ║
-- ║     di pollare ogni 60s. La 021 aveva aggiunto team_state ecc. ma NON    ║
-- ║     position_tickets (creata dopo, mig 043).                             ║
-- ║ (b) REPLICA IDENTITY FULL → consegna RLS affidabile sugli UPDATE via      ║
-- ║     Realtime (stesso motivo di team_state in mig 047).                   ║
-- ║                                                                          ║
-- ║ Auth: il daemon si autentica col REFRESH_TOKEN UTENTE (cloud.json), che  ║
-- ║ è un user JWT → può autenticare il WS Realtime user-channel (a           ║
-- ║ differenza di jht_sync_, vedi nota mig 021). La RLS (auth.uid()=user_id, ║
-- ║ mig 043) è rispettata dal Realtime → ogni client riceve solo le proprie  ║
-- ║ righe.                                                                    ║
-- ║                                                                          ║
-- ║ La subscription effettiva è dietro il flag JHT_REALTIME_SYNC nel daemon  ║
-- ║ (default OFF → comportamento odierno invariato). Idempotente.            ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- (a) publication: aggiungi position_tickets solo se non già presente (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'position_tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.position_tickets;
  END IF;
END $$;

-- (b) REPLICA IDENTITY FULL (idempotente per natura: ri-applicarla è un no-op)
ALTER TABLE public.position_tickets REPLICA IDENTITY FULL;
