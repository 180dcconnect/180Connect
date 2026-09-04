-- Migration: create_sector_income_distribution_rpc
-- Sequence: addition (needs public.organisations, public.financial_periods,
--   app.is_active_user). Not a numbered step — RPC migrations are not rows in
--   Data Model tab 11.
-- Story: Financials tab section 1 — "Scale" peer strip.
--
-- WHAT THIS CHANGES:
--   Adds one read-only aggregation RPC returning the income distribution of the
--   clients we hold in a given sector: peer count, the five-number summary
--   (min / p25 / median / p75 / max) of each peer's LATEST filed income, and how
--   many of those peers file less than a supplied figure. Plus a supporting
--   index on organisations.sector.
--
-- WHY AN RPC RATHER THAN TWO CLIENT-SIDE QUERIES:
--   The strip needs one income figure per peer organisation — the latest filed
--   one — which is a max-per-group. PostgREST cannot express DISTINCT ON, so the
--   app was doing it in two round trips: every same-sector organisation id, then
--   every financial_periods row for those ids, reduced in Node. On the largest
--   sector on staging (Education & Training, 363 clients averaging 4.8 filed
--   periods) that is ~1,750 rows crossing the wire on every visit to the tab, to
--   produce six numbers. This returns the six numbers.
--
--   DISTINCT ON here rides financial_periods_organisation_idx
--   (organisation_id, period_end desc) exactly; the new sector index keeps the
--   peer-set filter off a sequential scan of organisations.
--
-- WHY SECURITY INVOKER, NOT DEFINER:
--   Both tables are shared-read for every active user
--   (docs/rls-permission-matrix.md §3.2 and §4.3: "View canonical organisations"
--   — all three roles). There is nothing here a caller could not already select
--   for itself, so the function has no reason to hold elevated rights. Running
--   as invoker means RLS applies normally and a deactivated user's read collapses
--   to zero rows through the same policies as everything else, rather than
--   through a hand-written guard inside a definer body that could drift from
--   them. The active-user check is kept as well — belt and braces, and it turns
--   a deactivated caller's "sector of zero" into an explicit error rather than a
--   silently empty strip.
--
--   search_path is pinned regardless: an invoker function is still resolved
--   against the caller's search_path unless it says otherwise.
--
-- WHAT THE NUMBERS ARE NOT:
--   This is a distribution over the clients in OUR book, not over the sector.
--   The register holds ~170,000 charities; we hold a few hundred per sector,
--   selected by import criteria. Every label the app draws from this says
--   "clients on record" and prints the peer count beside the percentile, and the
--   app withholds the percentile entirely below a floor of peers
--   (MIN_PEERS_FOR_PERCENTILE in src/lib/financials/sector-peers.ts).
--
-- Schema change approval record (SOP §7):
--   Change        | Add get_sector_income_distribution(text, uuid, numeric)
--                 | returning one summary row. Add organisations_sector_idx.
--   Reason        | Replaces a ~1,750-row two-round-trip read on every
--                 | Financials tab view with a single six-number aggregate.
--   Compatibility | Additive only. No existing query changes; no column added,
--                 | renamed or dropped, so the Data Model is unchanged.
--   Data migration| None.
--   Security      | SECURITY INVOKER (RLS applies), search_path pinned, active
--                 | user re-checked in the body. EXECUTE revoked from
--                 | public/anon, granted to authenticated.
--   Documentation | docs/rls-permission-matrix.md RPC table updated in the same
--                 | PR.
--   Approved by   | Bashir (Project Leader), 3 Sep 2026.
--
-- Reversibility: paired rollback in
--   ../rollback/20260916090000_create_sector_income_distribution_rpc.down.sql

-- Keeps the peer-set filter off a sequential scan of organisations. Partial:
-- 71% of rows on staging have no sector at all, and none of them are ever a
-- peer set.
create index if not exists organisations_sector_idx
  on public.organisations (sector)
  where sector is not null;

create function public.get_sector_income_distribution(
  p_sector text,
  p_exclude_organisation_id uuid default null,
  p_income numeric default null
)
returns table (
  peer_count bigint,
  min_income numeric,
  p25_income numeric,
  median_income numeric,
  p75_income numeric,
  max_income numeric,
  smaller_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app.is_active_user() then
    raise exception 'your account is not active'
      using errcode = '42501';
  end if;

  return query
  with latest as (
    -- One row per peer: its most recently ended period that carries an income
    -- figure. Not "its most recent period" — the newest return is often a
    -- totals-only filing, and letting that shadow an older real figure would
    -- drop the peer from the distribution entirely.
    select distinct on (fp.organisation_id)
           fp.organisation_id,
           fp.total_income
      from public.financial_periods fp
      join public.organisations o
        on o.id = fp.organisation_id
     where o.sector = p_sector
       and fp.total_income is not null
       -- A negative total income is a filing error. Dropped rather than
       -- clamped: carrying it would drag the strip's minimum somewhere no
       -- charity actually sits.
       and fp.total_income >= 0
       and (p_exclude_organisation_id is null
            or fp.organisation_id <> p_exclude_organisation_id)
     order by fp.organisation_id, fp.period_end desc nulls last, fp.id
  )
  select count(*)::bigint,
         min(l.total_income),
         -- percentile_cont over numeric returns double precision; cast back so
         -- the column types match the source column rather than relying on an
         -- implicit coercion at the return boundary.
         percentile_cont(0.25) within group (order by l.total_income)::numeric,
         percentile_cont(0.5) within group (order by l.total_income)::numeric,
         percentile_cont(0.75) within group (order by l.total_income)::numeric,
         max(l.total_income),
         -- Strictly smaller, so a client tied with every peer reads as "larger
         -- than 0%" rather than "larger than 100%". Ties are common: several of
         -- these charities file identical round figures.
         count(*) filter (
           where p_income is not null and l.total_income < p_income
         )::bigint
    from latest l;
end;
$$;

comment on function public.get_sector_income_distribution(text, uuid, numeric) is
  'Income distribution of the clients on record in one sector: peer count, the '
  'five-number summary of each peer''s latest filed income, and how many file '
  'less than p_income. Read-only, SECURITY INVOKER so RLS applies. Feeds the '
  'Financials tab peer strip. Note this describes OUR book, not the sector — '
  'the caller prints the peer count beside any percentile it derives.';

revoke execute on function public.get_sector_income_distribution(text, uuid, numeric) from public;
revoke execute on function public.get_sector_income_distribution(text, uuid, numeric) from anon;
grant execute on function public.get_sector_income_distribution(text, uuid, numeric) to authenticated;
