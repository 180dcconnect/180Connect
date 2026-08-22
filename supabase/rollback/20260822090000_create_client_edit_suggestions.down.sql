-- Rollback for 20260822090000_create_client_edit_suggestions.sql (F077, #79).
--
-- Drops the RPC, then the table, then the enum — reverse creation order, so the
-- enum has no dependants left when it goes.
--
-- Data loss on rollback: every pending (or, once F078/F079 exist, decided) client
-- edit suggestion. Nothing on ORGANISATIONS is reverted — a suggestion never wrote
-- to it in the first place, which is the whole point of the table.

drop function if exists public.suggest_client_edit(uuid, text, text, text);

drop table if exists public.client_edit_suggestions;

drop type if exists public.client_edit_suggestion_status;
