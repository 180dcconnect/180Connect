-- Rollback: widen_audit_log_for_client_timeline

alter publication supabase_realtime drop table public.audit_log;
alter publication supabase_realtime drop table public.reply_events;
alter publication supabase_realtime drop table public.outreach_messages;
alter publication supabase_realtime drop table public.notes;

drop policy if exists audit_log_select_client_timeline on public.audit_log;
