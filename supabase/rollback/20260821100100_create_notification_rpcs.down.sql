-- Rollback for: 20260821100100_create_notification_rpcs.sql
-- Unschedule the prune job BEFORE dropping its function.

select cron.unschedule('notifications_prune_daily');

drop function if exists public.prune_notifications();
drop function if exists public.mark_all_notifications_read();
drop function if exists public.mark_notification_read(uuid);
drop function if exists public.create_notification(uuid, text, text, text, text, text, uuid, uuid);
