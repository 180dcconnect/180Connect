-- Rollback for 20260819100000_allow_admin_read_outreach_preferences.sql
-- Removes admin SELECT policy on public.outreach_preferences, restoring own-row-only reads.

drop policy if exists outreach_preferences_select_admin on public.outreach_preferences;
