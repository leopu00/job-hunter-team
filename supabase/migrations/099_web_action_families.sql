-- 099: the single door by families (JHT web capace, phase 2-a, the open vocabulary).
--
-- 098 closed the boundary: request_action is the only way for a browser session to ask for something
-- with an effect. Its vocabulary was written inside the function, so every new action meant copying the
-- whole function and its check. From here the vocabulary is DATA and each family of actions owns its
-- small function:
--
--   * web_door.vocab: one row per action (family, level, recent session, limits, whether it takes a
--     text, how many bytes its parameters may take). web_action_log.action is a foreign key to it: a
--     new action is an INSERT in the migration that adds it, with no check to alter and no order to
--     respect between migrations.
--   * web_door.ext_<family>(stage, action, user, params, body, log id): what an action means. 'prepare'
--     validates and normalises the parameters and says what will happen and whether it needs a
--     confirmation; 'effect' does it. The door (request_action) keeps everything that is common and
--     decides nothing about a family: the user, the session, the level of the route, the recent
--     login, the two-step confirmation and its expiry, the limits, the record and the lock.
--   * the text of an action (body, up to 2000 characters, only for the actions that take one) is saved
--     in the line of the log at the first call; the confirmation uses the SAVED text, and the second
--     call can not bring another.
--
-- The functions of the families live in a private schema, web_door, which no browser role can use and
-- PostgREST does not expose: a family that forgot to revoke its EXECUTE still can not be called by a
-- browser, and with it nobody could impersonate a user by passing another uid to 'effect'. The door
-- reaches them by name built from the family of the vocabulary row, never from the client.
--
-- The contract with a family function (SECURITY DEFINER, search_path '', in web_door):
--   web_door.ext_<family>(p_stage text, p_action text, p_uid uuid, p_params jsonb, p_body text,
--                         p_log_id uuid) returns jsonb
--   prepare (first call, p_log_id NULL): {"params": <normalised, closed keys>, "body": <text or null,
--     optional>, "summary": <what will happen, up to 200 characters>, "confirm": true|false}
--     or {"error": <invalid_params|not_found|position_not_ready|already_submitted>}
--   effect (when the line is queued: at once, or at the confirmation; p_params and p_body are the SAVED
--     ones): {"status": "queued"|"done" (default queued), "command_id": <uuid, optional>} or
--     {"error": <one of those codes>}. On an error the family has written nothing: the door cancels the
--     line. The effect looks at its target again (it can have changed during the two minutes).
--   A family never touches web_action_log: the door writes the state from what the function returns.
--
-- The actions of 098 (team.* and position.*) move into their families with the same behaviour.
-- request_action gets one more argument, p_body, at the end with a default: the call by names of the
-- website does not change. The old four-argument function is dropped.
--
-- Apply it right after 098, in the same step.

-- ---------------------------------------------------------------------------------------------
-- 1. The private schema and the vocabulary
-- ---------------------------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS web_door;
REVOKE ALL ON SCHEMA web_door FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS web_door.vocab (
    action           TEXT PRIMARY KEY,
    family           TEXT NOT NULL,
    level            TEXT NOT NULL,
    recent           BOOLEAN NOT NULL,
    cap_group        TEXT NOT NULL,
    cap_n            INTEGER NOT NULL,
    cap_window       INTERVAL NOT NULL,
    takes_body       BOOLEAN NOT NULL DEFAULT FALSE,
    params_max_bytes INTEGER NOT NULL DEFAULT 256,
    CONSTRAINT vocab_action_shape CHECK (action ~ '^[a-z][a-z0-9_]{0,30}\.[a-z][a-z0-9_]{0,30}$'),
    CONSTRAINT vocab_family_is_the_prefix CHECK (family = split_part(action, '.', 1)),
    CONSTRAINT vocab_level_closed CHECK (level IN ('L1', 'L2', 'L3')),
    CONSTRAINT vocab_cap_positive CHECK (cap_n > 0),
    CONSTRAINT vocab_params_bytes CHECK (params_max_bytes BETWEEN 2 AND 2048)
);

ALTER TABLE web_door.vocab ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE web_door.vocab FROM PUBLIC, anon, authenticated;

INSERT INTO web_door.vocab
    (action, family, level, recent, cap_group, cap_n, cap_window, takes_body, params_max_bytes)
VALUES
    ('team.start',               'team',     'L2', TRUE,  'team.up',         6,   INTERVAL '1 hour', FALSE, 256),
    ('team.restart',             'team',     'L2', TRUE,  'team.up',         6,   INTERVAL '1 hour', FALSE, 256),
    ('team.stop',                'team',     'L2', TRUE,  'team.down',       12,  INTERVAL '1 hour', FALSE, 256),
    ('team.emergency_stop',      'team',     'L2', FALSE, 'team.emergency',  120, INTERVAL '1 hour', FALSE, 256),
    ('position.apply_authorize', 'position', 'L3', TRUE,  'position.apply',  15,  INTERVAL '1 day',  FALSE, 256),
    ('position.apply_revoke',    'position', 'L1', FALSE, 'position.revoke', 60,  INTERVAL '1 hour', FALSE, 256)
