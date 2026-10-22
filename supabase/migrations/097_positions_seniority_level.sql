-- 097: the seniority an advert asks for (JHT-T45).
--
-- The Analyst used to write it only as a line of free text in the notes
-- (SENIORITY_JD: senior), which no rule can read. The local database now has it as
-- a column, and the exclusions «too senior» / «too junior» of the user's profile
-- act on it. The cloud mirrors the column so that a team restored from the cloud
-- keeps the level of its positions (a restore that dropped it would silently turn
-- those two exclusions off).
--
-- The level comes from a closed set, lowest to highest:
--   junior, mid, senior, lead
-- NULL means «the advert does not say». The writers (db_update, the cloud push)
-- send NULL or a value of this set, nothing else.
--
-- Additive only, no data is rewritten: the rows already in the cloud stay without a
-- level until the next push of their team carries it.
--
-- The cloud push writes this column: this migration must be applied BEFORE the web
-- that upserts it is deployed (an upsert with a column that does not exist answers
-- 400 for the whole batch, and the sync of every team stops).

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS seniority_level text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass
      AND conname = 'positions_seniority_level_check'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_seniority_level_check
      CHECK (seniority_level IS NULL
             OR seniority_level IN ('junior', 'mid', 'senior', 'lead'));
  END IF;
END $$;

COMMENT ON COLUMN public.positions.seniority_level IS
  'junior|mid|senior|lead, or NULL when the advert does not say. Written by the Analyst; the exclusions too_senior / too_junior of the profile act on it.';

-- Fail the migration if the column or its closed set is not there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'seniority_level'
  ) THEN
    RAISE EXCEPTION '097: positions.seniority_level is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass AND conname = 'positions_seniority_level_check'
  ) THEN
    RAISE EXCEPTION '097: positions_seniority_level_check is missing';
  END IF;
END $$;
