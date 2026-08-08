-- The telemetry whitelist, enforced by the database as well.
--
-- Migration 064 added client_version / client_platform / client_capabilities
-- and the rules that keep them technical — a strict format, a closed
-- platform list, a cap on how many capability flags — but those rules lived
-- only in the web parser (`web/lib/cloud-sync/client-identity.ts`). The RLS
-- policy on cloud_sync_tokens allows an authenticated user to UPDATE their
-- OWN row, and PostgREST is a supported way to do it, so the parser can be
-- bypassed entirely.
--
-- That is not cross-account exposure: RLS still holds, nobody reaches
-- anybody else's row. What it is: unbounded free text inside columns we
-- document as purely technical, and those columns are read straight into
-- the fleet view we use to decide things. A column whose contract is
-- enforced in one client and nowhere else does not have a contract.
--
-- The rules below are the parser's, transcribed:
--   version       ^[A-Za-z0-9._+-]{1,32}$, minus the words a sloppy client
--                 produces when interpolating a missing value
--   platform      the four families (already constrained in 064)
--   capabilities  at most 32 flags, each ^[a-z0-9-]{1,32}$
--
-- If the two ever drift apart, the parser is the source: it is the one with
-- the tests.

-- ── 1. Il predicato sull'array ───────────────────────────────────────────
-- A CHECK cannot contain a subquery, and validating every element of an
-- array needs one. Wrapping it in an IMMUTABLE function is the supported
-- way; doing it by flattening the array into a string would be worse than
-- no check, because a value containing a comma would be indistinguishable
-- from two valid elements.

CREATE OR REPLACE FUNCTION public.jht_valid_client_capabilities(flags text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    -- NULL = mai dichiarato. Diverso da un array vuoto, che è una
    -- dichiarazione ("non servo nessuna di queste") su cui il web gatea.
    WHEN flags IS NULL THEN true
    WHEN coalesce(array_length(flags, 1), 0) > 32 THEN false
    ELSE NOT EXISTS (
      SELECT 1
        FROM unnest(flags) AS f(flag)
       WHERE f.flag !~ '^[a-z0-9-]{1,32}$'
    )
  END;
$$;

COMMENT ON FUNCTION public.jht_valid_client_capabilities(text[]) IS
  'Mirror of CAPABILITY_RE / MAX_CAPABILITIES in web/lib/cloud-sync/client-identity.ts. NULL (never declared) passes; an empty array (declared none) passes too.';

-- ── 2. Bonifica prima dei vincoli ────────────────────────────────────────
-- A constraint added over non-conforming rows fails, and that would block a
-- deploy over exactly the garbage this migration exists to prevent. Values
-- outside the contract go back to NULL — "not declared" — which is honest:
-- an unreadable declaration told us nothing anyway, and the box overwrites
-- it on its next cloud-sync call.

UPDATE public.cloud_sync_tokens
   SET client_version = NULL
 WHERE client_version IS NOT NULL
   AND (
     client_version !~ '^[A-Za-z0-9._+-]{1,32}$'
     OR lower(client_version) IN ('undefined', 'null', 'nan', 'none', 'false')
   );

UPDATE public.cloud_sync_tokens
   SET client_capabilities = NULL
 WHERE NOT public.jht_valid_client_capabilities(client_capabilities);

-- ── 3. I vincoli ─────────────────────────────────────────────────────────
-- The version CHECK from 064 only bounded length, not shape: replaced.

ALTER TABLE public.cloud_sync_tokens
  DROP CONSTRAINT IF EXISTS cloud_sync_tokens_client_version_check;

ALTER TABLE public.cloud_sync_tokens
  ADD CONSTRAINT cloud_sync_tokens_client_version_check
  CHECK (
    client_version IS NULL
    OR (
      client_version ~ '^[A-Za-z0-9._+-]{1,32}$'
      AND lower(client_version) NOT IN ('undefined', 'null', 'nan', 'none', 'false')
    )
  );

ALTER TABLE public.cloud_sync_tokens
  DROP CONSTRAINT IF EXISTS cloud_sync_tokens_client_capabilities_check;

ALTER TABLE public.cloud_sync_tokens
  ADD CONSTRAINT cloud_sync_tokens_client_capabilities_check
  CHECK (public.jht_valid_client_capabilities(client_capabilities));

COMMENT ON COLUMN public.cloud_sync_tokens.client_capabilities IS
  'Feature flags the build declares it can serve (e.g. chat). At most 32, each [a-z0-9-]{1,32} — enforced here as well as in the parser, because RLS lets a user write this row directly via PostgREST.';
