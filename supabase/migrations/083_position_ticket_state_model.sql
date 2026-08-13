-- O-89 — one state model across DB/API/UI.
--
-- A ticket is an indicator attached to a position, never a replacement for
-- the position pipeline state.  The legacy integer remains for SQLite sync,
-- while the UUID composite FK makes the cloud relation tenant-safe.

ALTER TABLE public.position_tickets
  ADD COLUMN IF NOT EXISTS position_id UUID;

UPDATE public.position_tickets AS ticket
   SET position_id = position.id
  FROM public.positions AS position
 WHERE ticket.position_id IS NULL
   AND position.user_id = ticket.user_id
   AND position.legacy_id = ticket.position_legacy_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.position_tickets WHERE position_id IS NULL) THEN
    RAISE EXCEPTION 'position_ticket_without_tenant_parent';
  END IF;
END;
$$;

ALTER TABLE public.position_tickets
  ALTER COLUMN position_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS position_tickets_position_tenant_fkey;

-- The legacy id is part of the relationship, not parallel metadata that can
-- drift. PostgreSQL therefore certifies all three identity columns together.
CREATE UNIQUE INDEX IF NOT EXISTS positions_user_id_id_legacy_id_uidx
  ON public.positions (user_id, id, legacy_id);

ALTER TABLE public.position_tickets
  ADD CONSTRAINT position_tickets_position_tenant_fkey
    FOREIGN KEY (user_id, position_id, position_legacy_id)
    REFERENCES public.positions (user_id, id, legacy_id)
    ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_position_tickets_user_position
  ON public.position_tickets (user_id, position_id);

CREATE OR REPLACE FUNCTION public.create_position_ticket(
  p_position_legacy_id INTEGER,
  p_request_text TEXT,
  p_kind TEXT DEFAULT 'custom'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  parent public.positions%ROWTYPE;
  ticket public.position_tickets%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_position_legacy_id IS NULL OR p_position_legacy_id <= 0 THEN
    RAISE EXCEPTION 'invalid_position';
  END IF;
  IF NULLIF(BTRIM(p_request_text), '') IS NULL OR LENGTH(BTRIM(p_request_text)) > 2000 THEN
    RAISE EXCEPTION 'invalid_request_text';
  END IF;
  IF p_kind NOT IN ('custom', 'rescore') THEN RAISE EXCEPTION 'invalid_kind'; END IF;

  SELECT * INTO parent
    FROM public.positions
   WHERE user_id = actor AND legacy_id = p_position_legacy_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'position_not_found'; END IF;

  IF p_kind = 'rescore' THEN
    SELECT * INTO ticket
      FROM public.position_tickets
     WHERE user_id = actor
       AND position_id = parent.id
       AND kind = 'rescore'
       AND status IN ('open', 'assigned')
     ORDER BY created_at, id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', ticket.id::TEXT, 'status', ticket.status,
        'position_status', parent.status, 'deduplicated', TRUE
      );
    END IF;
  END IF;

  INSERT INTO public.position_tickets
    (user_id, position_id, position_legacy_id, request_text, kind, status)
  VALUES
    (actor, parent.id, parent.legacy_id, BTRIM(p_request_text), p_kind, 'open')
  RETURNING * INTO ticket;

  RETURN jsonb_build_object(
    'id', ticket.id::TEXT, 'status', ticket.status,
    'position_status', parent.status, 'deduplicated', FALSE
  );
EXCEPTION WHEN unique_violation THEN
  IF p_kind <> 'rescore' THEN RAISE; END IF;
  SELECT * INTO ticket
    FROM public.position_tickets
   WHERE user_id = actor
     AND position_id = parent.id
     AND kind = 'rescore'
     AND status IN ('open', 'assigned')
   ORDER BY created_at, id
   LIMIT 1;
  IF NOT FOUND THEN RAISE; END IF;
  RETURN jsonb_build_object(
    'id', ticket.id::TEXT, 'status', ticket.status,
    'position_status', parent.status, 'deduplicated', TRUE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_create_position_ticket(
  p_user_id UUID,
  p_position_legacy_id INTEGER,
  p_request_text TEXT,
  p_kind TEXT DEFAULT 'custom',
  p_status TEXT DEFAULT 'open',
  p_assigned_agent TEXT DEFAULT NULL,
  p_response_text TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NULL,
  p_assigned_at TIMESTAMPTZ DEFAULT NULL,
  p_resolved_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent public.positions%ROWTYPE;
  ticket public.position_tickets%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_user'; END IF;
  IF p_position_legacy_id IS NULL OR p_position_legacy_id <= 0 THEN
    RAISE EXCEPTION 'invalid_position';
  END IF;
  IF NULLIF(BTRIM(p_request_text), '') IS NULL OR LENGTH(BTRIM(p_request_text)) > 2000 THEN
    RAISE EXCEPTION 'invalid_request_text';
  END IF;
  IF p_kind NOT IN ('custom', 'rescore') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF p_status NOT IN ('open', 'assigned', 'resolved') THEN RAISE EXCEPTION 'invalid_status'; END IF;

  SELECT * INTO parent
    FROM public.positions
   WHERE user_id = p_user_id AND legacy_id = p_position_legacy_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'position_not_found'; END IF;

  IF p_kind = 'rescore' AND p_status IN ('open', 'assigned') THEN
    SELECT * INTO ticket
      FROM public.position_tickets
     WHERE user_id = p_user_id
       AND position_id = parent.id
       AND kind = 'rescore'
       AND status IN ('open', 'assigned')
     ORDER BY created_at, id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id', ticket.id, 'deduplicated', TRUE);
    END IF;
  END IF;

  INSERT INTO public.position_tickets
    (user_id, position_id, position_legacy_id, request_text, kind, status,
     assigned_agent, response_text, created_at, assigned_at, resolved_at)
  VALUES
    (p_user_id, parent.id, parent.legacy_id, BTRIM(p_request_text), p_kind,
     p_status, p_assigned_agent, p_response_text, COALESCE(p_created_at, now()),
     p_assigned_at, p_resolved_at)
  RETURNING * INTO ticket;
  RETURN jsonb_build_object('id', ticket.id, 'deduplicated', FALSE);
EXCEPTION WHEN unique_violation THEN
  IF p_kind <> 'rescore' OR p_status NOT IN ('open', 'assigned') THEN RAISE; END IF;
  SELECT * INTO ticket
    FROM public.position_tickets
   WHERE user_id = p_user_id
     AND position_id = parent.id
     AND kind = 'rescore'
     AND status IN ('open', 'assigned')
   ORDER BY created_at, id
   LIMIT 1;
  IF NOT FOUND THEN RAISE; END IF;
  RETURN jsonb_build_object('id', ticket.id, 'deduplicated', TRUE);
END;
$$;

REVOKE INSERT ON public.position_tickets FROM anon, authenticated, service_role;
REVOKE UPDATE ON public.position_tickets FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_position_ticket(INTEGER, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_position_ticket(INTEGER, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.sync_create_position_ticket(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_create_position_ticket(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
