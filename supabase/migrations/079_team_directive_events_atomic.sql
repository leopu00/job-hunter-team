-- O-80: a directive mutation, its Captain event, wakeup and replay result are
-- one tenant-bound transaction. request_id is an opaque client operation id.
ALTER TABLE public.pending_user_messages
  ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE public.pending_user_messages
  ADD COLUMN IF NOT EXISTS source_action TEXT;
ALTER TABLE public.pending_user_messages
  ADD COLUMN IF NOT EXISTS source_payload TEXT;
ALTER TABLE public.pending_user_messages
  ADD COLUMN IF NOT EXISTS source_directive_id BIGINT;
ALTER TABLE public.team_directives
  ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS team_directives_source_id_unique
  ON public.team_directives(user_id, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS pending_user_messages_source_id_unique
  ON public.pending_user_messages(user_id, source_id);

CREATE TABLE IF NOT EXISTS public.team_directive_request_ledger (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  payload TEXT,
  kind TEXT,
  result JSONB,
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE public.team_directive_request_ledger
  ADD COLUMN IF NOT EXISTS kind TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_directive_request_ledger_user_id_fkey'
      AND conrelid = 'public.team_directive_request_ledger'::regclass
  ) THEN
    ALTER TABLE public.team_directive_request_ledger
      ADD CONSTRAINT team_directive_request_ledger_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE public.team_directive_request_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_directive_request_ledger
  FROM PUBLIC, anon, authenticated, service_role;
-- Account export runs as service_role: it may read this user-owned ledger but
-- cannot manufacture, alter or delete replay receipts.
GRANT SELECT ON public.team_directive_request_ledger TO service_role;

-- The RPC is the only browser mutation seam. Direct writes would bypass its
-- claim/event/result invariant; service_role remains available to cloud sync.
REVOKE INSERT, UPDATE, DELETE ON public.team_directives FROM anon, authenticated;

-- Browser chat still needs a narrow insert/update surface, but cannot forge or
-- rewrite immutable directive-event identity columns.
REVOKE INSERT, UPDATE ON public.pending_user_messages FROM authenticated;
GRANT INSERT (
  user_id, legacy_id, agent, body, kind, author, delivered_via,
  acknowledged_at, created_at
) ON public.pending_user_messages TO authenticated;
GRANT UPDATE (delivered_at, acknowledged_at, user_reply, user_reply_at)
  ON public.pending_user_messages TO authenticated;

DROP FUNCTION IF EXISTS public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION public.mutate_team_directive_with_event(
  p_id BIGINT,
  p_action TEXT,
  p_body TEXT,
  p_kind TEXT,
  p_request_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_changed INTEGER;
  v_existing_action TEXT;
  v_existing_payload TEXT;
  v_existing_kind TEXT;
  v_existing_directive BIGINT;
  v_result JSONB;
  v_source_id TEXT;
  v_legacy_id BIGINT;
BEGIN
  IF v_user IS NULL OR p_action NOT IN ('created', 'edited', 'archived') THEN
    RAISE EXCEPTION 'invalid directive event';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.length(p_request_id) < 1
     OR pg_catalog.length(p_request_id) > 180 THEN
    RAISE EXCEPTION 'invalid directive request id';
  END IF;
  IF p_action = 'created' AND (
       p_id <> 0 OR p_body IS NULL OR pg_catalog.length(pg_catalog.btrim(p_body)) < 1
       OR pg_catalog.length(p_body) > 2000
       OR p_kind NOT IN ('order', 'strategy', 'formation', 'note')
     ) THEN
    RAISE EXCEPTION 'invalid directive create';
  END IF;
  IF p_action = 'edited' AND (
       p_id <= 0 OR p_body IS NULL OR pg_catalog.length(pg_catalog.btrim(p_body)) < 1
       OR pg_catalog.length(p_body) > 2000 OR p_kind IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'invalid directive edit';
  END IF;
  IF p_action = 'archived' AND (p_id <= 0 OR p_body IS NOT NULL OR p_kind IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid directive archive';
  END IF;

  INSERT INTO public.team_directive_request_ledger(
    user_id, request_id, action, target_id, payload, kind
  ) VALUES (v_user, p_request_id, p_action, p_id, p_body, p_kind)
  ON CONFLICT (user_id, request_id) DO NOTHING;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN
    SELECT action, target_id, payload, kind, result
      INTO v_existing_action, v_existing_directive, v_existing_payload,
           v_existing_kind, v_result
      FROM public.team_directive_request_ledger
      WHERE user_id = v_user AND request_id = p_request_id;
    IF v_existing_action IS DISTINCT FROM p_action
       OR v_existing_directive IS DISTINCT FROM p_id
       OR v_existing_payload IS DISTINCT FROM p_body
       OR v_existing_kind IS DISTINCT FROM p_kind THEN
      RAISE EXCEPTION 'request id payload mismatch';
    END IF;
    IF v_result IS NULL THEN RAISE EXCEPTION 'request result missing'; END IF;
    RETURN v_result;
  END IF;

  v_source_id := 'team-directive:' || p_request_id;
  IF EXISTS (
    SELECT 1 FROM public.pending_user_messages
    WHERE user_id = v_user AND source_id = v_source_id
  ) OR EXISTS (
    SELECT 1 FROM public.team_directives
    WHERE user_id = v_user AND source_id = v_source_id
  ) THEN
    RAISE EXCEPTION 'directive request identity collision';
  END IF;

  IF p_action = 'created' THEN
    INSERT INTO public.team_directives(
      user_id, body, kind, status, created_by, source_id
    ) VALUES (v_user, pg_catalog.btrim(p_body), p_kind, 'active', 'user', v_source_id)
    RETURNING id INTO p_id;
  ELSIF p_action = 'archived' THEN
    UPDATE public.team_directives
      SET status = 'archived', archived_at = pg_catalog.now(), updated_at = pg_catalog.now()
      WHERE id = p_id AND user_id = v_user AND status = 'active';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN RAISE EXCEPTION 'directive not found'; END IF;
  ELSE
    UPDATE public.team_directives
      SET body = pg_catalog.btrim(p_body), updated_at = pg_catalog.now()
      WHERE id = p_id AND user_id = v_user AND status = 'active';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN RAISE EXCEPTION 'directive not found'; END IF;
  END IF;

  -- Negative legacy ids are the established cloud-chat timestamp encoding.
  -- The tenant advisory lock makes two same-millisecond events distinct while
  -- preserving that encoding and the JavaScript-safe epoch range.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text, 0)
  );
  SELECT LEAST(
    -pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint,
    COALESCE(pg_catalog.min(legacy_id) - 1,
      -pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint)
  ) INTO v_legacy_id
  FROM public.pending_user_messages
  WHERE user_id = v_user AND legacy_id < 0;

  INSERT INTO public.pending_user_messages(
    user_id, legacy_id, agent, body, kind, author, source_id, source_action,
    source_payload, source_directive_id, created_at
  ) VALUES (
    v_user, v_legacy_id, 'capitano',
    '[TEAM-DIRECTIVE] ' || p_action,
    'notification', 'user', v_source_id, p_action, p_body, p_id, pg_catalog.now()
  );

  INSERT INTO public.team_state(user_id, chat_requested_at)
    VALUES (v_user, pg_catalog.now())
    ON CONFLICT (user_id) DO UPDATE
      SET chat_requested_at = EXCLUDED.chat_requested_at;

  v_result := pg_catalog.jsonb_build_object(
    'id', p_id, 'status', 'queued', 'request_id', p_request_id, 'action', p_action
  );
  UPDATE public.team_directive_request_ledger
    SET result = v_result
    WHERE user_id = v_user AND request_id = p_request_id AND result IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN RAISE EXCEPTION 'request result not persisted'; END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
