-- 098: the single door for the actions of the website that have an effect (JHT web capace, phase 2-a).
--
-- The website is going to do again what the user needs, with protections. The protections can not
-- live in the routes alone: the anon key is public, and a session token written with the user's own
-- rights could write the same rows straight through PostgREST, past every route. So the boundary is
-- here, in the database:
--
--   * `request_action(...)` is the ONLY way for a browser session to ask for something that has an
--     effect: to start, stop or restart the team, to stop it in an emergency, to authorise or to
--     withdraw the authorisation to apply to a position. It takes the user from auth.uid(), the
--     session from the token, a closed vocabulary of actions, closed parameters, and answers with
--     a code instead of raising for every refusal the caller is expected to meet;
--   * `web_action_log` is the user's visible record of those actions. Only the function writes it:
--     a stolen session can neither forge a line, nor erase one, nor inflate the counter the limits
--     read;
--   * the direct writes that bypassed the door are revoked:
--       - team_commands: no insert, update or delete for a browser role (the box answers with the
--         service role, which keeps its rights);
--       - team_state: the control fields (should_run, agents_enabled, restart_token, the emergency
--         stop) are no longer writable from a browser role; presence, «sync now» and the chat bell
--         are, by column;
--       - positions.apply_requested / _at / _by: refused by a trigger to a browser role. The
--         authorisation to apply is the only field of the notebook with an effect outside, so it is
--         the only one guarded; the other columns of positions and applications stay the user's own
--         notes (mark_position_applied and mark_position_outcome run with the user's rights and
--         need them);
--       - team_directives were already closed by 079: this migration checks it, it does not redo it;
--   * TRUNCATE, TRIGGER and REFERENCES (and MAINTAIN where the server knows it) are taken away from
--     the browser roles on the tables above: TRUNCATE skips the row policies.
--
-- The route says which level it thinks the action has (`p_route_level`, a constant of the server):
-- if it is missing, or lower than the real one, the door answers `level_mismatch` BEFORE it writes
-- anything. A route that took a weaker check than the action deserves is caught where the effect
-- would have happened, not after it.
--
-- The desired state of the team gets a stamp: team_state.desired_changed_at is set by a trigger, from
-- the clock of the database, whenever should_run, restart_token or agents_enabled change (by anyone:
-- the door, the box, an operator). The box compares it with the clock of the server to refuse a
-- command that has waited too long. Nobody writes the column by hand: the trigger keeps the old value
-- when no desired field changes.
--
-- What a browser session may NOT do through the door, by design: write free text (no action takes
-- any: a free text must never become an application), name a user or a session, choose its own
-- level, write its own confirmation text or state. Those come from the database.
--
-- Recent session (levels 2 and 3): the moment the CURRENT session authenticated, from the `amr`
-- claim of its token, or from auth.sessions.created_at when the claim is missing. Never `iat`
-- (it moves on every refresh) and never the user's last_sign_in_at (it belongs to the user: when the
-- real user signs in on the phone, every stolen session would look recent for fifteen minutes).
--
-- Order of release: the web that calls the door goes out first, then this migration is applied, then
-- whatever fallback the web kept for the gap is removed. Applying it to the cloud stays with the
-- maintainer. The routes that wrote the revoked fields directly (the dispatch of /api/team/command
-- through the tunnel, /api/team-state/emergency-stop, the cloud branch of
-- /api/positions/[id]/apply-request, the control fields of /api/team-state PATCH on a non-cloud
-- deploy) stop working until they call the door.
--
-- The vocabulary is closed here AND by a CHECK on the log: a new action needs a new migration.
-- The rule «apply only from the status `ready`, never when already sent» mirrors
-- shared/cloud/apply-request-rule.json; a test runs the function against every status.

