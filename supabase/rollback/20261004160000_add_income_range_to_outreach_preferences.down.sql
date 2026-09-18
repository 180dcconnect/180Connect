-- Rollback for 20261004160000_add_income_range_to_outreach_preferences.sql (F198).
--
-- Drops the income range columns. Data loss: each CAM's exact range. Their
-- preferred_income_bands (kept in step by the save action) survive, so their
-- queue falls back to band precision rather than to no size preference. Roll
-- the code back too — the settings screen and queue scoring read these columns.

alter table public.outreach_preferences
  drop constraint if exists outreach_preferences_income_range_ordered,
  drop column if exists preferred_income_min,
  drop column if exists preferred_income_max;
