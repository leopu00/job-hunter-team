-- 089: what each agent of the team is doing, as the box sees it.
--
-- The Godot game draws a tag over every agent (WORKING, WAITING, PAUSED,
-- THROTTLED) from the tmux pane and the pacing log it reads on the box. The
-- desktop reads the cloud instead, and until now the cloud knew the team
-- (is_running, heartbeat) but not the single agent. The box publishes it
-- here, next to the heartbeat, with the same rule the game uses
-- (shared/skills/agent_activity.py, byte for byte the game's payload).
--
-- Shape, written by one or more producers (the TUI team today, the JHT API
-- executor later), read by the desktop:
--   { "<uid>": { "status": "working" | "idle" | "paused" | "throttled",
--                "since": "<ISO, the producer's clock>",
--                "source": "tui" | "api",
--                "throttle_left_s": <seconds left at publish, throttled only> } }
-- A reader treats a missing or old value as "no state", never as a state:
-- agents_status_at says how old it is, stamped by the database.
--
-- Deliberately loose: only "a JSON object, not huge". A CHECK on the
-- vocabulary would refuse the whole UPDATE on a new word (it happened with
-- cloud_push_status, 17/08: 57 refusals an hour, the dashboard frozen); the
-- reader is the one that ignores an unknown status. The box writes these two
-- columns in an UPDATE of their own, never together with the heartbeat.
--
-- RLS: team_state is one row per user with its policies (019); nothing new
-- to open. Not audited: team_state_audit_trigger names its fields one by one.

ALTER TABLE team_state
  ADD COLUMN IF NOT EXISTS agents_status jsonb,
  ADD COLUMN IF NOT EXISTS agents_status_at timestamptz;

ALTER TABLE team_state
  DROP CONSTRAINT IF EXISTS team_state_agents_status_shape;

ALTER TABLE team_state
  ADD CONSTRAINT team_state_agents_status_shape CHECK (
    agents_status IS NULL
    OR (jsonb_typeof(agents_status) = 'object' AND pg_column_size(agents_status) <= 32768)
  );

-- The box's clock is not the reader's: the time of the observation is the
-- database's, as for cloud_push_checked_at (073).
CREATE OR REPLACE FUNCTION team_state_stamp_agents_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.agents_status IS NOT NULL THEN
      NEW.agents_status_at := now();
    END IF;
  ELSIF NEW.agents_status IS DISTINCT FROM OLD.agents_status
     OR NEW.agents_status_at IS DISTINCT FROM OLD.agents_status_at THEN
    NEW.agents_status_at := CASE WHEN NEW.agents_status IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_state_stamp_agents_status ON team_state;
CREATE TRIGGER trg_team_state_stamp_agents_status
  BEFORE INSERT OR UPDATE ON team_state
  FOR EACH ROW
  EXECUTE FUNCTION team_state_stamp_agents_status();

REVOKE ALL ON FUNCTION team_state_stamp_agents_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION team_state_stamp_agents_status() FROM anon, authenticated;