-- ---------------------------------------------------------------------------------------------
-- 1. The log
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.web_action_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id    UUID,
    action        TEXT NOT NULL,
    level         TEXT NOT NULL,
    params        JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary       TEXT NOT NULL,
    status        TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    confirmed_at  TIMESTAMPTZ,
    command_id    UUID,
    result        TEXT,
    CONSTRAINT web_action_log_action_closed CHECK (action IN (
        'team.start', 'team.stop', 'team.restart', 'team.emergency_stop',
        'position.apply_authorize', 'position.apply_revoke'
    )),
    CONSTRAINT web_action_log_level_closed CHECK (level IN ('L1', 'L2', 'L3')),
    CONSTRAINT web_action_log_status_closed CHECK (status IN (
        'awaiting_confirm', 'queued', 'done', 'error', 'cancelled', 'expired'
    )),
    CONSTRAINT web_action_log_params_small CHECK (
        jsonb_typeof(params) = 'object' AND pg_column_size(params) <= 256
    ),
    CONSTRAINT web_action_log_summary_short CHECK (char_length(summary) <= 200),
    CONSTRAINT web_action_log_result_short CHECK (result IS NULL OR char_length(result) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_web_action_log_user_recent
    ON public.web_action_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_action_log_user_action
    ON public.web_action_log (user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_action_log_awaiting
    ON public.web_action_log (user_id) WHERE status = 'awaiting_confirm';
CREATE INDEX IF NOT EXISTS idx_web_action_log_command
    ON public.web_action_log (command_id) WHERE command_id IS NOT NULL;

ALTER TABLE public.web_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users select own web actions" ON public.web_action_log;
CREATE POLICY "users select own web actions"
    ON public.web_action_log FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- A table born in `public` is born with everything granted to anon and authenticated (the default
-- privileges of the project): take it all back, then give back the read.
REVOKE ALL ON TABLE public.web_action_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.web_action_log TO authenticated;

COMMENT ON TABLE public.web_action_log IS
    'The user''s record of the actions asked through request_action(). Written only by that function (and by the trigger that follows team_commands). The browser roles can read their own rows and nothing else.';

-- ---------------------------------------------------------------------------------------------
-- 2. The rules of the vocabulary (private: only the door reads them)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.web_action_rule(p_action TEXT)
RETURNS TABLE (level TEXT, recent BOOLEAN, cap_group TEXT, cap_n INTEGER, cap_window INTERVAL)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT v.level, v.recent, v.cap_group, v.cap_n, v.cap_window
      FROM (VALUES
        ('team.start',                'L2', TRUE,  'team.up',          6,   INTERVAL '1 hour'),
        ('team.restart',              'L2', TRUE,  'team.up',          6,   INTERVAL '1 hour'),
        ('team.stop',                 'L2', TRUE,  'team.down',        12,  INTERVAL '1 hour'),
        ('team.emergency_stop',       'L2', FALSE, 'team.emergency',   120, INTERVAL '1 hour'),
        ('position.apply_authorize',  'L3', TRUE,  'position.apply',   15,  INTERVAL '1 day'),
        ('position.apply_revoke',     'L1', FALSE, 'position.revoke',  60,  INTERVAL '1 hour')
      ) AS v (action, level, recent, cap_group, cap_n, cap_window)
     WHERE v.action = p_action;
$$;

REVOKE ALL ON FUNCTION public.web_action_rule(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. The door
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_action(
    p_action      TEXT,
    p_params      JSONB DEFAULT '{}'::jsonb,
    p_confirm_id  UUID  DEFAULT NULL,
    p_route_level TEXT  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid        UUID := auth.uid();
    v_claims     JSONB;
    v_session    UUID;
    v_rule       RECORD;
    v_login      TIMESTAMPTZ;
    v_row        public.web_action_log%ROWTYPE;
    v_params     JSONB;
    v_target     TEXT;
    v_legacy     INTEGER;
    v_pos        RECORD;
    v_applied    BOOLEAN;
    v_summary    TEXT;
    v_needs_conf BOOLEAN := FALSE;
    v_used       INTEGER;
    v_oldest     TIMESTAMPTZ;
    v_command    UUID;
    v_at         TIMESTAMPTZ;
    v_new_id     UUID;
    v_action     TEXT;
    v_targets    TEXT[] := ARRAY['all', 'assistente', 'capitano', 'sentinella', 'scout', 'scorer',
                                 'analista', 'scrittore', 'critico', 'mentor', 'bridge'];
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

    v_claims := COALESCE(auth.jwt(), '{}'::jsonb);
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
        IF p_params IS NOT NULL AND p_params <> '{}'::jsonb THEN
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
        SELECT * INTO v_rule FROM public.web_action_rule(v_row.action);
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
           AND (SELECT r.cap_group FROM public.web_action_rule(l.action) AS r) = v_rule.cap_group;
        IF v_used >= v_rule.cap_n THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'error', 'rate_limited',
                'retry_after_s',
                GREATEST(1, ceil(extract(epoch FROM (v_oldest + v_rule.cap_window - now())))::INTEGER));
        END IF;

        v_action := v_row.action;
        v_params := v_row.params;
        v_summary := v_row.summary;
        UPDATE public.web_action_log
           SET status = 'queued', confirmed_at = now()
         WHERE id = v_row.id;
        v_new_id := v_row.id;
    ELSE
        -- -------------------------------------------------------------------------------------
        -- First call.
        -- -------------------------------------------------------------------------------------
        SELECT * INTO v_rule FROM public.web_action_rule(p_action);
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'unknown_action');
        END IF;
        IF p_route_level < v_rule.level THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'level_mismatch');
        END IF;
        v_action := p_action;

        IF p_params IS NULL THEN
            v_params := '{}'::jsonb;
        ELSE
            v_params := p_params;
        END IF;
        IF jsonb_typeof(v_params) <> 'object' OR pg_column_size(v_params) > 256 THEN
            RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
        END IF;

        -- Closed parameters per action. A key that is not listed is a refusal, never ignored.
        IF v_action IN ('team.start', 'team.stop', 'team.restart') THEN
            IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_params) AS k WHERE k <> 'target') THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
            END IF;
            IF v_params ? 'target' THEN
                IF jsonb_typeof(v_params -> 'target') <> 'string' THEN
                    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
                END IF;
                v_target := lower(v_params ->> 'target');
            ELSE
                v_target := 'all';
            END IF;
            IF NOT (v_target = ANY (v_targets)) THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
            END IF;
            v_params := jsonb_build_object('target', v_target);
            v_needs_conf := (v_target = 'all');
        ELSIF v_action = 'team.emergency_stop' THEN
            IF v_params <> '{}'::jsonb THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
            END IF;
        ELSE
            -- position.apply_authorize | position.apply_revoke
            IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_params) AS k WHERE k <> 'legacy_id')
               OR NOT (v_params ? 'legacy_id')
               OR jsonb_typeof(v_params -> 'legacy_id') <> 'number'
               OR (v_params ->> 'legacy_id') !~ '^[0-9]{1,9}$'
               OR (v_params ->> 'legacy_id')::BIGINT < 1
               OR (v_params ->> 'legacy_id')::BIGINT > 2147483647 THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_params');
            END IF;
            v_legacy := (v_params ->> 'legacy_id')::INTEGER;
            v_params := jsonb_build_object('legacy_id', v_legacy);
            v_needs_conf := (v_action = 'position.apply_authorize');
        END IF;

        -- Recent session: the login of THIS session, not of the user.
        IF v_rule.recent THEN
            SELECT to_timestamp(max((e ->> 'timestamp')::DOUBLE PRECISION))
              INTO v_login
              FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(v_claims -> 'amr') = 'array'
                            THEN v_claims -> 'amr' ELSE '[]'::jsonb END
                   ) AS e
             WHERE jsonb_typeof(e) = 'object'
               AND jsonb_typeof(e -> 'timestamp') = 'number'
               AND (e ->> 'method') IN ('password', 'oauth', 'otp', 'magiclink', 'sso/saml',
                                        'recovery', 'invite', 'email/signup',
                                        'mfa/totp', 'mfa/phone', 'mfa/webauthn');
            IF v_login IS NULL AND v_session IS NOT NULL THEN
                SELECT s.created_at INTO v_login
                  FROM auth.sessions AS s
                 WHERE s.id = v_session AND s.user_id = v_uid;
            END IF;
            IF v_login IS NULL OR v_login < now() - INTERVAL '15 minutes' THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'reauth_required');
            END IF;
        END IF;

        -- The target of a position belongs to the user, or does not exist (the same answer).
        IF v_action IN ('position.apply_authorize', 'position.apply_revoke') THEN
            SELECT p.id, p.title, p.company, p.status, p.apply_requested_at
              INTO v_pos
              FROM public.positions AS p
             WHERE p.user_id = v_uid AND p.legacy_id = v_legacy AND p.deleted_at IS NULL;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'not_found');
            END IF;
            SELECT COALESCE(bool_or(a.applied), FALSE) INTO v_applied
              FROM public.applications AS a
             WHERE a.position_id = v_pos.id AND a.user_id = v_uid AND a.deleted_at IS NULL;
            -- The same order as the gate (shared/cloud/apply-request-rule.json): an application that
            -- already left is neither authorised nor withdrawn; only `ready` is authorised.
            IF v_applied OR v_pos.status IN ('applied', 'response') THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'already_submitted');
            END IF;
            IF v_action = 'position.apply_authorize' AND v_pos.status IS DISTINCT FROM 'ready' THEN
                RETURN jsonb_build_object('ok', FALSE, 'error', 'position_not_ready');
            END IF;
            v_summary := left(
                regexp_replace(COALESCE(v_pos.title, '') || ' @ ' || COALESCE(v_pos.company, ''),
                               '[[:cntrl:]]', ' ', 'g'),
                200);
        ELSIF v_action = 'team.emergency_stop' THEN
            v_summary := 'emergency_stop';
        ELSE
            v_summary := substr(v_action, 6) || ' ' || v_target;
        END IF;

        -- Limits, counted on the log of the user.
        SELECT count(*), min(l.created_at)
          INTO v_used, v_oldest
          FROM public.web_action_log AS l
         WHERE l.user_id = v_uid
           AND l.created_at > now() - v_rule.cap_window
           AND l.status IN ('queued', 'done', 'error')
           AND (SELECT r.cap_group FROM public.web_action_rule(l.action) AS r) = v_rule.cap_group;
        IF v_used >= v_rule.cap_n THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'error', 'rate_limited',
                'retry_after_s',
                GREATEST(1, ceil(extract(epoch FROM (v_oldest + v_rule.cap_window - now())))::INTEGER));
        END IF;

        IF v_needs_conf THEN
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
                (user_id, session_id, action, level, params, summary, status, expires_at)
            VALUES
                (v_uid, v_session, v_action, v_rule.level, v_params, v_summary,
                 'awaiting_confirm', now() + INTERVAL '2 minutes')
            RETURNING id, expires_at INTO v_new_id, v_at;
            RETURN jsonb_build_object(
                'ok', TRUE, 'state', 'awaiting_confirm', 'id', v_new_id,
                'level', v_rule.level, 'summary', v_summary, 'expires_at', v_at);
        END IF;

        INSERT INTO public.web_action_log
            (user_id, session_id, action, level, params, summary, status)
        VALUES
            (v_uid, v_session, v_action, v_rule.level, v_params, v_summary, 'queued')
        RETURNING id INTO v_new_id;
    END IF;

    -- -----------------------------------------------------------------------------------------
    -- The effect. The line is `queued` here, in the same transaction: if the effect refuses, the
    -- line is `cancelled` with the reason and the caller gets the code.
    -- -----------------------------------------------------------------------------------------
    IF v_action IN ('team.start', 'team.stop', 'team.restart') THEN
        INSERT INTO public.team_commands (user_id, action, payload)
        VALUES (v_uid, substr(v_action, 6), jsonb_build_object('target', v_params ->> 'target'))
        RETURNING id INTO v_command;
        UPDATE public.web_action_log SET command_id = v_command WHERE id = v_new_id;

    ELSIF v_action = 'team.emergency_stop' THEN
        INSERT INTO public.team_state
            (user_id, should_run, emergency_stop_requested_at, last_user_activity_at)
        VALUES (v_uid, FALSE, now(), now())
        ON CONFLICT (user_id) DO UPDATE
           SET should_run = FALSE,
               emergency_stop_requested_at = EXCLUDED.emergency_stop_requested_at,
               last_user_activity_at = EXCLUDED.last_user_activity_at;

    ELSE
        -- position.apply_authorize | position.apply_revoke. For the second call the position is
        -- looked at again: a minute of waiting is enough for it to have left.
        v_legacy := (v_params ->> 'legacy_id')::INTEGER;
        SELECT p.id, p.status, p.apply_requested_at
          INTO v_pos
          FROM public.positions AS p
         WHERE p.user_id = v_uid AND p.legacy_id = v_legacy AND p.deleted_at IS NULL
         FOR UPDATE;
        IF NOT FOUND THEN
            UPDATE public.web_action_log SET status = 'cancelled', result = 'not_found'
             WHERE id = v_new_id;
            RETURN jsonb_build_object('ok', FALSE, 'error', 'not_found');
        END IF;
        SELECT COALESCE(bool_or(a.applied), FALSE) INTO v_applied
          FROM public.applications AS a
         WHERE a.position_id = v_pos.id AND a.user_id = v_uid AND a.deleted_at IS NULL;
        IF v_applied OR v_pos.status IN ('applied', 'response') THEN
            UPDATE public.web_action_log SET status = 'cancelled', result = 'already_submitted'
             WHERE id = v_new_id;
            RETURN jsonb_build_object('ok', FALSE, 'error', 'already_submitted');
        END IF;
        IF v_action = 'position.apply_authorize' AND v_pos.status IS DISTINCT FROM 'ready' THEN
            UPDATE public.web_action_log SET status = 'cancelled', result = 'position_not_ready'
             WHERE id = v_new_id;
            RETURN jsonb_build_object('ok', FALSE, 'error', 'position_not_ready');
        END IF;

        -- The pull of the box filters on `updated_at > cursor`: the instant always moves forward,
        -- also when the authorisation is withdrawn.
        v_at := GREATEST(now(),
                         COALESCE(v_pos.apply_requested_at, '-infinity'::TIMESTAMPTZ)
                         + INTERVAL '1 millisecond');
        UPDATE public.positions
           SET apply_requested    = (v_action = 'position.apply_authorize'),
               apply_requested_at = v_at,
               apply_requested_by = CASE WHEN v_action = 'position.apply_authorize'
                                         THEN 'user_web' ELSE NULL END
         WHERE id = v_pos.id AND user_id = v_uid;
    END IF;

    RETURN jsonb_strip_nulls(jsonb_build_object(
        'ok', TRUE, 'state', 'queued', 'id', v_new_id, 'level', v_rule.level,
        'summary', v_summary, 'command_id', v_command));
