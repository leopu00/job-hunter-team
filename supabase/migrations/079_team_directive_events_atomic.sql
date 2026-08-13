-- O-80: directive mutation and Captain handoff are one tenant-bound event.
ALTER TABLE public.pending_user_messages
  ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE public.team_directives
  ADD COLUMN IF NOT EXISTS source_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS team_directives_source_id_unique
  ON public.team_directives(user_id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS pending_user_messages_source_id_unique
  ON public.pending_user_messages(user_id, source_id);

CREATE OR REPLACE FUNCTION public.mutate_team_directive_with_event(
  p_id BIGINT,
  p_action TEXT,
  p_body TEXT,
  p_source_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_changed INTEGER;
  v_existing BIGINT;
BEGIN
  IF v_user IS NULL OR p_action NOT IN ('created','edited','archived') THEN
    RAISE EXCEPTION 'invalid directive event';
  END IF;
  SELECT id INTO v_existing FROM team_directives
    WHERE user_id = v_user AND source_id = p_source_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_existing, 'status', 'queued');
  END IF;
  IF p_action = 'created' THEN
    INSERT INTO team_directives (user_id, body, kind, status, created_by, source_id)
    VALUES (v_user, p_body, 'order', 'active', 'user', p_source_id)
    ON CONFLICT (user_id, source_id) DO UPDATE SET source_id = EXCLUDED.source_id
    RETURNING id INTO p_id;
  ELSIF p_action = 'archived' THEN
    UPDATE team_directives SET status='archived', archived_at=now(), updated_at=now()
      WHERE id=p_id AND user_id=v_user AND status='active';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN RAISE EXCEPTION 'directive not found'; END IF;
  ELSE
    UPDATE team_directives SET body=p_body, updated_at=now()
      WHERE id=p_id AND user_id=v_user AND status='active';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN RAISE EXCEPTION 'directive not found'; END IF;
  END IF;
  INSERT INTO pending_user_messages (user_id, agent, body, kind, author, source_id, created_at)
    VALUES (v_user, 'capitano', '[TEAM-DIRECTIVE] ' || p_action || ' #' || p_id,
            'notification', 'user', p_source_id, now())
    ON CONFLICT (user_id, source_id) DO NOTHING;
  INSERT INTO team_state (user_id, chat_requested_at) VALUES (v_user, now())
    ON CONFLICT (user_id) DO UPDATE SET chat_requested_at=EXCLUDED.chat_requested_at;
  RETURN jsonb_build_object('id', p_id, 'status', 'queued');
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
