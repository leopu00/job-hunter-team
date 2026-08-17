-- #186: applications.updated_at, the cursor the cloud->box lane never had.
-- The pull that brings applications home orders and filters on a single
-- monotonic column. applications has 27 columns and not one of them can hold
-- that role: applied_at is cleared by an undo (it fails exactly when it is
-- needed), response_at/written_at/critic_reviewed_at move for other reasons,
-- created_at never moves. A greatest() over five columns would order on a key
-- different from the one it filters on, which does not converge under
-- truncation. 23 tables on this schema already carry updated_at with the same
-- default; applications, companies and scores are the ones that never got it.
--
-- THE TRIGGER IS NOT AN EXTRA. The default only covers the INSERT: without a
-- BEFORE UPDATE trigger an update leaves updated_at where it was, the cursor
-- never sees the change, and today's defect comes back one floor below —
-- silent and permanent. update_updated_at() already exists and is what
-- positions, pending_user_messages, position_user_notes, notification_prefs
-- and user_settings use: this migration reuses it and defines nothing new.
--
-- No historical backfill, and that is a decision. Adding the column with
-- default now() stamps every existing row with the migration instant, so the
-- first pull after it brings every application home once — which is the
-- reconciliation #186 exists for. Backfilling the real historical timestamps
-- would push the rows older than the default lookback out of the window, and
-- those are precisely the ones we are trying to recover.
--
-- Additive and idempotent: no rewrite of the table, no data touched.
begin;
do $$
begin
  if to_regclass('public.applications') is null then
    raise exception '085 precondition: public.applications is missing';
  end if;
  if to_regprocedure('public.update_updated_at()') is null then
    raise exception '085 precondition: public.update_updated_at() is missing';
  end if;
end $$;

alter table public.applications
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_applications_updated_at on public.applications;
create trigger trg_applications_updated_at
  before update on public.applications
  for each row execute function public.update_updated_at();
commit;
