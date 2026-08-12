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

-- Il push usa un'unica RPC per il batch applications. Tutti i percorsi che
-- cambiano il fatto "inviata" prendono prima il lock della position: così
-- l'ordine di commit, non una lettura stale nella route, decide il risultato.
-- Se la mark concorrente ha già vinto, un payload incompleto fallisce e il
-- client non può avanzare il cursore.
CREATE OR REPLACE FUNCTION public.sync_upsert_applications(
    p_user_id UUID,
    p_applications JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    item JSONB;
    position_row public.positions%ROWTYPE;
    incoming_status TEXT;
    incoming_applied BOOLEAN;
    incoming_applied_at TIMESTAMPTZ;
    incoming_applied_via TEXT;
    upserted INTEGER := 0;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id_required';
    END IF;
    IF p_applications IS NULL
       OR jsonb_typeof(p_applications) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'applications_array_required';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(p_applications)
    LOOP
        SELECT * INTO position_row
          FROM public.positions
         WHERE id = (item->>'position_id')::UUID
           AND user_id = p_user_id
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'position_not_found';
        END IF;

        incoming_status := item->>'status';
        incoming_applied := (item->>'applied')::BOOLEAN;
        incoming_applied_at := (item->>'applied_at')::TIMESTAMPTZ;
        incoming_applied_via := item->>'applied_via';
        IF position_row.status IN ('applied', 'response')
           AND (
               incoming_status IS NULL
               OR incoming_status NOT IN ('applied', 'response')
               OR incoming_applied IS NOT TRUE
               OR incoming_applied_at IS NULL
               OR NULLIF(BTRIM(incoming_applied_via), '') IS NULL
           ) THEN
            RAISE EXCEPTION 'stale_application_downgrade';
        END IF;

        INSERT INTO public.applications (
            user_id, position_id, cv_path, cv_pdf_path, cl_path, cl_pdf_path,
            status, critic_score, critic_verdict, critic_notes, critic_round,
            written_at, applied_at, applied_via, response, response_at,
            written_by, reviewed_by, critic_reviewed_at, applied,
            cv_drive_id, cl_drive_id
        ) VALUES (
            p_user_id, position_row.id, item->>'cv_path',
            item->>'cv_pdf_path', item->>'cl_path', item->>'cl_pdf_path',
            incoming_status, (item->>'critic_score')::REAL,
            item->>'critic_verdict', item->>'critic_notes',
            (item->>'critic_round')::INTEGER,
            (item->>'written_at')::TIMESTAMPTZ, incoming_applied_at,
            incoming_applied_via, item->>'response',
            (item->>'response_at')::TIMESTAMPTZ, item->>'written_by',
            item->>'reviewed_by',
            (item->>'critic_reviewed_at')::TIMESTAMPTZ, incoming_applied,
            item->>'cv_drive_id', item->>'cl_drive_id'
        )
        ON CONFLICT (position_id) DO UPDATE SET
            cv_path = EXCLUDED.cv_path,
            cv_pdf_path = EXCLUDED.cv_pdf_path,
            cl_path = EXCLUDED.cl_path,
            cl_pdf_path = EXCLUDED.cl_pdf_path,
            status = EXCLUDED.status,
            critic_score = EXCLUDED.critic_score,
            critic_verdict = EXCLUDED.critic_verdict,
            critic_notes = EXCLUDED.critic_notes,
            critic_round = CASE
                WHEN item ? 'critic_round' THEN EXCLUDED.critic_round
                ELSE applications.critic_round
            END,
            written_at = EXCLUDED.written_at,
            applied_at = EXCLUDED.applied_at,
            applied_via = EXCLUDED.applied_via,
            response = EXCLUDED.response,
            response_at = EXCLUDED.response_at,
            written_by = EXCLUDED.written_by,
            reviewed_by = EXCLUDED.reviewed_by,
            critic_reviewed_at = EXCLUDED.critic_reviewed_at,
            applied = EXCLUDED.applied,
            cv_drive_id = EXCLUDED.cv_drive_id,
            cl_drive_id = EXCLUDED.cl_drive_id;
        upserted := upserted + 1;
    END LOOP;

    RETURN upserted;
END;
$$;

-- Protegge anche l'ordine opposto: se la mark ha già committato prima
-- dell'upsert positions, un delta locale precedente non può riportare la
-- position a ready/scored mentre l'application conserva il fatto inviato.
-- `response` è l'unica progressione post-invio; l'undo prima azzera i campi
-- application e poi ripristina lo stato precedente nella stessa transazione.
CREATE OR REPLACE FUNCTION public.reject_stale_applied_position_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.status IN ('applied', 'response')
       AND (
           NEW.status IS NULL
           OR NEW.status NOT IN ('applied', 'response')
       )
       AND EXISTS (
           SELECT 1
             FROM public.applications AS application
            WHERE application.position_id = OLD.id
              AND application.user_id = OLD.user_id
              AND application.status IN ('applied', 'response')
              AND application.applied IS TRUE
              AND application.applied_at IS NOT NULL
              AND NULLIF(BTRIM(application.applied_via), '') IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'stale_position_downgrade';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS positions_reject_stale_applied_downgrade
    ON public.positions;
CREATE TRIGGER positions_reject_stale_applied_downgrade
BEFORE UPDATE OF status ON public.positions
FOR EACH ROW
EXECUTE FUNCTION public.reject_stale_applied_position_downgrade();

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

REVOKE ALL ON FUNCTION public.sync_upsert_applications(UUID, JSONB)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_upsert_applications(UUID, JSONB)
    TO service_role;
