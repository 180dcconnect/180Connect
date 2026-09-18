-- Migration: create_charity_register_coverage
-- Data Model sequence: 28.9
--
-- Persists the four whole-book Charity Commission coverage readings. The page
-- reads four tiny rows; local SQLite and the client tables are scanned only by
-- a refresh worker after the response. Relevant writes mark the affected rows
-- stale in the database, so a new writer cannot forget cache invalidation.
--
-- Compatibility:
--   Expand-only. The old application ignores this table and keeps calculating
--   coverage on page load. The new application falls back to that path if the
--   table is not deployed yet. Four seeded rows begin stale and blank, so no
--   invented zero is shown during the first refresh.
--
-- Storage:
--   Exactly four rows, each comfortably below 1 KB. This is immaterial against
--   the free plan's 500 MB database ceiling.
--
-- Security:
--   Active authenticated users may read the figures because CAMs, admins and
--   viewers all see the Charity Commission screen. No interactive role may
--   write them. Refresh RPCs are SECURITY INVOKER and service_role-only. The
--   invalidation function is SECURITY DEFINER solely so table triggers still
--   work for authenticated writes; it is executable by no API role.
--
-- Audit:
--   This is derived operational state, not ownership, status, role or approval
--   state. Refresh/invalidation is therefore not an audit-log event.
--
-- Reversibility: paired rollback in
-- ../rollback/20261018130000_create_charity_register_coverage.down.sql

create table public.charity_register_coverage (
  id                  uuid primary key default gen_random_uuid(),
  coverage_kind       text not null,
  charities           integer,
  covered             integer,
  pending             integer,
  pending_items       integer,
  register_built_on   date,
  calculated_at       timestamptz,
  stale_at            timestamptz,
  refresh_started_at  timestamptz,
  refresh_failed_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint charity_register_coverage_kind_valid check (
    coverage_kind in ('annual_return', 'profile', 'reach', 'company_number')
  ),
  constraint charity_register_coverage_kind_unique unique (coverage_kind),
  constraint charity_register_coverage_counts_complete check (
    (
      charities is null
      and covered is null
      and pending is null
      and calculated_at is null
      and register_built_on is null
    )
    or (
      charities >= 0
      and covered >= 0
      and pending >= 0
      and covered + pending = charities
      and calculated_at is not null
      and register_built_on is not null
    )
  ),
  constraint charity_register_coverage_pending_items_nonnegative check (
    pending_items is null or pending_items >= 0
  ),
  constraint charity_register_coverage_pending_items_kind check (
    calculated_at is null
    or ((coverage_kind in ('annual_return', 'profile')) = (pending_items is not null))
  )
);

comment on table public.charity_register_coverage is
  'Four persisted Charity Commission coverage readings. Relevant client writes '
  'mark rows stale; a service-role worker refreshes them after the response.';
comment on column public.charity_register_coverage.pending_items is
  'Filed years for annual_return, missing fields for profile, null for reach and company_number.';
comment on column public.charity_register_coverage.refresh_started_at is
  'Refresh lease timestamp. A worker may reclaim it after ten minutes.';

create trigger charity_register_coverage_set_updated_at
  before update on public.charity_register_coverage
  for each row execute function public.set_updated_at();

insert into public.charity_register_coverage (coverage_kind, stale_at)
values
  ('annual_return', now()),
  ('profile', now()),
  ('reach', now()),
  ('company_number', now());

-- ---------------------------------------------------------------------------
-- Security: shared read, service-role write. REVOKE before GRANT.
-- ---------------------------------------------------------------------------
revoke all on table public.charity_register_coverage from anon, authenticated;
grant select on table public.charity_register_coverage to authenticated;
grant select, update on table public.charity_register_coverage to service_role;

alter table public.charity_register_coverage enable row level security;

create policy charity_register_coverage_select_active
  on public.charity_register_coverage
  for select to authenticated
  using ((select app.is_active_user()));

