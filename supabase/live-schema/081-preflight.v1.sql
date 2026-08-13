WITH checks(check_id, ok) AS (
  VALUES
    ('071.rescore.rows_ranked', COALESCE((SELECT count(*) = 0 FROM (SELECT ROW_NUMBER() OVER (PARTITION BY user_id, position_legacy_id, kind ORDER BY CASE status WHEN 'assigned' THEN 0 ELSE 1 END, created_at, id) AS rank FROM public.position_tickets WHERE kind='rescore' AND status IN ('open','assigned')) ranked WHERE rank > 1), false)),
    ('074.positions.company_detach', COALESCE((SELECT count(*) = 0 FROM public.positions p WHERE p.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=p.company_id AND c.user_id=p.user_id)), false)),
    ('074.pending_messages.detach', COALESCE((SELECT count(*) = 0 FROM public.pending_user_messages m WHERE m.related_position_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id=m.related_position_id AND p.user_id=m.user_id)), false)),
    ('074.scores.required_parent', COALESCE((SELECT count(*) = 0 FROM public.scores c WHERE NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id=c.position_id AND p.user_id=c.user_id)), false)),
    ('074.applications.required_parent', COALESCE((SELECT count(*) = 0 FROM public.applications c WHERE NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id=c.position_id AND p.user_id=c.user_id)), false)),
    ('074.position_highlights.required_parent', COALESCE((SELECT count(*) = 0 FROM public.position_highlights c WHERE NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id=c.position_id AND p.user_id=c.user_id)), false)),
    ('074.position_views.required_parent', COALESCE((SELECT count(*) = 0 FROM public.position_views c WHERE NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id=c.position_id AND p.user_id=c.user_id)), false)),
    ('074.position_user_notes.required_parent', COALESCE((SELECT count(*) = 0 FROM public.position_user_notes c WHERE NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id=c.position_id AND p.user_id=c.user_id)), false)),
    ('075.token.expiry_shortening', COALESCE((SELECT count(*) = 0 FROM public.cloud_sync_tokens t JOIN public.cloud_sync_pairing_sessions s ON s.approved_token_id=t.id WHERE s.status='approved' AND s.expires_at > now() AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > s.expires_at)), false)),
    ('075.token.expired_unrevoked', COALESCE((SELECT count(*) = 0 FROM public.cloud_sync_tokens t JOIN public.cloud_sync_pairing_sessions s ON s.approved_token_id=t.id WHERE s.status IN ('pending','approved','expired') AND s.expires_at <= now() AND t.revoked_at IS NULL), false)),
    ('075.session.expired_status', COALESCE((SELECT count(*) = 0 FROM public.cloud_sync_pairing_sessions WHERE status IN ('pending','approved') AND expires_at <= now()), false)),
    ('075.session.expired_token_wipe', COALESCE((SELECT count(*) = 0 FROM public.cloud_sync_pairing_sessions WHERE status IN ('pending','approved','expired') AND expires_at <= now() AND approved_token IS NOT NULL), false))
)
SELECT check_id, ok FROM checks ORDER BY check_id
