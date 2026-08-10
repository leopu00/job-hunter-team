-- Anonymous, aggregate-only campaign landing counters (/r, /t).
-- Same shape and same refusals as 063_download_clicks: no per-request row, no
-- full timestamp, no identity, IP, user-agent, referrer, cookie or
-- geolocation value is accepted by this schema.
--
-- Why it exists: two paid channels run at the same time and nothing tells them
-- apart. Client-side analytics only sees consenting visitors, so it cannot
-- answer "which channel sent this traffic" — the server has to count.

CREATE TABLE public.landing_hits (
  ts_hour text NOT NULL CHECK (ts_hour ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$'),
  source text NOT NULL CHECK (source IN ('reddit', 'tiktok')),
  n bigint NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (ts_hour, source)
);

ALTER TABLE public.landing_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_hits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.landing_hits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.landing_hits TO service_role;

CREATE OR REPLACE FUNCTION public.increment_landing_hits(
  p_ts_hour text,
  p_source text
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.landing_hits (ts_hour, source, n)
  VALUES (p_ts_hour, p_source, 1)
  ON CONFLICT (ts_hour, source)
  DO UPDATE SET n = public.landing_hits.n + 1
  RETURNING n;
$$;

REVOKE ALL ON FUNCTION public.increment_landing_hits(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_landing_hits(text, text)
  TO service_role;

COMMENT ON TABLE public.landing_hits IS
  'Hourly anonymous aggregate landing hits per paid channel; never stores request-level or identifying data.';
