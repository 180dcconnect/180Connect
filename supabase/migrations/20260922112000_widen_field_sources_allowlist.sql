-- Migration: widen_field_sources_allowlist
-- Story: per-field provenance was silently missing for every bulk-imported charity.
--
-- THE BUG
--
-- FIELD_SOURCES.source has a CHECK constraint listing eight allowed values, and
-- record_field_source() re-checks the same eight in its body. Two real sources
-- were never added to either list:
--
--   charity_commission_bulk  — every charity imported from the register
--   website                  — F037's manual URL import
--
-- So `record_field_sources` raised 22023 ("unknown field source") for all of
-- them. The call is best-effort by design (a failed annotation must not fail an
-- import that is already committed), so nothing broke visibly: the error was
-- logged and 793 charities on staging got no per-field provenance at all.
--
-- This migration fixes the constraint. The matching list inside
-- record_field_source() is fixed in 20260922104000, which recreates that
-- function — the two must stay identical, and the function's comment says so.
--
-- WHY NOT DERIVE THE LIST FROM data_source_name
--
-- Tempting, since that domain already holds both missing values. But
-- FIELD_SOURCES also accepts 'manual', which is not a data source and must never
-- become one, so the sets are genuinely different: this is data_source_name plus
-- 'manual'. Deriving it would either admit 'manual' to the domain or need a
-- lookup table for a list of nine strings.
--
-- Schema change approval record (SOP §7):
--   Change        | Replace field_sources_source_check with a list that also
--                 | accepts 'charity_commission_bulk' and 'website'.
--   Reason        | Both are existing sources that write organisations; their
--                 | provenance rows were being rejected.
--   Compatibility | Widening only. Every value that was valid stays valid, so no
--                 | existing row can violate the new constraint.
--   Data migration| None. Provenance for charities imported before this is not
--                 | backfilled — the values were never recorded, and inventing
--                 | them now would attribute fields to a source on no evidence.
--                 | Re-importing a charity records it correctly from then on.
--   Security      | No RLS or grant change.
--   Documentation | Data Model tab "04 Entities" lists FIELD_SOURCES.source's
--                 | allowed values — add both, then npm run export:data-model.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260922112000_widen_field_sources_allowlist.down.sql

alter table public.field_sources
  drop constraint if exists field_sources_source_check;

alter table public.field_sources
  add constraint field_sources_source_check check (
    source in (
      'charitybase', 'companies_house', '360giving', 'find_that_charity',
      'globalgiving', 'candid', 'charity_commission', 'charity_commission_bulk',
      'website', 'manual'
    )
  );

comment on column public.field_sources.source is
  'Which source produced this value. data_source_name''s values plus ''manual'' '
  '(a person typed it). Kept identical to the list inside record_field_source() — '
  'a value missing from either is rejected at write time, and because the write '
  'is best-effort that shows up as absent provenance rather than a failure.';
