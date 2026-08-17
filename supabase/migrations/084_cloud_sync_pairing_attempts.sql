-- F-06: durable authenticated-user pairing-attempt bucket.
-- Every authenticated confirmation attempt consumes this bucket before any
-- body parsing or session lookup. The row lock makes window/max decisions
-- atomic across concurrent requests and re-applying the migration is safe.
-- Historical correction: migration 008 described the AAAA-1234 user_code
-- space as ~36^8/~2.8T. The generator uses 23 letters and 8 digits, so the
-- actual space is 23^4 * 8^4 ~= 1.15B; 008 stays byte-for-byte immutable.
begin;
do $$
begin
  if to_regclass('public.cloud_sync_pairing_attempts') is not null then
    if not exists (
      select 1
        from pg_attribute
       where attrelid = to_regclass('public.cloud_sync_pairing_attempts')
         and attname = 'user_id'
         and not attisdropped
    ) then
      raise exception '084 collision: cloud_sync_pairing_attempts';
    end if;
  end if;
end $$;

create table if not exists public.cloud_sync_pairing_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  invalidated_at timestamptz,
  last_device_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cloud_sync_pairing_attempts enable row level security;
revoke all on table public.cloud_sync_pairing_attempts from public, anon, authenticated;

create or replace function public.consume_pairing_attempt(
  p_user_id uuid,
  p_device_code text default null,
  p_window_seconds integer default 600,
  p_max_attempts integer default 20
)
returns table(allowed boolean, attempts integer, retry_after_seconds integer)
language plpgsql security definer set search_path = ''
as $$
declare a public.cloud_sync_pairing_attempts%rowtype; n integer;
begin
  if p_user_id is null or p_window_seconds < 1 or p_max_attempts < 1 then
    return query select false, 0, 0; return;
  end if;
  insert into public.cloud_sync_pairing_attempts(user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select * into a from public.cloud_sync_pairing_attempts where user_id = p_user_id for update;
  if a.invalidated_at is not null then return query select false, a.attempts, 0; return; end if;
  if a.window_started_at + make_interval(secs => p_window_seconds) <= now() then
    a.window_started_at := now(); a.attempts := 0; a.locked_until := null;
  end if;
  if a.attempts >= p_max_attempts then
    n := greatest(1, ceil(extract(epoch from (a.window_started_at + make_interval(secs => p_window_seconds) - now())))::integer);
    return query select false, a.attempts, n; return;
  end if;
  a.attempts := a.attempts + 1; a.last_device_code := p_device_code; a.updated_at := now();
  update public.cloud_sync_pairing_attempts set window_started_at=a.window_started_at, attempts=a.attempts, locked_until=a.locked_until, last_device_code=a.last_device_code, updated_at=a.updated_at where user_id=p_user_id;
  n := greatest(0, p_max_attempts - a.attempts);
  return query select true, a.attempts, n;
end;
$$;
revoke all on function public.consume_pairing_attempt(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_pairing_attempt(uuid, text, integer, integer) to service_role;
commit;
