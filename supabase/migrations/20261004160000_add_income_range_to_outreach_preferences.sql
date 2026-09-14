-- Migration: add_income_range_to_outreach_preferences
-- Story: F198 — size preference, as a real income range.
--
-- WHAT THIS ADDS:
--   outreach_preferences.preferred_income_min / preferred_income_max — the
--   CAM's preferred annual income range in whole pounds. NULL on either side
--   means "no bound" (min NULL = from £0, max NULL = no upper limit); both NULL
--   is no size preference.
--
-- WHY: size was four fixed bands (public.income_band). The settings screen now
--   picks size on the same range slider as the Charity Commission import
--   (£0 to £5m+, £25k steps). Stored as bands, a choice of "£250k – £2m" would
--   silently widen to "£100k – £1m plus over £1m" and the queue would favour
--   clients the CAM never chose. Clients already carry their filed total income
--   (FINANCIAL_PERIODS.total_income), so a numeric range is matched against the
--   real figure instead (getSizePriorityScore in src/app/clients/visible-clients.ts).
--
-- preferred_income_bands STAYS, and the save action keeps it in step (the bands
--   the range overlaps), so anything still reading bands keeps working at band
--   precision. Retiring it is a later cleanup.
--
-- DATA MIGRATION: existing band choices become the range they cover — lowest
--   chosen band's bottom edge to highest chosen band's top edge (a gap between
--   chosen bands is filled; the settings screen tells the CAM). Rows with no
--   bands are untouched (both NULL).
--
-- SIZE: two bigints per CAM row. Negligible.
--
-- Schema change approval record (SOP §7):
--   Change        | Add preferred_income_min, preferred_income_max (bigint,
--                 | nullable, >= 0, max > min when both set) to
--                 | outreach_preferences; backfill from preferred_income_bands.
--   Reason        | Granular size preference on a range slider, matched against
--                 | real filed income.
--   Compatibility | Additive. preferred_income_bands kept and still written.
--   Data migration| Bands → covering range, in this migration.
--   Security      | No policy change. The table's existing grant (select,
--                 | insert, update to authenticated, 20260805110000) and
--                 | own-row policies cover the new columns.
--   Documentation | Data Model OUTREACH_PREFERENCES tab needs both columns.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004160000_add_income_range_to_outreach_preferences.down.sql

-- Re-runnable: every statement is safe to apply twice (columns `if not exists`,
-- the table constraint dropped first, the backfill idempotent), so the SQL can be
-- applied to staging ahead of the migration history without breaking the later
-- recorded run.
alter table public.outreach_preferences
  add column if not exists preferred_income_min bigint
    constraint outreach_preferences_income_min_non_negative
    check (preferred_income_min is null or preferred_income_min >= 0),
  add column if not exists preferred_income_max bigint
    constraint outreach_preferences_income_max_non_negative
    check (preferred_income_max is null or preferred_income_max >= 0);

alter table public.outreach_preferences
  drop constraint if exists outreach_preferences_income_range_ordered;

alter table public.outreach_preferences
  add constraint outreach_preferences_income_range_ordered
    check (
      preferred_income_min is null
      or preferred_income_max is null
      or preferred_income_max > preferred_income_min
    );

comment on column public.outreach_preferences.preferred_income_min is
  'F198: bottom of the preferred annual income range, whole pounds. NULL = from £0.';
comment on column public.outreach_preferences.preferred_income_max is
  'F198: top of the preferred annual income range, whole pounds. NULL = no upper limit.';

update public.outreach_preferences
set
  preferred_income_min = case
    when 'under_10k'::public.income_band = any (preferred_income_bands) then null
    when '10k_100k'::public.income_band = any (preferred_income_bands) then 10000
    when '100k_1m'::public.income_band = any (preferred_income_bands) then 100000
    else 1000000
  end,
  preferred_income_max = case
    when 'over_1m'::public.income_band = any (preferred_income_bands) then null
    when '100k_1m'::public.income_band = any (preferred_income_bands) then 1000000
    when '10k_100k'::public.income_band = any (preferred_income_bands) then 100000
    else 10000
  end
where cardinality(preferred_income_bands) > 0;
