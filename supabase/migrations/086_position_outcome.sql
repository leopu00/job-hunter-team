-- O-102 / #187 — l'esito di una candidatura inviata, scritto per intero.
--
-- `applications.response` esiste dal primo schema e non l'ha mai scritto
-- nessuno: 0 righe valorizzate su 428, contro 8 posizioni già in stato
-- `response`. Sapevamo otto volte CHE una risposta era arrivata e nessuna
-- volta COSA dicesse, perché le due metà del fatto — la colonna e lo stato —
-- le scriveva chi capitava, separatamente.
--
-- Queste funzioni sono le gemelle di `mark_position_applied` (migrazione 072)
-- e tengono posizione, candidatura e transizione nella stessa transazione.
-- SECURITY INVOKER come le altre: auth e RLS restano quelle della sessione.
--
-- Il vocabolario è quello del Mentor, unico dei cinque in circolazione che
-- avesse un lettore vero (`agents/_skills/mentor-patterns/SKILL.md`):
--   interview · rejected · ghosted
-- `ghosted` NON è scrivibile da qui, ed è voluto: il Mentor lo DERIVA
-- (nessuna risposta oltre i 30 giorni). Due definizioni della stessa cosa
-- divergono al primo ripensamento sulla soglia.

CREATE OR REPLACE FUNCTION public.mark_position_outcome(
    p_position_legacy_id INTEGER,
    p_outcome TEXT,
    p_response_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
    position_row public.positions%ROWTYPE;
    application_row public.applications%ROWTYPE;
    outcome TEXT := NULLIF(BTRIM(p_outcome), '');
    next_round INTEGER;
BEGIN
    IF actor IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;
    -- `ghosted` è assente di proposito: è derivato, non dichiarato.
    IF outcome IS NULL OR outcome NOT IN ('interview', 'rejected') THEN
        RAISE EXCEPTION 'invalid_outcome';
    END IF;
    IF p_response_at IS NULL THEN
        RAISE EXCEPTION 'response_at_required';
    END IF;

    SELECT * INTO position_row
      FROM public.positions
     WHERE user_id = actor AND legacy_id = p_position_legacy_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'position_not_found';
    END IF;

    SELECT * INTO application_row
      FROM public.applications
     WHERE user_id = actor AND position_id = position_row.id
     FOR UPDATE;
    -- Un esito su una candidatura mai inviata non è un dato, è un errore di
    -- battitura: `response` è la progressione POST-invio.
    IF NOT FOUND OR application_row.applied IS NOT TRUE THEN
        RAISE EXCEPTION 'not_applied';
    END IF;

    -- Il primo colloquio è il round 1; un round successivo lo scrive il team
    -- dalla CLI e da qui non si sovrascrive.
    IF outcome = 'interview' THEN
        next_round := COALESCE(application_row.interview_round, 1);
    ELSE
        next_round := application_row.interview_round;
    END IF;

    UPDATE public.applications
       SET status = 'response',
           response = outcome,
           response_at = p_response_at,
           interview_round = next_round
     WHERE id = application_row.id AND user_id = actor;

    UPDATE public.positions
       SET status = 'response', last_actor = 'user'
     WHERE id = position_row.id AND user_id = actor;

    IF position_row.status IS DISTINCT FROM 'response' THEN
        INSERT INTO public.position_transitions
            (user_id, position_legacy_id, from_state, to_state, ts, by_agent,
             notes)
        VALUES
            (actor, p_position_legacy_id, position_row.status, 'response',
             p_response_at, 'user', outcome)
        ON CONFLICT (user_id, position_legacy_id, ts, by_agent, to_state)
        DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'id', p_position_legacy_id::TEXT,
        'status', 'response',
        'response', outcome,
        'response_at', p_response_at,
        'interview_round', next_round
    );
END;
$$;

-- L'inverso, per la stessa ragione per cui esiste l'undo dell'invio (O-36):
-- un click per sbaglio che non si annulla è peggio del bottone che manca.
--
-- Si torna a `applied`, mai più indietro: la candidatura è stata mandata
-- davvero, e quel fatto non lo cancella un ripensamento sull'esito.
CREATE OR REPLACE FUNCTION public.undo_position_outcome(
    p_position_legacy_id INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor UUID := (SELECT auth.uid());
    position_row public.positions%ROWTYPE;
    application_row public.applications%ROWTYPE;
    kept_round INTEGER;
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

    SELECT * INTO application_row
      FROM public.applications
     WHERE user_id = actor AND position_id = position_row.id
     FOR UPDATE;
    IF NOT FOUND OR application_row.response IS NULL THEN
        RAISE EXCEPTION 'no_outcome';
    END IF;

    -- Un round oltre il primo l'ha scritto il team e non è roba di questo
    -- bottone: si azzera solo quello che il bottone stesso ha messo.
    kept_round := CASE
        WHEN application_row.interview_round = 1 THEN NULL
        ELSE application_row.interview_round
    END;

    UPDATE public.applications
       SET status = 'applied',
           response = NULL,
           response_at = NULL,
           interview_round = kept_round
     WHERE id = application_row.id AND user_id = actor;

    UPDATE public.positions
       SET status = 'applied', last_actor = 'user'
     WHERE id = position_row.id AND user_id = actor;

    IF position_row.status IS DISTINCT FROM 'applied' THEN
        INSERT INTO public.position_transitions
            (user_id, position_legacy_id, from_state, to_state, ts, by_agent,
             notes)
        VALUES
            (actor, p_position_legacy_id, position_row.status, 'applied',
             NOW(), 'user', 'outcome undone by the user')
        ON CONFLICT (user_id, position_legacy_id, ts, by_agent, to_state)
        DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'id', p_position_legacy_id::TEXT,
        'status', 'applied',
        'response', NULL,
        'response_at', NULL,
        'interview_round', kept_round
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_position_outcome(INTEGER, TEXT, TIMESTAMPTZ)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_position_outcome(INTEGER, TEXT, TIMESTAMPTZ)
    TO authenticated;

REVOKE ALL ON FUNCTION public.undo_position_outcome(INTEGER)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_position_outcome(INTEGER)
    TO authenticated;
