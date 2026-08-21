-- Rollback: 20260821100000_create_notifications
drop trigger if exists guard_notification_read_state on public.notifications;
drop function if exists public.guard_notification_read_state();
drop policy if exists notifications_update_own_read_state on public.notifications;
drop policy if exists notifications_select_own on public.notifications;
alter publication supabase_realtime drop table public.notifications;
revoke select, update on public.notifications from authenticated;
drop table if exists public.notifications;
