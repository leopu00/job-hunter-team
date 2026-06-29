-- 050_companies_highlights_full_unique_index.sql
-- Fix bug latente di mig 046: gli indici UNIQUE di `companies` e
-- `position_highlights` erano PARZIALI (`WHERE legacy_id IS NOT NULL`).
--
-- Il route push usa `supabase-js .upsert(payload, { onConflict: "user_id,legacy_id" })`
-- (web/app/api/cloud-sync/push/route.ts:433 companies, :743 highlights), che genera
-- `INSERT ... ON CONFLICT (user_id, legacy_id)` SENZA la clausola `WHERE`. Postgres
-- NON può inferire un indice PARZIALE da un ON CONFLICT senza lo stesso predicato →
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- → il push falliva con HTTP 500 al PRIMO esercizio reale del path (companies/highlights
-- non erano mai risaliti finché il route nuovo non è andato in production).
--
-- positions (mig 007 `positions_user_legacy_unique`) usa un indice TOTALE e funziona:
-- allineiamo companies/highlights allo stesso schema. I NULL restano non-collidenti
-- (UNIQUE tratta i NULL come distinti in Postgres), quindi le righe legacy senza
-- legacy_id non violano il vincolo — esattamente come positions.

-- ── COMPANIES ──────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_companies_user_legacy;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_user_legacy
    ON companies(user_id, legacy_id);

-- ── POSITION_HIGHLIGHTS ────────────────────────────────────────
DROP INDEX IF EXISTS idx_highlights_user_legacy;
CREATE UNIQUE INDEX IF NOT EXISTS idx_highlights_user_legacy
    ON position_highlights(user_id, legacy_id);
