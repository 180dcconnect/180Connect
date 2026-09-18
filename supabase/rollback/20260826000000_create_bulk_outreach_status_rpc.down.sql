-- Reverses 20260826000000_create_bulk_outreach_status_rpc.sql (F064).
--
-- The migration is purely additive — one new function, no table, column, enum or
-- grant changes — so dropping the function restores the previous state exactly.
-- The single-client path (set_outreach_status, F145) is untouched by both files,
-- so /clients/[id] keeps working after a rollback; only the bulk bar on the list
-- stops, which is the intent.
--
-- audit_log rows already written by the function are deliberately left in place:
-- they record changes that really happened, and an audit trail that can be
-- deleted by rolling back a migration is not an audit trail.

drop function if exists public.set_outreach_status_bulk(uuid[], public.outreach_status);
