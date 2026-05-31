-- 024: positions.write_requested + write_requested_at (Writer-on-demand)
-- Additive only — no data loss. Defaults: FALSE / NULL.
--
-- Background: oggi gli Scrittori partono al boot e scrivono CV per ogni
-- posizione che lo Scorer approva (score >= 50). Case study #2/#3 hanno
-- mostrato che ~50% dei CV non vengono mai usati dall'utente -> token bruciati.
--
-- Soluzione: l'utente seleziona dal dashboard web (button "Scrivi CV") o
-- via Telegram (`/cv <id>`) le posizioni per cui vuole un CV. Il Capitano
-- monitora `write_requested = TRUE` e spawna Scrittori on-demand.
--
-- Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) e SQLite mirror in
-- `shared/skills/_db.py::_migrate_positions_write_requested` (schema V6).

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS write_requested    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS write_requested_at TIMESTAMPTZ;

-- Index partial: l'utente seleziona poche posizioni (~5-20% del pool), il
-- Capitano polla questa view ogni 3 min -> partial index su WHERE = TRUE
-- mantiene la lookup O(log n_selected) invece di O(n_total).
CREATE INDEX IF NOT EXISTS positions_write_requested_idx
  ON positions (user_id, write_requested_at)
  WHERE write_requested = TRUE;