ON CONFLICT (action) DO NOTHING;

COMMENT ON TABLE web_door.vocab IS
    'The closed vocabulary of request_action: one row per action. Written only by migrations; no browser role can read it.';

-- The reader the door uses (private as the table).
DROP FUNCTION IF EXISTS web_door.rule(TEXT);
CREATE FUNCTION web_door.rule(p_action TEXT)
RETURNS TABLE (level TEXT, recent BOOLEAN, cap_group TEXT, cap_n INTEGER, cap_window INTERVAL,
               family TEXT, takes_body BOOLEAN, params_max_bytes INTEGER)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT v.level, v.recent, v.cap_group, v.cap_n, v.cap_window, v.family, v.takes_body, v.params_max_bytes
      FROM web_door.vocab AS v
     WHERE v.action = p_action;
$$;
REVOKE ALL ON FUNCTION web_door.rule(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. The log: the action is a foreign key to the vocabulary, the text has a place, the parameters
--    have the room the vocabulary gives them (the door applies the limit of each action).
-- ---------------------------------------------------------------------------------------------

ALTER TABLE public.web_action_log
    ADD COLUMN IF NOT EXISTS body TEXT;

ALTER TABLE public.web_action_log DROP CONSTRAINT IF EXISTS web_action_log_body_short;
ALTER TABLE public.web_action_log
    ADD CONSTRAINT web_action_log_body_short CHECK (body IS NULL OR char_length(body) <= 2000);

ALTER TABLE public.web_action_log DROP CONSTRAINT IF EXISTS web_action_log_params_small;
ALTER TABLE public.web_action_log
    ADD CONSTRAINT web_action_log_params_small
    CHECK (jsonb_typeof(params) = 'object' AND octet_length(params::TEXT) <= 2048);

ALTER TABLE public.web_action_log DROP CONSTRAINT IF EXISTS web_action_log_action_closed;
ALTER TABLE public.web_action_log DROP CONSTRAINT IF EXISTS web_action_log_action_in_vocab;
ALTER TABLE public.web_action_log
    ADD CONSTRAINT web_action_log_action_in_vocab
    FOREIGN KEY (action) REFERENCES web_door.vocab (action);

-- ---------------------------------------------------------------------------------------------
-- 3. The helper that reaches a family (the name is built from the family of the vocabulary)
-- ---------------------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS web_door.call_ext(TEXT, TEXT, TEXT, UUID, JSONB, TEXT, UUID);
CREATE FUNCTION web_door.call_ext(
    p_family TEXT, p_stage TEXT, p_action TEXT, p_uid UUID, p_params JSONB, p_body TEXT, p_log_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_family IS NULL OR p_family !~ '^[a-z][a-z0-9_]{0,30}$'
       OR p_stage NOT IN ('prepare', 'effect') THEN
        RAISE EXCEPTION 'web_door.call_ext: bad call';
    END IF;
    IF to_regprocedure(format('web_door.%I(text,text,uuid,jsonb,text,uuid)', 'ext_' || p_family)) IS NULL THEN
        RAISE EXCEPTION 'web_door.call_ext: the family % has no function', p_family;
    END IF;
    EXECUTE format('SELECT web_door.%I($1, $2, $3, $4, $5, $6)', 'ext_' || p_family)
       INTO v_result
      USING p_stage, p_action, p_uid, p_params, p_body, p_log_id;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION web_door.call_ext(TEXT, TEXT, TEXT, UUID, JSONB, TEXT, UUID)
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. The families of 098: team and position
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION web_door.ext_team(
    p_stage TEXT, p_action TEXT, p_uid UUID, p_params JSONB, p_body TEXT, p_log_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target  TEXT;
    v_command UUID;
    v_targets TEXT[] := ARRAY['all', 'assistente', 'capitano', 'sentinella', 'scout', 'scorer',
                              'analista', 'scrittore', 'critico', 'mentor', 'bridge'];
BEGIN
    IF p_action NOT IN ('team.start', 'team.stop', 'team.restart', 'team.emergency_stop') THEN
        RAISE EXCEPTION 'web_door.ext_team: not an action of this family: %', p_action;
    END IF;

    IF p_stage = 'prepare' THEN
        IF p_action = 'team.emergency_stop' THEN
            IF p_params <> '{}'::JSONB THEN
                RETURN jsonb_build_object('error', 'invalid_params');
            END IF;
            RETURN jsonb_build_object('params', '{}'::JSONB, 'summary', 'emergency_stop', 'confirm', FALSE);
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_params) AS k WHERE k <> 'target') THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        IF p_params ? 'target' THEN
            IF jsonb_typeof(p_params -> 'target') <> 'string' THEN
                RETURN jsonb_build_object('error', 'invalid_params');
            END IF;
            v_target := lower(p_params ->> 'target');
        ELSE
            v_target := 'all';
        END IF;
        IF NOT (v_target = ANY (v_targets)) THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        RETURN jsonb_build_object(
            'params', jsonb_build_object('target', v_target),
            'summary', substr(p_action, 6) || ' ' || v_target,
            'confirm', v_target = 'all');

    ELSIF p_stage = 'effect' THEN
        IF p_action = 'team.emergency_stop' THEN
            INSERT INTO public.team_state
                (user_id, should_run, emergency_stop_requested_at, last_user_activity_at)
            VALUES (p_uid, FALSE, now(), now())
            ON CONFLICT (user_id) DO UPDATE
               SET should_run = FALSE,
                   emergency_stop_requested_at = EXCLUDED.emergency_stop_requested_at,
                   last_user_activity_at = EXCLUDED.last_user_activity_at;
            RETURN jsonb_build_object('status', 'queued');
        END IF;
        INSERT INTO public.team_commands (user_id, action, payload)
        VALUES (p_uid, substr(p_action, 6), jsonb_build_object('target', p_params ->> 'target'))
        RETURNING id INTO v_command;
        RETURN jsonb_build_object('status', 'queued', 'command_id', v_command);
    END IF;

    RAISE EXCEPTION 'web_door.ext_team: bad stage %', p_stage;
END;
$$;
REVOKE ALL ON FUNCTION web_door.ext_team(TEXT, TEXT, UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;

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
    SELECT p.id, p.title, p.company, p.status, p.apply_requested_at
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
            'summary', left(regexp_replace(COALESCE(v_pos.title, '') || ' @ ' || COALESCE(v_pos.company, ''),
                                           '[[:cntrl:]]', ' ', 'g'), 200),
            'confirm', p_action = 'position.apply_authorize');
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

-- ---------------------------------------------------------------------------------------------
-- 5. The door
-- ---------------------------------------------------------------------------------------------

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
           AND l.status IN ('queued', 'done', 'error')
           AND (SELECT r.cap_group FROM web_door.rule(l.action) AS r) = v_rule.cap_group;
        IF v_used >= v_rule.cap_n THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'error', 'rate_limited',
                'retry_after_s',
                GREATEST(1, ceil(extract(epoch FROM (v_oldest + v_rule.cap_window - now())))::INTEGER));
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
           AND l.status IN ('queued', 'done', 'error')
           AND (SELECT r.cap_group FROM web_door.rule(l.action) AS r) = v_rule.cap_group;
        IF v_used >= v_rule.cap_n THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'error', 'rate_limited',
                'retry_after_s',
                GREATEST(1, ceil(extract(epoch FROM (v_oldest + v_rule.cap_window - now())))::INTEGER));
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
        'ok', TRUE, 'state', 'queued', 'id', v_new_id, 'level', v_rule.level,
        'summary', v_summary, 'command_id', v_command));
