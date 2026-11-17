-- 107: a cloud-sync token says where it was born, and the application door decides on that.
--
-- Needs 105 (cloud_sync_tokens.pairing_session_id and web_door.ext_position).
--
-- 105 closed every L3 application authorisation of a user who has an active token without a pairing session: such
-- a token could belong to a box that holds a user session (device-register exchanges the pairing refresh token)
-- whose session nobody recorded.  But only device-register hands a session to a box.  A token born from
-- `jht cloud login` (device-confirm, the device code) or created on the page of the tokens is a bearer token
-- alone: no user session goes with it.  Those tokens, written without a pairing session, kept the door shut for
-- good, and the website answered `not_found`.
--
-- token_origin says it explicitly, instead of a value in the column of the session:
--   device_register  the box exchanged a user refresh token: its pairing session is recorded (105) and refused;
--   device_code      `jht cloud login`, confirmed on the website: no session goes to the box;
--   page             created on the page of the tokens: no session goes to the box.
-- A token of unknown origin (NULL: made before this migration and not recognised below) is treated as before: if
-- active and without a session, it closes the door.  The person revokes it and pairs again.

-- From here token_origin opens the door: it must stay a column that only the server writes.  105 took every write on
-- the table from the browser roles and stops when one is left; the same check is repeated here, BEFORE anything
-- changes, so that 107 never goes on top of a database where a write was given back by hand after 105.
DO $$
BEGIN
    IF to_regprocedure('web_door.ext_position(text, text, uuid, jsonb, text, uuid)') IS NULL THEN
        RAISE EXCEPTION '107: needs 105 (web_door.ext_position)';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = 'public.cloud_sync_tokens'::regclass
           AND polcmd IN ('a', 'w', 'd', '*')
    ) THEN
        RAISE EXCEPTION '107: cloud_sync_tokens still has an INSERT, UPDATE, DELETE or ALL policy';
    END IF;
    IF has_any_column_privilege('anon', 'public.cloud_sync_tokens', 'INSERT')
       OR has_any_column_privilege('anon', 'public.cloud_sync_tokens', 'UPDATE')
       OR has_table_privilege('anon', 'public.cloud_sync_tokens', 'DELETE')
       OR has_any_column_privilege('authenticated', 'public.cloud_sync_tokens', 'INSERT')
       OR has_any_column_privilege('authenticated', 'public.cloud_sync_tokens', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.cloud_sync_tokens', 'DELETE') THEN
        RAISE EXCEPTION '107: anon or authenticated can still INSERT, UPDATE or DELETE cloud_sync_tokens';
    END IF;
END $$;

ALTER TABLE public.cloud_sync_tokens
  ADD COLUMN IF NOT EXISTS token_origin TEXT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.cloud_sync_tokens'::regclass
           AND conname = 'cloud_sync_tokens_token_origin_check'
    ) THEN
        ALTER TABLE public.cloud_sync_tokens
          ADD CONSTRAINT cloud_sync_tokens_token_origin_check
          CHECK (token_origin IS NULL OR token_origin IN ('device_register', 'device_code', 'page'));
    END IF;
END $$;
COMMENT ON COLUMN public.cloud_sync_tokens.token_origin IS
  'Where the token was born: device_register (the box holds a user session, recorded in pairing_session_id), device_code (jht cloud login) or page (the page of the tokens); NULL = unknown, made before 107. The application action door treats an active token without a session as a device session unless it is device_code or page.';

-- The tokens of before whose origin is certain.  A recorded pairing session exists only for device-register.  A
-- token that a device-code pairing approved is named by that pairing.  Nothing else is guessed: a token of the page
-- and a device-register token of before 105 leave the same trace, and calling the second one `page` would open the
-- door to the session of its box.
UPDATE public.cloud_sync_tokens
   SET token_origin = 'device_register'
 WHERE token_origin IS NULL AND pairing_session_id IS NOT NULL;
UPDATE public.cloud_sync_tokens AS t
   SET token_origin = 'device_code'
 WHERE t.token_origin IS NULL
   AND t.pairing_session_id IS NULL
   AND EXISTS (SELECT 1 FROM public.cloud_sync_pairing_sessions AS s WHERE s.approved_token_id = t.id);

-- The door of 105, with one change: the active token without a session closes it only when its origin may have
-- handed a session to a box.
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
    -- application.  A token that is active, has no pairing session to compare
    -- and may have handed a user session to its box (made by device-register,
    -- or of an origin nobody knows: a legacy one) closes this L3 door until the
    -- box is paired again.  A token born from `jht cloud login` (device_code) or
    -- on the page of the tokens (page) handed no user session to anyone: it has
    -- nothing to compare and closes nothing (107).  The session of the caller is
    -- compared with the pairing session of EVERY token of the user, a revoked or
    -- an expired one too: a device that ended its own token is still that
    -- device.  Return the same closed refusal as an inaccessible row.
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
                    AND (t.token_origin IS NULL OR t.token_origin = 'device_register')
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
