-- M2 mobile safety: evento stop-only sul team_state esistente.
-- requested/completed rendono la capacità ripetibile senza command payload.

ALTER TABLE team_state
  ADD COLUMN IF NOT EXISTS emergency_stop_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_stop_completed_at timestamptz;

COMMENT ON COLUMN team_state.emergency_stop_requested_at IS
  'Stop-only intent created by the authenticated mobile web route.';
COMMENT ON COLUMN team_state.emergency_stop_completed_at IS
  'Last emergency stop intent successfully applied by the active device.';
