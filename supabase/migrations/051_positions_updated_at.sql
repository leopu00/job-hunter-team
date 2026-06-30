-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 051 — positions.updated_at (cursore delta pull-desired-state)    ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ FIX drift codice↔schema. La route GET /api/cloud-sync/pull-desired-state  ║
-- ║ usa `positions.updated_at` come cursore delta (.gt/.order/cursor), ma la   ║
-- ║ colonna non è MAI esistita: `001_schema.sql` definisce solo `created_at`.  ║
-- ║ Risultato: la route andava in HTTP 500 a ogni ciclo del daemon            ║
-- ║   "query failed: column positions.updated_at does not exist"              ║
-- ║ → le intenzioni scritte dall'utente via web (write_requested,             ║
-- ║   recheck_requested, geocode_requested, user_excluded, salary_precise)    ║
-- ║   non raggiungevano mai la VPS = "non si sincronizza da pulsante web".     ║
-- ║                                                                          ║
-- ║ Aggiunge la colonna + trigger BEFORE UPDATE che riusa la funzione         ║
-- ║ update_updated_at() già definita in 001_schema.sql: ogni UPDATE (sia le   ║
-- ║ route desired-state, sia gli upsert di push) fa avanzare il cursore.       ║
-- ║ Le righe esistenti ottengono updated_at = now() al momento dell'ALTER     ║
-- ║ (DEFAULT su backfill): la prima pull post-deploy le rivede una volta      ║
-- ║ (volume limitato dalla finestra), poi si stabilizza sul delta.            ║
-- ║                                                                          ║
-- ║ Idempotente.                                                              ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_positions_updated_at ON public.positions;
CREATE TRIGGER trg_positions_updated_at
    BEFORE UPDATE ON public.positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
