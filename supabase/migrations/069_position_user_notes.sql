-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 069 — position_user_notes: la nota privata trova casa sul cloud ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ O-33. La nota privata (O-22) viveva SOLO nel jobs.db del box: a box       ║
-- ║ spento la route rispondeva 503 «non c'è ancora dove metterle» e il        ║
-- ║ pannello si apriva vuoto. Questa tabella è quel dove.                     ║
-- ║                                                                          ║
-- ║ «Privata» vuol dire privata DAGLI AGENTI, non dal cloud: gli agenti non   ║
-- ║ la leggono perché non sta in `positions.notes` — non perché non si        ║
-- ║ sincronizza. Le due cose sono diverse, e confonderle è ciò che ha         ║
-- ║ prodotto il 503.                                                         ║
-- ║                                                                          ║
-- ║ Tabella separata da `positions` per la stessa ragione del lato box:       ║
-- ║ `jht cloud restore` fa INSERT OR REPLACE su `positions` con un elenco     ║
-- ║ esplicito di colonne, quindi una colonna in più verrebbe azzerata a ogni  ║
-- ║ restore. Un campo che perde quello che ci scrivi è peggio di un campo     ║
-- ║ che non c'è.                                                             ║
-- ║                                                                          ║
-- ║ `origin` = LA SUPERFICIE CHE SCRIVE, non la UI: 'box' = il jobs.db del    ║
-- ║ box, 'web' = questo sito. Sta nella chiave perché quando i due testi      ║
-- ║ divergono si tengono ENTRAMBI: «vince l'ultima» obbligherebbe a           ║
-- ║ stabilire quale sia l'ultima fra due orologi non sincronizzati — e il     ║
-- ║ box tronca i timestamp ai secondi mentre il web tiene i millisecondi      ║
-- ║ (visto su O-16). Tenendole entrambe quel problema non esiste.             ║
-- ║                                                                          ║
-- ║ Oggi su questa tabella scrive SOLO il sito, e solo a box spento (il box   ║
-- ║ acceso resta la source of truth in-process e la nota va nel suo jobs.db). ║
-- ║ Quindi in pratica qui nascono solo righe 'web'. La colonna c'è comunque,  ║
-- ║ e la chiave la comprende, perché i due pezzi che restano — un mirror      ║
-- ║ box→cloud e il ritorno delle righe 'web' nel box via `jht cloud restore`  ║
-- ║ — porterebbero qui la seconda superficie: con la colonna già in chiave    ║
-- ║ si attaccano senza ri-migrare una tabella che nel frattempo contiene le   ║
-- ║ note di qualcuno. Il `default 'web'` dice la stessa cosa del `default     ║
-- ║ 'box'` lato SQLite: la provenienza predefinita è la superficie che        ║
-- ║ possiede il DB.                                                          ║
-- ║                                                                          ║
-- ║ Forma copiata da mig 055 (position_views): FK verso auth.users e          ║
-- ║ positions entrambe on delete cascade, RLS abilitata, policy own nella     ║
-- ║ forma init-plan `(select auth.uid()) = user_id` (mig 053). A differenza   ║
-- ║ di position_views qui serve anche UPDATE: un blocco note si riscrive,     ║
-- ║ non è insert-only.                                                       ║
-- ║                                                                          ║
-- ║ Idempotente.                                                             ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.position_user_notes (
  user_id     uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  origin      text not null default 'web' check (origin in ('box', 'web')),
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, position_id, origin)
);

alter table public.position_user_notes enable row level security;

-- La PK (user_id, position_id, origin) copre già le lookup per utente; questo
-- indice serve al CASCADE/join dal lato posizione.
create index if not exists position_user_notes_position_id_idx
  on public.position_user_notes (position_id);

-- `updated_at` non lo scrive chi chiama: riusa la funzione di 001_schema.sql,
-- come positions (mig 052). Così un upsert che riscrive il testo fa avanzare
-- il timestamp anche se chi lo manda se ne dimentica.
drop trigger if exists trg_position_user_notes_updated_at
  on public.position_user_notes;
create trigger trg_position_user_notes_updated_at
  before update on public.position_user_notes
  for each row execute function update_updated_at();

drop policy if exists "position_user_notes_select_own" on public.position_user_notes;
create policy "position_user_notes_select_own" on public.position_user_notes
  for select to public using ((select auth.uid()) = user_id);

drop policy if exists "position_user_notes_insert_own" on public.position_user_notes;
create policy "position_user_notes_insert_own" on public.position_user_notes
  for insert to public with check ((select auth.uid()) = user_id);

drop policy if exists "position_user_notes_update_own" on public.position_user_notes;
create policy "position_user_notes_update_own" on public.position_user_notes
  for update to public using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "position_user_notes_delete_own" on public.position_user_notes;
create policy "position_user_notes_delete_own" on public.position_user_notes
  for delete to public using ((select auth.uid()) = user_id);