END;
$$;

-- A function born in `public` is executable by anon: only a signed-in browser role may call it.
REVOKE ALL ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_action(TEXT, JSONB, UUID, TEXT) IS
    'The single door for the actions of the website that have an effect. Closed vocabulary, user from auth.uid(), session from the token, limits and the record in web_action_log. Refusals come back as {ok:false, error:code}.';

-- The log follows the bus: when the box reports a command, the line of the user says the same.
CREATE OR REPLACE FUNCTION public.web_action_log_follow_command()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status IN ('done', 'error') AND NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE public.web_action_log
           SET status = NEW.status,
               result = CASE WHEN NEW.status = 'error' THEN left(COALESCE(NEW.error, 'error'), 200) END
         WHERE command_id = NEW.id AND status = 'queued';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.web_action_log_follow_command() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_web_action_log_follow_command ON public.team_commands;
CREATE TRIGGER trg_web_action_log_follow_command
AFTER UPDATE OF status ON public.team_commands
FOR EACH ROW
EXECUTE FUNCTION public.web_action_log_follow_command();

-- ---------------------------------------------------------------------------------------------
-- 4. The direct writes that went past the door
-- ---------------------------------------------------------------------------------------------

-- team_commands: the box writes it with the service role; a browser role only reads its own lines.
DROP POLICY IF EXISTS "users insert own team commands" ON public.team_commands;
DROP POLICY IF EXISTS "users update own team commands" ON public.team_commands;
REVOKE ALL ON TABLE public.team_commands FROM anon, authenticated;
GRANT SELECT ON TABLE public.team_commands TO authenticated;

