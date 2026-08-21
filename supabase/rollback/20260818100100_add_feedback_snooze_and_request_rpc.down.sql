-- Rollback: 20260818100100_add_feedback_snooze_and_request_rpc
drop function if exists public.request_feedback_round();
drop function if exists public.snooze_feedback(integer);
alter table public.users drop column if exists feedback_snoozed_until;
