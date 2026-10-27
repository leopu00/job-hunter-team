-- 105: application authorisations from the website are receipts of a person, not of a box.
--
-- Needs the approved 104, which makes web_door.one_line the fence around
-- vacancy text shown by an application confirmation.
--
-- A cloud-sync pairing exchanges a refresh token for a bearer token.  Keep the
-- session that made that exchange on the server, so the action door can refuse
-- an L3 application request made from that device session.
--
-- The refusal must outlive the token.  A device holds a user session, so it
-- could end its own token (revoke it through the website, or delete the row)
-- and then, with the token gone from the check, authorise an application from
-- the same session once it is paired again.  So the comparison with the session
-- covers EVERY row of the user, revoked or expired included, and no browser
-- role can delete or change a row any more: only the server creates, revokes
-- and deletes cloud-sync tokens (093 took INSERT and UPDATE; this migration
-- takes them too, so that it stands alone in any order, and takes DELETE).

ALTER TABLE public.cloud_sync_tokens
  ADD COLUMN IF NOT EXISTS pairing_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_cloud_sync_tokens_pairing_session_active
  ON public.cloud_sync_tokens (pairing_session_id)
  WHERE pairing_session_id IS NOT NULL;

COMMENT ON COLUMN public.cloud_sync_tokens.pairing_session_id IS
  'The Supabase session which exchanged the pairing refresh token for this device token. The application action door refuses L3 authorisations from it.';