-- team_state: reading is whole; writing is by column, and only what is not control.
REVOKE ALL ON TABLE public.team_state FROM anon, authenticated;
GRANT SELECT ON TABLE public.team_state TO authenticated;
GRANT INSERT (user_id, last_user_activity_at, sync_requested_at, chat_requested_at)
    ON TABLE public.team_state TO authenticated;
GRANT UPDATE (last_user_activity_at, sync_requested_at, chat_requested_at)
    ON TABLE public.team_state TO authenticated;

-- positions.apply_requested*: only the door (a function owned by the migration role), or the box.
CREATE OR REPLACE FUNCTION public.positions_guard_apply_requested()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            IF COALESCE(NEW.apply_requested, FALSE)
               OR NEW.apply_requested_at IS NOT NULL
               OR NEW.apply_requested_by IS NOT NULL THEN
                RAISE EXCEPTION 'apply_requested_is_door_only' USING ERRCODE = '42501';
            END IF;
        ELSIF NEW.apply_requested IS DISTINCT FROM OLD.apply_requested
           OR NEW.apply_requested_at IS DISTINCT FROM OLD.apply_requested_at
           OR NEW.apply_requested_by IS DISTINCT FROM OLD.apply_requested_by THEN
            RAISE EXCEPTION 'apply_requested_is_door_only' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.positions_guard_apply_requested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_positions_guard_apply_requested ON public.positions;
