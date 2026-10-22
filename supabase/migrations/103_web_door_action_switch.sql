-- 103: the door is closed for the actions of the team the box does not run yet (team.start, team.stop,
-- team.restart). team.emergency_stop and every other action stay open.
--
-- Needs 098, 099 and 100, and nothing after them: on the cloud it is applied in the first deploy of the
-- door (web, 098, 099, 100, 103), before 101 and 102, so the door is born closed for those three. 101 and
-- 102 do not touch request_action, web_door.rule or the shape of web_door.vocab; the rows 101 adds take
-- the default of the new column (open).
--
-- Why: the build flag of phase 3 (NEXT_PUBLIC_JHT_TEAM_CONTROL) hides the buttons, not the capability.
-- With a stolen session and a recent login the door can be called by hand, and a start or a restart
-- would reach boxes whose executor of team commands has not been measured yet.
--
-- - web_door.vocab gets `enabled` (default TRUE); this migration sets it FALSE for the three actions.
-- - request_action is the one of 099, with the switch looked at twice: at the first call (after the
--   checks and the limits, before a confirmation is opened or the effect runs) and at the confirmation
--   (a confirmation prepared before the switch went off does not run after). The refusal is the closed
--   code action_disabled, and it is written in web_action_log (status cancelled, result
--   action_disabled). Those lines count in the limit of their group, so they cannot fill the log.
-- - Only a migration (or the owner) changes the switch: web_door and its vocabulary are closed to the
--   browser roles since 099, and the final block checks it.
-- - To open them, after the measure on a test box: a migration that sets enabled TRUE, together with
--   the build flag of the interface. The flag alone is no longer enough.

ALTER TABLE web_door.vocab
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN web_door.vocab.enabled IS
    'The switch of the action: FALSE and request_action refuses it with action_disabled, at the first call and at the confirmation. Changed only by migrations.';

UPDATE web_door.vocab
   SET enabled = FALSE
 WHERE action IN ('team.start', 'team.stop', 'team.restart');

