-- H-08 — forward-only reconciliation of the linked schema.
--
-- The linked ledger already records timestamped equivalents for most of
-- 014–068, while 070–075 are absent or only partially materialized. Replaying
-- the numeric history would run old DDL out of order and, in particular, would
-- replace the final 076/077 application RPCs with older 072 definitions.
-- This migration therefore carries only the allowlisted missing effects.
--
-- It is intentionally safe to apply after 078, 079 and 080. The 54 timestamped
-- aliases are comment-only anchors described by migration-anchors.v1.json.
-- No migration repair, remote write or historical replay happens here.

BEGIN;

-- Live-only DDL recorded by timestamped migrations and missing from the
-- numeric history. Keeping it here makes a repository-built schema complete.
-- Categoria semantica del ruolo, popolata dal team analyst (o pipeline LLM).
-- NULL = non ancora classificata. La dashboard la legge per il widget "Types"
-- senza alcuna regex hardcoded nel codice frontend.
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS role_family text;

CREATE INDEX IF NOT EXISTS idx_positions_role_family
  ON public.positions(role_family)
  WHERE role_family IS NOT NULL;

COMMENT ON COLUMN public.positions.role_family IS
  'Categoria semantica del ruolo (es. "Technical Writing", "CAD / CNC"). Popolata dal team analyst o da una pipeline LLM. Nullable: NULL = non ancora classificata.';
-- Colonne strutturate per location, popolate dall'analista (o pipeline LLM).
-- Vedi: docs/internal/2026-05-23-location-playbook.md
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS loc_city          text,
  ADD COLUMN IF NOT EXISTS loc_region        text,
  ADD COLUMN IF NOT EXISTS loc_country       text,
  ADD COLUMN IF NOT EXISTS loc_country_code  text,
  ADD COLUMN IF NOT EXISTS loc_continent     text,
  ADD COLUMN IF NOT EXISTS work_mode         text,
  ADD COLUMN IF NOT EXISTS work_country      text,
  ADD COLUMN IF NOT EXISTS work_country_code text,
  ADD COLUMN IF NOT EXISTS is_multi_location boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_notes    text;

COMMENT ON COLUMN public.positions.loc_city IS 'Città di ufficio. NULL se solo paese o solo continente (remote).';
COMMENT ON COLUMN public.positions.loc_country IS 'Paese di ufficio (Italy, Ireland). NULL se solo continente (Europe Remote).';
COMMENT ON COLUMN public.positions.loc_country_code IS 'ISO-3166 alpha-2 (IT, IE, HU).';
COMMENT ON COLUMN public.positions.loc_continent IS 'Europe|Asia|Americas|Africa|Oceania. Derivato da loc_country_code.';
COMMENT ON COLUMN public.positions.work_mode IS 'onsite|hybrid|remote. Rimpiazza is_remote + remote_type.';
COMMENT ON COLUMN public.positions.work_country IS 'Paese contrattuale (sede legale entity che assume). Determina stipendio/CCNL.';
COMMENT ON COLUMN public.positions.is_multi_location IS 'true se JD elenca più città/paesi. Pin singolo su centroide.';

-- Missing 070 state.
-- 070_user_settings.sql
--
-- [JHT-CLOUD-SYNC-THEME] Preferenza tema v1 sincronizzata fra browser.
-- Perimetro intenzionalmente stretto: nessun campo lingua, valuta, colonne o
-- JSON generico. Il browser usa direttamente la sessione utente e la RLS.

CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL
        CHECK (theme IN ('dark', 'light', 'system')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings"
    ON public.user_settings FOR ALL
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP TRIGGER IF EXISTS user_settings_updated_at ON public.user_settings;
CREATE TRIGGER user_settings_updated_at
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Missing 071 state.
-- O-70 — la rivalutazione usa position_tickets, non una coda parallela.
-- Una posizione può avere una sola richiesta rescore ancora open/assigned;
-- i ticket resolved restano nello storico e non impediscono di richiederne
-- una nuova in futuro. Specchio SQLite: shared/skills/_db.py.
--
-- `kind` era già testo libero prima di questa migrazione: eventuali rescore
-- legacy duplicati vanno sanati PRIMA dell'indice, altrimenti una sola coppia
-- blocca l'intera migrazione per tutti gli utenti. Non cancelliamo nulla:
-- resta attivo prima un ticket già assigned, poi il più antico (id spareggio);
-- gli altri passano a resolved conservando richiesta, risposta e assegnatario.

WITH ranked_active_rescores AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, position_legacy_id, kind
               ORDER BY CASE status WHEN 'assigned' THEN 0 ELSE 1 END,
                        created_at ASC,
                        id ASC
           ) AS active_rank
      FROM position_tickets
     WHERE kind = 'rescore'
       AND status IN ('open', 'assigned')
)
UPDATE position_tickets AS ticket
   SET status = 'resolved',
       resolved_at = COALESCE(ticket.resolved_at, now()),
       updated_at = now()
  FROM ranked_active_rescores AS ranked
 WHERE ticket.id = ranked.id
   AND ranked.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_tickets_active_rescore
    ON position_tickets(user_id, position_legacy_id, kind)
    WHERE kind = 'rescore' AND status IN ('open', 'assigned');

-- Missing subset of 072. Do not redefine mark_position_applied,
-- sync_upsert_applications or undo_manual_position_application: 076/077 own
-- their final definitions.
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

REVOKE ALL ON FUNCTION public.sync_confirm_positions_applied(UUID, INTEGER[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_confirm_positions_applied(UUID, INTEGER[])
    TO service_role;

-- Missing 073 state.
-- O-66: il browser deve distinguere un cloud realmente indietro da un
-- account semplicemente fermo (nessuna nuova posizione da inviare).
-- Il device pubblica solo esito + timestamp del controllo bounded; firma e
-- conteggi SQLite non lasciano il box.
ALTER TABLE team_state
  ADD COLUMN IF NOT EXISTS cloud_push_status text,
  ADD COLUMN IF NOT EXISTS cloud_push_checked_at timestamptz;

ALTER TABLE team_state
  DROP CONSTRAINT IF EXISTS team_state_cloud_push_status_valid;

ALTER TABLE team_state
  ADD CONSTRAINT team_state_cloud_push_status_valid CHECK (
    cloud_push_status IS NULL OR cloud_push_status IN (
      'current',
      'failed',
      'timeout',
      'partial',
      'auth_failed',
      'signature_unavailable'
    )
  );

-- Il browser e il box possono avere clock diversi. Come per gli altri
-- rendezvous, il timestamp autorevole nasce nel database.
CREATE OR REPLACE FUNCTION team_state_stamp_cloud_push_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cloud_push_status IS NOT NULL THEN
      NEW.cloud_push_checked_at := clock_timestamp();
    END IF;
  ELSIF NEW.cloud_push_status IS DISTINCT FROM OLD.cloud_push_status
        OR NEW.cloud_push_checked_at IS DISTINCT FROM OLD.cloud_push_checked_at THEN
      NEW.cloud_push_checked_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_state_stamp_cloud_push_check ON team_state;
CREATE TRIGGER trg_team_state_stamp_cloud_push_check
  BEFORE INSERT OR UPDATE ON team_state
  FOR EACH ROW
  EXECUTE FUNCTION team_state_stamp_cloud_push_check();

REVOKE ALL ON FUNCTION team_state_stamp_cloud_push_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION team_state_stamp_cloud_push_check() FROM anon, authenticated;

COMMENT ON COLUMN team_state.cloud_push_status IS
  'Esito minimale dell ultimo controllo automatico locale→cloud; nessun dato locale.';
COMMENT ON COLUMN team_state.cloud_push_checked_at IS
  'Timestamp del controllo automatico bounded pubblicato dal device attivo.';

-- Missing 074 state. The auth.users delete cascades through the later
-- team_directive_request_ledger, candidate_profile_sync_state and
-- user_settings foreign keys; the explicit order remains for non-cascading
-- account tables.
-- REL-0.3.8-TENANT-DELETE — tenant edges + atomic database deletion.
--
-- Every table below already carried a user_id and an RLS owner policy, but
-- its foreign key named only the UUID of the parent. A forged or historical
-- row could therefore say "owned by A" while pointing at a parent owned by B.
-- RLS would then protect the child as A's row while the relationship crossed
-- the tenant boundary.
--
-- The repair is deliberately in the same migration and under table locks as
-- the new constraints. Required inconsistent children have no safe owner, so
-- they are deleted. Optional links
-- (positions.company_id and pending_user_messages.related_position_id) are
-- detached instead, preserving the owning row.

LOCK TABLE
  public.companies,
  public.positions,
  public.scores,
  public.applications,
  public.position_highlights,
  public.position_views,
  public.position_user_notes,
  public.pending_user_messages
IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.positions AS position
   SET company_id = NULL
 WHERE position.company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.companies AS company
      WHERE company.id = position.company_id
        AND company.user_id = position.user_id
   );

DELETE FROM public.scores AS child
 USING public.positions AS parent
 WHERE child.position_id = parent.id
   AND child.user_id IS DISTINCT FROM parent.user_id;

DELETE FROM public.applications AS child
 USING public.positions AS parent
 WHERE child.position_id = parent.id
   AND child.user_id IS DISTINCT FROM parent.user_id;

DELETE FROM public.position_highlights AS child
 USING public.positions AS parent
 WHERE child.position_id = parent.id
   AND child.user_id IS DISTINCT FROM parent.user_id;

DELETE FROM public.position_views AS child
 USING public.positions AS parent
 WHERE child.position_id = parent.id
   AND child.user_id IS DISTINCT FROM parent.user_id;

DELETE FROM public.position_user_notes AS child
 USING public.positions AS parent
 WHERE child.position_id = parent.id
   AND child.user_id IS DISTINCT FROM parent.user_id;

-- The relation is optional: preserve the message, but detach an unsafe
-- historical link exactly as positions.company_id is detached above.
UPDATE public.pending_user_messages AS child
   SET related_position_id = NULL
 WHERE child.related_position_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.positions AS parent
      WHERE parent.id = child.related_position_id
        AND parent.user_id = child.user_id
   );

