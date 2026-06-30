-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 051 — sentinel_ticks: epoch dei reset (data completa, no ora-nuda)║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ La tabella esponeva solo `reset_at TEXT`. Il bridge ora scrive reset_at   ║
-- ║ come DATA+ORA completa, ma per il countdown lato UI (e per qualunque      ║
-- ║ calcolo) serve l'epoch non ambiguo. Aggiungiamo le colonne `*_unix` (già  ║
-- ║ presenti nel JSONL locale) + `weekly_reset_at` testuale, così il path     ║
-- ║ cloud non deve più ricostruire la data indovinando "oggi/domani".         ║
-- ║                                                                          ║
-- ║ Tutte nullable: i tick legacy restano validi.                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE sentinel_ticks
    ADD COLUMN IF NOT EXISTS reset_at_unix DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS weekly_reset_at TEXT,
    ADD COLUMN IF NOT EXISTS weekly_reset_at_unix DOUBLE PRECISION;
