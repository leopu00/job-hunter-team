-- 104: the summary of an application in the website's log goes through web_door.one_line.
--
-- Needs 098, 099, 101 (web_door.one_line), 102 (web_door.ext_position as it is now) and 103 (the door closed
-- for team.start, team.stop and team.restart). Applied after them: 098, 099, 100, 101, 102, 103, 104.
--
-- The summary of position.apply_authorize and position.apply_revoke is «title @ company», read from the
-- position, so from the scouting: the text of a vacancy, written by third parties. 099 and 102 only
-- replaced [[:cntrl:]] with a space, so an override or an isolate (U+202E, U+2066-2069), a zero-width space,
-- a soft hyphen or tag characters (U+E0000-E007F, an invisible sentence) reached web_action_log as they
-- were: the log is the person's record and is part of the export, and the page cleaned them only on screen.
--
-- Now the summary passes through web_door.one_line (101), the list of shared/skills/external_content.py
-- (INVISIBLE_COMMANDS removed, controls and line or paragraph separators turned into a space, one space
-- left of many). ZWNJ, ZWJ, LRM, RLM and ALM stay: they are letters of the writing of a name, and a company
-- name with them is a real name. The cap stays 200 characters.
--
-- web_door.ext_position is the one of 102, line by line, with that one change. request_action,
-- web_door.rule and web_door.call_ext are not redefined: on the cloud that would open again the door 103
-- closed. The final block checks the family and that the door is still the one of 103.
--
-- Lines already written in the log are not rewritten: the log keeps what the door showed at the time.

DO $$
BEGIN
    IF to_regprocedure('web_door.one_line(text, integer)') IS NULL
       OR to_regprocedure('web_door.ext_position(text, text, uuid, jsonb, text, uuid)') IS NULL
       OR to_regprocedure('public.request_action(text, jsonb, uuid, text, text)') IS NULL THEN
        RAISE EXCEPTION '104: needs 101 (web_door.one_line), 102 (web_door.ext_position) and the door';
    END IF;
END $$;

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

    -- The position belongs to the user, or does not exist (the same answer). At the effect it is read
    -- again, and locked: during the two minutes of a confirmation it can have left.
    SELECT p.id, p.title, p.company, p.status, p.apply_requested, p.apply_requested_at
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
        RETURN jsonb_build_object(
            'params', jsonb_build_object('legacy_id', v_legacy),
            -- The title and the company come from a vacancy, a text of third parties: one line, without the
            -- format characters that reorder or hide text (the fence's list, web_door.one_line of 101).
            'summary', web_door.one_line(COALESCE(v_pos.title, '') || ' @ ' || COALESCE(v_pos.company, ''), 200),
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

-- Fail the migration if the family is not this one, a browser role can run it, or the door is not the
-- one of 103 any more (porta_103: request_action a definer that refuses action_disabled).
DO $$
DECLARE
    v_def TEXT := pg_get_functiondef(to_regprocedure('web_door.ext_position(text, text, uuid, jsonb, text, uuid)'));
BEGIN
    IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
             WHERE oid = to_regprocedure('web_door.ext_position(text, text, uuid, jsonb, text, uuid)')) THEN
        RAISE EXCEPTION '104: the family of the position is not a definer with an empty search_path';
    END IF;
    IF position('web_door.one_line(COALESCE(v_pos.title' IN v_def) = 0
       OR position('[[:cntrl:]]' IN v_def) > 0 THEN
        RAISE EXCEPTION '104: the summary of the position does not go through web_door.one_line';
    END IF;
    IF position('position.apply_revoke'' AND v_pos.apply_requested IS NOT TRUE' IN v_def) = 0 THEN
        RAISE EXCEPTION '104: the withdrawal of 102 (nothing to withdraw writes nothing) is missing';
    END IF;
    IF has_function_privilege('authenticated', 'web_door.ext_position(text, text, uuid, jsonb, text, uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'web_door.ext_position(text, text, uuid, jsonb, text, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION '104: a browser role can run the family of the position';
    END IF;
    IF web_door.one_line('a' || U&'\202E' || 'b' || U&'\200C' || 'c', 10) IS DISTINCT FROM 'ab' || U&'\200C' || 'c' THEN
        RAISE EXCEPTION '104: web_door.one_line is not the list of the fence';
    END IF;
    -- porta_103
    IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
             WHERE oid = to_regprocedure('public.request_action(text, jsonb, uuid, text, text)'))
       OR position('action_disabled' IN pg_get_functiondef(
              to_regprocedure('public.request_action(text, jsonb, uuid, text, text)'))) = 0 THEN
        RAISE EXCEPTION '104: request_action is not the door of 103 (porta_103)';
    END IF;
    -- The switch of 103 must be there; its values are not this migration's business: a later migration
    -- that opens team.* again must not stop a new application of 104.
    IF NOT EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = to_regclass('web_door.vocab') AND attname = 'enabled'
                      AND NOT attisdropped) THEN
        RAISE EXCEPTION '104: web_door.vocab has no switch (enabled): the door is not the one of 103 (porta_103)';
    END IF;
END $$;
