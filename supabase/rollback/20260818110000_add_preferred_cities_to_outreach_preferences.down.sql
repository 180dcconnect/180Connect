-- Rollback for 20260818110000_add_preferred_cities_to_outreach_preferences.sql

alter table public.outreach_preferences
  drop column if exists preferred_cities;
