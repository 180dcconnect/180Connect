-- Rollback: 20260912180000_create_outreach_daily_send_limit
-- Reverses F128 Sending Limit Protection migration.

drop function if exists public.set_outreach_daily_send_limit(integer);
drop table if exists public.outreach_daily_send_limit;
