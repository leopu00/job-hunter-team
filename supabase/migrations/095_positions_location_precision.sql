-- 095: how precisely the place of a position is known.
--
-- Until now a position's office had one flag, office_verified: true for an
-- address with a street number, false for everything else, including a city
-- centre saved as if it were an office. The map could not tell a building from
-- the middle of a city (42 positions of 33 companies on one point in Rome).
--
-- location_precision names the level, from a closed set:
--   address   a street number, checked
--   street    a street, no number
--   district  a district or neighbourhood
--   city      the city
--   country   the country
--   remote    no place: the work is remote
-- NULL means «not classified» and is never a stand-in for a level. The writers
-- (db_update, the cloud push) send NULL or a value of this set, nothing else.
--
-- Additive only, no data is rewritten. A row without a level is read the way
-- the local database reads it, from what it already has: office_verified true
-- with coordinates is `address`, coordinates with office_verified false is
-- `city`. Rewriting every row here would fire the realtime publication and
-- move every updated_at for a value the readers can derive.
--
-- The web reads this column: this migration must be applied BEFORE the web that
-- selects it is deployed (a select on a missing column answers 400 for the
-- whole query).

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS location_precision text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass
      AND conname = 'positions_location_precision_check'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_location_precision_check
      CHECK (location_precision IS NULL
             OR location_precision IN ('address', 'street', 'district', 'city', 'country', 'remote'));
  END IF;
END $$;

COMMENT ON COLUMN public.positions.location_precision IS
  'address|street|district|city|country|remote, or NULL when not classified. Pin on the map only for address and street.';

-- Fail the migration if the column or its closed set is not there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'location_precision'
  ) THEN
    RAISE EXCEPTION '095: positions.location_precision is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass AND conname = 'positions_location_precision_check'
  ) THEN
    RAISE EXCEPTION '095: positions_location_precision_check is missing';
  END IF;
END $$;
