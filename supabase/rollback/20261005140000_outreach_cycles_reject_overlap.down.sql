-- Rollback of 20261005140000_outreach_cycles_reject_overlap.
--
-- Drops the trigger and the function. No data is touched: the migration never
-- wrote a row, and every cycle that exists is one the app created under its own
-- pre-check.
--
-- What reverting costs: the app-level check in createCycle/updateCycle becomes
-- the whole enforcement again, so two admins saving at the same moment can store
-- overlapping ranges and every event in the overlap is counted in both
-- comparisons. Re-apply the migration rather than living with that.

drop trigger if exists outreach_cycles_reject_overlap on public.outreach_cycles;

drop function if exists app.outreach_cycles_reject_overlap();
