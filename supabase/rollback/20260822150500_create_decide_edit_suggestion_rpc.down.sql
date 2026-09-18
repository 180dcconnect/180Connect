-- Rollback for 20260822150500_create_decide_edit_suggestion_rpc.sql (#80/#81).
--
-- Drops the RPC. Nothing else to remove: the migration created no tables, columns,
-- grants or policies, and EDIT_SUGGESTIONS (F077) predates it and stays.
--
-- Data loss on rollback: none directly — decided suggestions keep their status rows.
-- What is NOT unwound: values already applied to organisations by an approval stay
-- applied; the audit_log trail records them and is deliberately not rewritten.

drop function if exists public.decide_edit_suggestion(uuid, boolean, text);
