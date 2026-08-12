-- O-73 — positions.status='applied' e applications sono un solo fatto.
--
-- Il percorso web cloud aggiornava soltanto `positions`: la lista, che legge
-- correttamente `applications.applied_at`, mostrava quindi una candidatura
-- senza data. Le funzioni tengono posizione, candidatura e transizione nella
-- stessa transazione Postgres. SECURITY INVOKER è intenzionale: auth e RLS
-- restano quelle della sessione, senza introdurre privilegi laterali.

CREATE OR REPLACE FUNCTION public.mark_position_applied(
    p_position_legacy_id INTEGER,
    p_applied_at TIMESTAMPTZ,
    p_applied_via TEXT,
    p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
    position_row public.positions%ROWTYPE;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;
    IF p_applied_at IS NULL THEN
        RAISE EXCEPTION 'applied_at_required';
    END IF;
    IF NULLIF(BTRIM(p_applied_via), '') IS NULL THEN
        RAISE EXCEPTION 'applied_via_required';
    END IF;

    SELECT * INTO position_row
      FROM public.positions
     WHERE user_id = actor AND legacy_id = p_position_legacy_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'position_not_found';
    END IF;

    INSERT INTO public.applications
        (user_id, position_id, status, applied, applied_at, applied_via,
         critic_notes)
    VALUES
        (actor, position_row.id, 'applied', TRUE, p_applied_at,
         BTRIM(p_applied_via), p_note)
    ON CONFLICT (position_id) DO UPDATE SET
        status = 'applied',
        applied = TRUE,
        applied_at = EXCLUDED.applied_at,
        applied_via = EXCLUDED.applied_via;

    UPDATE public.positions
       SET status = 'applied', last_actor = 'user'
     WHERE id = position_row.id AND user_id = actor;

    IF position_row.status IS DISTINCT FROM 'applied' THEN
        INSERT INTO public.position_transitions
            (user_id, position_legacy_id, from_state, to_state, ts, by_agent,
             notes)
        VALUES
            (actor, p_position_legacy_id, position_row.status, 'applied',
             p_applied_at, 'user', p_note)
        ON CONFLICT (user_id, position_legacy_id, ts, by_agent, to_state)
        DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'id', p_position_legacy_id::TEXT,
        'status', 'applied',
        'applied_at', p_applied_at,
        'applied_via', BTRIM(p_applied_via)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_manual_position_application(
    p_position_legacy_id INTEGER,
    p_restored_status TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
    position_row public.positions%ROWTYPE;
    application_row public.applications%ROWTYPE;
    previous_state TEXT;
    restored_state TEXT;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    SELECT * INTO position_row
      FROM public.positions
     WHERE user_id = actor AND legacy_id = p_position_legacy_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'position_not_found';
    END IF;
    IF position_row.status IS DISTINCT FROM 'applied' THEN
        RAISE EXCEPTION 'not_applied';
    END IF;

    SELECT * INTO application_row
      FROM public.applications
     WHERE user_id = actor AND position_id = position_row.id
     FOR UPDATE;
    IF FOUND
       AND application_row.applied_via IS NOT NULL
       AND application_row.applied_via <> 'user_manual' THEN
        RAISE EXCEPTION 'applied_by_team';
    END IF;

    SELECT transition.from_state INTO previous_state
      FROM public.position_transitions AS transition
     WHERE transition.user_id = actor
       AND transition.position_legacy_id = p_position_legacy_id
       AND transition.to_state = 'applied'
       AND transition.by_agent = 'user'
     ORDER BY transition.ts DESC, transition.id DESC
     LIMIT 1;

    IF p_restored_status IS NOT NULL THEN
        IF p_restored_status = 'applied' OR p_restored_status NOT IN (
            'new', 'checked', 'excluded', 'scored', 'writing', 'review',
            'ready', 'response'
        ) THEN
            RAISE EXCEPTION 'invalid_restored_status';
        END IF;
        restored_state := p_restored_status;
    ELSIF previous_state IS NOT NULL THEN
        restored_state := previous_state;
    ELSIF application_row.cv_path IS NOT NULL
       OR application_row.cv_pdf_path IS NOT NULL THEN
        restored_state := 'ready';
    ELSIF EXISTS (
        SELECT 1 FROM public.scores
         WHERE user_id = actor AND position_id = position_row.id
    ) THEN
        restored_state := 'scored';
    ELSE
        restored_state := 'new';
    END IF;

    UPDATE public.applications
       SET applied = FALSE,
           applied_at = NULL,
           applied_via = NULL,
           status = CASE WHEN status = 'applied' THEN 'draft' ELSE status END
     WHERE user_id = actor AND position_id = position_row.id;

    UPDATE public.positions
       SET status = restored_state, last_actor = 'user'
     WHERE id = position_row.id AND user_id = actor;

    INSERT INTO public.position_transitions
        (user_id, position_legacy_id, from_state, to_state, ts, by_agent, notes)
    VALUES
        (actor, p_position_legacy_id, 'applied', restored_state,
         clock_timestamp(), 'user', 'annullata dall''utente');

    RETURN jsonb_build_object(
        'id', p_position_legacy_id::TEXT,
        'status', restored_state,
        'applied_at', NULL,
        'applied_via', NULL
    );
END;
$$;

-- Il push container usa il client service_role, quindi auth.uid() non è
-- disponibile. La funzione resta SECURITY INVOKER ed è eseguibile soltanto
-- da service_role: prima verifica che ogni application sia già completa,
-- poi pubblica status='applied'. In questo modo il solo passo che rende la
-- posizione visibile nel filtro "Candidature" non può precedere la sua data.
CREATE OR REPLACE FUNCTION public.sync_confirm_positions_applied(
    p_user_id UUID,
    p_position_legacy_ids INTEGER[]
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    requested_id INTEGER;
    position_row public.positions%ROWTYPE;
    application_row public.applications%ROWTYPE;
    confirmed INTEGER := 0;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id_required';
    END IF;

    FOREACH requested_id IN ARRAY COALESCE(p_position_legacy_ids, ARRAY[]::INTEGER[])
    LOOP
        SELECT * INTO position_row
          FROM public.positions
         WHERE user_id = p_user_id AND legacy_id = requested_id
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'position_not_found';
        END IF;

        SELECT * INTO application_row
          FROM public.applications
         WHERE user_id = p_user_id AND position_id = position_row.id
         FOR UPDATE;
        IF NOT FOUND
           OR application_row.status IS DISTINCT FROM 'applied'
           OR application_row.applied IS NOT TRUE
           OR application_row.applied_at IS NULL
           OR NULLIF(BTRIM(application_row.applied_via), '') IS NULL THEN
            RAISE EXCEPTION 'incomplete_application';
        END IF;

        UPDATE public.positions
           SET status = 'applied'
         WHERE id = position_row.id AND user_id = p_user_id;
        confirmed := confirmed + 1;
    END LOOP;

    RETURN confirmed;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_position_applied(INTEGER, TIMESTAMPTZ, TEXT, TEXT)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_position_applied(INTEGER, TIMESTAMPTZ, TEXT, TEXT)
    TO authenticated;

REVOKE ALL ON FUNCTION public.undo_manual_position_application(INTEGER, TEXT)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_manual_position_application(INTEGER, TEXT)
    TO authenticated;

REVOKE ALL ON FUNCTION public.sync_confirm_positions_applied(UUID, INTEGER[])
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_confirm_positions_applied(UUID, INTEGER[])
    TO service_role;
