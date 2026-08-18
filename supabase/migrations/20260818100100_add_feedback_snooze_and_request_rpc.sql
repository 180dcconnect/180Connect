-- Migration: add_feedback_snooze_and_request_rpc
-- Story: In-app feedback — periodic prompting + admin request-feedback toggle.
--
-- Adds feedback_snoozed_until to USERS so the prompt re-appears on a cadence
-- rather than asking once and disappearing forever:
--   • Submit → snoozed for 60 days
--   • Dismiss → snoozed for 30 days
--   • Admin clicks "Request feedback" → snooze cleared for all active users
--
-- Two RPCs:
--   1. snooze_feedback(p_days) — called by the submit/dismiss Server Actions,
--      writes only the caller's own row. SECURITY DEFINER because
--      feedback_snoozed_until is not directly grantable.
--   2. request_feedback_round() — admin-only, clears the snooze for everyone
--      so the prompt immediately re-appears on every user's dashboard.
--
-- Not audited: the snooze is a UI-preference-level write, not an ownership or
-- status change (docs/audit-log-pattern.md §1). The admin toggle is a bulk
-- UI reset, not an approval action. The feedback table itself is the record.
--
-- Reversibility: paired rollback in
--   ../rollback/20260818100100_add_feedback_snooze_and_request_rpc.down.sql

-- Column: snoozed-until for periodic re-prompting
alter table public.users
  add column feedback_snoozed_until timestamptz;

comment on column public.users.feedback_snoozed_until is
  'When set and in the future, the feedback prompt is hidden for this user. '
  'Cleared by the admin request_feedback_round RPC.';

-- RPC 1: snooze feedback for the caller
create or replace function public.snooze_feedback(p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_days < 0 then
    raise exception 'p_days must be non-negative';
  end if;

  update public.users
  set feedback_snoozed_until = now() + (p_days || ' days')::interval
  where id = (select auth.uid());
end;
$$;

comment on function public.snooze_feedback(integer) is
  'Sets feedback_snoozed_until for the calling user. SECURITY DEFINER because '
  'the column has no direct grant. Not audited — UI preference, not a state change.';

revoke execute on function public.snooze_feedback(integer) from public;
revoke execute on function public.snooze_feedback(integer) from anon;
grant execute on function public.snooze_feedback(integer) to authenticated;

-- RPC 2: admin triggers a feedback round for all active users
create or replace function public.request_feedback_round()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Re-check admin inside the function (SECURITY DEFINER bypasses RLS)
  if not app.is_admin() then
    raise exception 'Only administrators can request a feedback round';
  end if;

  update public.users
  set feedback_snoozed_until = null
  where is_active = true;
end;
$$;

comment on function public.request_feedback_round() is
  'Admin-only: clears feedback_snoozed_until for every active user, so the '
  'in-app feedback prompt re-appears on their next dashboard visit.';

revoke execute on function public.request_feedback_round() from public;
revoke execute on function public.request_feedback_round() from anon;
grant execute on function public.request_feedback_round() to authenticated;
