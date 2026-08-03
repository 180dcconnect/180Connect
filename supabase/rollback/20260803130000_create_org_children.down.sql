-- Rollback for 20260803130000_create_org_children.sql
--
-- Drops all six step-4.0 tables and their enums. This discards every note, contact,
-- filing, grant and enrichment record: none of this data exists anywhere else in the
-- schema, and none of it is recoverable afterwards. NOTES in particular is written by
-- hand and cannot be re-ingested — export before running this against any environment
-- where a CAM has used the client detail page.
--
-- Tables drop before the enums that their columns depend on. CASCADE is deliberately
-- not used: if something outside this migration has come to depend on one of these
-- tables, the drop should fail loudly rather than take that dependency with it.

drop table if exists public.notes;
drop table if exists public.enrichment_results;
drop table if exists public.grants;
drop table if exists public.financial_periods;
drop table if exists public.contacts;
drop table if exists public.organisation_identifiers;

drop type if exists public.financial_source;
drop type if exists public.income_band;
drop type if exists public.contact_source;
drop type if exists public.identifier_type;
