-- Rollback of 20260927090100_create_outreach_cron_health_rpc.
drop function if exists public.get_outreach_cron_health(text[]);
