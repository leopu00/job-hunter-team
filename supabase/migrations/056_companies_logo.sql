-- 056: Company logo columns on companies.
-- Additive only — no data loss. Defaults: NULL (logo/source) or FALSE (flag).
--
-- `logo` is a base64 data-URI (image/png|jpeg|webp|x-icon), hard-capped at
-- ~35KB raw by the fetch skill (shared/skills/logo_fetch.py) so the row stays
-- small and the web CSP (`img-src data:`) renders it without any new host.
-- `logo_source` is the URL the image was extracted from (audit/refresh).
-- `logo_fetched` mirrors the `office_geocoded` pattern: TRUE once an Analyst
-- attempted extraction (with or without a usable result), so the maintenance
-- queue `next-for-logo-missing` does not retry the same company every sweep.
--
-- RLS: covered by the existing per-user policies on companies (see mig 046
-- note — new columns are automatically covered).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS logo         TEXT,
  ADD COLUMN IF NOT EXISTS logo_source  TEXT,
  ADD COLUMN IF NOT EXISTS logo_fetched BOOLEAN NOT NULL DEFAULT FALSE;
