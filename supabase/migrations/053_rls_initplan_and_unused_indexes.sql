-- 053 — Performance a scala (Supabase advisor). Nessun cambio di comportamento.
--
-- (1) RLS "init-plan": le policy usano auth.uid() diretto → Postgres lo ri-valuta
--     PER OGNI RIGA. Avvolgendolo in (select auth.uid()) viene valutato una volta
--     sola e riusato. Stesso identico filtro, solo più veloce su tabelle grandi.
--     Ref: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--     Tabelle: position_transitions (4 policy), position_tickets (3 policy).
--
-- (2) Drop di indici MAI usati (advisor unused_index). DROP ... IF EXISTS →
--     idempotente e reversibile: se una query futura ne avesse bisogno, si ricrea.
--     Gli indici sui flag *_requested (bool) sono inerti: le query reali filtrano
--     sui timestamp *_requested_at, non sui bool (verificato dai log live).

begin;

-- ============================================================
-- (1) RLS init-plan → (select auth.uid())
-- ============================================================

-- position_transitions -----------------------------------------------------
drop policy if exists "Users can view own position_transitions" on public.position_transitions;
create policy "Users can view own position_transitions" on public.position_transitions
  for select to public using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own position_transitions" on public.position_transitions;
create policy "Users can insert own position_transitions" on public.position_transitions
  for insert to public with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own position_transitions" on public.position_transitions;
create policy "Users can update own position_transitions" on public.position_transitions
  for update to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own position_transitions" on public.position_transitions;
create policy "Users can delete own position_transitions" on public.position_transitions
  for delete to public using ((select auth.uid()) = user_id);

-- position_tickets ---------------------------------------------------------
drop policy if exists "users select own position tickets" on public.position_tickets;
create policy "users select own position tickets" on public.position_tickets
  for select to public using ((select auth.uid()) = user_id);

drop policy if exists "users insert own position tickets" on public.position_tickets;
create policy "users insert own position tickets" on public.position_tickets
  for insert to public with check ((select auth.uid()) = user_id);

drop policy if exists "users update own position tickets" on public.position_tickets;
create policy "users update own position tickets" on public.position_tickets
  for update to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ============================================================
-- (2) Drop indici inutilizzati (advisor unused_index) — reversibili
-- ============================================================
drop index if exists public.positions_write_requested_idx;
drop index if exists public.positions_geocode_requested_idx;
drop index if exists public.positions_salary_precise_requested_idx;
drop index if exists public.idx_positions_recheck_requested;
drop index if exists public.positions_open_expiry_idx;
drop index if exists public.idx_positions_user_excluded;
drop index if exists public.idx_positions_loc_country_code;
drop index if exists public.idx_positions_work_mode;
drop index if exists public.idx_positions_loc_continent;
drop index if exists public.file_bridge_requests_expires_idx;
drop index if exists public.idx_cloud_sync_pairing_sessions_approved_token_id;
drop index if exists public.idx_cloud_sync_pairing_sessions_user_id;

commit;
