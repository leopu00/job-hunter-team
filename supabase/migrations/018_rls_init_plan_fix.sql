-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 018 — RLS init plan fix (auth.uid() per-row → cached subquery) ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Address P0 from docs/internal/cloud-sync-architecture.md:                ║
-- ║                                                                          ║
-- ║   Supabase advisor `auth_rls_initplan` flags 24 policy che chiamano      ║
-- ║   auth.uid() PER OGNI ROW invece di valutarla UNA VOLTA per query.       ║
-- ║   Sintassi corretta: (SELECT auth.uid()).                                ║
-- ║                                                                          ║
-- ║   Su tabelle grandi + sotto carico questo amplifica O(N) → quasi        ║
-- ║   certamente uno dei moltiplicatori del 504-storm RobertHalf            ║
-- ║   2026-05-19 (il middleware Next.js fa query con RLS attiva).            ║
-- ║                                                                          ║
-- ║ Approccio: DO block che enumera tutte le policy in `public` schema il    ║
-- ║ cui qual / with_check contiene `auth.uid()` MA NON `(select auth.uid())` ║
-- ║ e le rewrita via ALTER POLICY. Idempotente: rieseguire e' no-op (il      ║
-- ║ WHERE filtra le policy gia' corrette).                                   ║
-- ║                                                                          ║
-- ║ Vantaggio vs DROP/CREATE: ALTER POLICY preserva permessi grant/revoke,   ║
-- ║ commenti, e non e' soggetto a race con altre transazioni che leggono    ║
-- ║ con le policy attive.                                                    ║
-- ║                                                                          ║
-- ║ Vantaggio vs enumerazione esplicita: ~42 policy nominate, il programmatic║
-- ║ approach evita drift (se una policy ha custom clause oltre `auth.uid()   ║
-- ║ = user_id`, l'ALTER preserva il pattern e cambia SOLO auth.uid() → cached║
-- ║ subquery via regexp_replace).                                            ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DO $$
DECLARE
  pol record;
  new_using text;
  new_check text;
  alter_sql text;
  fixed_count int := 0;
BEGIN
  FOR pol IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      pg_get_expr(p.polqual, c.oid) AS qual,
      pg_get_expr(p.polwithcheck, c.oid) AS with_check
    FROM pg_policy p
    JOIN pg_class c       ON p.polrelid = c.oid
    JOIN pg_namespace n   ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND (
        (pg_get_expr(p.polqual, c.oid) ~* '\mauth\.uid\(\)'
          AND pg_get_expr(p.polqual, c.oid) !~* '\(\s*select\s+auth\.uid\(\)\s*\)')
        OR
        (pg_get_expr(p.polwithcheck, c.oid) ~* '\mauth\.uid\(\)'
          AND pg_get_expr(p.polwithcheck, c.oid) !~* '\(\s*select\s+auth\.uid\(\)\s*\)')
      )
  LOOP
    -- Sostituisce ogni occorrenza nuda di auth.uid() con (select auth.uid()).
    -- Boundary word-class \m garantisce che NON tocchiamo strings che lo
    -- contengono in un identifier piu' lungo (improbabile ma safety net).
    new_using := regexp_replace(
      COALESCE(pol.qual, ''),
      '\mauth\.uid\(\)',
      '(select auth.uid())',
      'g'
    );
    new_check := regexp_replace(
      COALESCE(pol.with_check, ''),
      '\mauth\.uid\(\)',
      '(select auth.uid())',
      'g'
    );

    -- Compone ALTER POLICY dinamicamente. ALTER POLICY accetta USING e/o
    -- WITH CHECK insieme; mantiamo solo i clauses che la policy aveva.
    alter_sql := format(
      'ALTER POLICY %I ON %I.%I',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );

    IF pol.qual IS NOT NULL AND pol.qual <> '' THEN
      alter_sql := alter_sql || format(' USING (%s)', new_using);
    END IF;

    IF pol.with_check IS NOT NULL AND pol.with_check <> '' THEN
      alter_sql := alter_sql || format(' WITH CHECK (%s)', new_check);
    END IF;

    RAISE NOTICE 'mig 018: %.% policy "%": rewriting auth.uid() → (select auth.uid())',
      pol.schemaname, pol.tablename, pol.policyname;
    EXECUTE alter_sql;
    fixed_count := fixed_count + 1;
  END LOOP;

  IF fixed_count = 0 THEN
    RAISE NOTICE 'mig 018: no policies needed rewriting (idempotent re-run)';
  ELSE
    RAISE NOTICE 'mig 018: rewrote % policies', fixed_count;
  END IF;
END $$;

-- Company 140: nessuna policy in public schema deve avere `auth.uid()` nudo dopo
-- la migrazione. Se ne resta una, il DO block ha fallito (es. clause su
-- colonne diverse da user_id che il regexp non gestisce). RAISE EXCEPTION
-- fa rollback dell'intera migrazione.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM pg_policy p
  JOIN pg_class c     ON p.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND (
      (pg_get_expr(p.polqual, c.oid) ~* '\mauth\.uid\(\)'
        AND pg_get_expr(p.polqual, c.oid) !~* '\(\s*select\s+auth\.uid\(\)\s*\)')
      OR
      (pg_get_expr(p.polwithcheck, c.oid) ~* '\mauth\.uid\(\)'
        AND pg_get_expr(p.polwithcheck, c.oid) !~* '\(\s*select\s+auth\.uid\(\)\s*\)')
    );

  IF remaining > 0 THEN
    RAISE EXCEPTION 'mig 018 sanity: % policies still have un-cached auth.uid()', remaining;
  END IF;
END $$;
