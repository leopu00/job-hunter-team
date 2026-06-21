-- 045_team_state_sync_rendezvous.sql
-- Rendezvous per il "Sync now" on-demand ([JHT-DATA-SYNC] fase 3).
--
-- Problema: la dashboard cloud mostra il mirror Supabase, tenuto ~≤60s fresco
-- dal push condizionale del daemon. Per evitare polling continuo dei browser
-- (costoso a scala) il refresh diventa ON-DEMAND: l'utente apre la dashboard o
-- preme "Sync now" → il browser scrive `sync_requested_at` → il daemon sulla
-- VPS lo vede al tick successivo, fa un push fresco, e marca `sync_completed_at`
-- → il browser fa UN refetch e si ferma. Nessun ascolto continuo lato browser.
--
-- Una pending request = sync_requested_at > sync_completed_at (o completed NULL).
-- team_state è per-utente (PK user_id, mig 019): il flag vive con lo stato team.

ALTER TABLE team_state
    ADD COLUMN IF NOT EXISTS sync_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_completed_at TIMESTAMPTZ;

-- Nessun nuovo indice: il daemon legge la singola riga per user_id (PK), il
-- browser legge/scrive la propria riga. RLS già definita su team_state (mig 019):
-- l'utente vede/aggiorna solo la propria → la POST "request" dal browser passa,
-- e l'ack del daemon usa il service-role (filtro user_id esplicito lato route).
