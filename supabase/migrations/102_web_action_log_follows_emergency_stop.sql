-- 102: the line of an emergency stop in the website's log is closed when the box confirms the stop.
--
-- Needs 098 (web_action_log, team_state.emergency_stop_requested_at written by the door) and 099 (the
-- family `team`, whose effect writes the stop). Applied after 101, in the same series.
--
-- The emergency stop is not a team command: the door writes it in team_state (should_run = false,
-- emergency_stop_requested_at = now()) and its log line is born `queued` with no command_id, so the
-- trigger of 098 that follows team_commands never closes it. The box completes the stop in its round
-- and, once `jht team stop` worked, writes with its token emergency_stop_completed_at =
-- emergency_stop_requested_at. That write now closes the line: every `queued` emergency stop of that
-- user created at or before the completed instant becomes `done`.
--
-- Why the comparison holds: the door writes emergency_stop_requested_at and the log line in the same
-- transaction, with the same now(), and the box writes as completed exactly the requested value. A stop
-- asked again after that completion is younger than it and stays `queued` until the box completes it
-- too; older stops left open are satisfied by the one that worked.
--
-- Who can make it fire: only the box (the service role) or the migration owner. Since 098 a browser
-- role has no INSERT or UPDATE on emergency_stop_completed_at, so a session cannot make a stop that
-- never happened look done. A stop that fails is not written as completed: its line stays `queued`.
--
-- Also here: the index under the foreign key web_action_log_action_in_vocab of 099 (the action of a log
-- line is a row of web_door.vocab). Every foreign key of the schema has an index that starts with its
-- columns (092, the advisor's unindexed_foreign_keys); 099 is applied as it is, so the index comes now.
--
-- Also here: web_door.ext_position of 099, again, with one change. Its withdrawal (apply_revoke) wrote
-- apply_requested = false and a new instant also on a position never authorised, or withdrawn already.
-- The box reads a moving instant with apply_requested false as «authorisation withdrawn» and tells the
-- user, so every such call was a false notice: from a stolen session, up to the hourly limit of the
-- action. Now a withdrawal with nothing to withdraw writes nothing and answers `done`. The rest of the
-- function is the one of 099, line by line.

CREATE INDEX IF NOT EXISTS web_action_log_action_idx
    ON public.web_action_log (action);

CREATE OR REPLACE FUNCTION public.web_action_log_follow_emergency_stop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.emergency_stop_completed_at IS NOT NULL
       AND NEW.emergency_stop_completed_at IS DISTINCT FROM OLD.emergency_stop_completed_at THEN
        UPDATE public.web_action_log
           SET status = 'done'
         WHERE user_id = NEW.user_id
           AND action = 'team.emergency_stop'
           AND status = 'queued'
           AND created_at <= NEW.emergency_stop_completed_at;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.web_action_log_follow_emergency_stop() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_web_action_log_follow_emergency_stop ON public.team_state;
CREATE TRIGGER trg_web_action_log_follow_emergency_stop
AFTER UPDATE OF emergency_stop_completed_at ON public.team_state
FOR EACH ROW
EXECUTE FUNCTION public.web_action_log_follow_emergency_stop();

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
            'summary', left(regexp_replace(COALESCE(v_pos.title, '') || ' @ ' || COALESCE(v_pos.company, ''),
                                           '[[:cntrl:]]', ' ', 'g'), 200),
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

-- Fail the migration if the follower or the index is not there, or a browser role can reach the follower.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_index AS i
          JOIN pg_constraint AS c ON c.conrelid = i.indrelid
         WHERE c.conname = 'web_action_log_action_in_vocab'
           AND c.conrelid = 'public.web_action_log'::regclass
           AND i.indisvalid
           AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey) THEN
        RAISE EXCEPTION '102: the foreign key of the log to the vocabulary has no index under it';
    END IF;
    IF to_regprocedure('public.web_action_log_follow_emergency_stop()') IS NULL
       OR NOT (SELECT prosecdef FROM pg_proc
                WHERE oid = to_regprocedure('public.web_action_log_follow_emergency_stop()')) THEN
        RAISE EXCEPTION '102: the follower of the emergency stop is missing or not a definer';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.team_state'::regclass
                      AND tgname = 'trg_web_action_log_follow_emergency_stop'
                      AND NOT tgisinternal AND tgenabled = 'O') THEN
        RAISE EXCEPTION '102: the trigger that closes the emergency stop is missing or disabled';
    END IF;
    IF has_function_privilege('anon', 'public.web_action_log_follow_emergency_stop()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.web_action_log_follow_emergency_stop()', 'EXECUTE') THEN
        RAISE EXCEPTION '102: a browser role can execute the follower of the emergency stop';
    END IF;
    IF has_column_privilege('authenticated', 'public.team_state', 'emergency_stop_completed_at', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.team_state', 'emergency_stop_completed_at', 'INSERT')
       OR has_column_privilege('anon', 'public.team_state', 'emergency_stop_completed_at', 'UPDATE') THEN
        RAISE EXCEPTION '102: a browser role can write the completion of an emergency stop';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc
             WHERE oid = to_regprocedure('web_door.ext_position(text, text, uuid, jsonb, text, uuid)'))
       OR position('position.apply_revoke'' AND v_pos.apply_requested IS NOT TRUE' IN
                   pg_get_functiondef(to_regprocedure('web_door.ext_position(text, text, uuid, jsonb, text, uuid)'))) = 0
       OR has_function_privilege('authenticated', 'web_door.ext_position(text, text, uuid, jsonb, text, uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'web_door.ext_position(text, text, uuid, jsonb, text, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION '102: the family of the position is not the one of this migration, or a browser role can run it';
    END IF;
END $$;