CREATE TRIGGER trg_positions_guard_apply_requested
BEFORE INSERT OR UPDATE OF apply_requested, apply_requested_at, apply_requested_by
ON public.positions
FOR EACH ROW
EXECUTE FUNCTION public.positions_guard_apply_requested();

-- The stamp of the desired state of the team.
ALTER TABLE public.team_state
    ADD COLUMN IF NOT EXISTS desired_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.team_state.desired_changed_at IS
    'When should_run, restart_token or agents_enabled last changed, from the clock of the database. Set only by trigger; the box compares it with the clock of the server.';

CREATE OR REPLACE FUNCTION public.team_state_stamp_desired_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.should_run OR NEW.restart_token IS NOT NULL OR NEW.agents_enabled <> '{}'::jsonb THEN
            NEW.desired_changed_at := now();
        ELSE
            NEW.desired_changed_at := NULL;
        END IF;
    ELSIF NEW.should_run IS DISTINCT FROM OLD.should_run
       OR NEW.restart_token IS DISTINCT FROM OLD.restart_token
       OR NEW.agents_enabled IS DISTINCT FROM OLD.agents_enabled THEN
        NEW.desired_changed_at := now();
    ELSE
        NEW.desired_changed_at := OLD.desired_changed_at;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.team_state_stamp_desired_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_team_state_stamp_desired_changed ON public.team_state;
