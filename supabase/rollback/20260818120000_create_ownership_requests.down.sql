-- Rollback for 20260818120000_create_ownership_requests.sql (#408).
--
-- Drops the two RPCs, then the table, then the enum — reverse creation order, so the
-- enum has no dependants left when it goes. Nothing else referenced either function,
-- and reassign_ownership (which decide_ownership_request called) is untouched: it
-- predates this migration and is used by F163/F164/F253.
--
-- Data loss on rollback: every ownership request and its decision history. Ownership
-- itself is not reverted — an approved handover already moved the client through
-- reassign_ownership and is recorded in audit_log, which this does not unwind.

drop function if exists public.decide_ownership_request(uuid, boolean, text);
drop function if exists public.request_client_ownership(uuid, text);

drop table if exists public.ownership_requests;

drop type if exists public.ownership_request_status;
