-- Controllo del seed e2e LOCALE (lo chiama supabase/seed-e2e.sh con
-- -v e2e_email=...). L'utente lo crea l'Admin API di GoTrue, che scrive
-- auth.users e auth.identities nel formato della sua versione: qui si prova
-- soltanto che il risultato è quello che le spec presuppongono.
--   * l'utente sintetico esiste, una volta sola, con l'email confermata;
--   * non possiede posizioni né profilo (l'account di test è vuoto).

select set_config('seed_e2e.email', :'e2e_email', false);

do $$
declare
  n_users int;
  uid uuid;
  n_rows int;
begin
  select count(*), min(id::text)::uuid into n_users, uid
    from auth.users
   where email = current_setting('seed_e2e.email')
     and email_confirmed_at is not null;
  if n_users <> 1 then
    raise exception 'seed-e2e: attesi 1 utente confermato, trovati %', n_users;
  end if;

  select (select count(*) from public.positions where user_id = uid)
       + (select count(*) from public.candidate_profiles where user_id = uid)
    into n_rows;
  if n_rows <> 0 then
    raise exception 'seed-e2e: l''account di test non è vuoto (% righe)', n_rows;
  end if;
end $$;
