-- 093: only the server creates and revokes cloud-sync tokens.
--
-- 006 opened cloud_sync_tokens to the browser roles with one policy per
-- command on auth.uid() = user_id. Rows of other users stayed out of reach,
-- but whoever held a user's session could write that user's tokens straight
-- through PostgREST, around /api/cloud-sync/tokens: insert a token with a
-- hash of their choosing and no expiry, or set revoked_at back to NULL on a
-- token the user had revoked. A revocation held only until someone with the
-- session undid it.
--
-- The route now writes with the service_role client, after checking the
-- session and with that user's user_id on every write; device-confirm,
-- device-register, revoke and verifyBearerToken already did. So the INSERT
-- and UPDATE policies go, and the two privileges with them, for anon too:
-- a write that reaches the table without the server is refused before RLS.
-- The user still reads their own tokens (SELECT: the token list, the
-- desktop's onboarding, useBoxClient) and may delete them (DELETE).
--
-- The checks at the end fail the migration if a policy or a privilege is
-- still there: a REVOKE that removes nothing is only a WARNING.

DROP POLICY IF EXISTS "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens;
DROP POLICY IF EXISTS "Users can update own cloud sync tokens" ON public.cloud_sync_tokens;

REVOKE INSERT, UPDATE ON public.cloud_sync_tokens FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.cloud_sync_tokens'::regclass
       AND polcmd IN ('a', 'w', '*')
  ) THEN
    RAISE EXCEPTION '093: cloud_sync_tokens still has an INSERT, UPDATE or ALL policy';
  END IF;
  -- has_any_column_privilege sees table and column grants alike.
  IF has_any_column_privilege('anon', 'public.cloud_sync_tokens', 'INSERT')
     OR has_any_column_privilege('anon', 'public.cloud_sync_tokens', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.cloud_sync_tokens', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.cloud_sync_tokens', 'UPDATE') THEN
    RAISE EXCEPTION '093: anon or authenticated can still INSERT or UPDATE cloud_sync_tokens';
  END IF;
END $$;
