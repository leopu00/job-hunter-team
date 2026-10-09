-- 091: pg_graphql is dropped; nothing in JHT speaks GraphQL.
--
-- The web, the desktop and the CLI read and write through PostgREST and RPC.
-- pg_graphql still answered /graphql/v1 for anon and authenticated, and its
-- introspection listed every table those roles can SELECT, with columns,
-- relationships and generated mutations (Supabase advisor lints 0026 and
-- 0027). RLS protects rows, not that map.
--
-- Why not REVOKE USAGE ON SCHEMA graphql: on Supabase the schema belongs to
-- supabase_admin, which also granted USAGE to anon and authenticated. A
-- migration runs as postgres, and PostgreSQL lets a role revoke only the
-- grants it made itself: the REVOKE ends with a WARNING and removes nothing.
-- The same holds for EXECUTE on graphql.resolve. Dropping the extension is
-- allowed to postgres and is what Supabase documents for projects that do
-- not use GraphQL. After it /graphql/v1 answers every role with
-- "pg_graphql extension is not enabled."
--
-- The extension holds no data: CREATE EXTENSION pg_graphql brings it back,
-- and Supabase's event trigger grants the browser roles again.
-- On a plain self-hosted Postgres without pg_graphql this does nothing.

DROP EXTENSION IF EXISTS pg_graphql;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_graphql') THEN
    RAISE EXCEPTION '091: pg_graphql is still installed';
  END IF;
END $$;