END;
$$;

REVOKE ALL ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT, TEXT) IS
    'The single door for the actions of the website that have an effect. Closed vocabulary (web_door.vocab), user from auth.uid(), session from the token, limits and the record in web_action_log; what an action means is the function of its family. Refusals come back as {ok:false, error:code}.';

-- The four-argument door and the rules written inside 098 are replaced by the ones above.
DROP FUNCTION IF EXISTS public.request_action(TEXT, JSONB, UUID, TEXT);
DROP FUNCTION IF EXISTS public.web_action_rule(TEXT);

-- ---------------------------------------------------------------------------------------------
-- 6. Fail the migration if the boundary is not there
-- ---------------------------------------------------------------------------------------------

DO $$
DECLARE
    f RECORD;
BEGIN
    IF has_schema_privilege('authenticated', 'web_door', 'USAGE')
       OR has_schema_privilege('anon', 'web_door', 'USAGE')
       OR has_schema_privilege('authenticated', 'web_door', 'CREATE') THEN
        RAISE EXCEPTION '099: a browser role can use the private schema web_door';
    END IF;
    IF has_table_privilege('authenticated', 'web_door.vocab', 'SELECT')
       OR has_table_privilege('anon', 'web_door.vocab', 'SELECT')
       OR has_table_privilege('authenticated', 'web_door.vocab', 'INSERT') THEN
        RAISE EXCEPTION '099: a browser role can reach the vocabulary';
    END IF;
    FOR f IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc AS p
         WHERE p.pronamespace = 'web_door'::regnamespace
    LOOP
        IF has_function_privilege('authenticated', f.sig, 'EXECUTE')
           OR has_function_privilege('anon', f.sig, 'EXECUTE') THEN
            RAISE EXCEPTION '099: a browser role can execute %', f.sig;
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.request_action(text,jsonb,uuid,text,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.request_action(text,jsonb,uuid,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION '099: request_action is not executable by exactly the signed-in role';
    END IF;
    IF to_regprocedure('public.request_action(text,jsonb,uuid,text)') IS NOT NULL THEN
        RAISE EXCEPTION '099: the four-argument door is still there';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.web_action_log'::regclass
                      AND conname = 'web_action_log_action_in_vocab' AND contype = 'f') THEN
        RAISE EXCEPTION '099: the action of the log is not tied to the vocabulary';
    END IF;
END $$;
