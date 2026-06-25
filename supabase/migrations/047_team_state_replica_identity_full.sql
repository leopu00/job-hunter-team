-- 047_team_state_replica_identity_full.sql
-- Realtime + RLS affidabile su team_state (sync-now via Supabase Realtime).
--
-- Il browser cloud si iscrive via Supabase Realtime ai cambi di `team_state` per
-- rilevare `sync_completed_at` SENZA polling (CloudRefreshButton). Con la replica
-- identity di default, su UPDATE il WAL non porta tutte le colonne della riga
-- "vecchia": la valutazione RLS del Realtime sul cambio può risultare incompleta e
-- la consegna inaffidabile. REPLICA IDENTITY FULL mette l'intera riga (old+new) nel
-- WAL → RLS sempre valutabile, consegna garantita. `team_state` è per-utente
-- (PK user_id, 1 riga) → overhead WAL trascurabile.

ALTER TABLE team_state REPLICA IDENTITY FULL;
