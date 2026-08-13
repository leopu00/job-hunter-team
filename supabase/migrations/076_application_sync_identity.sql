-- Child-row identity is independent from position identity.
--
-- SQLite has two integer keys on every application row:
--   applications.id          -> applications.legacy_id
--   applications.position_id -> positions.legacy_id
-- The previous push sent only the second one and therefore could not preserve
-- or acknowledge the application's own identity.  Keep the cloud UUID as the
-- primary key, and store the local application key as a tenant-scoped origin
-- key like the other synced entities.

-- Scores have the same two-key shape. Keep existing cloud-only scores NULL:
-- there is no safe source id to backfill. The first sync may claim a NULL row,
-- after which neither its source identity nor parent may change.
ALTER TABLE public.scores
  ADD COLUMN IF NOT EXISTS legacy_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS scores_user_legacy_uidx
  ON public.scores (user_id, legacy_id)
  WHERE legacy_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_score_sync_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.legacy_id IS NOT NULL AND NEW.legacy_id <= 0 THEN
        RAISE EXCEPTION 'invalid_score_identity';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.position_id IS DISTINCT FROM OLD.position_id
           OR (
               OLD.legacy_id IS NOT NULL
               AND NEW.legacy_id IS DISTINCT FROM OLD.legacy_id
           ) THEN
            RAISE EXCEPTION 'score_identity_mismatch';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scores_sync_identity_guard ON public.scores;
CREATE TRIGGER scores_sync_identity_guard
BEFORE INSERT OR UPDATE OF legacy_id, user_id, position_id
ON public.scores
FOR EACH ROW
EXECUTE FUNCTION public.guard_score_sync_identity();

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS legacy_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS applications_user_legacy_uidx
  ON public.applications (user_id, legacy_id)
  WHERE legacy_id IS NOT NULL;

-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE.
-- The JSON receipt is part of the durability contract: the route accepts a
-- batch only when every input identity comes back as persisted.
DROP FUNCTION IF EXISTS public.sync_upsert_applications(UUID, JSONB);

CREATE FUNCTION public.sync_upsert_applications(
    p_user_id UUID,
    p_applications JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    item JSONB;
    position_row public.positions%ROWTYPE;
    existing_application public.applications%ROWTYPE;
    conflicting_application public.applications%ROWTYPE;
    incoming_legacy_id INTEGER;
    incoming_position_legacy_id INTEGER;
    incoming_status TEXT;
    incoming_applied BOOLEAN;
    incoming_applied_at TIMESTAMPTZ;
    incoming_applied_via TEXT;
    incoming_receipt_id TEXT;
    persisted_id UUID;
    receipts JSONB := '[]'::JSONB;
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
        IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'application_object_required';
        END IF;
        BEGIN
            incoming_legacy_id := (item->>'legacy_id')::INTEGER;
            incoming_position_legacy_id :=
                (item->>'position_legacy_id')::INTEGER;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid_application_identity';
        END;
        IF incoming_legacy_id IS NULL OR incoming_legacy_id <= 0
           OR incoming_position_legacy_id IS NULL
           OR incoming_position_legacy_id <= 0 THEN
            RAISE EXCEPTION 'invalid_application_identity';
        END IF;
        incoming_receipt_id := item->>'_receipt_id';
        IF incoming_receipt_id IS NULL
           OR LENGTH(incoming_receipt_id) > 128
           OR incoming_receipt_id !~ '^[a-zA-Z0-9_:-]+$' THEN
            RAISE EXCEPTION 'invalid_application_receipt_id';
        END IF;

        -- Resolve the parent by both tenant and local position identity.  A
        -- legacy id belonging to another account is indistinguishable from a
        -- missing parent and cannot be used to name its UUID.
        SELECT * INTO position_row
          FROM public.positions
         WHERE user_id = p_user_id
           AND legacy_id = incoming_position_legacy_id
         FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'position_not_found';
        END IF;

        -- Lock both possible identity owners before deciding.  Existing rows
        -- created before migration have legacy_id NULL and are repaired by the
        -- position conflict.  Any non-NULL disagreement is an identity
        -- mismatch, never an instruction to move one application to another
        -- position.
        SELECT * INTO existing_application
          FROM public.applications
         WHERE user_id = p_user_id
           AND position_id = position_row.id
         FOR UPDATE;
        IF FOUND
           AND existing_application.legacy_id IS NOT NULL
           AND existing_application.legacy_id IS DISTINCT FROM incoming_legacy_id
        THEN
            RAISE EXCEPTION 'application_identity_mismatch';
        END IF;

        SELECT * INTO conflicting_application
          FROM public.applications
         WHERE user_id = p_user_id
           AND legacy_id = incoming_legacy_id
           AND position_id IS DISTINCT FROM position_row.id
         FOR UPDATE;
        IF FOUND THEN
            RAISE EXCEPTION 'application_identity_mismatch';
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

        BEGIN
        INSERT INTO public.applications (
            user_id, position_id, legacy_id,
            cv_path, cv_pdf_path, cl_path, cl_pdf_path,
            status, critic_score, critic_verdict, critic_notes, critic_round,
            written_at, applied_at, applied_via, response, response_at,
            written_by, reviewed_by, critic_reviewed_at, applied,
            cv_drive_id, cl_drive_id
        ) VALUES (
            p_user_id, position_row.id, incoming_legacy_id,
            item->>'cv_path', item->>'cv_pdf_path', item->>'cl_path',
            item->>'cl_pdf_path', incoming_status,
            (item->>'critic_score')::REAL, item->>'critic_verdict',
            item->>'critic_notes', (item->>'critic_round')::INTEGER,
            (item->>'written_at')::TIMESTAMPTZ, incoming_applied_at,
            incoming_applied_via, item->>'response',
            (item->>'response_at')::TIMESTAMPTZ, item->>'written_by',
            item->>'reviewed_by',
            (item->>'critic_reviewed_at')::TIMESTAMPTZ, incoming_applied,
            item->>'cv_drive_id', item->>'cl_drive_id'
        )
        ON CONFLICT (position_id) DO UPDATE SET
            legacy_id = EXCLUDED.legacy_id,
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
            cl_drive_id = EXCLUDED.cl_drive_id
        RETURNING applications.id INTO persisted_id;
        EXCEPTION WHEN unique_violation THEN
            -- Due transazioni possono vedere entrambe libero legacy_id e
            -- contendere poi l'indice. La seconda non espone il nome del
            -- constraint: è lo stesso mismatch già chiuso sopra.
            RAISE EXCEPTION 'application_identity_mismatch';
        END;

        IF persisted_id IS NULL THEN
            RAISE EXCEPTION 'application_not_persisted';
        END IF;
        -- L'inserimento nell'array avviene soltanto dopo RETURNING: ogni
        -- stringa è quindi una ricevuta di persistenza, non un echo d'input.
        receipts := receipts || jsonb_build_array(incoming_receipt_id);
    END LOOP;

    RETURN receipts;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_upsert_applications(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_upsert_applications(UUID, JSONB)
  TO service_role;
