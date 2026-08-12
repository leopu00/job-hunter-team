-- O-66: il browser deve distinguere un cloud realmente indietro da un
-- account semplicemente fermo (nessuna nuova posizione da inviare).
-- Il device pubblica solo esito + timestamp del controllo bounded; firma e
-- conteggi SQLite non lasciano il box.
ALTER TABLE team_state
  ADD COLUMN IF NOT EXISTS cloud_push_status text,
  ADD COLUMN IF NOT EXISTS cloud_push_checked_at timestamptz;

ALTER TABLE team_state
  DROP CONSTRAINT IF EXISTS team_state_cloud_push_status_valid;

ALTER TABLE team_state
  ADD CONSTRAINT team_state_cloud_push_status_valid CHECK (
    cloud_push_status IS NULL OR cloud_push_status IN (
      'current',
      'failed',
      'timeout',
      'partial',
      'auth_failed',
      'signature_unavailable'
    )
  );

-- Il browser e il box possono avere clock diversi. Come per gli altri
-- rendezvous, il timestamp autorevole nasce nel database.
CREATE OR REPLACE FUNCTION team_state_stamp_cloud_push_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cloud_push_status IS NOT NULL THEN
      NEW.cloud_push_checked_at := clock_timestamp();
    END IF;
  ELSIF NEW.cloud_push_status IS DISTINCT FROM OLD.cloud_push_status
        OR NEW.cloud_push_checked_at IS DISTINCT FROM OLD.cloud_push_checked_at THEN
      NEW.cloud_push_checked_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_state_stamp_cloud_push_check ON team_state;
CREATE TRIGGER trg_team_state_stamp_cloud_push_check
  BEFORE INSERT OR UPDATE ON team_state
  FOR EACH ROW
  EXECUTE FUNCTION team_state_stamp_cloud_push_check();

REVOKE ALL ON FUNCTION team_state_stamp_cloud_push_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION team_state_stamp_cloud_push_check() FROM anon, authenticated;

COMMENT ON COLUMN team_state.cloud_push_status IS
  'Esito minimale dell ultimo controllo automatico locale→cloud; nessun dato locale.';
COMMENT ON COLUMN team_state.cloud_push_checked_at IS
  'Timestamp del controllo automatico bounded pubblicato dal device attivo.';
