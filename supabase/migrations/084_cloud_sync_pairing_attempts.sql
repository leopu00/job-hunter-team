-- F-06: durable, tenant-bound failed pairing attempts.
-- The session row is locked before the counter so invalidation and increment
-- are one atomic decision under concurrent confirmations.
begin;

do $$
begin
  if to_regclass('public.cloud_sync_pairing_sessions') is null then
    raise exception '084 requires cloud_sync_pairing_sessions';
  end if;
  if to_regclass('public.cloud_sync_pairing_attempts') is not null then
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.cloud_sync_pairing_attempts'::regclass
        and a.attname = 'device_code' and not a.attisdropped
    ) then raise exception '084 collision: cloud_sync_pairing_attempts'; end if;
  end if;
end $$;

create table if not exists public.cloud_sync_pairing_attempts (
  device_code text not null references public.cloud_sync_pairing_sessions(device_code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_code, user_id)
);

alter table public.cloud_sync_pairing_attempts enable row level security;
revoke all on table public.cloud_sync_pairing_attempts from public, anon, authenticated;

create or replace function public.record_pairing_failure(
  p_device_code text,
  p_user_id uuid,
  p_lock_seconds integer default 60,
  p_max_attempts integer default 5
)
returns table(allowed boolean, invalidated boolean, attempts integer)
language plpgsql security definer set search_path = ''
as $$
declare
  s public.cloud_sync_pairing_sessions%rowtype;
  a public.cloud_sync_pairing_attempts%rowtype;
begin
  if p_device_code is null or p_user_id is null or p_lock_seconds < 1 or p_max_attempts < 1 then
    return query select false, false, 0;
    return;
  end if;
  select * into s from public.cloud_sync_pairing_sessions
    where device_code = p_device_code for update;
  if not found or s.status <> 'pending' or s.expires_at <= now() then
    return query select false, false, 0;
    return;
  end if;
  insert into public.cloud_sync_pairing_attempts(device_code, user_id)
    values (p_device_code, p_user_id)
    on conflict (device_code, user_id) do nothing;
  select * into a from public.cloud_sync_pairing_attempts
    where device_code = p_device_code and user_id = p_user_id for update;
  if a.invalidated_at is not null or (a.locked_until is not null and a.locked_until > now()) then
    return query select false, a.invalidated_at is not null, a.failed_attempts;
    return;
  end if;
  a.failed_attempts := a.failed_attempts + 1;
  a.locked_until := now() + make_interval(secs => p_lock_seconds);
  if a.failed_attempts >= p_max_attempts then
    a.invalidated_at := now();
    -- Make the invalidation visible to every subsequent confirmation lookup;
    -- the session lock above keeps this transition atomic with the counter.
    update public.cloud_sync_pairing_sessions
      set status = 'expired'
      where device_code = p_device_code and status = 'pending';
  end if;
  update public.cloud_sync_pairing_attempts
    set failed_attempts = a.failed_attempts, locked_until = a.locked_until,
        invalidated_at = a.invalidated_at, updated_at = now()
    where device_code = p_device_code and user_id = p_user_id;
  return query select a.invalidated_at is null, a.invalidated_at is not null, a.failed_attempts;
end;
$$;

revoke all on function public.record_pairing_failure(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.record_pairing_failure(text, uuid, integer, integer) to service_role;
commit;
