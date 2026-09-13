-- Rollback of 20261002091000_create_outreach_cron_health_rpc.
drop function if exists public.get_outreach_cron_health(text[]);
