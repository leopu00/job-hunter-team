-- 025: deleted_at TIMESTAMPTZ su positions/applications/scores (soft-delete tombstones)
-- Additive only — no data loss. Default NULL = riga viva.
--
-- Background: il push container→cloud è UPSERT-only (mai DELETE). Una
-- riga cancellata in SQLite locale resta ghost in cloud per sempre,
-- inquinando dashboard e analytics. Vedi cloud-sync-architecture.md P0 #2.
--
-- Scope ridotto: tombstones SOLO sulle 3 tabelle effettivamente pushate
-- (positions/scores/applications). companies e position_highlights non
-- sono mai propagate al cloud oggi (vedi handlePush in cli/src/commands/
-- cloud.js + receive in web/app/api/cloud-sync/push/route.ts), quindi
-- non hanno il problema ghost-rows e non serve aggiungere la colonna.
--
-- Design end-to-end:
--   - SQLite locale: hard-delete invariato (gli agenti hanno regola
--     "NO DELETE" su queste tabelle, vedi agents/_team/team-rules.md,
--     ma migrazioni one-shot come db_migrate_v2 e cleanup del Capitano
--     lo fanno).
--   - SQLite locale ha tabella `_tombstones(table_name, legacy_id,
--     deleted_at)` + trigger BEFORE DELETE che la popolano. Tombstones
--     viaggiano nel push delta (mig SQLite V7).
--   - Lato Supabase, qui, il receive del push interpreta i tombstones
--     come UPDATE soft: SET deleted_at = tombstone.deleted_at WHERE
--     (positions: legacy_id; scores/applications: position_id UUID
--     derivato da legacy_id).
--   - Cleanup hard-delete su deleted_at < now() - 30d: deferito a job
--     cron Supabase post-merge (out of scope MVP, vedi BACKLOG follow-up).
--
-- Vedi BACKLOG [JHT-CLOUDSYNC-01] P0 DELETE tombstone + SQLite V7 in
-- `shared/skills/_db.py::_migrate_v6_to_v7`.

ALTER TABLE positions     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE applications  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE scores        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index partial sulle live rows: il dashboard cloud filtra `WHERE
-- deleted_at IS NULL` come default; partial index mantiene la lookup
-- O(log n_live) invece di O(n_total) (la gran parte delle righe resta
-- viva, il deleted è marginale).
CREATE INDEX IF NOT EXISTS positions_live_idx
  ON positions (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS applications_live_idx
  ON applications (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scores_live_idx
  ON scores (position_id) WHERE deleted_at IS NULL;
