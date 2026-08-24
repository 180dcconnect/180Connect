-- Rollback for 20260828130000_add_notification_frequency_and_followup_timing.sql
-- Reverses F201 and F202 schema additions.

alter table public.outreach_preferences
  drop column if exists first_follow_up_days,
  drop column if exists second_follow_up_days;

alter table public.users
  drop column if exists notification_frequency;

drop type if exists public.notification_frequency;
