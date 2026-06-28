-- 049_positions_summary.sql
-- Riassunto leggibile dell'offerta, prodotto dall'Analista nella lingua
-- dell'utente (markdown a sezioni: ruolo / requisiti / fit / da verificare).
-- Sostituisce la JD grezza nella UI: la `jd_text` resta nel DB solo per uso
-- interno degli agenti, mai piu' mostrata all'utente sulla pagina posizione.
-- Vedi prompt analista RULE-04bis.
-- Mirror SQLite: shared/skills/_db.py::_migrate_positions_summary.

ALTER TABLE positions ADD COLUMN IF NOT EXISTS summary TEXT;
