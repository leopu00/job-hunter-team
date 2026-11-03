-- 106: companies.about — who the company is and what it does.
-- Additive only — no data loss. NULL = not written yet.
--
-- Two sentences written by the Analista from the company's own website, in the user's language, plain text, about
-- the COMPANY only (the position's description mixes company and role). The position page shows them at the top of
-- the company card. Companies analysed before this column existed are filled at their next re-evaluation, never in
-- bulk. SQLite twin: companies.about (shared/skills/_db.py, _migrate_companies_about).
--
-- RLS: covered by the existing per-user policies on companies (new columns are automatically covered).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS about TEXT;
