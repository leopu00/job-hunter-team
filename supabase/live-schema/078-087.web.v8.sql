-- Additive read-only contract linking the shipped web query surface to live catalog receipts.
-- Generated identifiers are versioned in web-code-coverage.v1.json; no user rows are read.
-- Taken on 2026-08-18 against the production Supabase project, AFTER migration
-- 087 was applied: a receipt taken before would have described a schema that
-- did not exist. The only census change against v7 is two columns —
-- applications.rejection_reason and applications.rejection_note — which the
-- desired-state pull now reads so that the REASON for a rejection declared on
-- the web reaches the box (O-105). The v7 pair is not widened to hold them: a
-- receipt is a verification at one moment, and one widened twice can no longer
-- answer WHEN it was taken. The checks below are what was executed; only the
-- final projection was aggregated to read the outcome, and comments take no
-- part in the result. A receipt answers "verified against what, and when" or
-- it is only a declaration.
WITH expected_web_tables(check_id, table_name, column_names) AS (
  VALUES
    ('088.web.columns.applications', 'applications', ARRAY['applied', 'applied_at', 'applied_via', 'critic_reviewed_at', 'critic_round', 'critic_score', 'critic_verdict', 'deleted_at', 'id', 'position_id', 'rejection_note', 'rejection_reason', 'response', 'response_at', 'reviewed_by', 'status', 'updated_at', 'user_id', 'written_at', 'written_by']::text[]),
    ('088.web.columns.candidate_blocks', 'candidate_blocks', ARRAY['content', 'key', 'kind', 'ord', 'title', 'user_id']::text[]),
    ('088.web.columns.candidate_contacts', 'candidate_contacts', ARRAY['address', 'email', 'github', 'linkedin', 'phone', 'user_id', 'website']::text[]),
    ('088.web.columns.candidate_files', 'candidate_files', ARRAY['name', 'size', 'updated_at', 'user_id']::text[]),
    ('088.web.columns.candidate_profiles', 'candidate_profiles', ARRAY['user_id']::text[]),
    ('088.web.columns.cloud_sync_pairing_sessions', 'cloud_sync_pairing_sessions', ARRAY['approved_at', 'approved_token', 'approved_token_id', 'device_code', 'expires_at', 'status', 'user_code', 'user_id']::text[]),
    ('088.web.columns.cloud_sync_tokens', 'cloud_sync_tokens', ARRAY['client_capabilities', 'client_platform', 'client_seen_at', 'client_version', 'created_at', 'expires_at', 'id', 'name', 'revoked_at', 'token_hash', 'token_prefix', 'user_id']::text[]),
    ('088.web.columns.companies', 'companies', ARRAY['id', 'legacy_id', 'user_id']::text[]),
    ('088.web.columns.file_bridge_requests', 'file_bridge_requests', ARRAY['created_at', 'error', 'expires_at', 'file_name', 'id', 'status', 'updated_at', 'user_id']::text[]),
    ('088.web.columns.notification_prefs', 'notification_prefs', ARRAY['prefs', 'user_id']::text[]),
    ('088.web.columns.pending_user_messages', 'pending_user_messages', ARRAY['acknowledged_at', 'agent', 'agent_seen_reply_at', 'author', 'body', 'chat_ts', 'created_at', 'delivered_at', 'delivered_via', 'id', 'kind', 'legacy_id', 'related_position_id', 'source_action', 'source_directive_id', 'source_id', 'source_payload', 'user_id', 'user_reply', 'user_reply_at']::text[]),
    ('088.web.columns.position_feedback', 'position_feedback', ARRAY['action', 'comment', 'created_at', 'direction', 'position_legacy_id', 'reason', 'score', 'user_id']::text[]),
    ('088.web.columns.position_highlights', 'position_highlights', ARRAY['legacy_id', 'position_id', 'type']::text[]),
    ('088.web.columns.position_tickets', 'position_tickets', ARRAY['assigned_agent', 'assigned_at', 'created_at', 'id', 'kind', 'position_legacy_id', 'request_text', 'resolved_at', 'response_text', 'status', 'updated_at', 'user_id']::text[]),
    ('088.web.columns.position_transitions', 'position_transitions', ARRAY['by_agent', 'from_state', 'id', 'notes', 'position_legacy_id', 'to_state', 'ts']::text[]),
    ('088.web.columns.position_user_notes', 'position_user_notes', ARRAY['body', 'origin', 'position_id', 'updated_at', 'user_id']::text[]),
    ('088.web.columns.position_views', 'position_views', ARRAY['position_id', 'user_id']::text[]),
    ('088.web.columns.positions', 'positions', ARRAY['company', 'created_at', 'deadline', 'deleted_at', 'found_at', 'found_by', 'geocode_requested', 'geocode_requested_at', 'id', 'is_remote', 'jd_summary', 'jd_text', 'last_checked', 'legacy_id', 'loc_city', 'loc_country', 'loc_country_code', 'location', 'notes', 'office_address', 'office_geocoded', 'office_lat', 'office_lon', 'recheck_requested', 'recheck_requested_at', 'remote_type', 'role_family', 'salary_declared_currency', 'salary_declared_max', 'salary_declared_min', 'salary_estimated_currency', 'salary_estimated_max', 'salary_estimated_min', 'salary_precise_requested', 'salary_precise_requested_at', 'score', 'source', 'status', 'title', 'updated_at', 'url', 'user_excluded_at', 'user_excluded_note', 'user_excluded_prev_status', 'user_excluded_reason', 'user_id', 'write_request_kind', 'write_requested', 'write_requested_at']::text[]),
    ('088.web.columns.scores', 'scores', ARRAY['deleted_at', 'id', 'legacy_id', 'position_id', 'remote_fit', 'salary_fit', 'scored_at', 'scored_by', 'stack_match', 'strategic_fit', 'total_score']::text[]),
    ('088.web.columns.sentinel_ticks', 'sentinel_ticks', ARRAY['id']::text[]),
    ('088.web.columns.team_commands', 'team_commands', ARRAY['action', 'error', 'id', 'payload', 'processed_at', 'requested_at', 'status', 'user_id']::text[]),
    ('088.web.columns.team_directives', 'team_directives', ARRAY['archived_at', 'body', 'created_at', 'created_by', 'id', 'kind', 'sort_order', 'status', 'updated_at', 'user_id']::text[]),
    ('088.web.columns.team_state', 'team_state', ARRAY['active_device_claimed_at', 'active_device_id', 'agents_enabled', 'chat_delivered_at', 'chat_requested_at', 'cloud_push_checked_at', 'cloud_push_status', 'emergency_stop_completed_at', 'emergency_stop_requested_at', 'is_running', 'last_action', 'last_action_at', 'last_error', 'last_error_at', 'last_heartbeat_at', 'last_user_activity_at', 'should_run', 'sync_completed_at', 'sync_requested_at', 'user_id']::text[]),
    ('088.web.columns.user_onboarding_state', 'user_onboarding_state', ARRAY['first_team_run_at', 'profile_configured_at', 'tour_done_at', 'updated_at', 'user_id', 'vps_setup_completed_at']::text[]),
    ('088.web.columns.user_settings', 'user_settings', ARRAY['theme', 'user_id']::text[]),
    ('088.web.columns.user_to_agent_messages', 'user_to_agent_messages', ARRAY['agent', 'id', 'message', 'payload', 'sent_at', 'user_id']::text[])
),
web_column_checks(check_id, ok) AS (
  SELECT expected.check_id,
    COALESCE((
      SELECT pg_catalog.count(*) = pg_catalog.cardinality(expected.column_names)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid =
          pg_catalog.to_regclass('public.' || expected.table_name)
        AND attribute.attname = ANY(expected.column_names)
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ), false)
  FROM expected_web_tables AS expected
),
expected_web_rpcs(check_id, function_name, argument_names, argument_types) AS (
  VALUES
    ('088.web.rpc.consume_pairing_attempt', 'consume_pairing_attempt', ARRAY['p_user_id', 'p_device_code', 'p_window_seconds', 'p_max_attempts']::text[], ARRAY['uuid', 'text', 'integer', 'integer']::text[]),
    ('088.web.rpc.create_position_ticket', 'create_position_ticket', ARRAY['p_position_legacy_id', 'p_request_text', 'p_kind']::text[], ARRAY['integer', 'text', 'text']::text[]),
    ('088.web.rpc.delete_account_data', 'delete_account_data', ARRAY['p_user_id']::text[], ARRAY['uuid']::text[]),
    ('088.web.rpc.increment_download_clicks', 'increment_download_clicks', ARRAY['p_ts_hour', 'p_slug', 'p_utm_source', 'p_utm_medium', 'p_utm_campaign']::text[], ARRAY['text', 'text', 'text', 'text', 'text']::text[]),
    ('088.web.rpc.increment_landing_hits', 'increment_landing_hits', ARRAY['p_ts_hour', 'p_source']::text[], ARRAY['text', 'text']::text[]),
    ('088.web.rpc.mark_position_applied', 'mark_position_applied', ARRAY['p_position_legacy_id', 'p_applied_at', 'p_applied_via', 'p_note']::text[], ARRAY['integer', 'timestamp with time zone', 'text', 'text']::text[]),
    ('088.web.rpc.mark_position_outcome', 'mark_position_outcome', ARRAY['p_position_legacy_id', 'p_outcome', 'p_response_at', 'p_rejection_reason', 'p_rejection_note']::text[], ARRAY['integer', 'text', 'timestamp with time zone', 'text', 'text']::text[]),
    ('088.web.rpc.mutate_team_directive_with_event', 'mutate_team_directive_with_event', ARRAY['p_id', 'p_action', 'p_body', 'p_kind', 'p_request_id']::text[], ARRAY['bigint', 'text', 'text', 'text', 'text']::text[]),
    ('088.web.rpc.redeem_cloud_sync_pairing', 'redeem_cloud_sync_pairing', ARRAY['p_device_code']::text[], ARRAY['text']::text[]),
    ('088.web.rpc.sync_candidate_profile_atomic', 'sync_candidate_profile_atomic', ARRAY['p_user_id', 'p_content_hash', 'p_snapshot', 'p_force']::text[], ARRAY['uuid', 'text', 'jsonb', 'boolean']::text[]),
    ('088.web.rpc.sync_confirm_positions_applied', 'sync_confirm_positions_applied', ARRAY['p_user_id', 'p_position_legacy_ids']::text[], ARRAY['uuid', 'integer[]']::text[]),
    ('088.web.rpc.sync_create_position_ticket', 'sync_create_position_ticket', ARRAY['p_user_id', 'p_position_legacy_id', 'p_request_text', 'p_kind', 'p_status', 'p_assigned_agent', 'p_response_text', 'p_created_at', 'p_assigned_at', 'p_resolved_at']::text[], ARRAY['uuid', 'integer', 'text', 'text', 'text', 'text', 'text', 'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone']::text[]),
    ('088.web.rpc.sync_upsert_applications', 'sync_upsert_applications', ARRAY['p_user_id', 'p_applications']::text[], ARRAY['uuid', 'jsonb']::text[]),
    ('088.web.rpc.undo_manual_position_application', 'undo_manual_position_application', ARRAY['p_position_legacy_id', 'p_restored_status']::text[], ARRAY['integer', 'text']::text[]),
    ('088.web.rpc.undo_position_outcome', 'undo_position_outcome', ARRAY['p_position_legacy_id']::text[], ARRAY['integer']::text[]),
    ('088.web.rpc.upsert_pending_user_messages_merge', 'upsert_pending_user_messages_merge', ARRAY['p_rows']::text[], ARRAY['jsonb']::text[])
),
web_rpc_checks(check_id, ok) AS (
  SELECT expected.check_id,
    COALESCE((
      SELECT pg_catalog.count(*) = 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = expected.function_name
        AND procedure.proargnames[1:procedure.pronargs] = expected.argument_names
        AND ARRAY(
          SELECT pg_catalog.format_type(argument_type, NULL)
          FROM pg_catalog.unnest(procedure.proargtypes::oid[]) AS argument_type
        ) = expected.argument_types
    ), false)
  FROM expected_web_rpcs AS expected
)
SELECT checks.check_id, checks.ok
FROM (
  SELECT * FROM web_column_checks
  UNION ALL
  SELECT * FROM web_rpc_checks
) AS checks
ORDER BY checks.check_id
