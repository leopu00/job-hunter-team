-- 2026-05-31 — Migration 025: RLS init-plan fix v2
--
-- Copre il P0 del perf-backlog 2026-05-20: 22 policy che richiamano
-- auth.uid() direttamente, costringendo Postgres a re-valutare la
-- funzione per ogni row del result set.
--
-- La migration 018 (2026-05-20) ne aveva sistemate una parte; queste
-- 22 sono rimaste (o sono state introdotte da migrations successive
-- senza il wrap `(select ...)`).
--
-- Fix: sostituire `auth.uid()` con `(select auth.uid())`. Postgres
-- materializza l'init-plan una sola volta a query, non per-row.
--
-- Impatto sotto carico: passaggio da O(N×K) a O(N+K) dove N = row
-- e K = funzioni auth nelle policy. Documentato come moltiplicatore
-- principale dell'incident 2026-05-19.
--
-- Zero downtime: DROP+CREATE policy è lock minimal e istantaneo.
-- I roles `{public}` vengono preservati (default attuale).
--
-- Refs:
--   - docs/internal/2026-05-20-supabase-perf-backlog.md (P0)
--   - https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- ───── applications ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users see own data" ON public.applications;
CREATE POLICY "Users see own data" ON public.applications
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ───── candidate_profiles ────────────────────────────────────────────
DROP POLICY IF EXISTS "Users see own data" ON public.candidate_profiles;
CREATE POLICY "Users see own data" ON public.candidate_profiles
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ───── cloud_sync_pairing_sessions ───────────────────────────────────
DROP POLICY IF EXISTS "Users can view own approved pairings" ON public.cloud_sync_pairing_sessions;
CREATE POLICY "Users can view own approved pairings" ON public.cloud_sync_pairing_sessions
  FOR SELECT
  USING (
    (select auth.uid()) = user_id
    AND status = ANY (ARRAY['approved'::text, 'consumed'::text])
  );

-- ───── cloud_sync_tokens (×4) ────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own cloud sync tokens" ON public.cloud_sync_tokens;
CREATE POLICY "Users can view own cloud sync tokens" ON public.cloud_sync_tokens
  FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens;
CREATE POLICY "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own cloud sync tokens" ON public.cloud_sync_tokens;
CREATE POLICY "Users can update own cloud sync tokens" ON public.cloud_sync_tokens
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own cloud sync tokens" ON public.cloud_sync_tokens;
CREATE POLICY "Users can delete own cloud sync tokens" ON public.cloud_sync_tokens
  FOR DELETE
  USING ((select auth.uid()) = user_id);

-- ───── companies ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users see own data" ON public.companies;
CREATE POLICY "Users see own data" ON public.companies
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ───── encrypted_user_blobs (×4) ─────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own encrypted blobs" ON public.encrypted_user_blobs;
CREATE POLICY "Users can view own encrypted blobs" ON public.encrypted_user_blobs
  FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own encrypted blobs" ON public.encrypted_user_blobs;
CREATE POLICY "Users can insert own encrypted blobs" ON public.encrypted_user_blobs
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own encrypted blobs" ON public.encrypted_user_blobs;
CREATE POLICY "Users can update own encrypted blobs" ON public.encrypted_user_blobs
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own encrypted blobs" ON public.encrypted_user_blobs;
CREATE POLICY "Users can delete own encrypted blobs" ON public.encrypted_user_blobs
  FOR DELETE
  USING ((select auth.uid()) = user_id);

-- ───── pending_user_messages (×2) ────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own pending messages" ON public.pending_user_messages;
CREATE POLICY "Users can view own pending messages" ON public.pending_user_messages
  FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own pending messages" ON public.pending_user_messages;
CREATE POLICY "Users can update own pending messages" ON public.pending_user_messages
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ───── position_highlights ───────────────────────────────────────────
DROP POLICY IF EXISTS "Users see own data" ON public.position_highlights;
CREATE POLICY "Users see own data" ON public.position_highlights
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ───── positions ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users see own data" ON public.positions;
CREATE POLICY "Users see own data" ON public.positions
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ───── scores ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users see own data" ON public.scores;
CREATE POLICY "Users see own data" ON public.scores
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ───── sentinel_ticks ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own sentinel ticks" ON public.sentinel_ticks;
CREATE POLICY "Users can view own sentinel ticks" ON public.sentinel_ticks
  FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ───── team_commands (×3) ────────────────────────────────────────────
DROP POLICY IF EXISTS "users select own team commands" ON public.team_commands;
CREATE POLICY "users select own team commands" ON public.team_commands
  FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "users insert own team commands" ON public.team_commands;
CREATE POLICY "users insert own team commands" ON public.team_commands
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "users update own team commands" ON public.team_commands;
CREATE POLICY "users update own team commands" ON public.team_commands
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ───── user_onboarding_state ─────────────────────────────────────────
DROP POLICY IF EXISTS "users read own onboarding state" ON public.user_onboarding_state;
CREATE POLICY "users read own onboarding state" ON public.user_onboarding_state
  FOR SELECT
  USING ((select auth.uid()) = user_id);
