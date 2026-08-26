-- Rollback of 20260902120000_scheduled_outreach_safety.sql.
-- No schema change to reverse — drop the two F126 RPCs.

drop function if exists public.cancel_outreach_schedule(uuid);
drop function if exists public.schedule_outreach_send(uuid, timestamptz);
