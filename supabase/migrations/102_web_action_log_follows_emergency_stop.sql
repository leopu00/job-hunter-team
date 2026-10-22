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
END $$;
