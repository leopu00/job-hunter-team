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

BEGIN;

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

COMMIT;
