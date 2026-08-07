-- Rollback for 20260805110000_create_outreach_preferences.sql
--
-- Drops the F195 outreach preferences table. What this discards: every CAM's saved
-- geography/sector/size preferences. On a re-apply, every CAM starts with no
-- preferences set (empty arrays) — an annoyance, not a correctness issue, since
-- nothing else in the schema references this table yet (F094 is not built).
--
-- Trigger and policies are dropped explicitly ahead of the table so a partial
-- failure cannot leave either naming a table on its way out.

drop trigger if exists outreach_preferences_set_updated_at on public.outreach_preferences;

drop policy if exists outreach_preferences_update_own on public.outreach_preferences;
drop policy if exists outreach_preferences_insert_own on public.outreach_preferences;
drop policy if exists outreach_preferences_select_own on public.outreach_preferences;

drop table if exists public.outreach_preferences;
