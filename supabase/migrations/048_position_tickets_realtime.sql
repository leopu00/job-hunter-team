-- 048_position_tickets_realtime.sql
-- Realtime su position_tickets (tappa 3 del sync event-driven, dietro flag JHT_REALTIME_SYNC).
--
-- Col flag JHT_REALTIME_SYNC attivo, il daemon VPS si iscrive via Supabase Realtime
-- ai cambi di `position_tickets` invece di pollarli a 60s. Perché la consegna sia
-- affidabile servono due cose, identiche a team_state (mig 021 + 047):
--   1. la tabella dev'essere nella publication `supabase_realtime` (emette WAL);
--   2. REPLICA IDENTITY FULL → su UPDATE il WAL porta l'intera riga (old+new) così
--      la valutazione RLS del Realtime è sempre completa e la consegna garantita.
-- RLS già attiva e per-utente (mig 043) → ogni client riceve solo le proprie righe.
--
-- Inerte finché nessuno si iscrive: con flag OFF (default) nessun client del cli
-- apre un canale Realtime su questa tabella, quindi il comportamento odierno
-- (poll 60s) resta invariato. Idempotente: rilanciabile senza errori.

-- 1. publication — guardia perché ALTER PUBLICATION ... ADD TABLE non è idempotente
--    di suo (errore se la tabella è già membro).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'position_tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE position_tickets;
  END IF;
END $$;

-- 2. replica identity full — idempotente di natura.
ALTER TABLE position_tickets REPLICA IDENTITY FULL;