CREATE OR REPLACE FUNCTION public.request_action(
    p_action      TEXT,
    p_params      JSONB DEFAULT '{}'::JSONB,
    p_confirm_id  UUID  DEFAULT NULL,
    p_route_level TEXT  DEFAULT NULL,
    p_body        TEXT  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid     UUID := auth.uid();
    v_claims  JSONB;
    v_session UUID;
    v_rule    RECORD;
    v_login   TIMESTAMPTZ;
    v_row     public.web_action_log%ROWTYPE;
    v_params  JSONB;
    v_body    TEXT;
    v_summary TEXT;
    v_confirm BOOLEAN;
    v_prep    JSONB;
    v_eff     JSONB;
    v_code    TEXT;
    v_status  TEXT;
    v_command UUID;
    v_used    INTEGER;
    v_oldest  TIMESTAMPTZ;
    v_new_id  UUID;
    v_action  TEXT;
    v_expires TIMESTAMPTZ;
    -- The refusals a family may answer with: the closed codes of the contract with the website.
    v_codes   TEXT[] := ARRAY['invalid_params', 'not_found', 'position_not_ready', 'already_submitted'];
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'unauthenticated');
    END IF;

    -- The level the route declared: fail closed. Nothing is written before this is checked.
    IF p_route_level IS NULL OR p_route_level NOT IN ('L1', 'L2', 'L3') THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'level_mismatch');
    END IF;

    -- One request of a user at a time: the limits count rows, and two requests that count together
    -- would both pass.
    PERFORM pg_advisory_xact_lock(hashtextextended('web_action:' || v_uid::TEXT, 0));

    v_claims := COALESCE(auth.jwt(), '{}'::JSONB);
    BEGIN
        v_session := NULLIF(v_claims ->> 'session_id', '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        v_session := NULL;
    END;

    -- A confirmation nobody used does not stay open: it expires, on the clock of the database.
    UPDATE public.web_action_log
       SET status = 'expired'
     WHERE user_id = v_uid AND status = 'awaiting_confirm' AND expires_at <= now();

    -- -----------------------------------------------------------------------------------------
    -- Second call: only the id of the line, nothing else.
    -- -----------------------------------------------------------------------------------------
    IF p_confirm_id IS NOT NULL THEN
        IF p_body IS NOT NULL OR (p_params IS NOT NULL AND p_params <> '{}'::JSONB) THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
        END IF;

        SELECT * INTO v_row
          FROM public.web_action_log
         WHERE id = p_confirm_id AND user_id = v_uid
         FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'confirm_not_found');
        END IF;
        IF p_action IS DISTINCT FROM v_row.action THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'confirm_action_mismatch');
        END IF;
        SELECT * INTO v_rule FROM web_door.rule(v_row.action);
        IF p_route_level < v_rule.level THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'level_mismatch');
        END IF;
        IF v_row.status = 'expired' THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'confirm_expired');
        END IF;
        IF v_row.status <> 'awaiting_confirm' THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'confirm_used');
        END IF;
        IF v_row.session_id IS DISTINCT FROM v_session THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'confirm_session_mismatch');
        END IF;

        -- The limit is looked at again at the moment the action leaves: confirmations opened
        -- together must not all pass a cap that one of them was already using up.
        SELECT count(*), min(l.created_at)
          INTO v_used, v_oldest
          FROM public.web_action_log AS l
         WHERE l.user_id = v_uid
           AND l.created_at > now() - v_rule.cap_window
           AND (l.status IN ('queued', 'done', 'error') OR l.result = 'action_disabled')
           AND (SELECT r.cap_group FROM web_door.rule(l.action) AS r) = v_rule.cap_group;
        IF v_used >= v_rule.cap_n THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'error', 'rate_limited',
                'retry_after_s',
                GREATEST(1, ceil(extract(epoch FROM (v_oldest + v_rule.cap_window - now())))::INTEGER));
        END IF;

        -- The switch, again at the moment the action leaves: a confirmation prepared before the action
        -- was switched off does not run after.
        IF NOT COALESCE((SELECT v.enabled FROM web_door.vocab AS v WHERE v.action = v_row.action), FALSE) THEN
            UPDATE public.web_action_log
               SET status = 'cancelled', result = 'action_disabled'
             WHERE id = v_row.id;
            RETURN jsonb_build_object('ok', FALSE, 'error', 'action_disabled');
        END IF;

        UPDATE public.web_action_log
           SET status = 'queued', confirmed_at = now()
         WHERE id = v_row.id;
        v_new_id  := v_row.id;
        v_action  := v_row.action;
        v_params  := v_row.params;
        v_body    := v_row.body;
        v_summary := v_row.summary;
    ELSE
        -- -------------------------------------------------------------------------------------
        -- First call.
        -- -------------------------------------------------------------------------------------
        SELECT * INTO v_rule FROM web_door.rule(p_action);
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'unknown_action');
        END IF;
        IF p_route_level < v_rule.level THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'level_mismatch');
        END IF;
        v_action := p_action;

        v_params := COALESCE(p_params, '{}'::JSONB);
        IF jsonb_typeof(v_params) <> 'object' OR octet_length(v_params::TEXT) > v_rule.params_max_bytes THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
        END IF;

        -- The text: only for the actions that take one, up to 2000 characters, no control character
        -- but the line break and the tab.
        IF p_body IS NOT NULL THEN
            IF NOT v_rule.takes_body
               OR char_length(p_body) > 2000
               OR regexp_replace(p_body, '[\n\r\t]', '', 'g') ~ '[[:cntrl:]]' THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
            END IF;
        END IF;

        -- Recent session: the login of THIS session, not of the user.
        IF v_rule.recent THEN
            SELECT to_timestamp(max((e ->> 'timestamp')::DOUBLE PRECISION))
              INTO v_login
              FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(v_claims -> 'amr') = 'array'
                            THEN v_claims -> 'amr' ELSE '[]'::JSONB END
                   ) AS e
             WHERE jsonb_typeof(e) = 'object'
               AND jsonb_typeof(e -> 'timestamp') = 'number'
               AND (e ->> 'method') IN ('password', 'oauth', 'otp', 'magiclink', 'sso/saml',
                                        'recovery', 'invite', 'email/signup',
                                        'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn');
            IF v_login IS NULL AND v_session IS NOT NULL THEN
                SELECT s.created_at INTO v_login
                  FROM auth.sessions AS s
                 WHERE s.id = v_session AND s.user_id = v_uid;
            END IF;
            IF v_login IS NULL OR v_login < now() - INTERVAL '15 minutes' THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'reauth_required');
            END IF;
        END IF;

        -- What the action means: the family validates, normalises and says what will happen.
        v_prep := web_door.call_ext(v_rule.family, 'prepare', v_action, v_uid, v_params, p_body, NULL);
        IF v_prep IS NULL OR jsonb_typeof(v_prep) <> 'object' THEN
            RAISE EXCEPTION 'web_door: prepare of % answered nothing usable', v_action;
        END IF;
        IF v_prep ? 'error' THEN
            v_code := v_prep ->> 'error';
            IF v_code IS NULL OR NOT (v_code = ANY (v_codes)) THEN
                RAISE EXCEPTION 'web_door: prepare of % answered with a code outside the contract', v_action;
            END IF;
            RETURN jsonb_build_object('ok', FALSE, 'error', v_code);
        END IF;
        IF jsonb_typeof(v_prep -> 'params') IS DISTINCT FROM 'object'
           OR octet_length((v_prep -> 'params')::TEXT) > v_rule.params_max_bytes
           OR jsonb_typeof(v_prep -> 'confirm') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(v_prep -> 'summary') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'web_door: prepare of % answered out of shape', v_action;
        END IF;
        v_params  := v_prep -> 'params';
        v_confirm := (v_prep ->> 'confirm')::BOOLEAN;
        v_summary := left(regexp_replace(v_prep ->> 'summary', '[[:cntrl:]]', ' ', 'g'), 200);
        IF btrim(v_summary) = '' THEN
            RAISE EXCEPTION 'web_door: prepare of % answered without a summary', v_action;
        END IF;
        IF v_prep ? 'body' THEN
            v_body := CASE WHEN jsonb_typeof(v_prep -> 'body') = 'string' THEN v_prep ->> 'body' END;
        ELSE
            v_body := p_body;
        END IF;
        IF v_body IS NOT NULL AND (NOT v_rule.takes_body OR char_length(v_body) > 2000) THEN
            RAISE EXCEPTION 'web_door: prepare of % answered with a text it can not take', v_action;
        END IF;

        -- Limits, counted on the log of the user.
        SELECT count(*), min(l.created_at)
          INTO v_used, v_oldest
          FROM public.web_action_log AS l
         WHERE l.user_id = v_uid
           AND l.created_at > now() - v_rule.cap_window
           AND (l.status IN ('queued', 'done', 'error') OR l.result = 'action_disabled')
           AND (SELECT r.cap_group FROM web_door.rule(l.action) AS r) = v_rule.cap_group;
        IF v_used >= v_rule.cap_n THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'error', 'rate_limited',
                'retry_after_s',
                GREATEST(1, ceil(extract(epoch FROM (v_oldest + v_rule.cap_window - now())))::INTEGER));
        END IF;

        -- The switch: an action switched off is refused before a confirmation is opened or the effect
        -- runs, and the refusal is written in the log. Those lines count in the limit above, so a
        -- stolen session cannot fill the log with them.
        IF NOT COALESCE((SELECT v.enabled FROM web_door.vocab AS v WHERE v.action = v_action), FALSE) THEN
            INSERT INTO public.web_action_log
                (user_id, session_id, action, level, params, body, summary, status, result)
            VALUES
                (v_uid, v_session, v_action, v_rule.level, v_params, v_body, v_summary,
                 'cancelled', 'action_disabled');
            RETURN jsonb_build_object('ok', FALSE, 'error', 'action_disabled');
        END IF;

        IF v_confirm THEN
            -- Confirmations left open are bounded too: a stolen session must not fill the log.
            SELECT count(*) INTO v_used
              FROM public.web_action_log AS l
             WHERE l.user_id = v_uid
               AND l.created_at > now() - INTERVAL '1 hour'
               AND l.expires_at IS NOT NULL;
            IF v_used >= 30 THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'rate_limited', 'retry_after_s', 60);
            END IF;

            INSERT INTO public.web_action_log
                (user_id, session_id, action, level, params, body, summary, status, expires_at)
            VALUES
                (v_uid, v_session, v_action, v_rule.level, v_params, v_body, v_summary,
                 'awaiting_confirm', now() + INTERVAL '2 minutes')
            RETURNING id, expires_at INTO v_new_id, v_expires;
            RETURN jsonb_build_object(
                'ok', TRUE, 'state', 'awaiting_confirm', 'id', v_new_id,
                'level', v_rule.level, 'summary', v_summary, 'expires_at', v_expires);
        END IF;

        INSERT INTO public.web_action_log
            (user_id, session_id, action, level, params, body, summary, status)
        VALUES
            (v_uid, v_session, v_action, v_rule.level, v_params, v_body, v_summary, 'queued')
        RETURNING id INTO v_new_id;
    END IF;

    -- -----------------------------------------------------------------------------------------
    -- The effect. The line is `queued` here, in the same transaction, and the family gets the SAVED
    -- parameters and text. If it refuses, the line is `cancelled` with the reason and the caller gets
    -- the code; if it fails, the whole transaction goes back.
    -- -----------------------------------------------------------------------------------------
    v_eff := web_door.call_ext(v_rule.family, 'effect', v_action, v_uid, v_params, v_body, v_new_id);
    IF v_eff IS NULL OR jsonb_typeof(v_eff) <> 'object' THEN
        RAISE EXCEPTION 'web_door: effect of % answered nothing usable', v_action;
    END IF;
    IF v_eff ? 'error' THEN
        v_code := v_eff ->> 'error';
        IF v_code IS NULL OR NOT (v_code = ANY (v_codes)) THEN
            RAISE EXCEPTION 'web_door: effect of % answered with a code outside the contract', v_action;
        END IF;
        UPDATE public.web_action_log SET status = 'cancelled', result = v_code WHERE id = v_new_id;
        RETURN jsonb_build_object('ok', FALSE, 'error', v_code);
    END IF;
    v_status := COALESCE(v_eff ->> 'status', 'queued');
    IF v_status NOT IN ('queued', 'done') THEN
        RAISE EXCEPTION 'web_door: effect of % answered with the state %', v_action, v_status;
    END IF;
    IF v_eff ? 'command_id' AND jsonb_typeof(v_eff -> 'command_id') = 'string' THEN
        v_command := (v_eff ->> 'command_id')::UUID;
    END IF;
    UPDATE public.web_action_log
       SET status = v_status, command_id = v_command
     WHERE id = v_new_id;

    RETURN jsonb_strip_nulls(jsonb_build_object(
        'ok', TRUE, 'state', v_status, 'id', v_new_id, 'level', v_rule.level,
        'summary', v_summary, 'command_id', v_command));