-- PostgreSQL requires a unique key whose columns exactly match the composite
-- FK target. id remains the primary identity; these indexes certify its owner.
CREATE UNIQUE INDEX IF NOT EXISTS companies_user_id_id_uidx
  ON public.companies (user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS positions_user_id_id_uidx
  ON public.positions (user_id, id);

ALTER TABLE public.positions
  DROP CONSTRAINT IF EXISTS positions_company_id_fkey,
  DROP CONSTRAINT IF EXISTS positions_company_tenant_fkey,
  ADD CONSTRAINT positions_company_tenant_fkey
    FOREIGN KEY (user_id, company_id)
    REFERENCES public.companies (user_id, id);

ALTER TABLE public.scores
  DROP CONSTRAINT IF EXISTS scores_position_id_fkey,
  DROP CONSTRAINT IF EXISTS scores_position_tenant_fkey,
  ADD CONSTRAINT scores_position_tenant_fkey
    FOREIGN KEY (user_id, position_id)
    REFERENCES public.positions (user_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_position_id_fkey,
  DROP CONSTRAINT IF EXISTS applications_position_tenant_fkey,
  ADD CONSTRAINT applications_position_tenant_fkey
    FOREIGN KEY (user_id, position_id)
    REFERENCES public.positions (user_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.position_highlights
  DROP CONSTRAINT IF EXISTS position_highlights_position_id_fkey,
  DROP CONSTRAINT IF EXISTS position_highlights_position_tenant_fkey,
  ADD CONSTRAINT position_highlights_position_tenant_fkey
    FOREIGN KEY (user_id, position_id)
    REFERENCES public.positions (user_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.position_views
  DROP CONSTRAINT IF EXISTS position_views_position_id_fkey,
  DROP CONSTRAINT IF EXISTS position_views_position_tenant_fkey,
  ADD CONSTRAINT position_views_position_tenant_fkey
    FOREIGN KEY (user_id, position_id)
    REFERENCES public.positions (user_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.position_user_notes
  DROP CONSTRAINT IF EXISTS position_user_notes_position_id_fkey,
  DROP CONSTRAINT IF EXISTS position_user_notes_position_tenant_fkey,
  ADD CONSTRAINT position_user_notes_position_tenant_fkey
    FOREIGN KEY (user_id, position_id)
    REFERENCES public.positions (user_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.pending_user_messages
  DROP CONSTRAINT IF EXISTS pending_user_messages_related_position_id_fkey,
  DROP CONSTRAINT IF EXISTS pending_user_messages_position_tenant_fkey,
  ADD CONSTRAINT pending_user_messages_position_tenant_fkey
    FOREIGN KEY (user_id, related_position_id)
    REFERENCES public.positions (user_id, id)
    ON DELETE SET NULL (related_position_id);

-- One privileged call owns every database mutation. Any FK, trigger or other
-- unexpected failure aborts the PostgreSQL statement and rolls all preceding
-- deletes back. The auth row is locked first, which serializes two concurrent
-- deletion attempts and also makes inserts racing through auth.users' FKs wait
-- for the final outcome.
CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed JSONB := '{}'::JSONB;
  affected INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_user_id';
  END IF;

  PERFORM 1
    FROM auth.users
   WHERE id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;

  DELETE FROM public.applications WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  removed := removed || jsonb_build_object('applications', affected);

  DELETE FROM public.position_highlights WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  removed := removed || jsonb_build_object('position_highlights', affected);

  DELETE FROM public.scores WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  removed := removed || jsonb_build_object('scores', affected);

  DELETE FROM public.positions WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  removed := removed || jsonb_build_object('positions', affected);

  DELETE FROM public.companies WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  removed := removed || jsonb_build_object('companies', affected);

  DELETE FROM public.candidate_profiles WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  removed := removed || jsonb_build_object('candidate_profiles', affected);

  DELETE FROM auth.users WHERE id = p_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'auth_user_not_deleted';
  END IF;

  RETURN jsonb_build_object('removed', removed);
END;
$$;

-- The browser session must never be able to invoke a privileged deletion or
-- choose a victim. Only the server-side service-role client calls this RPC,
-- with the user id read from the already verified session.
REVOKE ALL ON FUNCTION public.delete_account_data(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_data(UUID) TO service_role;

-- Missing 075 redemption and its one-shot/expiry sanitation. The linked
-- cleanup_pairing_sessions body predates 075: replace it with the final body
-- that locks session before token, revokes the bearer and wipes plaintext.
-- Sessioni già approvate: fino al riscatto il bearer non può vivere più
-- della sessione. È una sanatoria conservativa, non estende mai una scadenza.
UPDATE public.cloud_sync_tokens AS token
SET expires_at = pairing.expires_at
FROM public.cloud_sync_pairing_sessions AS pairing
WHERE pairing.approved_token_id = token.id
  AND pairing.status = 'approved'
  AND pairing.expires_at > now()
  AND token.revoked_at IS NULL
  AND (token.expires_at IS NULL OR token.expires_at > pairing.expires_at);

-- Le approvazioni già scadute diventano inutilizzabili immediatamente.
UPDATE public.cloud_sync_tokens AS token
SET revoked_at = COALESCE(token.revoked_at, now())
FROM public.cloud_sync_pairing_sessions AS pairing
WHERE pairing.approved_token_id = token.id
  AND pairing.status IN ('pending', 'approved', 'expired')
  AND pairing.expires_at <= now();

UPDATE public.cloud_sync_pairing_sessions
SET status = 'expired',
    approved_token = NULL
WHERE status IN ('pending', 'approved', 'expired')
  AND expires_at <= now()
  AND (status <> 'expired' OR approved_token IS NOT NULL);

CREATE OR REPLACE FUNCTION public.redeem_cloud_sync_pairing(p_device_code text)
RETURNS TABLE(
  status text,
  approved_token text,
  user_id uuid,
  approved_token_id uuid,
  token_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pairing public.cloud_sync_pairing_sessions%ROWTYPE;
  token_value text;
  token_label text;
  changed integer;
BEGIN
  -- Il lock dura fino al commit della RPC. Il secondo poll osserva quindi lo
  -- stato consumed/expired, mai il plaintext letto dal primo.
  SELECT * INTO pairing
  FROM public.cloud_sync_pairing_sessions
  WHERE device_code = p_device_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid,
      NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF pairing.expires_at <= now()
      AND pairing.status IN ('pending', 'approved', 'expired') THEN
    IF pairing.approved_token_id IS NOT NULL THEN
      UPDATE public.cloud_sync_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = pairing.approved_token_id;
    END IF;
    UPDATE public.cloud_sync_pairing_sessions
    SET status = 'expired', approved_token = NULL
    WHERE device_code = pairing.device_code;
    RETURN QUERY SELECT 'expired'::text, NULL::text, pairing.user_id,
      pairing.approved_token_id, NULL::text;
    RETURN;
  END IF;

  IF pairing.status = 'approved' THEN
    IF pairing.approved_token IS NULL
        OR pairing.approved_token_id IS NULL
        OR pairing.user_id IS NULL THEN
      IF pairing.approved_token_id IS NOT NULL THEN
        UPDATE public.cloud_sync_tokens
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = pairing.approved_token_id;
      END IF;
      UPDATE public.cloud_sync_pairing_sessions
      SET status = 'expired', approved_token = NULL
      WHERE device_code = pairing.device_code;
      RETURN QUERY SELECT 'invalid'::text, NULL::text, pairing.user_id,
        pairing.approved_token_id, NULL::text;
      RETURN;
    END IF;

    -- Il bearer diventa headless/no-expiry solo per il vincitore. Se il token
    -- è stato revocato o è già scaduto non viene consegnato.
    UPDATE public.cloud_sync_tokens
    SET expires_at = NULL
    WHERE id = pairing.approved_token_id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING name INTO token_label;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
      -- Anche un token già scaduto viene revocato esplicitamente: l'expiry
      -- nega già l'uso, la revoca rende durevole e osservabile la chiusura.
      UPDATE public.cloud_sync_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = pairing.approved_token_id;
      UPDATE public.cloud_sync_pairing_sessions
      SET status = 'expired', approved_token = NULL
      WHERE device_code = pairing.device_code;
      RETURN QUERY SELECT 'expired'::text, NULL::text, pairing.user_id,
        pairing.approved_token_id, NULL::text;
      RETURN;
    END IF;

    token_value := pairing.approved_token;
    UPDATE public.cloud_sync_pairing_sessions AS session
    SET status = 'consumed',
        approved_token = NULL,
        consumed_at = now()
    WHERE session.device_code = pairing.device_code
      AND session.status = 'approved';
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
      RAISE EXCEPTION 'pairing redemption changed % rows', changed;
    END IF;

    RETURN QUERY SELECT 'approved'::text, token_value, pairing.user_id,
      pairing.approved_token_id, token_label;
    RETURN;
  END IF;

  RETURN QUERY SELECT pairing.status, NULL::text, pairing.user_id,
    pairing.approved_token_id, NULL::text;
END;
$$;

-- Cleanup amministrativo: stessa revoca/wipe della corsia lazy. Il FOR UPDATE
-- usa lo stesso ordine di lock della redemption (sessione, poi token).
CREATE OR REPLACE FUNCTION public.cleanup_pairing_sessions()
RETURNS TABLE(expired_count int, deleted_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pairing record;
  expired integer := 0;
  deleted integer := 0;
BEGIN
  FOR pairing IN
    SELECT device_code, approved_token_id
    FROM public.cloud_sync_pairing_sessions
    WHERE status IN ('pending', 'approved', 'expired')
      AND expires_at <= now()
      AND (status <> 'expired' OR approved_token IS NOT NULL)
    FOR UPDATE
  LOOP
    IF pairing.approved_token_id IS NOT NULL THEN
      UPDATE public.cloud_sync_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = pairing.approved_token_id;
    END IF;
    UPDATE public.cloud_sync_pairing_sessions
    SET status = 'expired', approved_token = NULL
    WHERE device_code = pairing.device_code;
    expired := expired + 1;
  END LOOP;

  DELETE FROM public.cloud_sync_pairing_sessions
  WHERE (status = 'consumed' AND consumed_at < now() - interval '1 hour')
     OR (status = 'expired' AND expires_at < now() - interval '1 day');
  GET DIAGNOSTICS deleted = ROW_COUNT;

  RETURN QUERY SELECT expired, deleted;
END;
$$;

-- Le route server usano service_role. Nessun browser/utente può chiamare
-- direttamente funzioni SECURITY DEFINER che leggono plaintext o revocano.
REVOKE EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_pairing_sessions() TO service_role;

-- La 018 dinamica non è re-runnable sul catalogo live. Correggiamo solo
-- le tre policy create successivamente dalla 054, con initplan auth.uid().
DROP POLICY IF EXISTS "users insert own team directives"
  ON public.team_directives;
CREATE POLICY "users insert own team directives"
  ON public.team_directives FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "users select own team directives"
  ON public.team_directives;
CREATE POLICY "users select own team directives"
  ON public.team_directives FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "users update own team directives"
  ON public.team_directives;
CREATE POLICY "users update own team directives"
  ON public.team_directives FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

COMMIT;
