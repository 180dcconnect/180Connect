-- Migration: add_preferred_cities_to_outreach_preferences
-- Sequence step: Addition to OUTREACH_PREFERENCES (F196 Geographic Preference).
-- Story: F196 Geographic Preference (#192)
--
-- SCOPE: Extends OUTREACH_PREFERENCES with preferred_cities text[] to allow CAMs
--   to specify target cities/regions (e.g. Sheffield, Rotherham, Barnsley, Doncaster,
--   Leeds, Manchester) for granular geographic queue prioritisation (F090/F094).
--
-- Schema change approval record (SOP §7):
--   Change        | Add preferred_cities column to OUTREACH_PREFERENCES table
--   Reason        | F196 — CAMs need granular location/city preference settings (#192).
--   Compatibility | Column added with default '{}', non-breaking for existing rows.
--   Data migration| None.
--   Security      | Existing RLS policies on outreach_preferences apply.
--
-- Reversibility: paired rollback in ../rollback/20260818110000_add_preferred_cities_to_outreach_preferences.down.sql

alter table public.outreach_preferences
  add column if not exists preferred_cities text[] not null default '{}';

comment on column public.outreach_preferences.preferred_cities is
  'F196: Specific cities or locations the CAM wants prioritised (e.g. Sheffield, Leeds). '
  'Matched case-insensitively against ORGANISATIONS.city. Empty array means no city preference set.';
