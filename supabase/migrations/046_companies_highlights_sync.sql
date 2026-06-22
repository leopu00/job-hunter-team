-- 046_companies_highlights_sync.sql
-- Sblocca il sync VPS→cloud di `companies` e `position_highlights`, finora
-- escluse ("Scope MVP" in full-dump/route.ts) → sul cloud la Company card e i
-- blocchi Pro/Contro del dettaglio posizione erano sempre vuoti.
--
-- Causa-radice del "mapping non banale": a differenza di positions (che ha
-- `legacy_id` per mappare l'id intero locale → UUID cloud, mig 004/007),
-- companies e position_highlights NON avevano una chiave stabile cloud↔locale.
-- companies aveva solo `name` (NON unique per-utente sul cloud → inaffidabile
-- per onConflict) e highlights solo la FK UUID `position_id`.
--
-- Fix: stesso pattern già collaudato per positions/pending_user_messages —
-- aggiungere `legacy_id` (= id intero SQLite locale) + UNIQUE (user_id,
-- legacy_id) per un upsert idempotente delta-friendly. Il push risolve poi:
--   - positions.company_id (UUID) via companies.legacy_id
--   - position_highlights.position_id (UUID) via positions.legacy_id
-- riusando la mappa legacy→UUID già costruita lato server.
--
-- Limite noto (coerente col vecchio "Scope MVP"): la CANCELLAZIONE locale di un
-- highlight/company NON propaga al cloud (i tombstones coprono solo
-- positions/scores/applications). Il re-sync AGGIORNA le righe esistenti; un
-- highlight rimosso localmente resta finché non lo si gestisce con un tombstone
-- dedicato (follow-up). Per i pro/con rigenerati di rado è un degrado accettabile.

-- ── COMPANIES: chiave stabile per il sync ─────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legacy_id INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- UNIQUE per onConflict (user_id, legacy_id). Parziale: si applica solo dove
-- legacy_id è valorizzato, così le righe legacy pre-esistenti senza legacy_id
-- (create dalla dashboard o da sync vecchi) non violano il vincolo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_user_legacy
    ON companies(user_id, legacy_id) WHERE legacy_id IS NOT NULL;

-- ── POSITION_HIGHLIGHTS: chiave stabile per il sync ───────────
ALTER TABLE position_highlights ADD COLUMN IF NOT EXISTS legacy_id INTEGER;
ALTER TABLE position_highlights ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_highlights_user_legacy
    ON position_highlights(user_id, legacy_id) WHERE legacy_id IS NOT NULL;

-- RLS: companies e position_highlights hanno già le 4 policy per-utente
-- (mig 001 + 003); le nuove colonne sono coperte automaticamente.
