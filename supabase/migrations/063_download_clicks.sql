-- Anonymous, aggregate-only download funnel counters.
-- No per-request row, full timestamp, identity, IP, user-agent, referrer,
-- cookie or geolocation value is accepted by this schema.

CREATE TABLE public.download_clicks (
  ts_hour text NOT NULL CHECK (ts_hour ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$'),
  slug text NOT NULL CHECK (slug IN ('win-setup', 'win-portable', 'mac', 'linux')),
  utm_source text NOT NULL DEFAULT 'none' CHECK (utm_source ~ '^[a-z0-9_-]{1,40}$'),
  utm_medium text NOT NULL DEFAULT 'none' CHECK (utm_medium ~ '^[a-z0-9_-]{1,40}$'),
  utm_campaign text NOT NULL DEFAULT 'none' CHECK (utm_campaign ~ '^[a-z0-9_-]{1,40}$'),
  n bigint NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (ts_hour, slug, utm_source, utm_medium, utm_campaign)
);

ALTER TABLE public.download_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_clicks FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.download_clicks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.download_clicks TO service_role;

CREATE OR REPLACE FUNCTION public.increment_download_clicks(
  p_ts_hour text,
  p_slug text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.download_clicks (
    ts_hour,
    slug,
    utm_source,
    utm_medium,
    utm_campaign,
    n
  ) VALUES (
    p_ts_hour,
    p_slug,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    1
  )
  ON CONFLICT (ts_hour, slug, utm_source, utm_medium, utm_campaign)
  DO UPDATE SET n = public.download_clicks.n + 1
  RETURNING n;
$$;

REVOKE ALL ON FUNCTION public.increment_download_clicks(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_download_clicks(text, text, text, text, text)
  TO service_role;

COMMENT ON TABLE public.download_clicks IS
  'Hourly anonymous aggregate download clicks; never stores request-level or identifying data.';
