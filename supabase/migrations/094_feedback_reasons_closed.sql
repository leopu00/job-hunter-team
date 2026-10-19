-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 094 — il motivo del feedback è un codice, la nota ha una colonna ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ JHT-T05. `position_feedback.reason` era testo libero: lo Scorer doveva    ║
-- ║ interpretarlo, sinonimi diversi diventavano segnali diversi, e il testo   ║
-- ║ dell'utente arrivava a un agente. Ora il motivo è un codice del           ║
-- ║ vocabolario chiuso `shared/feedback-reasons.json` (too_senior,            ║
-- ║ too_junior, wrong_location, salary_low, wrong_stack, company,             ║
-- ║ scam_or_gone, closed, already_applied, other) e quello che l'utente       ║
-- ║ scrive a parole sue è la NOTA: max 200 caratteri, sua, mai agli agenti.   ║
-- ║                                                                          ║
-- ║ 1. `position_feedback.note` (nuova, ≤ 200). `comment` non lo scrive più   ║
-- ║    nessuno e nessun agente lo legge; i dati vecchi non si perdono (un     ║
-- ║    reason libero lungo ci viene copiato intero).                         ║
-- ║ 2. I dati già salvati. Un `reason` che non è un codice diventa `other` e  ║
-- ║    il testo che l'utente aveva scritto (in `reason` o in `comment`) va in ║
-- ║    `note`, ripulito dai caratteri di controllo e tagliato a 200. I tre    ║
-- ║    codici del vecchio elenco senza equivalente (not_interested, mismatch, ║
-- ║    conditions) diventano `other`; `positions.user_excluded_reason` idem.  ║
-- ║ 3. `profile_exclusions`: la preferenza dell'utente quando accetta (o      ║
-- ║    rifiuta) la proposta di escludere un tipo di posizioni — codice, data, ║
-- ║    stato. SOLO preferenza: nessun agente la legge e non cambia ciò che    ║
-- ║    Scout e Scorer fanno; collegarli è un lavoro a parte.                  ║
-- ║                                                                          ║
-- ║ NIENTE CHECK sul vocabolario di `reason` in questa migrazione, di         ║
-- ║ proposito: un client già installato manda ancora i codici del vecchio     ║
-- ║ elenco, e un CHECK che rifiuta lo scrittore congela il sync (è già        ║
-- ║ successo con `cloud_push_status`). Le route rimappano e rifiutano il      ║
-- ║ testo libero; il CHECK viene dopo, in una migrazione successiva, quando   ║
-- ║ i client sono aggiornati.                                                ║
-- ║                                                                          ║
-- ║ Idempotente.                                                             ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.position_feedback
  add column if not exists note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'position_feedback_note_length'
       and conrelid = 'public.position_feedback'::regclass
  ) then
    alter table public.position_feedback
      add constraint position_feedback_note_length
      check (note is null or length(note) <= 200);
  end if;
end$$;

-- I dati già salvati. Il testo libero (nel vecchio `reason`, o nel `comment`)
-- passa in `note` ripulito e tagliato; il motivo diventa un codice.
-- Il testo libero intero (fino a 500 caratteri) non si perde: oltre che nella
-- nota tagliata a 200, finisce nel commento, che nessun agente legge. Al posto
-- del commento se era vuoto, in coda se c'era già qualcosa; il tetto del
-- commento è 2000 e quel che non entra si dichiara qui sotto.
do $$
declare
  cut_rows integer;
begin
  select count(*) into cut_rows
    from public.position_feedback
   where reason is not null
     and reason not in (
       'too_senior', 'too_junior', 'wrong_location', 'salary_low',
       'wrong_stack', 'company', 'scam_or_gone', 'closed',
       'already_applied', 'other', 'not_interested', 'mismatch', 'conditions'
     )
     and btrim(reason) <> ''
     and comment is not null and btrim(comment) <> ''
     and position(btrim(reason) in comment) = 0
     and length(btrim(comment)) + 5 + length(btrim(reason)) > 2000;
  if cut_rows > 0 then
    raise notice 'feedback reasons: % original reason text(s) did not fit the 2000 characters of the comment and were cut there', cut_rows;
  end if;
end$$;

update public.position_feedback
   set note = coalesce(
         note,
         nullif(left(btrim(regexp_replace(
           case
             when reason in ('not_interested', 'mismatch', 'conditions') then comment
             else coalesce(nullif(btrim(reason), ''), comment)
           end,
           '[\x00-\x1f\x7f]', ' ', 'g')), 200), '')),
       comment = case
         when reason in ('not_interested', 'mismatch', 'conditions') or btrim(coalesce(reason, '')) = '' then comment
         when comment is null or btrim(comment) = '' then left(btrim(reason), 2000)
         when position(btrim(reason) in comment) > 0 then comment
         else left(btrim(comment) || E'\n---\n' || btrim(reason), 2000)
       end,
       reason = 'other'
 where reason is not null
   and reason not in (
     'too_senior', 'too_junior', 'wrong_location', 'salary_low',
     'wrong_stack', 'company', 'scam_or_gone', 'closed',
     'already_applied', 'other'
   );

update public.position_feedback
   set note = nullif(left(btrim(regexp_replace(comment, '[\x00-\x1f\x7f]', ' ', 'g')), 200), '')
 where note is null
   and comment is not null
   and btrim(comment) <> '';

update public.positions
   set user_excluded_reason = 'other'
 where user_excluded_reason in ('not_interested', 'mismatch', 'conditions');

-- La preferenza sull'esclusione del profilo: codice, data, stato.
create table if not exists public.profile_exclusions (
  user_id               uuid not null references auth.users(id) on delete cascade,
  reason                text not null check (reason in (
    'too_senior', 'too_junior', 'wrong_location', 'salary_low',
    'wrong_stack', 'company'
  )),
  status                text not null check (status in ('accepted', 'dismissed')),
  positions_at_decision integer not null default 0 check (positions_at_decision >= 0),
  decided_at            timestamptz not null default now(),
  primary key (user_id, reason)
);

alter table public.profile_exclusions enable row level security;

drop policy if exists "profile_exclusions_select_own" on public.profile_exclusions;
create policy "profile_exclusions_select_own" on public.profile_exclusions
  for select to public using ((select auth.uid()) = user_id);

drop policy if exists "profile_exclusions_insert_own" on public.profile_exclusions;
create policy "profile_exclusions_insert_own" on public.profile_exclusions
  for insert to public with check ((select auth.uid()) = user_id);

drop policy if exists "profile_exclusions_update_own" on public.profile_exclusions;
create policy "profile_exclusions_update_own" on public.profile_exclusions
  for update to public using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "profile_exclusions_delete_own" on public.profile_exclusions;
create policy "profile_exclusions_delete_own" on public.profile_exclusions
  for delete to public using ((select auth.uid()) = user_id);