-- The position extension owns the text a person sees before confirming.  The
-- host is extracted only from an http(s) URL and kept in the short summary;
-- the broker later validates it again as a closed web destination.
CREATE OR REPLACE FUNCTION web_door.ext_position(
    p_stage TEXT, p_action TEXT, p_uid UUID, p_params JSONB, p_body TEXT, p_log_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_legacy  INTEGER;
    v_pos     RECORD;
    v_applied BOOLEAN;
    v_at      TIMESTAMPTZ;
    v_session UUID;
    v_host    TEXT;
    v_title   TEXT;
    v_company TEXT;
BEGIN
    IF to_regprocedure('web_door.one_line(text, integer)') IS NULL THEN
        RAISE EXCEPTION '105: needs 104 (web_door.one_line)';
    END IF;
    IF p_action NOT IN ('position.apply_authorize', 'position.apply_revoke') THEN
        RAISE EXCEPTION 'web_door.ext_position: not an action of this family: %', p_action;
    END IF;
    IF p_stage NOT IN ('prepare', 'effect') THEN
        RAISE EXCEPTION 'web_door.ext_position: bad stage %', p_stage;
    END IF;

    IF p_stage = 'prepare' THEN
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_params) AS k WHERE k <> 'legacy_id')
           OR NOT (p_params ? 'legacy_id')
           OR jsonb_typeof(p_params -> 'legacy_id') <> 'number'
           OR (p_params ->> 'legacy_id') !~ '^[0-9]{1,9}$'
           OR (p_params ->> 'legacy_id')::BIGINT < 1
           OR (p_params ->> 'legacy_id')::BIGINT > 2147483647 THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
    END IF;
    v_legacy := (p_params ->> 'legacy_id')::INTEGER;

    -- Device sessions may operate cloud sync but cannot authorise an external
    -- application.  A token that is active and has no pairing session to
    -- compare (a legacy one) closes this L3 door until the box is paired again.
    -- The session of the caller is compared with the pairing session of EVERY
    -- token of the user, a revoked or an expired one too: a device that ended
    -- its own token is still that device.  Return the same closed refusal as an
    -- inaccessible row.
    IF p_action = 'position.apply_authorize' THEN
        BEGIN
            v_session := NULLIF(auth.jwt() ->> 'session_id', '')::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            v_session := NULL;
        END;
        IF EXISTS (
            SELECT 1 FROM public.cloud_sync_tokens AS t
             WHERE t.user_id = p_uid
               AND (
                   (t.pairing_session_id IS NULL
                    AND t.revoked_at IS NULL
                    AND (t.expires_at IS NULL OR t.expires_at > now()))
                   OR (v_session IS NOT NULL AND t.pairing_session_id = v_session)
               )
        ) THEN
            RETURN jsonb_build_object('error', 'not_found');
        END IF;
    END IF;

    -- The position belongs to the user, or does not exist (the same answer). At the effect it is read
    -- again, and locked: during the two minutes of a confirmation it can have left.
    SELECT p.id, p.title, p.company, p.url, p.status, p.apply_requested, p.apply_requested_at
      INTO v_pos
      FROM public.positions AS p
     WHERE p.user_id = p_uid AND p.legacy_id = v_legacy AND p.deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'not_found');
    END IF;
    SELECT COALESCE(bool_or(a.applied), FALSE) INTO v_applied
      FROM public.applications AS a
     WHERE a.position_id = v_pos.id AND a.user_id = p_uid AND a.deleted_at IS NULL;
    -- The same order as the gate (shared/cloud/apply-request-rule.json): an application that already
    -- left is neither authorised nor withdrawn; only `ready` is authorised.
    IF v_applied OR v_pos.status IN ('applied', 'response') THEN
        RETURN jsonb_build_object('error', 'already_submitted');
    END IF;
    IF p_action = 'position.apply_authorize' AND v_pos.status IS DISTINCT FROM 'ready' THEN
        RETURN jsonb_build_object('error', 'position_not_ready');
    END IF;

    IF p_stage = 'prepare' THEN
        IF p_action = 'position.apply_authorize' THEN
            v_host := lower(substring(COALESCE(v_pos.url, '') FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#:]+)'));
            IF v_host IS NULL OR v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
               OR v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
               -- The door caps the summary at 200 characters.  Keep the
               -- complete destination at its beginning, never a clipped
               -- prefix whose registrable domain may be at the far right.
               OR char_length(v_host) > 120 THEN
                RETURN jsonb_build_object('error', 'not_found');
            END IF;
            -- Vacancy text is fenced before the confirmation.  A middle dot
            -- belongs to neither label: it used to be confused with the old
            -- host delimiter, so it is removed rather than parsed later.
            v_title := web_door.one_line(regexp_replace(COALESCE(v_pos.title, ''), '·', ' ', 'g'), 80);
            v_company := web_door.one_line(
                regexp_replace(COALESCE(v_pos.company, ''), '·', ' ', 'g'),
                GREATEST(0, 180 - char_length(v_host) - char_length(v_title)));
        ELSE
            v_title := web_door.one_line(regexp_replace(COALESCE(v_pos.title, ''), '·', ' ', 'g'), 96);
            v_company := web_door.one_line(regexp_replace(COALESCE(v_pos.company, ''), '·', ' ', 'g'), 100);
        END IF;
        RETURN jsonb_build_object(
            'params', CASE WHEN p_action = 'position.apply_authorize'
                           THEN jsonb_build_object('legacy_id', v_legacy, 'host', v_host)
                           ELSE jsonb_build_object('legacy_id', v_legacy)
                      END,
            'summary', CASE WHEN p_action = 'position.apply_authorize'
                            THEN 'Destinazione: ' || v_host || ' · ' || v_title || ' @ ' || v_company
                            ELSE web_door.one_line(v_title || ' @ ' || v_company, 200)
                       END,
            'confirm', p_action = 'position.apply_authorize');
    END IF;

    -- Nothing to withdraw: the position was never authorised, or already withdrawn. No new instant, so
    -- the box sees no change and sends no notice of a withdrawn authorisation.
    IF p_action = 'position.apply_revoke' AND v_pos.apply_requested IS NOT TRUE THEN
        RETURN jsonb_build_object('status', 'done');
    END IF;

    -- The pull of the box filters on `updated_at > cursor`: the instant always moves forward, also
    -- when the authorisation is withdrawn.
    v_at := GREATEST(now(),
                     COALESCE(v_pos.apply_requested_at, '-infinity'::TIMESTAMPTZ) + INTERVAL '1 millisecond');
    UPDATE public.positions
       SET apply_requested    = (p_action = 'position.apply_authorize'),
           apply_requested_at = v_at,
           apply_requested_by = CASE WHEN p_action = 'position.apply_authorize' THEN 'user_web' ELSE NULL END
     WHERE id = v_pos.id AND user_id = p_uid;
    RETURN jsonb_build_object('status', 'queued');
END;
$$;

REVOKE ALL ON FUNCTION web_door.ext_position(TEXT, TEXT, UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Only the server creates, changes and deletes cloud-sync tokens.  The user still reads their own (SELECT: the
-- token list, the desktop's onboarding).  The website writes them with the service role after checking the
-- session (tokens, revoke, device-confirm, device-register); nothing in the apps deletes one from the browser.
-- 093 did this for INSERT and UPDATE; it is repeated here (IF EXISTS, REVOKE: harmless the second time) so that the
-- barrier above does not depend on the order of the migrations, and DELETE goes with them.
DROP POLICY IF EXISTS "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens;
DROP POLICY IF EXISTS "Users can update own cloud sync tokens" ON public.cloud_sync_tokens;
DROP POLICY IF EXISTS "Users can delete own cloud sync tokens" ON public.cloud_sync_tokens;

REVOKE INSERT, UPDATE, DELETE ON public.cloud_sync_tokens FROM anon, authenticated;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = 'public.cloud_sync_tokens'::regclass
           AND polcmd IN ('a', 'w', 'd', '*')
    ) THEN
        RAISE EXCEPTION '105: cloud_sync_tokens still has an INSERT, UPDATE, DELETE or ALL policy';
    END IF;
    -- A REVOKE that removes nothing is only a WARNING: check what is left.  has_any_column_privilege sees table
    -- and column grants alike; DELETE is a table privilege only.
    IF has_any_column_privilege('anon', 'public.cloud_sync_tokens', 'INSERT')
       OR has_any_column_privilege('anon', 'public.cloud_sync_tokens', 'UPDATE')
       OR has_table_privilege('anon', 'public.cloud_sync_tokens', 'DELETE')
       OR has_any_column_privilege('authenticated', 'public.cloud_sync_tokens', 'INSERT')
       OR has_any_column_privilege('authenticated', 'public.cloud_sync_tokens', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.cloud_sync_tokens', 'DELETE') THEN
        RAISE EXCEPTION '105: anon or authenticated can still INSERT, UPDATE or DELETE cloud_sync_tokens';
    END IF;
END $$;
