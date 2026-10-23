-- 104: application authorisations from the website are receipts of a person, not of a box.
--
-- A cloud-sync pairing exchanges a refresh token for a bearer token.  Keep the
-- session that made that exchange on the server, so the action door can refuse
-- an L3 application request made from that device session.  The table is read
-- only by SECURITY DEFINER code; browser roles do not receive the column.

ALTER TABLE public.cloud_sync_tokens
  ADD COLUMN IF NOT EXISTS pairing_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_cloud_sync_tokens_pairing_session_active
  ON public.cloud_sync_tokens (pairing_session_id)
  WHERE pairing_session_id IS NOT NULL AND revoked_at IS NULL;

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
BEGIN
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
    -- application.  Return the same closed refusal as an inaccessible row.
    IF p_action = 'position.apply_authorize' THEN
        BEGIN
            v_session := NULLIF(auth.jwt() ->> 'session_id', '')::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            v_session := NULL;
        END;
        IF v_session IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.cloud_sync_tokens AS t
             WHERE t.user_id = p_uid
               AND t.pairing_session_id = v_session
               AND t.revoked_at IS NULL
        ) THEN
            RETURN jsonb_build_object('error', 'not_found');
        END IF;
    END IF;

    SELECT p.id, p.title, p.company, p.url, p.status, p.apply_requested_at
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
    IF v_applied OR v_pos.status IN ('applied', 'response') THEN
        RETURN jsonb_build_object('error', 'already_submitted');
    END IF;
    IF p_action = 'position.apply_authorize' AND v_pos.status IS DISTINCT FROM 'ready' THEN
        RETURN jsonb_build_object('error', 'position_not_ready');
    END IF;

    IF p_stage = 'prepare' THEN
        IF p_action = 'position.apply_authorize' THEN
            v_host := lower(substring(COALESCE(v_pos.url, '') FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#:]+)'));
            IF v_host IS NULL OR v_host !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
                RETURN jsonb_build_object('error', 'not_found');
            END IF;
        END IF;
        RETURN jsonb_build_object(
            'params', jsonb_build_object('legacy_id', v_legacy),
            'summary', left(regexp_replace(COALESCE(v_pos.title, '') || ' @ ' || COALESCE(v_pos.company, '') ||
                                            CASE WHEN p_action = 'position.apply_authorize' THEN ' · ' || v_host ELSE '' END,
                                           '[[:cntrl:]]', ' ', 'g'), 200),
            'confirm', p_action = 'position.apply_authorize');
    END IF;

    v_at := GREATEST(now(), COALESCE(v_pos.apply_requested_at, '-infinity'::TIMESTAMPTZ) + INTERVAL '1 millisecond');
    UPDATE public.positions
       SET apply_requested    = (p_action = 'position.apply_authorize'),
           apply_requested_at = v_at,
           apply_requested_by = CASE WHEN p_action = 'position.apply_authorize' THEN 'user_web' ELSE NULL END
     WHERE id = v_pos.id AND user_id = p_uid;
    RETURN jsonb_build_object('status', 'queued');
END;
$$;

REVOKE ALL ON FUNCTION web_door.ext_position(TEXT, TEXT, UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
