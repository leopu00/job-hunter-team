-- O-50 — attribute TikTok downloads without opening an unbounded dimension.
-- The application allow-list ships with this forward-only CHECK replacement;
-- `none` and `reddit` remain valid historical buckets.

BEGIN;

ALTER TABLE public.download_clicks
  DROP CONSTRAINT IF EXISTS download_clicks_utm_source_check;

ALTER TABLE public.download_clicks
  ADD CONSTRAINT download_clicks_utm_source_check
  CHECK (utm_source IN ('none', 'reddit', 'tiktok'));

COMMIT;
