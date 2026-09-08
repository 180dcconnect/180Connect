-- Rollback for: 20260922112000_widen_field_sources_allowlist.sql
--
-- Narrows the allowlist back to its original eight values.
--
-- WILL FAIL if any FIELD_SOURCES row has been written with source
-- 'charity_commission_bulk' or 'website' since the migration was applied — which
-- is the point of the constraint. Delete or re-attribute those rows first, and
-- be aware that doing so discards real provenance.

delete from public.field_sources
 where source in ('charity_commission_bulk', 'website');

alter table public.field_sources
  drop constraint if exists field_sources_source_check;

alter table public.field_sources
  add constraint field_sources_source_check check (
    source in (
      'charitybase', 'companies_house', '360giving', 'find_that_charity',
      'globalgiving', 'candid', 'charity_commission', 'manual'
    )
  );
