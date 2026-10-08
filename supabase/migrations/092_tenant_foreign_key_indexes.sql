-- 092: an index under each foreign key the advisor finds uncovered.
--
-- Supabase advisor lint 0001 (unindexed_foreign_keys), 8 findings. Six are
-- the composite tenant edges of 074 and 083: (user_id, <parent id>) pointing
-- at the parent's (user_id, id). The single-column indexes already there,
-- on user_id or on the parent id alone, do not cover a two-column key: a
-- DELETE of a position or a company, or an account deletion, checks each
-- child table by both columns, and without a leading match it scans.
--
-- The other two are cloud_sync_pairing_sessions' user_id and
-- approved_token_id. 024 indexed them and 053 dropped the indexes as never
-- used: the table holds a few ten-minute pairing sessions, so the advisor
-- swings between "unused index" and "unindexed foreign key". They come back
-- because the ON DELETE of a user (CASCADE) and of a token (SET NULL)
-- checks this table by those columns, and an empty index costs nothing.
--
-- Columns follow each constraint's own order, which is what the lint and
-- the planner match. IF NOT EXISTS keeps the file idempotent. No
-- CONCURRENTLY: it cannot run inside the migration's transaction. The
-- largest table is positions (66 MB on 07/10): building its index holds
-- writes on it for a few seconds.

CREATE INDEX IF NOT EXISTS idx_applications_user_position
  ON public.applications (user_id, position_id);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_pairing_sessions_approved_token_id
  ON public.cloud_sync_pairing_sessions (approved_token_id);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_pairing_sessions_user_id
  ON public.cloud_sync_pairing_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_pending_user_messages_user_related_position
  ON public.pending_user_messages (user_id, related_position_id);

CREATE INDEX IF NOT EXISTS idx_position_highlights_user_position
  ON public.position_highlights (user_id, position_id);

CREATE INDEX IF NOT EXISTS idx_position_tickets_user_position_legacy
  ON public.position_tickets (user_id, position_id, position_legacy_id);

CREATE INDEX IF NOT EXISTS idx_positions_user_company
  ON public.positions (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_scores_user_position
  ON public.scores (user_id, position_id);