CREATE TRIGGER trg_team_state_stamp_desired_changed
BEFORE INSERT OR UPDATE ON public.team_state
FOR EACH ROW
EXECUTE FUNCTION public.team_state_stamp_desired_changed();

-- TRUNCATE skips the row policies; TRIGGER and REFERENCES are of no use to a browser role. MAINTAIN
-- exists only from PostgreSQL 17.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['team_commands', 'team_state', 'team_directives', 'positions',
                             'applications', 'scores', 'candidate_profiles']
    LOOP
        EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', t);
        IF current_setting('server_version_num')::INTEGER >= 170000 THEN
            EXECUTE format('REVOKE MAINTAIN ON TABLE public.%I FROM anon, authenticated', t);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Fail the migration if the boundary is not there
-- ---------------------------------------------------------------------------------------------

DO $$
DECLARE
    t TEXT;
    p TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['team_commands', 'team_state', 'team_directives', 'web_action_log']
    LOOP
        FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
        LOOP
            IF has_table_privilege('authenticated', format('public.%I', t), p)
               OR has_table_privilege('anon', format('public.%I', t), p) THEN
                RAISE EXCEPTION '098: a browser role still has % on public.%', p, t;
            END IF;
        END LOOP;
    END LOOP;
    IF has_column_privilege('authenticated', 'public.team_state', 'should_run', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.team_state', 'agents_enabled', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.team_state', 'restart_token', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.team_state', 'emergency_stop_requested_at', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.team_state', 'desired_changed_at', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.team_state', 'should_run', 'INSERT') THEN
        RAISE EXCEPTION '098: a browser role can still write a control field of team_state';
    END IF;
    IF has_function_privilege('anon', 'public.request_action(text,jsonb,uuid,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.request_action(text,jsonb,uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION '098: request_action is not executable by exactly the signed-in role';
    END IF;
    IF has_function_privilege('authenticated', 'public.web_action_rule(text)', 'EXECUTE') THEN
        RAISE EXCEPTION '098: the rules of the vocabulary are readable by a browser role';
    END IF;
END $$;
