-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 049 — positions.jd_summary (sintesi JD per l'utente)            ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Nuovo campo testuale `jd_summary` su `positions`: la sintesi della job    ║
-- ║ description scritta dall'ANALISTA per l'utente — 1-3 paragrafi o bullet,   ║
-- ║ nella lingua dell'utente, in markdown leggero (grassetto/bullet/emoji).   ║
-- ║                                                                          ║
-- ║ Sostituisce, nella pagina posizione, il dump grezzo di `jd_text` (che     ║
-- ║ resta in DB come fonte per l'agente + fallback per le posizioni legacy    ║
-- ║ non ancora ri-analizzate). `jd_text` NON viene rimosso.                   ║
-- ║                                                                          ║
-- ║ Mirror SQLite: shared/skills/_db.py::_migrate_positions_jd_summary.       ║
-- ║ Scrittura: db_update.py --jd-summary. Nullable, nessun default.           ║
-- ║ Idempotente.                                                              ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS jd_summary text;
