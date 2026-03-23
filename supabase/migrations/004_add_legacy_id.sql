-- ============================================================
-- Migration 004: aggiungi legacy_id a positions
-- Colonna per tracciare l'ID originale dalla migrazione SQLite
-- ============================================================

ALTER TABLE positions ADD COLUMN IF NOT EXISTS legacy_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_positions_legacy_id ON positions(legacy_id);
