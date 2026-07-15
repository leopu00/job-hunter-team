-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 055 — position_views: stato "posizione vista" per-utente        ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Il marker "nuova = mai aperta" (pallino accanto al titolo, dashboard e   ║
-- ║ /positions) era client-only in localStorage — quindi per-browser. Con    ║
-- ║ questa tabella lo stato diventa cross-device: la web app inserisce la    ║
-- ║ riga quando l'utente resta sulla pagina della posizione per almeno 2s    ║
-- ║ (route /api/positions/seen, sessione utente + RLS).                      ║
-- ║                                                                          ║
-- ║ Una riga = "l'utente X ha visto la posizione Y". Nessun UPDATE mai:      ║
-- ║ insert-only con ON CONFLICT DO NOTHING, delete via CASCADE quando la     ║
-- ║ posizione sparisce. RLS auth.uid()=user_id nella forma init-plan         ║
-- ║ (select auth.uid()) — vedi mig 053.                                      ║
-- ║                                                                          ║
-- ║ Idempotente.                                                             ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.position_views (
  user_id     uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  viewed_at   timestamptz not null default now(),
  primary key (user_id, position_id)
);

alter table public.position_views enable row level security;

-- La PK (user_id, position_id) copre già le lookup per utente; questo
-- indice serve al CASCADE/join dal lato posizione.
create index if not exists position_views_position_id_idx
  on public.position_views (position_id);

drop policy if exists "position_views_select_own" on public.position_views;
create policy "position_views_select_own" on public.position_views
  for select to public using ((select auth.uid()) = user_id);

drop policy if exists "position_views_insert_own" on public.position_views;
create policy "position_views_insert_own" on public.position_views
  for insert to public with check ((select auth.uid()) = user_id);

drop policy if exists "position_views_delete_own" on public.position_views;
create policy "position_views_delete_own" on public.position_views
  for delete to public using ((select auth.uid()) = user_id);
