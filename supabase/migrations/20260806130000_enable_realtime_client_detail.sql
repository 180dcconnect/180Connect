-- F068: View Client Basic Info AC3 needs the client detail page to reflect a
-- basic-info change (e.g. an approved edit suggestion, F078) immediately, without
-- a manual refresh — same requirement F011 already solved for the admin team
-- list (20260805120000_enable_realtime_users.sql). Supabase only broadcasts row
-- changes for tables added to the `supabase_realtime` publication, so both source
-- tables for the basic-info section need adding explicitly.
--
-- RLS still governs what each subscriber actually receives:
--   - organisations_select_active (20260722103000_create_organisations.sql) already
--     lets any active authenticated user read every row.
--   - enrichment_results_select_active (20260804180000_create_org_children.sql)
--     does the same for enrichment_results.
-- Neither policy is widened by this migration; it only turns on broadcast of
-- changes those policies already allow to be read.
alter publication supabase_realtime add table public.organisations;
alter publication supabase_realtime add table public.enrichment_results;
