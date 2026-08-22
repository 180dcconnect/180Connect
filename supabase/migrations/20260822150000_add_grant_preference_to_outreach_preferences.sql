-- Migration: add_grant_preference_to_outreach_preferences
-- Sequence step: Addition to OUTREACH_PREFERENCES (F199 Previous Donation/Grant Preference).
-- Story: F199 Previous Donation/Grant Preference (#346)
--
-- SCOPE: Extends OUTREACH_PREFERENCES with prioritise_grant_recipients boolean to allow
--   CAMs to configure funding & grant history preferences (sourced from 360Giving grant
--   awards) for personalised queue prioritisation (F092/F094).
--
-- Schema change approval record (SOP §7):
--   Change        | Add prioritise_grant_recipients column to OUTREACH_PREFERENCES table
--   Reason        | F199 — CAMs need funding/grant history preference settings (#346).
--   Compatibility | Column added with default false, non-breaking for existing rows.
--   Data migration| None.
--   Security      | Existing RLS policies on outreach_preferences apply.
--   Documentation | Data Model tab 04 + tab 02.
--
-- Reversibility: paired rollback in ../rollback/20260822150000_add_grant_preference_to_outreach_preferences.down.sql
--
-- Re-dated from 20260818120000 before merging: dev had already applied
-- 20260818120000_create_ownership_requests.sql and later migrations (including
-- 20260822140000, which this was briefly dated to), and a migration's timestamp
-- must be later than everything already on dev (SOP §7).

alter table public.outreach_preferences
  add column if not exists prioritise_grant_recipients boolean not null default false;

comment on column public.outreach_preferences.prioritise_grant_recipients is
  'F199: Whether the CAM wants organisations with recorded grant/funding history (360Giving) '
  'prioritised in their personal queue (F092/F094). Default false (no grant preference).';
