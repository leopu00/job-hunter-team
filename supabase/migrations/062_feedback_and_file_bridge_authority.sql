-- Security boundary for feedback and transient file storage.
--
-- feedback_tickets contains free-form reports and historical screenshot URLs.
-- Submission stays public, but no browser role may enumerate stored reports.
--
-- file_bridge_requests used to accept storage_path from an authenticated
-- INSERT.  Service-role consumers must not treat a browser-writable path as
-- Storage authority.  The path is now generated from the owning user and the
-- server-generated request UUID; browser INSERT is restricted to the two
-- fields it actually supplies.

begin;

do $$
declare
    policy_record record;
begin
    -- Some deployed schemas predate migration 005 and never created this
    -- optional table.  Every statement that resolves the relation is dynamic
    -- and stays inside the existence guard, so the file-bridge hardening below
    -- still runs without recreating feedback storage.
    if to_regclass('public.feedback_tickets') is not null then
        execute 'lock table public.feedback_tickets in access exclusive mode';
        execute 'alter table public.feedback_tickets enable row level security';
        execute 'revoke select on table public.feedback_tickets from public, anon, authenticated';

        -- Remove every read-capable policy, not just the name used by
        -- migration 005. Permissive RLS policies combine with OR, so a
        -- forgotten FOR ALL policy would otherwise reopen the table despite
        -- dropping the known SELECT policy.
        for policy_record in
            select policyname
              from pg_policies
             where schemaname = 'public'
               and tablename = 'feedback_tickets'
               and cmd in ('SELECT', 'ALL')
        loop
            execute format(
                'drop policy %I on public.feedback_tickets',
                policy_record.policyname
            );
        end loop;

        execute 'grant select on table public.feedback_tickets to service_role';
    end if;
end
$$;

drop policy if exists "file_bridge_requests select own"
    on public.file_bridge_requests;
drop policy if exists "file_bridge_requests insert own"
    on public.file_bridge_requests;

revoke all privileges on table public.file_bridge_requests
    from public, anon, authenticated;

-- The bridge is ephemeral.  Existing path metadata is deliberately discarded:
-- it was client-writable and therefore cannot be migrated as trusted input.
alter table public.file_bridge_requests
    drop column if exists storage_path;
alter table public.file_bridge_requests
    add column storage_path text generated always as (
        user_id::text || '/' || id::text || '/payload'
    ) stored;
alter table public.file_bridge_requests
    drop constraint if exists file_bridge_requests_file_name_safe;
alter table public.file_bridge_requests
    add constraint file_bridge_requests_file_name_safe
    check (
        char_length(file_name) between 1 and 255
        and file_name !~ '[[:cntrl:]]'
    ) not valid;

grant select on table public.file_bridge_requests to authenticated;
grant insert (user_id, file_name)
    on table public.file_bridge_requests to authenticated;

create policy "file_bridge_requests select own"
    on public.file_bridge_requests for select
    to authenticated
    using ((select auth.uid()) = user_id);

create policy "file_bridge_requests insert own"
    on public.file_bridge_requests for insert
    to authenticated
    with check (
        (select auth.uid()) = user_id
        and status = 'pending'
        and error is null
        and expires_at is null
    );

commit;
