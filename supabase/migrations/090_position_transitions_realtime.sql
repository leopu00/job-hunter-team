-- 090: position_transitions in the Realtime publication.
--
-- The desktop office (D09) follows the cloud live: positions and team_state
-- are published already (058, 021); a transition, the thing the office
-- turns into an agent's trip, was not. With this the desktop sees each new
-- transition as it is written and walks it at once, instead of waiting for
-- its next read (at most one a minute).
--
-- Realtime applies the table's RLS ("own transitions" SELECT policy, 044):
-- a user receives only their rows; the desktop also filters by user_id.
-- Only INSERTs are listened to: no REPLICA IDENTITY change is needed.
-- Without this migration the desktop still works: a change of positions
-- or team_state asks for a read, and the read brings the transitions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'position_transitions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.position_transitions;
  END IF;
END $$;
