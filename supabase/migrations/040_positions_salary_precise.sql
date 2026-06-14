-- 040: positions.salary_precise_requested + _at + salary_precise (Salary-precise on-demand)
-- Additive only — no data loss. Defaults: FALSE / NULL / NULL.
--
-- Background (Parte B 2026-06-14): l'analista produce SEMPRE una stima salary
-- "rough" durante il passaggio pipeline (salary_estimated_*). La versione
-- PRECISA (ricerca azienda + media web + tasse + NETTO del paese) è costosa e
-- serve solo per le posizioni che l'utente vuole davvero approfondire → on-demand,
-- stesso pattern di Writer-on-demand (024) e Geocoding-on-demand (027/029).
--
-- USER-DRIVEN + cross-device: l'utente seleziona dal dashboard web (o Telegram)
-- → `salary_precise_requested = TRUE` viaggia nel sync (PUSH flag VPS→cloud e
-- PULL cloud→VPS). L'analista monitora il flag (`db_query.py next-for-salary-precise`)
-- e scrive il risultato in `salary_precise` (breakdown strutturato: lordo/netto,
-- tasse, fonte). Default FALSE → niente ricerca precisa di default.
--
-- recheck/categorize NON hanno colonna-richiesta: sono code SISTEMATICHE via
-- query naturale (last_open_check stale / role_family IS NULL), loop-guard gratis
-- (una volta lavorate escono dalla query). Vedi db_query.py next-for-recheck /
-- next-for-categorize. SQLite mirror in
-- `shared/skills/_db.py::_migrate_positions_salary_precise` (schema V9).

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS salary_precise_requested    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS salary_precise_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS salary_precise              TEXT;

-- Index partial: l'utente seleziona poche posizioni; il pull cloud→SQLite polla
-- WHERE = TRUE → partial index su WHERE = TRUE mantiene la lookup O(log n_selected).
CREATE INDEX IF NOT EXISTS positions_salary_precise_requested_idx
  ON positions (user_id, salary_precise_requested_at)
  WHERE salary_precise_requested = TRUE;