-- ---------------------------------------------------------------------------
-- Invalidation. The fixed trigger arguments are coverage_kind values, never
-- caller input. statement_timestamp() advances even when a row was already
-- stale, so a write racing a refresh cannot be erased by that older worker.
-- ---------------------------------------------------------------------------
create or replace function public.mark_charity_register_coverage_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.charity_register_coverage
     set stale_at = statement_timestamp()
   where coverage_kind = any (tg_argv);
  return null;
end;
$$;

revoke all on function public.mark_charity_register_coverage_stale()
  from public, anon, authenticated;

create trigger organisations_stale_charity_profile_coverage
  after update of charity_activities, sector, registered_on,
    charity_reporting_status, insolvent, in_administration
  on public.organisations
  for each statement execute function public.mark_charity_register_coverage_stale('profile');

create trigger organisations_stale_charity_reach_coverage
  after update of geographic_reach
  on public.organisations
  for each statement execute function public.mark_charity_register_coverage_stale('reach');

create trigger financial_periods_stale_charity_coverage
  after insert or update or delete on public.financial_periods
  for each statement execute function public.mark_charity_register_coverage_stale('annual_return');

-- A charity-number change alters all four populations. A company-number change
-- only affects one, but identifier writes are rare and keeping this statement
-- trigger avoids thousands of per-row trigger calls during bulk promotion.
create trigger organisation_identifiers_stale_charity_coverage
  after insert or update or delete on public.organisation_identifiers
  for each statement execute function public.mark_charity_register_coverage_stale(
    'annual_return', 'profile', 'reach', 'company_number'
  );

-- ---------------------------------------------------------------------------
-- Refresh lease. These RPCs are service-role-only and SECURITY INVOKER: the
-- service role has explicit table privileges above and bypasses RLS, so no
-- definer rights are needed. The timestamp token prevents an expired worker from
-- overwriting a newer refresh.
-- ---------------------------------------------------------------------------
create or replace function public.claim_charity_register_coverage_refreshes(
  p_register_built_on date
)
returns table (coverage_kind text, started_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_started_at timestamptz := clock_timestamp();
begin
  return query
  update public.charity_register_coverage as coverage
     set refresh_started_at = v_started_at,
         stale_at = coalesce(stale_at, v_started_at)
   where (
       calculated_at is null
       or stale_at is not null
       or register_built_on is distinct from p_register_built_on
     )
     and (
       refresh_started_at is null
       or refresh_started_at < v_started_at - interval '10 minutes'
     )
  returning coverage.coverage_kind, v_started_at;
end;
$$;

create or replace function public.finish_charity_register_coverage_refresh(
  p_coverage_kind text,
  p_started_at timestamptz,
  p_register_built_on date,
  p_charities integer,
  p_covered integer,
  p_pending integer,
  p_pending_items integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.charity_register_coverage
     set charities = p_charities,
         covered = p_covered,
         pending = p_pending,
         pending_items = p_pending_items,
         register_built_on = p_register_built_on,
         calculated_at = clock_timestamp(),
         stale_at = case
           when stale_at <= p_started_at then null
           else stale_at
         end,
         refresh_started_at = null,
         refresh_failed_at = null
   where coverage_kind = p_coverage_kind
     and refresh_started_at = p_started_at;
  return found;
end;
$$;

create or replace function public.fail_charity_register_coverage_refresh(
  p_coverage_kind text,
  p_started_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.charity_register_coverage
     set refresh_started_at = null,
         refresh_failed_at = clock_timestamp()
   where coverage_kind = p_coverage_kind
     and refresh_started_at = p_started_at;
  return found;
end;
$$;

revoke all on function public.claim_charity_register_coverage_refreshes(date)
  from public, anon, authenticated;
revoke all on function public.finish_charity_register_coverage_refresh(
  text, timestamptz, date, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.fail_charity_register_coverage_refresh(text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_charity_register_coverage_refreshes(date)
  to service_role;
grant execute on function public.finish_charity_register_coverage_refresh(
  text, timestamptz, date, integer, integer, integer, integer
) to service_role;
grant execute on function public.fail_charity_register_coverage_refresh(text, timestamptz)
  to service_role;
