-- 089: what each agent of the team is doing, as the box sees it.
--
-- The Godot game draws a tag over every agent (WORKING, WAITING, PAUSED,
-- THROTTLED) from the tmux pane and the pacing log it reads on the box. The
-- desktop reads the cloud instead, and until now the cloud knew the team
-- (is_running, heartbeat) but not the single agent. The box publishes it
-- here, next to the heartbeat, with the same rule the game uses
-- (shared/skills/agent_activity.py, byte for byte the game's payload).
--
-- Shape: one entry per SOURCE, each written by its own producer and stamped
-- by the database, so two producers never erase each other:
--   { "tui": { "at": "<ISO, stamped here>",
--              "agents": { "<uid>": { "status": "working" | "idle" | "paused" | "throttled",
--                                     "since": "<ISO, the producer's clock>",
--                                     "throttle_left_s": <seconds left at publish, throttled only> } } },
--     "api": { same, from the JHT API executor's traces } }
-- `uid` is the TUI session name in lower case (capitano, scout-1, critico-s2),
-- as the cloud's by_agent; cli/src/lib/agents-status.js canonicalAgentId is
-- the one rule that maps a name to it.
--
-- A producer writes ONLY its own key ({ "tui": { "agents": {...} } }): the
-- trigger below merges it into what the other sources wrote, and stamps its
-- "at". A key set to JSON null removes that source; the column set to NULL
-- removes them all. A reader treats a missing or old source (its "at") as
-- "no state", never as a state.
--
-- Deliberately loose: only "a JSON object, not huge". A CHECK on the
-- vocabulary would refuse the whole UPDATE on a new word (it happened with
-- cloud_push_status, 17/08: 57 refusals an hour, the dashboard frozen); the
-- reader is the one that ignores an unknown status. The box writes this
-- column in an UPDATE of its own, never together with the heartbeat.
--
-- RLS: team_state is one row per user with its policies (019); nothing new
-- to open. Not audited: team_state_audit_trigger names its fields one by one.

ALTER TABLE team_state
  ADD COLUMN IF NOT EXISTS agents_status jsonb;

ALTER TABLE team_state
  DROP CONSTRAINT IF EXISTS team_state_agents_status_shape;

ALTER TABLE team_state
  ADD CONSTRAINT team_state_agents_status_shape CHECK (
    agents_status IS NULL
    OR (jsonb_typeof(agents_status) = 'object' AND pg_column_size(agents_status) <= 32768)
  );

-- The merge by source, and the time of each observation. The box's clock is
-- not the reader's: "at" is the database's, as cloud_push_checked_at (073).
-- Milliseconds and a Z, so every browser's Date.parse reads it.
CREATE OR REPLACE FUNCTION team_state_merge_agents_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  merged jsonb;
  source text;
  entry jsonb;
  stamp jsonb := to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.agents_status IS NOT DISTINCT FROM OLD.agents_status THEN
    RETURN NEW;
  END IF;
  -- NULL clears every source; a value that is not an object is left to the CHECK
  IF NEW.agents_status IS NULL OR jsonb_typeof(NEW.agents_status) <> 'object' THEN
    RETURN NEW;
  END IF;

  merged := CASE
    WHEN TG_OP = 'UPDATE' AND jsonb_typeof(OLD.agents_status) = 'object' THEN OLD.agents_status
    ELSE '{}'::jsonb
  END;
  FOR source, entry IN SELECT key, value FROM jsonb_each(NEW.agents_status) LOOP
    IF jsonb_typeof(entry) = 'object' THEN
      merged := merged || jsonb_build_object(source, entry || jsonb_build_object('at', stamp));
    ELSIF jsonb_typeof(entry) = 'null' THEN
      merged := merged - source;
    END IF;
  END LOOP;
  NEW.agents_status := merged;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_state_merge_agents_status ON team_state;
CREATE TRIGGER trg_team_state_merge_agents_status
  BEFORE INSERT OR UPDATE ON team_state
  FOR EACH ROW
  EXECUTE FUNCTION team_state_merge_agents_status();

REVOKE ALL ON FUNCTION team_state_merge_agents_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION team_state_merge_agents_status() FROM anon, authenticated;
