-- 017: Office geocoding columns + location_geocode cache
-- Additive only — no data loss. Defaults: NULL (coords/address) or FALSE (boolean flags).
-- Riferimento design doc: docs/internal/2026-05-20-world-globe-feature.md

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS office_address  TEXT,
  ADD COLUMN IF NOT EXISTS office_lat      NUMERIC,
  ADD COLUMN IF NOT EXISTS office_lon      NUMERIC,
  ADD COLUMN IF NOT EXISTS office_geocoded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS office_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_remote       BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS positions_office_coords_idx
  ON positions (office_lat, office_lon)
  WHERE office_lat IS NOT NULL;

CREATE TABLE IF NOT EXISTS location_geocode (
  canonical   TEXT PRIMARY KEY,
  raw_text    TEXT,
  lat         NUMERIC,
  lon         NUMERIC,
  city        TEXT,
  country     TEXT,
  geocoded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL
);
