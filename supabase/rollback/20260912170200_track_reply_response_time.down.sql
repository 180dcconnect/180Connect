drop trigger if exists reply_events_set_response_time on public.reply_events;
drop function if exists app.set_reply_response_time();
drop index if exists public.reply_events_one_response_time_per_attempt_idx;
alter table public.reply_events drop constraint if exists reply_events_response_time_nonnegative;
alter table public.reply_events drop column if exists response_time_seconds;

