-- O-82 — CV e cover letter condividono la stessa coda Writer-on-demand.
-- NULL resta l'identità legacy di una richiesta CV: i container pre-0.3.8
-- continuano così a poter fare push senza violare il contratto nuovo.

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS write_request_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'positions_write_request_kind_check'
      AND conrelid = 'positions'::regclass
  ) THEN
    ALTER TABLE positions
      ADD CONSTRAINT positions_write_request_kind_check
      CHECK (write_request_kind IS NULL OR write_request_kind IN ('cv', 'cover_letter'));
  END IF;
END $$;