END;
$$;

REVOKE ALL ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT, TEXT) IS
    'The single door for the actions of the website that have an effect. Closed vocabulary (web_door.vocab), user from auth.uid(), session from the token, limits and the record in web_action_log; what an action means is the function of its family. Refusals come back as {ok:false, error:code}; an action switched off in the vocabulary (enabled) is refused with action_disabled, at the first call and at the confirmation.';

-- Fail the migration if the switch is not there, is not where it must be, or a browser role can move it.
DO $$
DECLARE
    v_def TEXT;
BEGIN
    IF (SELECT count(*) FROM web_door.vocab
         WHERE action IN ('team.start', 'team.stop', 'team.restart') AND NOT enabled) <> 3 THEN
        RAISE EXCEPTION '103: team.start, team.stop and team.restart are not all switched off';
    END IF;
    IF NOT COALESCE((SELECT enabled FROM web_door.vocab WHERE action = 'team.emergency_stop'), FALSE) THEN
        RAISE EXCEPTION '103: the emergency stop must stay open';
    END IF;
    IF has_schema_privilege('authenticated', 'web_door', 'USAGE')
       OR has_schema_privilege('anon', 'web_door', 'USAGE')
       OR has_table_privilege('authenticated', 'web_door.vocab', 'INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_table_privilege('anon', 'web_door.vocab', 'INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_column_privilege('authenticated', 'web_door.vocab', 'enabled', 'UPDATE')
       OR has_column_privilege('anon', 'web_door.vocab', 'enabled', 'UPDATE') THEN
        RAISE EXCEPTION '103: a browser role can reach or change the vocabulary of the door';
    END IF;
    v_def := pg_get_functiondef(to_regprocedure('public.request_action(text, jsonb, uuid, text, text)'));
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.request_action(text, jsonb, uuid, text, text)'))
       OR (length(v_def) - length(replace(v_def, 'action_disabled', ''))) / length('action_disabled') < 4 THEN
        RAISE EXCEPTION '103: request_action is not the one of this migration';
    END IF;
    IF has_function_privilege('anon', 'public.request_action(text, jsonb, uuid, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION '103: anon can call the door';
    END IF;
END $$;
