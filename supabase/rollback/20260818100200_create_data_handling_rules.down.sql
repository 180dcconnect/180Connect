<<<<<<<< HEAD:supabase/rollback/20260817130000_create_data_handling_rules.down.sql
-- Rollback: 20260817130000_create_data_handling_rules
========
-- Rollback: 20260818100200_create_data_handling_rules
>>>>>>>> origin/dev:supabase/rollback/20260818100200_create_data_handling_rules.down.sql
-- Reverses F246 Public Data Handling Rules migration.

-- Drop RPCs first (depend on the table)
drop function if exists public.data_handling_coverage();
drop function if exists public.data_handling_filter_summary();
drop function if exists public.set_data_handling_rule_active(uuid, boolean, text);
drop function if exists public.create_data_handling_rule(text, text, text, text);

-- Remove columns added to raw_source_records
alter table public.raw_source_records
  drop column if exists excluded_fields,
  drop column if exists rule_version_applied;

-- Drop tables
drop table if exists public.data_handling_rules;
drop table if exists public.data_handling_rule_versions;
