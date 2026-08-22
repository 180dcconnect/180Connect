-- Rollback for 20260822090000_create_edit_suggestions.sql (#79, F077).
--
-- Drops the RPC, then the table, then the enum — reverse creation order, so the enum
-- has no dependants left when it goes. Nothing else referenced either: F078/F079
-- (decide paths) do not exist yet by design.
--
-- Data loss on rollback: every submitted suggestion and its supersede history. No live
-- client data is affected — suggest_organisation_edit never wrote to organisations.

drop function if exists public.suggest_organisation_edit(uuid, text, text);

drop table if exists public.edit_suggestions;

drop type if exists public.edit_suggestion_status;
