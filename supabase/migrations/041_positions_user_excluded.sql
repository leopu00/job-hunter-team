-- 041_positions_user_excluded.sql
-- Esclusione MANUALE di una posizione da parte dell'UTENTE (non dell'agente).
-- Dalla pagina dettaglio l'utente esclude una job offer scegliendo una causa
-- (dropdown: 5 default + 'Altro' con testo libero). Effetto: status -> 'excluded'
-- → la posizione esce dalle code agenti (next-for-recheck / next-for-categorize
-- filtrano già lo stato), così gli agenti NON sprecano token a ri-verificarne la
-- liveness: lo decide l'utente. Reversibile: user_excluded_prev_status conserva
-- lo stato precedente per l'annullamento.
--
-- Mirror SQLite: shared/skills/_db.py::_migrate_positions_user_excluded.
-- Sync: lo 'status' viaggia con il push esistente; i campi user_excluded_* li
-- scrive direttamente la route /api/positions/[id]/user-exclude su entrambi i DB.

ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_excluded_reason TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_excluded_note TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_excluded_at TIMESTAMPTZ;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_excluded_prev_status TEXT;

-- Indice parziale: le query "è stata esclusa dall'utente?" e i filtri di vista.
CREATE INDEX IF NOT EXISTS idx_positions_user_excluded
  ON positions(user_excluded_at) WHERE user_excluded_at IS NOT NULL;
