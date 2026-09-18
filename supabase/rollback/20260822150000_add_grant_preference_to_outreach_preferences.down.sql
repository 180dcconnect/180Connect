-- Rollback for 20260818120000_add_grant_preference_to_outreach_preferences.sql
-- Reverses F199 Previous Donation/Grant Preference schema changes.

alter table public.outreach_preferences
  drop column if exists prioritise_grant_recipients;
