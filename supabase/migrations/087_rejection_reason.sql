-- O-105 — perché hanno detto di no: due colonne, non una.
--
-- `rejection_reason` è uno dei motivi predefiniti e SI CONTA (il Mentor ne
-- ricava i pattern); `rejection_note` è il testo libero dell'utente e SI
-- LEGGE. Fonderle in una colonna sola darebbe un campo che a volte contiene
-- una parola nota e a volte una frase, e nessun conteggio possibile.
--
-- ⚠️ NESSUN CHECK sul motivo, ed è deliberato — come già per `response`.
-- I quattro motivi di oggi (location · salary · experience · language) non
-- coprono il rifiuto più comune che esista, «hanno preso un altro»: quello
-- oggi finisce nel testo libero, e se fra un mese ricorre lo si promuove a
-- predefinito con un dato in mano. Un motivo nuovo deve costare una riga in
-- `web/lib/applications/outcome.ts`, non un'altra migrazione. Il prezzo è che
-- la lista la fa rispettare il codice: `rejectionDetailFor()` è il solo punto
-- in cui un valore sconosciuto viene rifiutato invece che salvato com'è.
--
-- Perché i nomi dicono «rejection» e non «response»: il motivo esiste solo per
-- il rifiuto. Su un colloquio non c'è un perché da chiedere, e su `ghosted`
-- non c'è nessuno a cui chiederlo — è derivato dal silenzio, non dichiarato.
-- Un nome legato a `response` inviterebbe ad allargarlo alla prima occasione;
-- se un giorno servirà una nota sul colloquio sarà un altro campo per un'altra
-- domanda.

ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS rejection_note TEXT;

COMMENT ON COLUMN public.applications.rejection_reason IS
    'O-105: motivo predefinito del rifiuto, contabile. Vocabolario in web/lib/applications/outcome.ts (nessun CHECK: un motivo nuovo non deve costare una migrazione).';
COMMENT ON COLUMN public.applications.rejection_note IS
    'O-105: testo libero dell''utente accanto al motivo, mai al posto suo.';

-- `mark_position_outcome` prende due parametri in più. Sono in coda e con
-- DEFAULT NULL, quindi la chiamata a tre argomenti nominati che fa il sito
-- oggi continua a funzionare durante il deploy — ma la versione a tre
-- argomenti va ELIMINATA, altrimenti Postgres si trova due candidate e
-- risponde `function is not unique` a ogni chiamata.
DROP FUNCTION IF EXISTS public.mark_position_outcome(INTEGER, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.mark_position_outcome(
    p_position_legacy_id INTEGER,
    p_outcome TEXT,
    p_response_at TIMESTAMPTZ,
    p_rejection_reason TEXT DEFAULT NULL,
    p_rejection_note TEXT DEFAULT NULL
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
    reason TEXT := NULLIF(BTRIM(p_rejection_reason), '');
    note TEXT := NULLIF(BTRIM(p_rejection_note), '');
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
    -- Il perché appartiene al rifiuto. Accettarlo su un colloquio
    -- produrrebbe righe in cui `rejection_reason` è valorizzato e `response`
    -- dice `interview`: nessun lettore saprebbe cosa farne, e il conteggio
    -- del Mentor conterebbe motivi di rifiuti che rifiuti non sono.
    IF outcome <> 'rejected' AND (reason IS NOT NULL OR note IS NOT NULL) THEN
        RAISE EXCEPTION 'reason_only_on_rejection';
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
           interview_round = next_round,
           -- Su `interview` si azzerano: è il caso di chi corregge un rifiuto
           -- in colloquio, e il motivo del rifiuto sbagliato non deve
           -- sopravvivere alla correzione.
           rejection_reason = CASE WHEN outcome = 'rejected' THEN reason END,
           rejection_note = CASE WHEN outcome = 'rejected' THEN note END
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
        'interview_round', next_round,
        'rejection_reason', CASE WHEN outcome = 'rejected' THEN reason END,
        'rejection_note', CASE WHEN outcome = 'rejected' THEN note END
    );
END;
$$;

-- L'annullamento cancella anche il perché: un rifiuto annullato che lasciasse
-- il suo motivo dietro darebbe al Mentor un motivo senza il rifiuto a cui
-- apparteneva.
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
           interview_round = kept_round,
           rejection_reason = NULL,
           rejection_note = NULL
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

-- I permessi vanno riscritti perché la funzione a tre argomenti è stata
-- eliminata e con lei i suoi ACL: quelli della firma nuova ripartono dai
-- default privileges di Supabase, che includono `anon` e `service_role`.
--
-- `FROM PUBLIC` da solo NON basta e non è un dettaglio di stile: `PUBLIC` è lo
-- pseudo-ruolo, e revocarlo non tocca i tre ruoli concreti. Scritta senza i
-- nomi, la revoca si legge come una restrizione e non restringe niente —
-- misurato sul vivo sulla 086, dove la scrittura corta aveva lasciato
-- `anon` e `service_role` con l'EXECUTE.
REVOKE ALL ON FUNCTION public.mark_position_outcome(INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_position_outcome(INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT)
    TO authenticated;

REVOKE ALL ON FUNCTION public.undo_position_outcome(INTEGER)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_position_outcome(INTEGER)
    TO authenticated;
