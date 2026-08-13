-- O-80 hotfix: production 0.3.8 may be missing the two RPCs called by the
-- "Mi sono candidato" POST/DELETE routes.  This migration is intentionally
-- narrow: it installs only those two tenant-bound, locking, atomic functions.
-- It must not re-run or alter sync_upsert_applications from migration 072.

CREATE OR REPLACE FUNCTION public.mark_position_applied(
    p_position_legacy_id INTEGER,
    p_applied_at TIMESTAMPTZ,
    p_applied_via TEXT,
    p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
    position_row public.positions%ROWTYPE;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    IF p_applied_at IS NULL THEN RAISE EXCEPTION 'applied_at_required'; END IF;
    IF NULLIF(BTRIM(p_applied_via), '') IS NULL THEN RAISE EXCEPTION 'applied_via_required'; END IF;

    SELECT * INTO position_row FROM public.positions
     WHERE user_id = actor AND legacy_id = p_position_legacy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'position_not_found'; END IF;

    INSERT INTO public.applications
        (user_id, position_id, status, applied, applied_at, applied_via, critic_notes)
    VALUES (actor, position_row.id, 'applied', TRUE, p_applied_at, BTRIM(p_applied_via), p_note)
    ON CONFLICT (position_id) DO UPDATE SET
        status = 'applied', applied = TRUE, applied_at = EXCLUDED.applied_at,
        applied_via = EXCLUDED.applied_via;

    UPDATE public.positions SET status = 'applied', last_actor = 'user'
     WHERE id = position_row.id AND user_id = actor;

    IF position_row.status IS DISTINCT FROM 'applied' THEN
        INSERT INTO public.position_transitions
            (user_id, position_legacy_id, from_state, to_state, ts, by_agent, notes)
        VALUES (actor, p_position_legacy_id, position_row.status, 'applied',
                p_applied_at, 'user', p_note)
        ON CONFLICT (user_id, position_legacy_id, ts, by_agent, to_state) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('id', p_position_legacy_id::TEXT, 'status', 'applied',
        'applied_at', p_applied_at, 'applied_via', BTRIM(p_applied_via));
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_manual_position_application(
    p_position_legacy_id INTEGER,
    p_restored_status TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
    position_row public.positions%ROWTYPE;
    application_row public.applications%ROWTYPE;
    previous_state TEXT;
    restored_state TEXT;
BEGIN
    IF actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT * INTO position_row FROM public.positions
     WHERE user_id = actor AND legacy_id = p_position_legacy_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'position_not_found'; END IF;
    IF position_row.status IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'not_applied'; END IF;

    SELECT * INTO application_row FROM public.applications
     WHERE user_id = actor AND position_id = position_row.id FOR UPDATE;
    IF FOUND AND application_row.applied_via IS NOT NULL
       AND application_row.applied_via <> 'user_manual' THEN
        RAISE EXCEPTION 'applied_by_team';
    END IF;

    SELECT transition.from_state INTO previous_state FROM public.position_transitions transition
     WHERE transition.user_id = actor AND transition.position_legacy_id = p_position_legacy_id
       AND transition.to_state = 'applied' AND transition.by_agent = 'user'
     ORDER BY transition.ts DESC, transition.id DESC LIMIT 1;
    IF p_restored_status IS NOT NULL THEN
        IF p_restored_status = 'applied' OR p_restored_status NOT IN
           ('new','checked','excluded','scored','writing','review','ready','response') THEN
            RAISE EXCEPTION 'invalid_restored_status';
        END IF;
        restored_state := p_restored_status;
    ELSIF previous_state IS NOT NULL THEN restored_state := previous_state;
    ELSIF application_row.cv_path IS NOT NULL OR application_row.cv_pdf_path IS NOT NULL THEN restored_state := 'ready';
    ELSIF EXISTS (SELECT 1 FROM public.scores WHERE user_id = actor AND position_id = position_row.id) THEN restored_state := 'scored';
    ELSE restored_state := 'new'; END IF;

    UPDATE public.applications SET applied = FALSE, applied_at = NULL, applied_via = NULL,
        status = CASE WHEN status = 'applied' THEN 'draft' ELSE status END
     WHERE user_id = actor AND position_id = position_row.id;
    UPDATE public.positions SET status = restored_state, last_actor = 'user'
     WHERE id = position_row.id AND user_id = actor;
    INSERT INTO public.position_transitions
        (user_id, position_legacy_id, from_state, to_state, ts, by_agent, notes)
    VALUES (actor, p_position_legacy_id, 'applied', restored_state, clock_timestamp(),
            'user', 'annullata dall''utente');
    RETURN jsonb_build_object('id', p_position_legacy_id::TEXT, 'status', restored_state,
        'applied_at', NULL, 'applied_via', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_position_applied(INTEGER, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_position_applied(INTEGER, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.undo_manual_position_application(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_manual_position_application(INTEGER, TEXT) TO authenticated;
