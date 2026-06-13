-- 038: Position expiry tracking — machine-readable deadline + open lifecycle
-- Additive only — no data loss. Riferimento: docs/internal/ANALISTA-EXPANSION-design.md
--
-- Perché: `deadline` (TEXT, mig 003) è polluto — su 219 posizioni live 164 valori
-- ma solo 3 ISO (resto "non presente" ecc.), quindi inusabile come campo macchina.
-- L'Analista parsa il JD con shared/skills/deadline_extract.py → `expires_at` (DATE
-- pulita, NULL = sconosciuta/sempre-aperta) e gestisce il ciclo aperto/scaduto via
-- `is_open` al richeck giornaliero. `deadline` TEXT resta (raw, bonificato in backfill).

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS expires_at      DATE,
  ADD COLUMN IF NOT EXISTS is_open         BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_open_check TIMESTAMPTZ;

-- Query dashboard: "in scadenza" (is_open=true AND expires_at <= now+7d) e
-- "archivio scadute" (is_open=false). Indice parziale sulle aperte.
CREATE INDEX IF NOT EXISTS positions_open_expiry_idx
  ON positions (expires_at)
  WHERE is_open = TRUE;
