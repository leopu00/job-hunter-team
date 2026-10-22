-- 096: the scam signals of a position (JHT-T06 phase B, JHT-T44).
--
-- The scam-signals skill computes verifiable facts about a job ad (the same text
-- in other companies, a payment in advance, a company nobody can verify, a private
-- chat as the only way to apply) and stores the result on the position:
--
--   {"bucket":"badge|section","codes":["advance_payment", ...],"v":1}
--
-- only the closed codes and the bucket, never the text of the ad. It is a warning,
-- never an exclusion: nothing here changes a position's status.
-- NULL means «never checked».
--
-- Additive only, no data is rewritten. The local database has had the column since
-- phase A; the cloud push now carries it, and the web reads it to show the badge
-- and the «suspicious» section.
--
-- The web reads this column: this migration must be applied BEFORE the web that
-- selects it is deployed (a select on a missing column answers 400 for the
-- whole query).

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS scam_signals text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass
      AND conname = 'positions_scam_signals_check'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_scam_signals_check
      CHECK (scam_signals IS NULL
             OR (length(scam_signals) <= 400 AND scam_signals LIKE '{%}'));
  END IF;
END $$;

COMMENT ON COLUMN public.positions.scam_signals IS
  'JSON {"bucket":"badge|section","codes":[...],"v":1} written by the scam-signals skill: closed codes only, never the ad text. A warning, never an exclusion. NULL = never checked.';

-- Fail the migration if the column or its check is not there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'scam_signals'
  ) THEN
    RAISE EXCEPTION '096: positions.scam_signals is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass AND conname = 'positions_scam_signals_check'
  ) THEN
    RAISE EXCEPTION '096: positions_scam_signals_check is missing';
  END IF;
END $$;
