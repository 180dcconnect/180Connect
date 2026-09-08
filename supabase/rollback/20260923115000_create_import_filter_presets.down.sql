-- Rollback for: 20260923115000_create_import_filter_presets.sql
--
-- Destructive: drops every saved filter set. These are the team's own work — a
-- cycle's criteria, named and kept — and are not recoverable from anything else,
-- unlike the register itself which rebuilds from the regulator's files.

drop table if exists public.import_filter_presets;
