-- Rollback of 20260903140000_create_send_failure_handling.sql.
-- Drops the two F129 RPCs.
--
-- NOTE: the 'failed' value added to public.send_event_type cannot be removed
-- in Postgres without rebuilding the type and every dependent column. It is
-- harmless to keep (no code writes it once these functions are gone), so the
-- rollback deliberately leaves it in place.

drop function if exists public.reopen_outreach_draft(uuid);
drop function if exists public.mark_outreach_send_failed(uuid, text);
