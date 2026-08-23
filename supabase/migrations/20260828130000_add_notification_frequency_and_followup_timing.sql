-- Migration: add_notification_frequency_and_followup_timing
-- Sequence step: Addition to USERS (F201) and OUTREACH_PREFERENCES (F202).
-- Stories:
--   - F201: Notification Frequency (#196)
--   - F202: Follow-Up Timing Settings (#197)
--
-- SCOPE:
--   1. Extends USERS with notification_frequency enum ('immediate', 'daily', 'weekly')
--      to allow users to control delivery frequency in Account Settings (F201/F178).
--   2. Extends OUTREACH_PREFERENCES with first_follow_up_days and second_follow_up_days
--      integers to allow CAMs to configure personal reminder timing thresholds (F202/F161).
--
-- Schema change approval record (SOP §7):
--   Change        | Add notification_frequency to USERS; add first_follow_up_days & second_follow_up_days to OUTREACH_PREFERENCES
--   Reason        | F201 & F202 — User notification delivery settings & CAM follow-up cadence settings.
--   Compatibility | Columns added with safe defaults ('immediate', 7, 14), non-breaking.
--   Data migration| None.
--   Security      | Grants update (notification_frequency) to authenticated on users. Existing RLS policies apply.
--   Documentation | Data Model tab 04 + tab 02.
--
-- Reversibility: paired rollback in ../rollback/20260828130000_add_notification_frequency_and_followup_timing.down.sql

-- 1. F201: Notification Frequency
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_frequency') then
    create type public.notification_frequency as enum ('immediate', 'daily', 'weekly');
  end if;
end $$;

alter table public.users
  add column if not exists notification_frequency public.notification_frequency not null default 'immediate';

comment on column public.users.notification_frequency is
  'F201: Preferred notification delivery cadence (immediate, daily, weekly). Configured in Account Settings.';

-- Grant update on notification_frequency column to authenticated users (users_update_self_or_admin policy applies)
grant update (notification_frequency) on public.users to authenticated;

-- 2. F202: Follow-Up Timing Settings
alter table public.outreach_preferences
  add column if not exists first_follow_up_days integer not null default 7 check (first_follow_up_days > 0 and first_follow_up_days <= 60),
  add column if not exists second_follow_up_days integer not null default 14 check (second_follow_up_days > 0 and second_follow_up_days <= 90);

comment on column public.outreach_preferences.first_follow_up_days is
  'F202: Number of days before the first follow-up reminder is recommended (F160/F161). Default 7 days.';
comment on column public.outreach_preferences.second_follow_up_days is
  'F202: Number of days before the second follow-up reminder is recommended (F160/F161). Default 14 days.';
