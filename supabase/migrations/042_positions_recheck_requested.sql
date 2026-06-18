-- 042_positions_recheck_requested.sql
-- Recheck / liveness ON-DEMAND (2026-06-18). Prima il recheck era AUTONOMO
-- (Analista RULE-12: ri-verificava ogni posizione ogni 24h di sua iniziativa) →
-- causa-radice del consumo settimanale sproporzionato (weekly burn). Ora il
-- recheck avviene SOLO su richiesta dell'utente: dalla pagina dettaglio clicca
-- "Ricontrolla se attiva" → recheck_requested=1 → l'Analista serve la coda
-- next-for-recheck (flag-driven). Stesso pattern di write_requested /
-- geocode_requested / salary_precise_requested.
-- Mirror SQLite: shared/skills/_db.py::_migrate_positions_recheck_requested.

ALTER TABLE positions ADD COLUMN IF NOT EXISTS recheck_requested BOOLEAN DEFAULT false;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS recheck_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_positions_recheck_requested
  ON positions(recheck_requested) WHERE recheck_requested;
