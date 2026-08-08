-- Backfill of user_onboarding_state.first_team_run_at.
--
-- The column now has a writer: the first push carrying agent-produced rows
-- stamps it. That only ever looks forward, so the accounts that motivated
-- the ticket in the first place — the historical and dormant ones, the very
-- population you would query to ask "where do new users stall" — would keep
-- a NULL for good. A funnel populated only from today onward is the same
-- half-truth the ticket set out to remove, just with a newer start date.
--
-- Same shape as migration 011, which backfilled vps_setup_completed_at from
-- MIN(cloud_sync_tokens.created_at) rather than stamping now(): the value
-- has to say when it happened, not when we got around to recording it.
--
-- WHAT THE TIMESTAMP MEANS, precisely. `positions.created_at` is written by
-- the server when the row reaches the cloud, so it sits slightly AFTER the
-- moment the team actually produced it — a push follows the work. It is
-- therefore an upper bound: "that team had certainly run by then". The
-- alternative, `found_at`, comes from the box's own clock and would be a
-- lower bound of unknown quality; boxes with a clock minutes or hours off
-- are ordinary, which is why the delivery lane stopped trusting client
-- clocks at all. Between a bound we can defend and one we cannot, this
-- takes the defensible one.
--
-- Rows already stamped by the push are left alone: that value is closer to
-- the truth than anything reconstructed here.

INSERT INTO public.user_onboarding_state (
    user_id,
    first_team_run_at,
    created_at,
    updated_at
)
SELECT
    user_id,
    MIN(created_at) AS first_team_run_at,
    now(),
    now()
FROM public.positions
WHERE user_id IS NOT NULL
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
    SET first_team_run_at = COALESCE(
            public.user_onboarding_state.first_team_run_at,
            EXCLUDED.first_team_run_at
        ),
        updated_at = now();

COMMENT ON COLUMN public.user_onboarding_state.first_team_run_at IS
  'When that account''s team first produced work. Written forward by the first cloud push carrying agent-produced rows; historical accounts were backfilled in migration 066 from MIN(positions.created_at), which is an upper bound (the push follows the work).';
