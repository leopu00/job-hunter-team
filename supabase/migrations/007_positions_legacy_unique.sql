-- ============================================================
-- Job Hunter Team — Unique constraint per upsert da CLI
-- Migration 007: positions(user_id, legacy_id) unique
-- ============================================================
--
-- Permette al push endpoint di fare upsert idempotente delle
-- positions provenienti dalla CLI (legacy_id = id SQLite locale).
-- NULL != NULL in Postgres, quindi le righe create dal web senza
-- legacy_id non collidono mai sul constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'positions_user_legacy_unique'
  ) THEN
    ALTER TABLE positions
      ADD CONSTRAINT positions_user_legacy_unique UNIQUE (user_id, legacy_id);
  END IF;
END$$;
